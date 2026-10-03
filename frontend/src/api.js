/**
 * Thin wrapper around the Django REST API.
 *
 * In development the Vite proxy forwards `/api/*` to Django, so `API_BASE` can
 * stay empty. In production set `VITE_API_BASE_URL` to the deployed API origin.
 */
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')

export const API_ORIGIN = API_BASE

async function request(path, options = {}) {
  let response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    })
  } catch (networkError) {
    throw new Error(
      'Could not reach the API. Make sure the Django server is running (python manage.py runserver).',
    )
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
  // DRF field errors: { field: ["message", ...] }
  const firstField = Object.keys(data)[0]
  if (firstField && Array.isArray(data[firstField])) {
    return `${firstField}: ${data[firstField].join(' ')}`
  }
  return null
}

export function planTrip(payload, { persist = true } = {}) {
  const path = persist ? '/api/trips/' : '/api/trips/plan/'
  return request(path, { method: 'POST', body: JSON.stringify(payload) })
}

export function listTrips() {
  return request('/api/trips/')
}

export async function getTrip(id) {
  const data = await request(`/api/trips/${id}/`)
  if (data && data.result) {
    return {
      ...data.result,
      id: data.id,
      created_at: data.created_at,
    }
  }
  return data
}

export function deleteTrip(id) {
  return request(`/api/trips/${id}/`, { method: 'DELETE' })
}

export function suggestLocations(query) {
  const q = encodeURIComponent(query || '')
  return request(`/api/trips/suggest/?q=${q}`)
}

export function checkHealth() {
  return request('/api/health/')
}

