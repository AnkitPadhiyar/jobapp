/**
 * Client-side Hours-of-Service (HOS) Engine & Route Planner.
 *
 * Implements the full 49 CFR §395.3 simulation and OSRM routing in pure JavaScript.
 * Runs seamlessly in the browser whenever the backend is unreachable or when deployed
 * as a standalone web app on static hosts like Vercel.
 */

const MAX_DRIVE_PER_SHIFT_HOURS = 11.0
const MAX_DUTY_WINDOW_HOURS = 14.0
const BREAK_AFTER_DRIVE_HOURS = 8.0
const BREAK_DURATION_HOURS = 0.5
const FULL_RESET_HOURS = 10.0
const CYCLE_LIMIT_HOURS = 70.0
const CYCLE_RESTART_HOURS = 34.0
const FUEL_INTERVAL_MILES = 1000.0
const FUEL_DURATION_HOURS = 0.5
const PICKUP_DURATION_HOURS = 1.0
const DROPOFF_DURATION_HOURS = 1.0
const DEFAULT_SPEED_MPH = 55.0

const OFF_DUTY = 'off_duty'
const SLEEPER = 'sleeper'
const DRIVING = 'driving'
const ON_DUTY = 'on_duty'
const DUTY_STATUSES = [OFF_DUTY, SLEEPER, DRIVING, ON_DUTY]

const STATUS_LABELS = {
  off_duty: 'Off Duty',
  sleeper: 'Sleeper Berth',
  driving: 'Driving',
  on_duty: 'On-Duty (Not Driving)',
}

const EPSILON = 1e-6
const SECONDS_PER_HOUR = 3600.0

const OFFLINE_GAZETTEER = {
  'new york': [40.7128, -74.006],
  newark: [40.7357, -74.1724],
  philadelphia: [39.9526, -75.1652],
  baltimore: [39.2904, -76.6122],
  washington: [38.9072, -77.0369],
  richmond: [37.5407, -77.436],
  charlotte: [35.2271, -80.8431],
  atlanta: [33.749, -84.388],
  jacksonville: [30.3322, -81.6557],
  orlando: [28.5383, -81.3792],
  tampa: [27.9506, -82.4572],
  miami: [25.7617, -80.1918],
  chicago: [41.8781, -87.6298],
  indianapolis: [39.7684, -86.1581],
  columbus: [39.9612, -82.9988],
  nashville: [36.1627, -86.7816],
  memphis: [35.1495, -90.049],
  'st. louis': [38.627, -90.1994],
  dallas: [32.7767, -96.797],
  'fort worth': [32.7555, -97.3308],
  houston: [29.7604, -95.3698],
  'san antonio': [29.4241, -98.4936],
  austin: [30.2672, -97.7431],
  'el paso': [31.7619, -106.485],
  denver: [39.7392, -104.9903],
  'kansas city': [39.0997, -94.5786],
  omaha: [41.2565, -95.9345],
  minneapolis: [44.9778, -93.265],
  milwaukee: [43.0389, -87.9065],
  detroit: [42.3314, -83.0458],
  cleveland: [41.4993, -81.6944],
  pittsburgh: [40.4406, -79.9959],
  boston: [42.3601, -71.0589],
  phoenix: [33.4484, -112.074],
  tucson: [32.2226, -110.9747],
  albuquerque: [35.0844, -106.6504],
  'salt lake city': [40.7608, -111.891],
  'las vegas': [36.1699, -115.1398],
  'los angeles': [34.0522, -118.2437],
  ontario: [34.0633, -117.6509],
  'long beach': [33.7701, -118.1937],
  'san diego': [32.7157, -117.1611],
  'san francisco': [37.7749, -122.4194],
  'san jose': [37.3382, -121.8863],
  sacramento: [38.5816, -121.4944],
  portland: [45.5152, -122.6784],
  seattle: [47.6062, -122.3321],
  spokane: [47.6588, -117.426],
  boise: [43.615, -116.2023],
  'oklahoma city': [35.4676, -97.5164],
  tulsa: [36.154, -95.9928],
  'new orleans': [29.9511, -90.0715],
  louisville: [38.2527, -85.7585],
  cincinnati: [39.1031, -84.512],
  buffalo: [42.8864, -78.8784],
  reno: [39.5296, -119.8138],
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.7613
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1.0, Math.sqrt(a)))
}

class RouteGeometry {
  constructor(geometry, totalMiles) {
    this.geometry = (geometry || []).map(([lat, lng]) => [Number(lat), Number(lng)])
    this.cumulative = [0.0]
    for (let i = 0; i < this.geometry.length - 1; i++) {
      const [lat1, lng1] = this.geometry[i]
      const [lat2, lng2] = this.geometry[i + 1]
      this.cumulative.push(this.cumulative[this.cumulative.length - 1] + haversineMiles(lat1, lng1, lat2, lng2))
    }
    this.lineMiles = this.cumulative[this.cumulative.length - 1] || 0.0
    this.totalMiles = Number(totalMiles) || this.lineMiles
  }

  pointAt(miles) {
    if (!this.geometry.length) return [0, 0]
    let target = Math.max(0, Math.min(Number(miles), this.totalMiles))
    if (this.lineMiles > 0 && this.totalMiles > 0) {
      target = (target / this.totalMiles) * this.lineMiles
    }
    let lo = 0
    let hi = this.cumulative.length - 1
    while (lo < hi - 1) {
      const mid = Math.floor((lo + hi) / 2)
      if (this.cumulative[mid] <= target) lo = mid
      else hi = mid
    }
    const span = this.cumulative[hi] - this.cumulative[lo]
    const ratio = span <= 0 ? 0 : (target - this.cumulative[lo]) / span
    const [lat1, lng1] = this.geometry[lo]
    const [lat2, lng2] = this.geometry[hi]
    return [lat1 + (lat2 - lat1) * ratio, lng1 + (lng2 - lng1) * ratio]
  }
}

export async function clientGeocode(query) {
  const q = (query || '').trim()
  const lower = q.toLowerCase()

  // 1. Check local gazetteer first for instant hit
  for (const [name, [lat, lng]] of Object.entries(OFFLINE_GAZETTEER)) {
    if (lower.includes(name)) {
      return {
        label: q,
        display_name: `${q}, United States`,
        lat,
        lng,
        source: 'gazetteer',
      }
    }
  }

  // 2. Query Photon API (supports CORS)
  try {
    const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=3&lang=en`)
    if (res.ok) {
      const json = await res.json()
      const features = json.features || []
      const usMatch = features.find((f) => f.properties?.countrycode === 'US') || features[0]
      if (usMatch) {
        const [lng, lat] = usMatch.geometry.coordinates
        const p = usMatch.properties || {}
        const display = [p.name || p.city, p.state, p.country].filter(Boolean).join(', ')
        return {
          label: q,
          display_name: display || q,
          lat: Number(lat),
          lng: Number(lng),
          source: 'photon',
        }
      }
    }
  } catch {
    // ignore
  }

  // Default coordinate if completely unknown (center of US)
  return {
    label: q,
    display_name: `${q}, USA`,
    lat: 39.8283,
    lng: -98.5795,
    source: 'default',
  }
}

export async function clientRoute(origin, destination) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`
    const res = await fetch(url)
    if (res.ok) {
      const data = await res.json()
      if (data.routes && data.routes[0]) {
        const r = data.routes[0]
        const miles = r.distance / 1609.344
        const hours = r.duration / 3600.0
        const geom = r.geometry.coordinates.map(([lng, lat]) => [lat, lng])
        return {
          distance_miles: Math.round(miles * 100) / 100,
          duration_hours: Math.round(hours * 10000) / 10000,
          geometry: geom,
          source: 'osrm',
        }
      }
    }
  } catch {
    // fallback
  }

  // Fallback: great-circle estimate with 1.25 road winding factor at 55 mph
  const gc = haversineMiles(origin.lat, origin.lng, destination.lat, destination.lng) * 1.25
  const duration = gc / DEFAULT_SPEED_MPH
  return {
    distance_miles: Math.round(gc * 100) / 100,
    duration_hours: Math.round(duration * 10000) / 10000,
    geometry: [
      [origin.lat, origin.lng],
      [destination.lat, destination.lng],
    ],
    source: 'fallback',
  }
}

class ClientHOSPlanner {
  constructor(startTime, cycleUsedHours = 0.0) {
    this.startTime = new Date(startTime)
    this.initialCycleUsed = Math.max(0, Number(cycleUsedHours) || 0)
    this.clock = new Date(this.startTime)
    this.shiftStart = new Date(this.startTime)
    this.driveThisShift = 0.0
    this.driveSinceBreak = 0.0
    this.cycleUsed = this.initialCycleUsed
    this.milesSinceFuel = 0.0
    this.totalMiles = 0.0
    this.records = []
    this.stops = []
    this.violations = []
  }

  hoursSinceShiftStart() {
    return (this.clock - this.shiftStart) / (1000 * SECONDS_PER_HOUR)
  }

  cycleRemaining() {
    return CYCLE_LIMIT_HOURS - this.cycleUsed
  }

  add(status, hours, { miles = 0.0, location = '', note = '', lat = null, lng = null } = {}) {
    if (hours <= EPSILON) return null
    const start = new Date(this.clock)
    const end = new Date(start.getTime() + hours * SECONDS_PER_HOUR * 1000)

    const rec = {
      status,
      status_label: STATUS_LABELS[status],
      start: start.toISOString().slice(0, 16),
      end: end.toISOString().slice(0, 16),
      startDate: start,
      endDate: end,
      hours: Math.round(hours * 10000) / 10000,
      miles: Math.round(miles * 100) / 100,
      location,
      note,
      lat,
      lng,
    }

    this.records.push(rec)

    if (status === DRIVING) {
      this.driveThisShift += hours
      this.driveSinceBreak += hours
      this.cycleUsed += hours
      this.milesSinceFuel += miles
      this.totalMiles += miles
    } else if (status === ON_DUTY) {
      this.cycleUsed += hours
    }

    if (status === OFF_DUTY || status === SLEEPER || (status === ON_DUTY && hours >= BREAK_DURATION_HOURS - EPSILON)) {
      this.driveSinceBreak = 0.0
    }

    this.clock = end
    return rec
  }

  recordStop(kind, label, start, end, lat, lng) {
    this.stops.push({
      kind,
      label,
      start: start.toISOString().slice(0, 16),
      end: end.toISOString().slice(0, 16),
      hours: Math.round(((end - start) / (1000 * SECONDS_PER_HOUR)) * 10000) / 10000,
      lat,
      lng,
      miles_from_origin: Math.round(this.totalMiles * 100) / 100,
    })
  }

  takeBreak(loc, lat, lng) {
    const start = new Date(this.clock)
    this.add(OFF_DUTY, BREAK_DURATION_HOURS, {
      location: loc,
      note: '30-minute break (8h driving rule)',
      lat,
      lng,
    })
    this.recordStop('break', '30-min break', start, this.clock, lat, lng)
  }

  takeFullReset(loc, lat, lng) {
    const start = new Date(this.clock)
    this.add(SLEEPER, FULL_RESET_HOURS, {
      location: loc,
      note: '10-hour reset (11h / 14h limit reached)',
      lat,
      lng,
    })
    this.shiftStart = new Date(this.clock)
    this.driveThisShift = 0.0
    this.driveSinceBreak = 0.0
    this.recordStop('rest', '10-hour reset', start, this.clock, lat, lng)
  }

  takeRestart(loc, lat, lng) {
    const start = new Date(this.clock)
    this.add(OFF_DUTY, CYCLE_RESTART_HOURS, {
      location: loc,
      note: '34-hour restart (70-hour / 8-day cycle reached)',
      lat,
      lng,
    })
    this.cycleUsed = 0.0
    this.shiftStart = new Date(this.clock)
    this.driveThisShift = 0.0
    this.driveSinceBreak = 0.0
    this.recordStop('restart', '34-hour restart', start, this.clock, lat, lng)
  }

  takeFuel(loc, lat, lng) {
    const start = new Date(this.clock)
    this.add(ON_DUTY, FUEL_DURATION_HOURS, {
      location: loc,
      note: 'Fuel stop (1,000-mile rule)',
      lat,
      lng,
    })
    this.milesSinceFuel = 0.0
    this.recordStop('fuel', 'Fuel stop', start, this.clock, lat, lng)
  }

  driveLeg(leg) {
    const totalHours = Number(leg.duration_hours)
    const totalMiles = Number(leg.distance_miles)
    if (totalHours <= EPSILON || totalMiles <= EPSILON) return

    const geometry = new RouteGeometry(leg.geometry || [], totalMiles)
    const speed = totalMiles / totalHours
    const fromLabel = leg.from.label
    const toLabel = leg.to.label
    const legDesc = `Driving: ${fromLabel} → ${toLabel}`

    let covered = 0.0
    let remainingHours = totalHours
    let remainingMiles = totalMiles

    for (let i = 0; i < 5000; i++) {
      if (remainingHours <= EPSILON || remainingMiles <= EPSILON) break

      // 1. 70h cycle limit
      if (this.cycleRemaining() <= EPSILON) {
        const [lat, lng] = geometry.pointAt(covered)
        this.takeRestart(legDesc, lat, lng)
        continue
      }

      // 2. 11h driving / 14h window
      const driveLeft = MAX_DRIVE_PER_SHIFT_HOURS - this.driveThisShift
      const windowLeft = MAX_DUTY_WINDOW_HOURS - this.hoursSinceShiftStart()
      if (driveLeft <= EPSILON || windowLeft <= EPSILON) {
        const [lat, lng] = geometry.pointAt(covered)
        this.takeFullReset(legDesc, lat, lng)
        continue
      }

      // 3. 30m break
      const breakLeft = BREAK_AFTER_DRIVE_HOURS - this.driveSinceBreak
      if (breakLeft <= EPSILON) {
        const [lat, lng] = geometry.pointAt(covered)
        this.takeBreak(legDesc, lat, lng)
        continue
      }

      // 4. Fuel every 1,000 mi
      const fuelLeftMiles = FUEL_INTERVAL_MILES - this.milesSinceFuel
      const fuelLeftHours = speed > 0 ? fuelLeftMiles / speed : remainingHours

      // 5. Cycle limit
      const cycleLeftHours = this.cycleRemaining()

      let chunkHours = Math.min(
        remainingHours,
        driveLeft,
        windowLeft,
        breakLeft,
        fuelLeftHours,
        cycleLeftHours,
      )
      chunkHours = Math.max(chunkHours, 1e-4)
      const chunkMiles = Math.min(chunkHours * speed, remainingMiles)
      chunkHours = speed > 0 ? chunkMiles / speed : chunkHours

      const [segLat, segLng] = geometry.pointAt(covered + chunkMiles)
      this.add(DRIVING, chunkHours, {
        miles: chunkMiles,
        location: legDesc,
        note: legDesc,
        lat: segLat,
        lng: segLng,
      })

      covered += chunkMiles
      remainingHours -= chunkHours
      remainingMiles -= chunkMiles
      if (remainingMiles < 0.5) remainingMiles = 0.0

      if (this.milesSinceFuel >= FUEL_INTERVAL_MILES - EPSILON && remainingMiles > 1.0) {
        const [lat, lng] = geometry.pointAt(covered)
        this.takeFuel(`${legDesc} (mile ${Math.round(covered).toLocaleString()})`, lat, lng)
      }
    }
  }

  onDutyStop(act) {
    const hours = Number(act.hours)
    const label = act.label
    const loc = act.location || {}
    const lat = loc.lat
    const lng = loc.lng

    if (this.cycleRemaining() < hours - EPSILON) {
      this.takeRestart(`Before ${label}`, lat, lng)
    }

    const start = new Date(this.clock)
    this.add(ON_DUTY, hours, { location: label, note: label, lat, lng })
    this.recordStop(act.kind || 'on_duty', label, start, this.clock, lat, lng)
  }

  plan(activities) {
    for (const act of activities) {
      if (act.type === 'drive') this.driveLeg(act)
      else if (act.type === 'on_duty') this.onDutyStop(act)
    }
    return this
  }

  summary() {
    const totals = { off_duty: 0, sleeper: 0, driving: 0, on_duty: 0 }
    for (const r of this.records) {
      totals[r.status] += r.hours
    }
    return {
      trip_start: this.startTime.toISOString().slice(0, 16),
      trip_end: this.clock.toISOString().slice(0, 16),
      total_miles: Math.round(this.totalMiles * 100) / 100,
      total_hours: Math.round(Object.values(totals).reduce((a, b) => a + b, 0) * 10000) / 10000,
      driving_hours: Math.round(totals.driving * 10000) / 10000,
      on_duty_hours: Math.round(totals.on_duty * 10000) / 10000,
      off_duty_hours: Math.round(totals.off_duty * 10000) / 10000,
      sleeper_hours: Math.round(totals.sleeper * 10000) / 10000,
      cycle_hours_start: Math.round(this.initialCycleUsed * 100) / 100,
      cycle_hours_used: Math.round(Math.min(this.cycleUsed, CYCLE_LIMIT_HOURS) * 100) / 100,
      stops: this.stops.length,
      violations: this.violations,
    }
  }
}

function formatHours(h) {
  const m = Math.round(h * 60)
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}

function buildDailyLogs(records, cycleUsedInitial = 0.0) {
  if (!records || !records.length) return []
  const firstMidnight = new Date(records[0].startDate)
  firstMidnight.setHours(0, 0, 0, 0)
  const tripEnd = new Date(records[records.length - 1].endDate)

  const rawDays = []
  let day = new Date(firstMidnight)

  while (day < tripEnd) {
    const dayStart = new Date(day)
    const dayEnd = new Date(day.getTime() + 24 * 3600 * 1000)

    const segments = []
    const remarks = []
    const totals = { off_duty: 0, sleeper: 0, driving: 0, on_duty: 0 }
    let milesDrivingToday = 0

    for (const r of records) {
      if (r.endDate <= dayStart || r.startDate >= dayEnd) continue
      const segStart = new Date(Math.max(r.startDate, dayStart))
      const segEnd = new Date(Math.min(r.endDate, dayEnd))
      const segHours = (segEnd - segStart) / (1000 * 3600)
      if (segHours <= 0) continue

      const ratio = r.hours > 0 ? segHours / r.hours : 0
      const segMiles = r.miles * ratio
      totals[r.status] += segHours
      if (r.status === DRIVING) milesDrivingToday += segMiles

      const startHour = (segStart - dayStart) / (1000 * 3600)
      const endHour = (segEnd - dayStart) / (1000 * 3600)

      segments.push({
        status: r.status,
        status_label: STATUS_LABELS[r.status],
        start_hour: Math.round(startHour * 10000) / 10000,
        end_hour: Math.round(endHour * 10000) / 10000,
        from_time: segStart.toTimeString().slice(0, 5),
        to_time: segEnd.toTimeString().slice(0, 5),
        hours: Math.round(segHours * 10000) / 10000,
        hours_label: formatHours(segHours),
        miles: Math.round(segMiles * 100) / 100,
        label: r.note || r.location || STATUS_LABELS[r.status],
        location: r.location,
        lat: r.lat,
        lng: r.lng,
      })

      if (r.startDate >= dayStart || !remarks.length) {
        remarks.push({
          time: segStart.toTimeString().slice(0, 5),
          text: r.note || STATUS_LABELS[r.status],
          status: r.status,
          location: r.location,
          lat: r.lat,
          lng: r.lng,
        })
      }
    }

    const onDutyHours = totals.driving + totals.on_duty
    const pad = (n) => String(n).padStart(2, '0')
    const dateStr = `${dayStart.getFullYear()}-${pad(dayStart.getMonth() + 1)}-${pad(dayStart.getDate())}`

    rawDays.push({
      date: dateStr,
      day_index: rawDays.length + 1,
      segments,
      remarks,
      totals: {
        off_duty: Math.round(totals.off_duty * 10000) / 10000,
        sleeper: Math.round(totals.sleeper * 10000) / 10000,
        driving: Math.round(totals.driving * 10000) / 10000,
        on_duty: Math.round(totals.on_duty * 10000) / 10000,
      },
      totals_label: {
        off_duty: formatHours(totals.off_duty),
        sleeper: formatHours(totals.sleeper),
        driving: formatHours(totals.driving),
        on_duty: formatHours(totals.on_duty),
      },
      on_duty_hours: Math.round(onDutyHours * 10000) / 10000,
      total_hours: Math.round(Object.values(totals).reduce((a, b) => a + b, 0) * 10000) / 10000,
      miles_driving_today: Math.round(milesDrivingToday * 100) / 100,
      total_mileage_today: 0,
    })

    day = dayEnd
  }

  // Cumulative mileage & recap
  let cumMiles = 0
  for (let i = 0; i < rawDays.length; i++) {
    cumMiles += rawDays[i].miles_driving_today
    rawDays[i].total_mileage_today = Math.round(cumMiles * 100) / 100

    const todayHours = rawDays[i].on_duty_hours
    const prev7 = rawDays.slice(Math.max(0, i - 7), i).reduce((s, d) => s + d.on_duty_hours, 0)
    const total8 = todayHours + prev7
    const avail = Math.max(0, 70.0 - (cycleUsedInitial + total8))

    rawDays[i].recap = {
      on_duty_today: Math.round(todayHours * 10000) / 10000,
      on_duty_today_label: formatHours(todayHours),
      on_duty_previous_7_days: Math.round(prev7 * 10000) / 10000,
      on_duty_previous_7_days_label: formatHours(prev7),
      total_last_8_days: Math.round(total8 * 10000) / 10000,
      total_last_8_days_label: formatHours(total8),
      available_tomorrow: Math.round(avail * 10000) / 10000,
      available_tomorrow_label: formatHours(avail),
    }
  }

  return rawDays
}

export async function clientPlanTrip(payload) {
  const current = await clientGeocode(payload.current_location)
  const pickup = await clientGeocode(payload.pickup_location)
  const dropoff = await clientGeocode(payload.dropoff_location)

  const legOne = await clientRoute(current, pickup)
  const legTwo = await clientRoute(pickup, dropoff)

  const legOneDrive = {
    type: 'drive',
    from: current,
    to: pickup,
    distance_miles: legOne.distance_miles,
    duration_hours: legOne.duration_hours,
    geometry: legOne.geometry,
  }

  const legTwoDrive = {
    type: 'drive',
    from: pickup,
    to: dropoff,
    distance_miles: legTwo.distance_miles,
    duration_hours: legTwo.duration_hours,
    geometry: legTwo.geometry,
  }

  const activities = [
    legOneDrive,
    {
      type: 'on_duty',
      kind: 'pickup',
      label: `Pickup - ${pickup.label}`,
      hours: PICKUP_DURATION_HOURS,
      location: pickup,
    },
    legTwoDrive,
    {
      type: 'on_duty',
      kind: 'dropoff',
      label: `Drop-off - ${dropoff.label}`,
      hours: DROPOFF_DURATION_HOURS,
      location: dropoff,
    },
  ]

  const startTimeStr = payload.start_time || new Date().toISOString()
  const cycleUsed = Number(payload.current_cycle_used) || 0.0

  const planner = new ClientHOSPlanner(startTimeStr, cycleUsed)
  planner.plan(activities)

  const dailyLogs = buildDailyLogs(planner.records, cycleUsed)
  const combinedGeometry = legOneDrive.geometry.concat(legTwoDrive.geometry.slice(1))

  return {
    id: Date.now(),
    inputs: {
      current_location: payload.current_location,
      pickup_location: payload.pickup_location,
      dropoff_location: payload.dropoff_location,
      current_cycle_used: cycleUsed,
      start_time: startTimeStr,
    },
    locations: { current, pickup, dropoff },
    route: {
      legs: [
        { ...legOneDrive, source: legOne.source },
        { ...legTwoDrive, source: legTwo.source },
      ],
      geometry: combinedGeometry,
      total_distance_miles: Math.round((legOne.distance_miles + legTwo.distance_miles) * 100) / 100,
      total_drive_hours: Math.round((legOne.duration_hours + legTwo.duration_hours) * 10000) / 10000,
    },
    stops: planner.stops,
    records: planner.records,
    daily_logs: dailyLogs,
    summary: planner.summary(),
    assumptions: [
      'Property-carrying driver, 70-hour / 8-day cycle, no adverse driving conditions.',
      '11-hour driving limit and 14-hour on-duty window per duty period.',
      '30-minute break required after 8 cumulative hours of driving.',
      '10 consecutive hours off duty resets the 11-hour and 14-hour clocks.',
      '34 consecutive hours off duty restarts the 70-hour / 8-day cycle.',
      'Fueling at least once every 1,000 miles (30-minute on-duty fuel stop).',
      '1 hour on duty (not driving) for pickup and 1 hour for drop-off.',
    ],
    warnings: planner.violations,
  }
}
