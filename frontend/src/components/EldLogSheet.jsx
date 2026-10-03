import { useState } from 'react'

import {
  STATUS_COLORS,
  STATUS_LABELS,
  STATUS_ORDER,
  STATUS_ROW_INDEX,
  formatDayLabel,
  formatDuration,
} from '../utils/format.js'

// Grid geometry (SVG user coordinates)
const TOP_LABEL_H = 28
const PAD_LEFT = 200
const PAD_RIGHT = 75
const HOUR_W = 34
const ROW_H = 46
const GRID_W = 24 * HOUR_W
const GRID_H = 4 * ROW_H
const SVG_W = PAD_LEFT + GRID_W + PAD_RIGHT
const SVG_H = TOP_LABEL_H + GRID_H + 12

const gridTop = () => TOP_LABEL_H
const rowTop = (index) => TOP_LABEL_H + index * ROW_H
const rowCenter = (status) => rowTop(STATUS_ROW_INDEX[status]) + ROW_H / 2
const xAt = (hour) => PAD_LEFT + hour * HOUR_W

function hourLabel(hour) {
  if (hour === 0 || hour === 24) return 'Mid'
  if (hour === 12) return 'Noon'
  return String(hour % 12)
}

function buildStepPath(segments) {
  if (!segments || !segments.length) return ''
  const parts = []
  segments.forEach((segment, index) => {
    const y = rowCenter(segment.status)
    const x1 = xAt(segment.start_hour)
    const x2 = xAt(segment.end_hour)
    parts.push(`${index === 0 ? 'M' : 'L'} ${x1.toFixed(2)} ${y.toFixed(2)}`)
    parts.push(`L ${x2.toFixed(2)} ${y.toFixed(2)}`)
  })
  return parts.join(' ')
}

function shortPlace(location) {
  if (!location) return '—'
  return location.length > 50 ? `${location.slice(0, 48)}…` : location
}

export default function EldLogSheet({
  sheet,
  driver = 'A. Driver',
  carrier = 'Lone Star Freight LLC',
  vehicle = 'Truck #1042',
  trailer = 'Trailer #88',
  shippingDoc = 'BOL-10492',
  homeTerminal = 'Dallas, TX',
}) {
  const [hoveredHour, setHoveredHour] = useState(null)
  const [isSigned, setIsSigned] = useState(true)

  if (!sheet) return null

  const totals = sheet.totals || {}
  const segments = sheet.segments || []
  const stepPath = buildStepPath(segments)
  const firstPlace = segments.find((segment) => segment.location)?.location

  // Find active segment for hovered hour
  const hoveredSegment =
    hoveredHour !== null
      ? segments.find(
          (seg) => hoveredHour >= seg.start_hour && hoveredHour < seg.end_hour,
        )
      : null

  const handleMouseMove = (e) => {
    const svgRect = e.currentTarget.getBoundingClientRect()
    const mouseX = e.clientX - svgRect.left
    const scaleX = SVG_W / svgRect.width
    const svgX = mouseX * scaleX
    if (svgX >= PAD_LEFT && svgX <= PAD_LEFT + GRID_W) {
      const hour = (svgX - PAD_LEFT) / HOUR_W
      setHoveredHour(Math.round(hour * 4) / 4) // snap to 15 min
    } else {
      setHoveredHour(null)
    }
  }

  const handleMouseLeave = () => {
    setHoveredHour(null)
  }

  const totalDayHours = Number(sheet.total_hours || 0)
  const isCompleteDay = Math.abs(totalDayHours - 24.0) < 0.05

  return (
    <article className="log-sheet">
      {/* Official Form Header */}
      <header className="log-sheet-head">
        <div className="log-title-area">
          <div className="log-title-badge">
            <span className="dot-pulse" /> FMCSA Form §395.8 Compliant
          </div>
          <h3>DRIVER&rsquo;S DAILY LOG</h3>
          <p className="muted small">
            Day {sheet.day_index} of Haul &middot; {formatDayLabel(sheet.date)} &middot; 24-Hour
            Period Starting at Midnight
          </p>
        </div>

        <div className="log-metrics-box">
          <div className="metric-item">
            <span className="metric-label">Miles Driving Today</span>
            <span className="metric-value">
              {Number(sheet.miles_driving_today || 0).toLocaleString()} mi
            </span>
          </div>
          <div className="metric-divider" />
          <div className="metric-item">
            <span className="metric-label">Cumulative Total Mileage</span>
            <span className="metric-value">
              {Number(sheet.total_mileage_today || 0).toLocaleString()} mi
            </span>
          </div>
        </div>
      </header>

      {/* Driver & Carrier Metadata Block */}
      <div className="log-identity-grid">
        <div className="identity-cell">
          <span className="cell-label">Carrier Name</span>
          <strong className="cell-value">{carrier}</strong>
        </div>
        <div className="identity-cell">
          <span className="cell-label">Driver Name</span>
          <strong className="cell-value">{driver}</strong>
        </div>
        <div className="identity-cell">
          <span className="cell-label">Truck / Tractor #</span>
          <strong className="cell-value">{vehicle}</strong>
        </div>
        <div className="identity-cell">
          <span className="cell-label">Trailer Number(s)</span>
          <strong className="cell-value">{trailer || 'None'}</strong>
        </div>
        <div className="identity-cell">
          <span className="cell-label">Starting Point</span>
          <strong className="cell-value">{shortPlace(firstPlace)}</strong>
        </div>
        <div className="identity-cell">
          <span className="cell-label">Shipping Document / BOL</span>
          <strong className="cell-value">{shippingDoc || 'BOL-ON-FILE'}</strong>
        </div>
        <div className="identity-cell">
          <span className="cell-label">Home Terminal</span>
          <strong className="cell-value">{homeTerminal || 'Main Depot'}</strong>
        </div>
        <div className="identity-cell">
          <span className="cell-label">Duty Rule Cycle</span>
          <strong className="cell-value">70 hr / 8 Days (Property)</strong>
        </div>
      </div>

      {/* Interactive Tooltip Banner */}
      <div className="grid-inspector-bar">
        {hoveredSegment ? (
          <div className="inspector-content">
            <span className="inspector-badge" style={{ background: STATUS_COLORS[hoveredSegment.status] }}>
              {STATUS_LABELS[hoveredSegment.status]}
            </span>
            <span className="inspector-time">
              ⏱ {hoveredSegment.from_time} &rarr; {hoveredSegment.to_time} ({formatDuration(hoveredSegment.hours)})
            </span>
            <span className="inspector-label">
              📍 {hoveredSegment.label || hoveredSegment.location || 'In transit'}
            </span>
            {hoveredSegment.miles > 0 && (
              <span className="inspector-miles">
                🚗 {hoveredSegment.miles} miles
              </span>
            )}
          </div>
        ) : (
          <span className="inspector-prompt muted small">
            💡 Hover over any hour or line segment on the 24-hour grid below to inspect duty status &amp; notes.
          </span>
        )}
      </div>

      {/* 24-Hour SVG ELD Duty Grid */}
      <div className="svg-container">
        <svg
          className="eld-svg"
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`Daily log grid for ${sheet.date}`}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          {/* Base Background */}
          <rect x="0" y="0" width={SVG_W} height={SVG_H} fill="#ffffff" />

          {/* Top Hour Column Headers (0..24) */}
          {Array.from({ length: 25 }).map((_, hour) => (
            <text
              key={`hl-${hour}`}
              x={xAt(hour)}
              y={TOP_LABEL_H - 8}
              textAnchor="middle"
              className={`hour-label ${hour === 12 ? 'is-noon' : ''} ${
                hoveredHour != null && Math.floor(hoveredHour) === hour ? 'is-hovered' : ''
              }`}
            >
              {hourLabel(hour)}
            </text>
          ))}

          {/* 15-Minute Minor Subdivision Lines */}
          {Array.from({ length: 24 }).flatMap((_, hour) =>
            [0.25, 0.5, 0.75].map((fraction) => (
              <line
                key={`q-${hour}-${fraction}`}
                x1={xAt(hour + fraction)}
                x2={xAt(hour + fraction)}
                y1={gridTop()}
                y2={gridTop() + GRID_H}
                className="tick-quarter"
              />
            )),
          )}

          {/* Horizontal Row Backgrounds */}
          {STATUS_ORDER.map((status, index) => (
            <rect
              key={`band-${status}`}
              x={PAD_LEFT}
              y={rowTop(index)}
              width={GRID_W}
              height={ROW_H}
              fill={index % 2 === 0 ? '#ffffff' : '#f8fafc'}
            />
          ))}

          {/* 1-Hour Major Vertical Grid Lines */}
          {Array.from({ length: 25 }).map((_, hour) => (
            <line
              key={`v-${hour}`}
              x1={xAt(hour)}
              x2={xAt(hour)}
              y1={gridTop()}
              y2={gridTop() + GRID_H}
              className={hour % 6 === 0 ? 'tick-major' : 'tick-hour'}
            />
          ))}

          {/* Horizontal Divider Lines */}
          {Array.from({ length: 5 }).map((_, index) => (
            <line
              key={`h-${index}`}
              x1={PAD_LEFT}
              x2={PAD_LEFT + GRID_W}
              y1={rowTop(index)}
              y2={rowTop(index)}
              className="tick-row"
            />
          ))}

          {/* Left-Side Row Labels & Right-Side Totals Column */}
          {STATUS_ORDER.map((status, index) => (
            <g key={`label-${status}`}>
              {/* Row Status Label */}
              <text x={12} y={rowCenter(status)} dy="4" className="row-label">
                {index + 1}. {STATUS_LABELS[status]}
              </text>

              {/* Status Indicator Pip */}
              <circle
                cx={182}
                cy={rowCenter(status)}
                r="4.5"
                fill={STATUS_COLORS[status]}
              />

              {/* Total Hours Column on the Right */}
              <rect
                x={PAD_LEFT + GRID_W + 8}
                y={rowTop(index) + 8}
                width={56}
                height={ROW_H - 16}
                rx="6"
                fill={STATUS_COLORS[status]}
                opacity="0.12"
              />
              <text
                x={PAD_LEFT + GRID_W + 36}
                y={rowCenter(status)}
                dy="4"
                textAnchor="middle"
                className="row-total"
                fill={STATUS_COLORS[status]}
              >
                {formatDuration(totals[status] || 0)}
              </text>
            </g>
          ))}

          {/* Right Header for Total Hours */}
          <text
            x={PAD_LEFT + GRID_W + 36}
            y={TOP_LABEL_H - 8}
            textAnchor="middle"
            className="hour-label"
            style={{ fontWeight: 700, fill: '#0f172a' }}
          >
            TOTAL
          </text>

          {/* Hover Crosshair Line */}
          {hoveredHour !== null && (
            <line
              x1={xAt(hoveredHour)}
              x2={xAt(hoveredHour)}
              y1={gridTop()}
              y2={gridTop() + GRID_H}
              stroke="#2563eb"
              strokeWidth="2"
              strokeDasharray="4 2"
              pointerEvents="none"
            />
          )}

          {/* Active Step-Line Duty Graph */}
          {stepPath && (
            <>
              <path d={stepPath} className="duty-line-halo" />
              <path d={stepPath} className="duty-line" />
            </>
          )}

          {/* Noon Marker Guide */}
          <line
            x1={xAt(12)}
            x2={xAt(12)}
            y1={gridTop()}
            y2={gridTop() + GRID_H}
            className="noon-line"
          />
        </svg>
      </div>

      {/* Row Total Verification Bar */}
      <div className="checksum-bar">
        <div className="checksum-left">
          <span className="checksum-tag">24-Hour Accounting Integrity:</span>
          <span className="checksum-math">
            Off Duty ({formatDuration(totals.off_duty || 0)}) + Sleeper ({formatDuration(totals.sleeper || 0)}) + Driving ({formatDuration(totals.driving || 0)}) + On Duty ({formatDuration(totals.on_duty || 0)}) = <b>{totalDayHours.toFixed(1)} hrs</b>
          </span>
        </div>
        <div className={`checksum-badge ${isCompleteDay ? 'valid' : 'partial'}`}>
          {isCompleteDay ? '✓ 24.0 Hr Balanced' : `Partial Day (${totalDayHours.toFixed(1)}h)`}
        </div>
      </div>

      {/* Remarks Ledger & 70-Hour Recap */}
      <footer className="log-sheet-foot">
        <section className="remarks-box">
          <div className="section-head">
            <h4>Remarks &amp; Duty Changes</h4>
            <span className="small muted">{sheet.remarks?.length || 0} Events Logged</span>
          </div>
          <div className="remarks-table-wrap">
            <table className="remarks-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Status</th>
                  <th>Location &amp; Activity Reason</th>
                </tr>
              </thead>
              <tbody>
                {(sheet.remarks || []).map((remark, index) => (
                  <tr key={`remark-${index}`}>
                    <td className="remark-col-time">{remark.time}</td>
                    <td className="remark-col-status">
                      <span
                        className="status-dot-sm"
                        style={{ background: STATUS_COLORS[remark.status] || '#64748b' }}
                      />
                      <span>{STATUS_LABELS[remark.status] || remark.status}</span>
                    </td>
                    <td className="remark-col-desc">{remark.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="recap-box">
          <div className="section-head">
            <h4>70-Hour / 8-Day Recap</h4>
            <span className="small muted">Rolling Cycle Clock</span>
          </div>
          <table className="recap-table">
            <tbody>
              <tr>
                <td>A. Total hours on duty today</td>
                <td className="recap-val">{formatDuration(sheet.recap?.on_duty_today)}</td>
              </tr>
              <tr>
                <td>B. Total hours on duty previous 7 days</td>
                <td className="recap-val">{formatDuration(sheet.recap?.on_duty_previous_7_days)}</td>
              </tr>
              <tr className="recap-row-total">
                <td>C. Total on duty last 8 days (A + B)</td>
                <td className="recap-val highlight">{formatDuration(sheet.recap?.total_last_8_days)}</td>
              </tr>
              <tr className="recap-row-avail">
                <td>Available driving/on-duty hours tomorrow (70 - C)</td>
                <td className="recap-val green">{formatDuration(sheet.recap?.available_tomorrow)}</td>
              </tr>
            </tbody>
          </table>

          {/* Driver Legal Certification Signature Block */}
          <div className="driver-signature-box">
            <p className="certification-statement">
              &ldquo;I certify that these entries are true and correct as prescribed by 49 CFR Part 395 of the Federal Motor Carrier Safety Regulations.&rdquo;
            </p>
            <div className="signature-line-wrap">
              <div className="signature-preview">
                {isSigned ? (
                  <span className="cursive-signature">{driver}</span>
                ) : (
                  <span className="unsigned-text">Unsigned</span>
                )}
              </div>
              <button
                type="button"
                className="signature-toggle-btn no-print"
                onClick={() => setIsSigned(!isSigned)}
              >
                {isSigned ? '✓ Signed Digitally' : 'Click to Sign'}
              </button>
            </div>
            <div className="signature-date-row">
              <span className="small muted">Certified on {formatDayLabel(sheet.date)}</span>
            </div>
          </div>
        </section>
      </footer>
    </article>
  )
}
