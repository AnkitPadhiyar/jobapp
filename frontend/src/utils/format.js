// Shared formatting helpers, duty-status palette, and FMCSA rule references.

export const STATUS_ORDER = ['off_duty', 'sleeper', 'driving', 'on_duty']

export const STATUS_ROW_INDEX = {
  off_duty: 0,
  sleeper: 1,
  driving: 2,
  on_duty: 3,
}

export const STATUS_LABELS = {
  off_duty: 'Off Duty',
  sleeper: 'Sleeper Berth',
  driving: 'Driving',
  on_duty: 'On-Duty (Not Driving)',
}

export const STATUS_COLORS = {
  off_duty: '#64748b',
  sleeper: '#6366f1',
  driving: '#10b981',
  on_duty: '#f59e0b',
}

export const STATUS_BG_LIGHT = {
  off_duty: 'rgba(100, 116, 139, 0.12)',
  sleeper: 'rgba(99, 102, 241, 0.12)',
  driving: 'rgba(16, 185, 129, 0.12)',
  on_duty: 'rgba(245, 158, 11, 0.12)',
}

export const STOP_META = {
  current: { label: 'Start / Origin', color: '#0f172a', icon: '🚚', badge: 'Origin' },
  pickup: { label: 'Pickup (Loading)', color: '#059669', icon: '📦', badge: '1h Service' },
  dropoff: { label: 'Drop-off (Unloading)', color: '#dc2626', icon: '🏁', badge: '1h Service' },
  fuel: { label: 'Fuel Stop', color: '#f59e0b', icon: '⛽', badge: '1,000 mi Rule' },
  break: { label: '30-Min Rest Break', color: '#0284c7', icon: '☕', badge: '8h Driving Limit' },
  rest: { label: '10-Hour Reset', color: '#7c3aed', icon: '🛏️', badge: '11h/14h Reset' },
  restart: { label: '34-Hour Restart', color: '#db2777', icon: '🔄', badge: '70h Cycle Reset' },
  on_duty: { label: 'On Duty Activity', color: '#ea580c', icon: '📋', badge: 'On Duty' },
}

export const stopMeta = (kind) => STOP_META[kind] || STOP_META.on_duty

export const FMCSA_RULES = [
  {
    id: '11hr_driving',
    title: '11-Hour Driving Limit',
    cfr: '49 CFR §395.3(a)(1)',
    description: 'May drive a maximum of 11 hours after 10 consecutive hours off duty.',
    badge: '11h Max',
  },
  {
    id: '14hr_window',
    title: '14-Hour Duty Window',
    cfr: '49 CFR §395.3(a)(2)',
    description: 'May not drive beyond the 14th consecutive hour after coming on duty.',
    badge: '14h Window',
  },
  {
    id: '30min_break',
    title: '30-Minute Rest Break',
    cfr: '49 CFR §395.3(a)(3)(ii)',
    description: 'Must take at least 30 consecutive minutes non-driving break after 8 cumulative hours of driving.',
    badge: '30m Break',
  },
  {
    id: '70hr_8day_cycle',
    title: '70-Hour / 8-Day Cycle Limit',
    cfr: '49 CFR §395.3(b)(2)',
    description: 'May not drive after 70 hours on duty in any rolling period of 8 consecutive days.',
    badge: '70h / 8d',
  },
  {
    id: '34hr_restart',
    title: '34-Hour Cycle Restart',
    cfr: '49 CFR §395.3(c)',
    description: 'Any period of 34 consecutive hours off duty resets the 70-hour / 8-day running clock to zero.',
    badge: '34h Restart',
  },
  {
    id: '10hr_reset',
    title: '10-Hour Shift Reset',
    cfr: '49 CFR §395.3(a)',
    description: '10 consecutive hours off duty or in sleeper berth resets the 11-hour driving and 14-hour duty clocks.',
    badge: '10h Off Duty',
  },
  {
    id: 'fueling_interval',
    title: 'Fuel Interval (1,000 Miles)',
    cfr: 'Fleet Operating Standard',
    description: 'Requires a 30-minute on-duty fueling stop at or before every 1,000 miles traveled.',
    badge: 'Every 1k mi',
  },
]

export function formatMiles(value) {
  if (value === null || value === undefined) return '—'
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })} mi`
}

export function formatDecimalMiles(value) {
  if (value === null || value === undefined) return '—'
  return `${Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} mi`
}

/** 8.5 -> "8h 30m" */
export function formatDuration(hours) {
  if (hours === null || hours === undefined) return '—'
  const totalMinutes = Math.round(Number(hours) * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  return `${m}m`
}

/** "2026-10-03T13:30" -> "Oct 3, 2026 · 1:30 PM" */
export function formatDateTime(iso) {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** "2026-10-03T13:30" -> "01:30 PM" */
export function formatTimeOnly(iso) {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    const parts = iso.split('T')
    return parts[1] ? parts[1].slice(0, 5) : iso
  }
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** "2026-10-03" -> "Sat, Oct 3, 2026" (parsed as a plain local date). */
export function formatDayLabel(dateOnly) {
  if (!dateOnly) return '—'
  const [y, m, d] = dateOnly.split('-').map(Number)
  const date = new Date(y, (m || 1) - 1, d || 1)
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function todayIsoDate() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** Generate a dispatch manifest text string for quick copy/download. */
export function buildDispatchManifest(result, driverDetails = {}) {
  if (!result) return ''
  const { inputs, route, summary, stops = [] } = result
  const driver = driverDetails.driver || 'Driver'
  const carrier = driverDetails.carrier || 'Fleet Carrier'
  const vehicle = driverDetails.vehicle || 'Truck'
  const trailer = driverDetails.trailer || 'N/A'
  const shippingDoc = driverDetails.shippingDoc || 'N/A'

  const lines = [
    '=================================================================',
    '             DRIVER DISPATCH MANIFEST & HOS SCHEDULE             ',
    '=================================================================',
    `Generated: ${new Date().toLocaleString()}`,
    `Carrier:   ${carrier}`,
    `Driver:    ${driver}`,
    `Vehicle:   ${vehicle} | Trailer: ${trailer}`,
    `B/L / Doc: ${shippingDoc}`,
    '',
    'TRIP SUMMARY:',
    `  Origin:           ${inputs.current_location}`,
    `  Pickup:           ${inputs.pickup_location}`,
    `  Drop-off:         ${inputs.dropoff_location}`,
    `  Total Distance:   ${formatMiles(route.total_distance_miles)}`,
    `  Total Drive Time: ${formatDuration(summary.driving_hours)}`,
    `  Total On-Duty:    ${formatDuration(summary.on_duty_hours)}`,
    `  Total Duration:   ${formatDuration(summary.total_hours)}`,
    `  Cycle Consumption:${summary.cycle_hours_start}h -> ${summary.cycle_hours_used}h / 70.0h`,
    '',
    '-----------------------------------------------------------------',
    'SCHEDULED STOPS & RESTS TIMELINE (FMCSA 49 CFR §395.3)',
    '-----------------------------------------------------------------',
  ]

  stops.forEach((stop, i) => {
    const meta = stopMeta(stop.kind)
    lines.push(
      `[${i + 1}] ${meta.icon} ${meta.label.toUpperCase()} (${formatDuration(stop.hours)})`,
      `    Location: ${stop.label || 'En route'}`,
      `    Window:   ${formatDateTime(stop.start)} -> ${formatDateTime(stop.end)}`,
      `    Marker:   Mile ${Number(stop.miles_from_origin || 0).toLocaleString()}`,
      '',
    )
  })

  lines.push(
    '-----------------------------------------------------------------',
    'DRIVER CERTIFICATION:',
    'I certify that these entries are true and correct as prescribed',
    'by 49 CFR Part 395 of the Federal Motor Carrier Safety Regulations.',
    `Driver Signature: _______________________ Date: _________________`,
    '=================================================================',
  )

  return lines.join('\n')
}
