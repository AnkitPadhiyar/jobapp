import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

import { formatDateTime, formatDuration, formatMiles, stopMeta } from '../utils/format.js'

const INTERMEDIATE_KINDS = ['fuel', 'break', 'rest', 'restart']
const LEG_COLORS = ['#2563eb', '#10b981']

function pinIcon(color, emoji, size = 32, isSelected = false) {
  const selectedStyle = isSelected
    ? 'box-shadow: 0 0 0 4px #3b82f6, 0 4px 14px rgba(0,0,0,0.35); transform: scale(1.18);'
    : 'box-shadow: 0 3px 10px rgba(0,0,0,0.22);'

  return L.divIcon({
    className: 'custom-map-pin',
    html: `
      <div class="pin-badge" style="--pin-color: ${color}; ${selectedStyle}">
        <span class="pin-emoji">${emoji}</span>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  })
}

const START_ICON = pinIcon('#0f172a', '🚚', 34)
const PICKUP_ICON = pinIcon('#059669', '📦', 34)
const DROPOFF_ICON = pinIcon('#dc2626', '🏁', 34)

/** Map controller component to programmatically pan/zoom when selectedStop changes */
function MapController({ selectedStop, allPositions }) {
  const map = useMap()
  const prevSelectedRef = useRef(null)

  useEffect(() => {
    if (selectedStop && selectedStop.lat != null && selectedStop.lng != null) {
      if (prevSelectedRef.current !== selectedStop) {
        map.flyTo([selectedStop.lat, selectedStop.lng], Math.max(map.getZoom(), 8), {
          duration: 1.2,
        })
        prevSelectedRef.current = selectedStop
      }
    }
  }, [selectedStop, map])

  useEffect(() => {
    if (allPositions && allPositions.length > 0) {
      const bounds = L.latLngBounds(allPositions)
      map.fitBounds(bounds, { padding: [50, 50] })
    }
  }, [allPositions, map])

  return null
}

export default function RouteMap({ result, selectedStopIndex, onSelectStop }) {
  const { route, locations, stops = [] } = result
  const legs = route.legs || []
  const allPositions = (route.geometry || []).map(([lat, lng]) => [lat, lng])

  const [activeFilter, setActiveFilter] = useState('all') // 'all', 'fuel', 'rest', 'break'

  const intermediateStops = stops
    .map((stop, idx) => ({ ...stop, originalIndex: idx }))
    .filter(
      (stop) =>
        INTERMEDIATE_KINDS.includes(stop.kind) &&
        stop.lat != null &&
        stop.lng != null &&
        (activeFilter === 'all' || stop.kind === activeFilter),
    )

  const selectedStop =
    selectedStopIndex != null && stops[selectedStopIndex]
      ? stops[selectedStopIndex]
      : null

  const dayCount = result.daily_logs?.length || 0

  return (
    <section className="card map-card">
      <div className="card-head map-header-row">
        <div>
          <h2>Interactive Route &amp; Stoppage Map</h2>
          <p className="muted small">
            {formatMiles(route.total_distance_miles)} total &middot;{' '}
            {formatDuration(route.total_drive_hours)} pure driving &middot;{' '}
            {dayCount} {dayCount === 1 ? 'daily log sheet' : 'daily log sheets'}
          </p>
        </div>
        <div className="map-actions-bar">
          <span className="stops-count-pill">
            {stops.length} Planned Events
          </span>
        </div>
      </div>

      <div className="map-wrap">
        <MapContainer
          center={allPositions[0] || [39.5, -98.35]}
          zoom={5}
          scrollWheelZoom
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <MapController selectedStop={selectedStop} allPositions={allPositions} />

          {/* Route Legs */}
          {legs.map((leg, index) => (
            <Polyline
              key={`leg-${index}`}
              positions={(leg.geometry || []).map(([lat, lng]) => [lat, lng])}
              pathOptions={{
                color: LEG_COLORS[index % LEG_COLORS.length],
                weight: 5,
                opacity: 0.9,
              }}
            />
          ))}

          {/* Start Origin Marker */}
          {locations?.current && (
            <Marker
              position={[locations.current.lat, locations.current.lng]}
              icon={START_ICON}
              eventHandlers={{
                click: () => onSelectStop && onSelectStop(0),
              }}
            >
              <Popup>
                <div className="popup-card">
                  <div className="popup-header">
                    <span className="popup-icon">🚚</span>
                    <strong>Origin / Departure Point</strong>
                  </div>
                  <p className="popup-address">{locations.current.display_name}</p>
                  <div className="popup-meta">
                    <span>Departure: {formatDateTime(result.inputs.start_time)}</span>
                  </div>
                </div>
              </Popup>
              <Tooltip direction="top">Start: {locations.current.label}</Tooltip>
            </Marker>
          )}

          {/* Pickup Marker */}
          {locations?.pickup && (
            <Marker
              position={[locations.pickup.lat, locations.pickup.lng]}
              icon={PICKUP_ICON}
              eventHandlers={{
                click: () => {
                  const pickupIdx = stops.findIndex((s) => s.kind === 'pickup')
                  if (pickupIdx >= 0 && onSelectStop) onSelectStop(pickupIdx)
                },
              }}
            >
              <Popup>
                <div className="popup-card">
                  <div className="popup-header">
                    <span className="popup-icon">📦</span>
                    <strong>Pickup (1 Hour Loading)</strong>
                  </div>
                  <p className="popup-address">{locations.pickup.display_name}</p>
                  <div className="popup-meta">
                    <span>1.0 hr On-Duty (Not Driving) for loading</span>
                  </div>
                </div>
              </Popup>
              <Tooltip direction="top">Pickup: {locations.pickup.label}</Tooltip>
            </Marker>
          )}

          {/* Drop-off Marker */}
          {locations?.dropoff && (
            <Marker
              position={[locations.dropoff.lat, locations.dropoff.lng]}
              icon={DROPOFF_ICON}
              eventHandlers={{
                click: () => {
                  const dropIdx = stops.findIndex((s) => s.kind === 'dropoff')
                  if (dropIdx >= 0 && onSelectStop) onSelectStop(dropIdx)
                },
              }}
            >
              <Popup>
                <div className="popup-card">
                  <div className="popup-header">
                    <span className="popup-icon">🏁</span>
                    <strong>Final Destination (Drop-off)</strong>
                  </div>
                  <p className="popup-address">{locations.dropoff.display_name}</p>
                  <div className="popup-meta">
                    <span>1.0 hr On-Duty (Not Driving) for unloading</span>
                  </div>
                </div>
              </Popup>
              <Tooltip direction="top">Drop-off: {locations.dropoff.label}</Tooltip>
            </Marker>
          )}

          {/* Intermediate Stops: Fuel, 30m break, 10h reset, 34h restart */}
          {intermediateStops.map((stop) => {
            const meta = stopMeta(stop.kind)
            const isSelected = selectedStopIndex === stop.originalIndex
            return (
              <Marker
                key={`stop-${stop.originalIndex}`}
                position={[stop.lat, stop.lng]}
                icon={pinIcon(meta.color, meta.icon, isSelected ? 36 : 28, isSelected)}
                eventHandlers={{
                  click: () => onSelectStop && onSelectStop(stop.originalIndex),
                }}
              >
                <Popup>
                  <div className="popup-card">
                    <div className="popup-header">
                      <span className="popup-icon">{meta.icon}</span>
                      <strong style={{ color: meta.color }}>{meta.label}</strong>
                    </div>
                    <p className="popup-label">{stop.label}</p>
                    <div className="popup-details">
                      <div>
                        <b>Duration:</b> {formatDuration(stop.hours)}
                      </div>
                      <div>
                        <b>Window:</b> {formatDateTime(stop.start)} &rarr;{' '}
                        {formatDateTime(stop.end)}
                      </div>
                      <div>
                        <b>Odometer:</b> Mile{' '}
                        {Number(stop.miles_from_origin).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </Popup>
                <Tooltip direction="top">{meta.label}</Tooltip>
              </Marker>
            )
          })}
        </MapContainer>
      </div>

      {/* Interactive Legend & Filters */}
      <div className="map-legend-bar">
        <span className="legend-title">Filter Pins:</span>
        <button
          type="button"
          className={`legend-chip ${activeFilter === 'all' ? 'active' : ''}`}
          onClick={() => setActiveFilter('all')}
        >
          All Events
        </button>
        <button
          type="button"
          className={`legend-chip ${activeFilter === 'fuel' ? 'active' : ''}`}
          onClick={() => setActiveFilter(activeFilter === 'fuel' ? 'all' : 'fuel')}
        >
          <span className="legend-dot" style={{ background: '#f59e0b' }} /> Fuel (1,000 mi)
        </button>
        <button
          type="button"
          className={`legend-chip ${activeFilter === 'break' ? 'active' : ''}`}
          onClick={() => setActiveFilter(activeFilter === 'break' ? 'all' : 'break')}
        >
          <span className="legend-dot" style={{ background: '#0284c7' }} /> 30-min Break
        </button>
        <button
          type="button"
          className={`legend-chip ${activeFilter === 'rest' ? 'active' : ''}`}
          onClick={() => setActiveFilter(activeFilter === 'rest' ? 'all' : 'rest')}
        >
          <span className="legend-dot" style={{ background: '#7c3aed' }} /> 10-hr Reset
        </button>
        <button
          type="button"
          className={`legend-chip ${activeFilter === 'restart' ? 'active' : ''}`}
          onClick={() => setActiveFilter(activeFilter === 'restart' ? 'all' : 'restart')}
        >
          <span className="legend-dot" style={{ background: '#db2777' }} /> 34-hr Restart
        </button>
      </div>
    </section>
  )
}
