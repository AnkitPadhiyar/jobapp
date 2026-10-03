import { useState } from 'react'

import { formatDateTime, formatDuration, stopMeta } from '../utils/format.js'

export default function StopTimeline({ stops = [], selectedStopIndex, onSelectStop }) {
  const [filter, setFilter] = useState('all')

  if (!stops?.length) return null

  const filteredStops = stops
    .map((stop, index) => ({ ...stop, originalIndex: index }))
    .filter((stop) => {
      if (filter === 'all') return true
      if (filter === 'rests') return ['break', 'rest', 'restart'].includes(stop.kind)
      if (filter === 'fuel') return stop.kind === 'fuel'
      if (filter === 'service') return ['pickup', 'dropoff', 'on_duty'].includes(stop.kind)
      return true
    })

  return (
    <section className="card timeline-card">
      <div className="card-head timeline-head-row">
        <div>
          <h2>Stop &amp; Rest Schedule</h2>
          <p className="muted small">
            Chronological log of every planned interruption with FMCSA reason &amp; mile marker.
          </p>
        </div>
        <div className="timeline-filter-pills">
          <button
            type="button"
            className={`filter-pill ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All ({stops.length})
          </button>
          <button
            type="button"
            className={`filter-pill ${filter === 'rests' ? 'active' : ''}`}
            onClick={() => setFilter('rests')}
          >
            Rests ({stops.filter((s) => ['break', 'rest', 'restart'].includes(s.kind)).length})
          </button>
          <button
            type="button"
            className={`filter-pill ${filter === 'fuel' ? 'active' : ''}`}
            onClick={() => setFilter('fuel')}
          >
            Fuel ({stops.filter((s) => s.kind === 'fuel').length})
          </button>
          <button
            type="button"
            className={`filter-pill ${filter === 'service' ? 'active' : ''}`}
            onClick={() => setFilter('service')}
          >
            Service ({stops.filter((s) => ['pickup', 'dropoff'].includes(s.kind)).length})
          </button>
        </div>
      </div>

      <ol className="timeline-list">
        {filteredStops.map((stop) => {
          const meta = stopMeta(stop.kind)
          const isSelected = selectedStopIndex === stop.originalIndex

          return (
            <li
              key={`${stop.kind}-${stop.originalIndex}`}
              className={`timeline-entry ${isSelected ? 'is-selected' : ''}`}
              onClick={() => onSelectStop && onSelectStop(stop.originalIndex)}
            >
              <div
                className="timeline-badge-icon"
                style={{ background: meta.color }}
                title={meta.label}
              >
                <span>{meta.icon}</span>
              </div>

              <div className="timeline-entry-content">
                <div className="timeline-entry-top">
                  <div className="timeline-title-wrap">
                    <span className="timeline-index">#{stop.originalIndex + 1}</span>
                    <strong className="timeline-title">{meta.label}</strong>
                    <span
                      className="stop-badge"
                      style={{
                        background: `${meta.color}15`,
                        color: meta.color,
                        borderColor: `${meta.color}35`,
                      }}
                    >
                      {formatDuration(stop.hours)}
                    </span>
                  </div>
                  <span className="mile-marker-tag">
                    Mile {Number(stop.miles_from_origin || 0).toLocaleString()}
                  </span>
                </div>

                <p className="timeline-label-text">{stop.label}</p>

                <div className="timeline-meta-row">
                  <span className="timeline-time-span">
                    🕒 {formatDateTime(stop.start)} &rarr; {formatDateTime(stop.end)}
                  </span>
                  {stop.lat != null && (
                    <button
                      type="button"
                      className="locate-map-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelectStop && onSelectStop(stop.originalIndex)
                      }}
                    >
                      <span>📍 View on Map</span>
                    </button>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
