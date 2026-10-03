import { useEffect, useRef, useState } from 'react'

import { suggestLocations } from '../api.js'
import { formatDuration, todayIsoDate } from '../utils/format.js'

const EXAMPLES = [
  {
    label: 'Short Regional (Same Day)',
    desc: 'Newark -> Philly -> Baltimore (8h used)',
    current_location: 'Newark, NJ',
    pickup_location: 'Philadelphia, PA',
    dropoff_location: 'Baltimore, MD',
    current_cycle_used: 8,
  },
  {
    label: 'I-10 Corridor (Multi-Day)',
    desc: 'Los Angeles -> Phoenix -> Dallas (20h used)',
    current_location: 'Los Angeles, CA',
    pickup_location: 'Phoenix, AZ',
    dropoff_location: 'Dallas, TX',
    current_cycle_used: 20,
  },
  {
    label: 'Coast-to-Coast (70h Test)',
    desc: 'Seattle -> Denver -> Miami (34h used)',
    current_location: 'Seattle, WA',
    pickup_location: 'Denver, CO',
    dropoff_location: 'Miami, FL',
    current_cycle_used: 34,
  },
  {
    label: 'High Cycle (34h Restart)',
    desc: 'Chicago -> Memphis -> Atlanta (60h used)',
    current_location: 'Chicago, IL',
    pickup_location: 'Memphis, TN',
    dropoff_location: 'Atlanta, GA',
    current_cycle_used: 60,
  },
]

function defaultStart() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(now.getHours())}:${pad(Math.floor(now.getMinutes() / 15) * 15)}`
}

export default function TripForm({
  onSubmit,
  loading,
  driverDetails,
  onDriverDetailsChange,
}) {
  const [form, setForm] = useState({
    current_location: '',
    pickup_location: '',
    dropoff_location: '',
    current_cycle_used: 0,
    start_date: todayIsoDate(),
    start_time: defaultStart(),
    dry_run: false,
  })

  const [errors, setErrors] = useState({})
  const [showDriverDetails, setShowDriverDetails] = useState(false)

  // Suggestions state
  const [suggestions, setSuggestions] = useState([])
  const [activeSuggestField, setActiveSuggestField] = useState(null)
  const suggestTimerRef = useRef(null)

  const update = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value
    setForm((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }

    // Trigger autocomplete on location fields
    if (['current_location', 'pickup_location', 'dropoff_location'].includes(field)) {
      clearTimeout(suggestTimerRef.current)
      setActiveSuggestField(field)
      if (value.trim().length >= 2) {
        suggestTimerRef.current = setTimeout(async () => {
          try {
            const data = await suggestLocations(value)
            setSuggestions(data || [])
          } catch {
            setSuggestions([])
          }
        }, 220)
      } else {
        setSuggestions([])
      }
    }
  }

  const selectSuggestion = (field, item) => {
    setForm((prev) => ({ ...prev, [field]: item.label }))
    setActiveSuggestField(null)
    setSuggestions([])
  }

  const handleBlurField = () => {
    // Delay hiding suggestions so clicks can register
    setTimeout(() => {
      setActiveSuggestField(null)
      setSuggestions([])
    }, 250)
  }

  const cycleUsed = Number(form.current_cycle_used) || 0
  const cycleRemaining = Math.max(0, 70 - cycleUsed)

  const cycleStatus =
    cycleUsed < 45
      ? { label: 'Optimal Buffer', class: 'status-safe' }
      : cycleUsed < 60
      ? { label: 'Approaching Limit', class: 'status-warn' }
      : { label: '34h Restart Expected', class: 'status-danger' }

  function handleSwapLocations() {
    setForm((prev) => ({
      ...prev,
      pickup_location: prev.dropoff_location,
      dropoff_location: prev.pickup_location,
    }))
  }

  function handleSetNow() {
    const now = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    setForm((prev) => ({
      ...prev,
      start_date: todayIsoDate(),
      start_time: `${pad(now.getHours())}:${pad(Math.floor(now.getMinutes() / 15) * 15)}`,
    }))
  }

  function handleSubmit(event) {
    event.preventDefault()
    const nextErrors = {}
    if (!form.current_location.trim()) nextErrors.current_location = 'Enter starting location.'
    if (!form.pickup_location.trim()) nextErrors.pickup_location = 'Enter pickup location.'
    if (!form.dropoff_location.trim()) nextErrors.dropoff_location = 'Enter drop-off destination.'
    if (cycleUsed < 0 || cycleUsed > 70) nextErrors.current_cycle_used = 'Cycle used must be between 0 and 70 hours.'

    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return

    onSubmit({
      current_location: form.current_location.trim(),
      pickup_location: form.pickup_location.trim(),
      dropoff_location: form.dropoff_location.trim(),
      current_cycle_used: cycleUsed,
      start_time: `${form.start_date}T${form.start_time}:00`,
      save: !form.dry_run,
    })
  }

  function applyExample(example) {
    setForm((prev) => ({
      ...prev,
      current_location: example.current_location,
      pickup_location: example.pickup_location,
      dropoff_location: example.dropoff_location,
      current_cycle_used: example.current_cycle_used,
    }))
    setErrors({})
  }

  return (
    <form className="card trip-form" onSubmit={handleSubmit} noValidate>
      <div className="card-head">
        <div className="card-title-row">
          <h2>Haul Configuration</h2>
          <span className="badge compliance-badge">49 CFR §395.3</span>
        </div>
        <p className="muted small">
          70h / 8-day cycle &middot; 1,000 mi fueling &middot; 1h pickup/drop-off
        </p>
      </div>

      {/* Preset hauls */}
      <div className="preset-selector">
        <span className="field-subhead">Quick Route Presets:</span>
        <div className="preset-chips">
          {EXAMPLES.map((ex) => (
            <button
              type="button"
              key={ex.label}
              className="preset-chip"
              onClick={() => applyExample(ex)}
              title={ex.desc}
            >
              <span className="preset-title">{ex.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Location fields with visual route line */}
      <div className="locations-group">
        {/* Origin */}
        <div className="field-with-suggest">
          <label className="field">
            <span className="field-label">
              <span className="route-dot dot-origin" />
              <span>Starting Location (Current)</span>
            </span>
            <input
              type="text"
              value={form.current_location}
              onChange={update('current_location')}
              onFocus={update('current_location')}
              onBlur={handleBlurField}
              placeholder="e.g. Newark, NJ or Chicago, IL"
              autoComplete="off"
            />
            {errors.current_location && <em className="field-error">{errors.current_location}</em>}
          </label>
          {activeSuggestField === 'current_location' && suggestions.length > 0 && (
            <ul className="suggestions-menu">
              {suggestions.map((item, idx) => (
                <li
                  key={`cur-${idx}`}
                  onMouseDown={() => selectSuggestion('current_location', item)}
                >
                  <span className="suggest-icon">📍</span>
                  <span className="suggest-label">{item.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Pickup */}
        <div className="field-with-suggest">
          <label className="field">
            <span className="field-label">
              <span className="route-dot dot-pickup" />
              <span>Pickup Location (1h Loading)</span>
            </span>
            <input
              type="text"
              value={form.pickup_location}
              onChange={update('pickup_location')}
              onFocus={update('pickup_location')}
              onBlur={handleBlurField}
              placeholder="e.g. Philadelphia, PA"
              autoComplete="off"
            />
            {errors.pickup_location && <em className="field-error">{errors.pickup_location}</em>}
          </label>
          {activeSuggestField === 'pickup_location' && suggestions.length > 0 && (
            <ul className="suggestions-menu">
              {suggestions.map((item, idx) => (
                <li
                  key={`pick-${idx}`}
                  onMouseDown={() => selectSuggestion('pickup_location', item)}
                >
                  <span className="suggest-icon">📦</span>
                  <span className="suggest-label">{item.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Swap Action */}
        <div className="swap-row">
          <button
            type="button"
            className="swap-btn"
            onClick={handleSwapLocations}
            title="Swap Pickup and Drop-off locations"
          >
            <span className="swap-icon">⇅</span> Swap Pickup &amp; Drop-off
          </button>
        </div>

        {/* Drop-off */}
        <div className="field-with-suggest">
          <label className="field">
            <span className="field-label">
              <span className="route-dot dot-dropoff" />
              <span>Drop-off Destination (1h Unloading)</span>
            </span>
            <input
              type="text"
              value={form.dropoff_location}
              onChange={update('dropoff_location')}
              onFocus={update('dropoff_location')}
              onBlur={handleBlurField}
              placeholder="e.g. Baltimore, MD or Dallas, TX"
              autoComplete="off"
            />
            {errors.dropoff_location && <em className="field-error">{errors.dropoff_location}</em>}
          </label>
          {activeSuggestField === 'dropoff_location' && suggestions.length > 0 && (
            <ul className="suggestions-menu">
              {suggestions.map((item, idx) => (
                <li
                  key={`drop-${idx}`}
                  onMouseDown={() => selectSuggestion('dropoff_location', item)}
                >
                  <span className="suggest-icon">🏁</span>
                  <span className="suggest-label">{item.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Cycle Management */}
      <div className="field cycle-field-group">
        <div className="cycle-header">
          <span className="field-label">
            <span className="route-dot dot-cycle" />
            <span>Cycle Hours Used (70h / 8-day)</span>
          </span>
          <span className={`cycle-status-pill ${cycleStatus.class}`}>
            {cycleStatus.label}
          </span>
        </div>

        <div className="cycle-gauge-bar">
          <div
            className="cycle-gauge-fill"
            style={{ width: `${(cycleUsed / 70) * 100}%` }}
          />
        </div>

        <div className="range-row">
          <input
            type="range"
            min="0"
            max="70"
            step="0.5"
            value={cycleUsed}
            onChange={update('current_cycle_used')}
          />
          <div className="cycle-number-input">
            <input
              type="number"
              min="0"
              max="70"
              step="0.5"
              value={form.current_cycle_used}
              onChange={update('current_cycle_used')}
            />
            <span className="unit-label">hrs</span>
          </div>
        </div>

        <div className="cycle-quick-presets">
          <button
            type="button"
            className="cycle-btn"
            onClick={() => setForm((p) => ({ ...p, current_cycle_used: 0 }))}
          >
            0h (Fresh 34h)
          </button>
          <button
            type="button"
            className="cycle-btn"
            onClick={() => setForm((p) => ({ ...p, current_cycle_used: 24 }))}
          >
            24h (Mid-Week)
          </button>
          <button
            type="button"
            className="cycle-btn"
            onClick={() => setForm((p) => ({ ...p, current_cycle_used: 56 }))}
          >
            56h (Heavy)
          </button>
        </div>

        <div className="cycle-meta-text">
          <span><b>{formatDuration(cycleUsed)}</b> used</span>
          <span>&bull;</span>
          <span><b>{formatDuration(cycleRemaining)}</b> remaining before reset</span>
        </div>
        {errors.current_cycle_used && (
          <em className="field-error">{errors.current_cycle_used}</em>
        )}
      </div>

      {/* Departure Timing */}
      <div className="departure-section">
        <div className="departure-header">
          <span className="field-subhead">Departure Schedule</span>
          <button type="button" className="ghost-btn-xs" onClick={handleSetNow}>
            Set to Now
          </button>
        </div>
        <div className="field-row">
          <label className="field">
            <span className="field-label-sm">Departure Date</span>
            <input
              type="date"
              value={form.start_date}
              onChange={update('start_date')}
            />
          </label>
          <label className="field">
            <span className="field-label-sm">Departure Time</span>
            <input
              type="time"
              step="900"
              value={form.start_time}
              onChange={update('start_time')}
            />
          </label>
        </div>
      </div>

      {/* Expandable Carrier / Vehicle / Log Header Details */}
      <div className="collapsible-section">
        <button
          type="button"
          className="collapsible-toggle"
          onClick={() => setShowDriverDetails(!showDriverDetails)}
        >
          <span>📋 Driver &amp; Vehicle Info (Log Header)</span>
          <span className="toggle-chevron">{showDriverDetails ? '▲' : '▼'}</span>
        </button>

        {showDriverDetails && (
          <div className="collapsible-content">
            <div className="field-row">
              <label className="field">
                <span className="field-label-sm">Driver Name</span>
                <input
                  type="text"
                  value={driverDetails.driver}
                  onChange={(e) =>
                    onDriverDetailsChange({ ...driverDetails, driver: e.target.value })
                  }
                  placeholder="e.g. John Doe"
                />
              </label>
              <label className="field">
                <span className="field-label-sm">Carrier Name</span>
                <input
                  type="text"
                  value={driverDetails.carrier}
                  onChange={(e) =>
                    onDriverDetailsChange({ ...driverDetails, carrier: e.target.value })
                  }
                  placeholder="e.g. Lone Star Freight LLC"
                />
              </label>
            </div>

            <div className="field-row">
              <label className="field">
                <span className="field-label-sm">Tractor / Truck #</span>
                <input
                  type="text"
                  value={driverDetails.vehicle}
                  onChange={(e) =>
                    onDriverDetailsChange({ ...driverDetails, vehicle: e.target.value })
                  }
                  placeholder="e.g. Truck #1042"
                />
              </label>
              <label className="field">
                <span className="field-label-sm">Trailer #</span>
                <input
                  type="text"
                  value={driverDetails.trailer || ''}
                  onChange={(e) =>
                    onDriverDetailsChange({ ...driverDetails, trailer: e.target.value })
                  }
                  placeholder="e.g. Trailer #88"
                />
              </label>
            </div>

            <div className="field-row">
              <label className="field">
                <span className="field-label-sm">Bill of Lading / Shipping Doc #</span>
                <input
                  type="text"
                  value={driverDetails.shippingDoc || ''}
                  onChange={(e) =>
                    onDriverDetailsChange({ ...driverDetails, shippingDoc: e.target.value })
                  }
                  placeholder="e.g. BOL-94821"
                />
              </label>
              <label className="field">
                <span className="field-label-sm">Home Terminal Address</span>
                <input
                  type="text"
                  value={driverDetails.homeTerminal || ''}
                  onChange={(e) =>
                    onDriverDetailsChange({ ...driverDetails, homeTerminal: e.target.value })
                  }
                  placeholder="e.g. Dallas, TX Terminal"
                />
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Dry run checkbox & Action buttons */}
      <div className="form-actions">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={form.dry_run}
            onChange={update('dry_run')}
          />
          <span className="small muted">Dry Run (Calculate without saving to history)</span>
        </label>

        <button type="submit" className="primary-action-btn" disabled={loading}>
          {loading ? (
            <span className="btn-loading">
              <span className="mini-spinner" />
              Routing &amp; Simulating Duty Clocks…
            </span>
          ) : (
            <span className="btn-content">
              <span>🚀</span>
              <span>Calculate Route &amp; Generate Logs</span>
            </span>
          )}
        </button>
      </div>
    </form>
  )
}
