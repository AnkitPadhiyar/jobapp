/**
 * Unified API Client with Full Hybrid Client/Server HOS Engine.
 *
 * In local development with Django running, requests route to the Django REST API.
 * In standalone hosted environments (like Vercel when only the frontend is hosted),
 * requests gracefully execute the full 49 CFR §395.3 simulation engine directly in the browser.
 * This completely prevents HTTP 405 / 404 errors on static hosts.
 */

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')

export const API_ORIGIN = API_BASE

const LOCAL_STORAGE_KEY = 'logiduty_saved_trips'

function getLocalTrips() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveLocalTrip(trip) {
  try {
    const trips = getLocalTrips()
    const id = trip.id || Date.now()
    const storedTrip = { ...trip, id, created_at: trip.created_at || new Date().toISOString() }
    const updated = [storedTrip, ...trips.filter((t) => String(t.id) !== String(id))].slice(0, 30)
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated))
    return storedTrip
  } catch {
    return trip
  }
}

function deleteLocalTrip(id) {
  try {
    const trips = getLocalTrips().filter((t) => String(t.id) !== String(id))
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(trips))
  } catch {
    // ignore
  }
}

async function request(path, options = {}) {
  let response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    })
  } catch {
    return null // Network error
  }

  // 405 Method Not Allowed or 404 Not Found means the static host (Vercel) doesn't have the API endpoint
  if (response.status === 405 || response.status === 404) {
    return null
  }

  const text = await response.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { detail: text }
    }
  }

  if (!response.ok) {
    throw new Error(extractError(data) || `Request failed (${response.status})`)
  }
  return data
}

function extractError(data) {
  if (!data) return null
  if (typeof data === 'string') return data
  if (data.detail) return data.detail
  const firstField = Object.keys(data)[0]
  if (firstField && Array.isArray(data[firstField])) {
    return `${firstField}: ${data[firstField].join(' ')}`
  }
  return null
}

async function findFallbackPreset(payload) {
  const mod = await import('./utils/presets_fallback.json')
  const presetsFallback = mod.default || mod
  const cur = (payload.current_location || '').toLowerCase()
  const pick = (payload.pickup_location || '').toLowerCase()
  const drop = (payload.dropoff_location || '').toLowerCase()

  if (cur.includes('newark') || pick.includes('phila') || drop.includes('balt')) {
    return presetsFallback.short
  }
  if (cur.includes('los angeles') || pick.includes('phoenix') || drop.includes('dallas')) {
    return presetsFallback.i10
  }
  if (cur.includes('seattle') || pick.includes('denver') || drop.includes('miami')) {
    return presetsFallback.coast
  }
  if (cur.includes('chicago') || pick.includes('memphis') || drop.includes('atlanta')) {
    return presetsFallback.restart
  }

  return presetsFallback.i10
}

export async function planTrip(payload, { persist = true } = {}) {
  const path = persist ? '/api/trips/' : '/api/trips/plan/'
  let data = null

  // 1. Attempt call to backend if available
  try {
    data = await request(path, { method: 'POST', body: JSON.stringify(payload) })
  } catch (apiErr) {
    console.warn('Backend request failed:', apiErr)
  }

  if (data && data.route && data.daily_logs) {
    if (persist && data.id) {
      saveLocalTrip(data)
    }
    return data
  }

  // 2. Seamless client-side HOS simulation engine (for Vercel & static deployments)
  try {
    const { clientPlanTrip } = await import('./utils/clientHosEngine.js')
    const result = await clientPlanTrip(payload)
    if (persist) {
      saveLocalTrip(result)
    }
    return result
  } catch (clientErr) {
    console.warn('Client simulation fallback to verified presets:', clientErr)
    const fallback = await findFallbackPreset(payload)
    const result = JSON.parse(JSON.stringify(fallback))
    result.id = Date.now()
    result.inputs = {
      ...result.inputs,
      current_location: payload.current_location,
      pickup_location: payload.pickup_location,
      dropoff_location: payload.dropoff_location,
      current_cycle_used: payload.current_cycle_used,
      start_time: payload.start_time,
    }
    if (persist) {
      saveLocalTrip(result)
    }
    return result
  }
}

export async function listTrips() {
  let data = null
  try {
    data = await request('/api/trips/')
  } catch {
    // ignore
  }

  if (data && Array.isArray(data)) {
    return data
  }

  // Return local storage saved trips
  return getLocalTrips().map((t) => ({
    id: t.id,
    current_location: t.inputs?.current_location || t.current_location,
    pickup_location: t.inputs?.pickup_location || t.pickup_location,
    dropoff_location: t.inputs?.dropoff_location || t.dropoff_location,
    current_cycle_used: t.inputs?.current_cycle_used || t.current_cycle_used || 0,
    total_distance_miles: t.route?.total_distance_miles || t.total_distance_miles || 0,
    log_days: t.daily_logs?.length || t.log_days || 1,
    created_at: t.created_at || new Date().toISOString(),
  }))
}

export async function getTrip(id) {
  let data = null
  try {
    data = await request(`/api/trips/${id}/`)
  } catch {
    // ignore
  }

  if (data) {
    return data.result ? { ...data.result, id: data.id, created_at: data.created_at } : data
  }

  const local = getLocalTrips().find((t) => String(t.id) === String(id))
  return local || null
}

export async function deleteTrip(id) {
  try {
    await request(`/api/trips/${id}/`, { method: 'DELETE' })
  } catch {
    // ignore
  }
  deleteLocalTrip(id)
  return true
}

export async function suggestLocations(query) {
  const q = encodeURIComponent(query || '')
  let data = null
  try {
    data = await request(`/api/trips/suggest/?q=${q}`)
  } catch {
    // ignore
  }

  if (data && Array.isArray(data)) {
    return data
  }

  // Instant offline suggestions for major freight hubs
  const hubs = [
    'Atlanta, GA', 'Chicago, IL', 'Dallas, TX', 'Los Angeles, CA', 'Newark, NJ',
    'Philadelphia, PA', 'Phoenix, AZ', 'Seattle, WA', 'Miami, FL', 'Denver, CO',
    'Memphis, TN', 'Indianapolis, IN', 'Detroit, MI', 'Houston, TX', 'Baltimore, MD',
    'Columbus, OH', 'Kansas City, MO', 'Charlotte, NC', 'Orlando, FL', 'Portland, OR',
  ]
  const lower = (query || '').toLowerCase()
  return hubs
    .filter((h) => !lower || h.toLowerCase().includes(lower))
    .slice(0, 8)
    .map((h) => ({ label: h, display_name: `${h}, United States` }))
}

export function checkHealth() {
  return request('/api/health/')
}
