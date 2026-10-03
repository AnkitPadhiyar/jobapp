import { useEffect, useState } from 'react'

import { deleteTrip, listTrips } from '../api.js'
import { formatDateTime, formatMiles } from '../utils/format.js'

export default function TripHistory({ isOpen, onClose, onLoadTrip, currentTripId }) {
  const [trips, setTrips] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [deletingId, setDeletingId] = useState(null)

  const fetchTrips = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await listTrips()
      setTrips(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err.message || 'Could not load saved trips.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      fetchTrips()
    }
  }, [isOpen])

  const handleDelete = async (e, id) => {
    e.stopPropagation()
    if (!window.confirm('Are you sure you want to delete this planned trip from history?')) {
      return
    }
    setDeletingId(id)
    try {
      await deleteTrip(id)
      setTrips((prev) => prev.filter((t) => t.id !== id))
    } catch (err) {
      alert(`Could not delete trip: ${err.message}`)
    } finally {
      setDeletingId(null)
    }
  }

  if (!isOpen) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card history-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title-wrap">
            <span className="modal-icon">📚</span>
            <div>
              <h3>Saved Trips &amp; Haul History</h3>
              <p className="muted small">
                Previously planned hauls stored in database. Click any trip to restore route &amp; logs.
              </p>
            </div>
          </div>
          <button type="button" className="close-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="modal-body history-body">
          {loading && (
            <div className="history-placeholder">
              <div className="mini-spinner" />
              <p className="muted">Fetching saved trips from database…</p>
            </div>
          )}

          {error && (
            <div className="alert error">
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && trips.length === 0 && (
            <div className="history-empty">
              <span className="empty-icon">🚛</span>
              <h4>No saved trips yet</h4>
              <p className="muted small">
                Plan a trip on the main screen with &ldquo;Dry Run&rdquo; unchecked to persist it here.
              </p>
            </div>
          )}

          {!loading && trips.length > 0 && (
            <ul className="history-list">
              {trips.map((item) => {
                const isCurrent = currentTripId === item.id
                return (
                  <li
                    key={item.id}
                    className={`history-item ${isCurrent ? 'is-active-trip' : ''}`}
                    onClick={() => {
                      onLoadTrip(item.id)
                      onClose()
                    }}
                  >
                    <div className="history-item-main">
                      <div className="history-locations-row">
                        <span className="history-tag">#{item.id}</span>
                        <strong className="route-string">
                          {item.current_location} &rarr; {item.pickup_location} &rarr;{' '}
                          {item.dropoff_location}
                        </strong>
                        {isCurrent && <span className="active-tag">Active</span>}
                      </div>

                      <div className="history-meta-row">
                        <span>📏 {formatMiles(item.total_distance_miles)}</span>
                        <span>&bull;</span>
                        <span>
                          📅 {item.log_days} {item.log_days === 1 ? 'day' : 'days'} of logs
                        </span>
                        <span>&bull;</span>
                        <span>🔄 Seed cycle: {item.current_cycle_used}h</span>
                        <span>&bull;</span>
                        <span className="history-date">
                          {formatDateTime(item.created_at)}
                        </span>
                      </div>
                    </div>

                    <div className="history-item-actions">
                      <button
                        type="button"
                        className="load-trip-btn"
                        onClick={() => {
                          onLoadTrip(item.id)
                          onClose()
                        }}
                      >
                        Load Trip
                      </button>
                      <button
                        type="button"
                        className="delete-trip-btn"
                        disabled={deletingId === item.id}
                        onClick={(e) => handleDelete(e, item.id)}
                        title="Delete from database"
                      >
                        {deletingId === item.id ? '…' : '🗑️'}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="modal-foot">
          <button type="button" className="ghost-btn" onClick={fetchTrips} disabled={loading}>
            🔄 Refresh History
          </button>
          <button type="button" className="primary-btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
