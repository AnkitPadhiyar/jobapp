import { useCallback, useEffect, useState } from 'react'

import ComplianceAudit from './components/ComplianceAudit.jsx'
import DispatchManifestModal from './components/DispatchManifestModal.jsx'
import LogBook from './components/LogBook.jsx'
import RouteMap from './components/RouteMap.jsx'
import StopTimeline from './components/StopTimeline.jsx'
import TripForm from './components/TripForm.jsx'
import TripHistory from './components/TripHistory.jsx'
import { getTrip, listTrips, planTrip } from './api.js'
import { formatDuration, formatMiles } from './utils/format.js'

export default function App() {
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState('overview') // 'overview', 'logs', 'audit'
  const [selectedStopIndex, setSelectedStopIndex] = useState(null)

  // Driver and vehicle details passed down to ELD Log Sheets
  const [driverDetails, setDriverDetails] = useState({
    driver: 'Alex Mercer',
    carrier: 'Apex Continental Express LLC',
    vehicle: 'Freightliner Cascadia #1042',
    trailer: '53ft Dry Van #TL-8820',
    shippingDoc: 'BOL-849204-US',
    homeTerminal: 'Dallas, TX Terminal',
  })

  // Modals state
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isManifestOpen, setIsManifestOpen] = useState(false)
  const [savedCount, setSavedCount] = useState(0)

  // Fetch count of saved trips for header badge
  const refreshSavedCount = useCallback(async () => {
    try {
      const trips = await listTrips()
      setSavedCount(Array.isArray(trips) ? trips.length : 0)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    refreshSavedCount()
  }, [refreshSavedCount])

  const handleSubmit = useCallback(
    async (payload) => {
      setLoading(true)
      setError('')
      setSelectedStopIndex(null)
      try {
        const data = await planTrip(payload, { persist: payload.save !== false })
        setResult(data)
        setActiveTab('overview')
        refreshSavedCount()
      } catch (submitError) {
        setError(submitError.message)
        setResult(null)
      } finally {
        setLoading(false)
      }
    },
    [refreshSavedCount],
  )

  const handleLoadTripFromHistory = useCallback(async (tripId) => {
    setLoading(true)
    setError('')
    setSelectedStopIndex(null)
    try {
      const data = await getTrip(tripId)
      setResult(data)
      setActiveTab('overview')
    } catch (err) {
      setError(`Could not load trip #${tripId}: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  return (
    <div className="app">
      {/* Top Professional Navigation Bar */}
      <header className="app-header no-print">
        <div className="header-container">
          <div className="brand-group">
            <div className="brand-mark">
              <span className="brand-icon">🚛</span>
            </div>
            <div className="brand-text">
              <div className="brand-title-row">
                <h1>LogiDuty ELD</h1>
                <span className="engine-badge">FMCSA §395 Certified Engine</span>
              </div>
              <p className="brand-subtitle">
                Hours-of-Service Trip Planner &middot; 70h/8-day Simulator &middot; Electronic Log Sheets
              </p>
            </div>
          </div>

          <div className="header-actions">
            <button
              type="button"
              className="nav-btn history-nav-btn"
              onClick={() => setIsHistoryOpen(true)}
              title="View saved trip history in database"
            >
              <span>📚 Saved Trips</span>
              {savedCount > 0 && <span className="nav-counter">{savedCount}</span>}
            </button>

            {result && (
              <>
                <button
                  type="button"
                  className="nav-btn manifest-nav-btn"
                  onClick={() => setIsManifestOpen(true)}
                  title="View dispatch manifest and export options"
                >
                  <span>📋 Dispatch Manifest</span>
                </button>

                <button
                  type="button"
                  className="nav-btn print-nav-btn"
                  onClick={() => window.print()}
                  title="Print all daily log sheets (PDF)"
                >
                  <span>🖨️ Print Logs (PDF)</span>
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main App Layout */}
      <div className="layout">
        {/* Left Sidebar: Trip Setup Form */}
        <aside className="sidebar no-print">
          <TripForm
            onSubmit={handleSubmit}
            loading={loading}
            driverDetails={driverDetails}
            onDriverDetailsChange={setDriverDetails}
          />
        </aside>

        {/* Main Content Area */}
        <main className="content">
          {error && (
            <div className="alert error no-print" role="alert">
              <div className="alert-icon">⚠️</div>
              <div className="alert-body">
                <strong>Planning Error</strong>
                <p>{error}</p>
              </div>
            </div>
          )}

          {result?.warnings?.length > 0 && (
            <div className="alert warn no-print">
              <div className="alert-icon">⚠️</div>
              <div className="alert-body">
                <strong>Routing &amp; HOS Notice</strong>
                {result.warnings.map((warning, idx) => (
                  <p key={idx}>{warning}</p>
                ))}
              </div>
            </div>
          )}

          {loading && (
            <div className="card loading-card no-print">
              <div className="spinner-wrap">
                <div className="spinner" />
              </div>
              <h3>Generating Route &amp; Simulating Duty Clocks</h3>
              <p className="muted">
                Geocoding waypoints, querying road networks, applying 49 CFR §395.3 rules, and
                drawing FMCSA log grids…
              </p>
              <div className="loading-steps-hints">
                <span>1. Multi-Leg Routing</span>
                <span>2. 11h Driving Limit</span>
                <span>3. 14h Duty Window</span>
                <span>4. 30m Breaks</span>
                <span>5. 1,000mi Fueling</span>
                <span>6. SVG Daily Logs</span>
              </div>
            </div>
          )}

          {!result && !loading && !error && (
            <div className="card empty-state-card no-print">
              <div className="empty-hero">
                <span className="hero-emoji">🗺️</span>
                <h2>Start Planning Your Commercial Haul</h2>
                <p className="hero-desc">
                  Input your starting location, pickup point, drop-off destination, and starting
                  cycle hours on the left. The engine deterministically plans every required stop,
                  simulates the 70-hour / 8-day duty clocks, and draws filled-out FMCSA daily log
                  sheets.
                </p>
              </div>

              <div className="features-grid">
                <div className="feature-tile">
                  <span className="feature-icon">⏱️</span>
                  <h4>FMCSA HOS Simulation</h4>
                  <p className="small muted">
                    Automatically schedules 30-minute breaks (8h rule), 10-hour sleeper resets
                    (11h/14h rule), and 34-hour restarts (70h cycle).
                  </p>
                </div>
                <div className="feature-tile">
                  <span className="feature-icon">⛽</span>
                  <h4>1,000-Mile Fueling</h4>
                  <p className="small muted">
                    Inserts 30-minute on-duty fueling stops at every 1,000-mile interval along the
                    highway network.
                  </p>
                </div>
                <div className="feature-tile">
                  <span className="feature-icon">📝</span>
                  <h4>Drawn ELD Daily Logs</h4>
                  <p className="small muted">
                    Generates official 24-hour 4-row step graph log sheets with 15-minute resolution,
                    remarks, recap table, and digital driver signature.
                  </p>
                </div>
                <div className="feature-tile">
                  <span className="feature-icon">🖨️</span>
                  <h4>Export &amp; Print Ready</h4>
                  <p className="small muted">
                    One-click print/PDF layout for DOT audit inspections, plus downloadable
                    dispatch manifests and JSON payloads.
                  </p>
                </div>
              </div>
            </div>
          )}

          {result && !loading && (
            <>
              {/* Trip KPI Summary Tiles */}
              <TripMetricsBar result={result} />

              {/* End-to-End Workflow Tab Bar */}
              <div className="workflow-tab-bar no-print">
                <button
                  type="button"
                  className={`workflow-tab ${activeTab === 'overview' ? 'is-active' : ''}`}
                  onClick={() => setActiveTab('overview')}
                >
                  <span className="tab-icon">🗺️</span>
                  <span>Route Map &amp; Schedule</span>
                </button>
                <button
                  type="button"
                  className={`workflow-tab ${activeTab === 'logs' ? 'is-active' : ''}`}
                  onClick={() => setActiveTab('logs')}
                >
                  <span className="tab-icon">📝</span>
                  <span>
                    ELD Daily Log Sheets ({result.daily_logs?.length || 0})
                  </span>
                </button>
                <button
                  type="button"
                  className={`workflow-tab ${activeTab === 'audit' ? 'is-active' : ''}`}
                  onClick={() => setActiveTab('audit')}
                >
                  <span className="tab-icon">⚖️</span>
                  <span>Compliance Audit</span>
                </button>
              </div>

              {/* Tab 1: Route & Stops */}
              <div className={`tab-view ${activeTab === 'overview' ? 'active' : 'hidden'}`}>
                <RouteMap
                  result={result}
                  selectedStopIndex={selectedStopIndex}
                  onSelectStop={setSelectedStopIndex}
                />
                <div className="split-layout">
                  <StopTimeline
                    stops={result.stops}
                    selectedStopIndex={selectedStopIndex}
                    onSelectStop={setSelectedStopIndex}
                  />
                  <CycleUsageCard result={result} />
                </div>
              </div>

              {/* Tab 2: ELD Daily Logs */}
              <div className={`tab-view ${activeTab === 'logs' ? 'active' : 'hidden'} printable-section`}>
                <LogBook
                  sheets={result.daily_logs}
                  driver={driverDetails.driver}
                  carrier={driverDetails.carrier}
                  vehicle={driverDetails.vehicle}
                  trailer={driverDetails.trailer}
                  shippingDoc={driverDetails.shippingDoc}
                  homeTerminal={driverDetails.homeTerminal}
                />
              </div>

              {/* Tab 3: Compliance Audit */}
              <div className={`tab-view ${activeTab === 'audit' ? 'active' : 'hidden'}`}>
                <ComplianceAudit result={result} />
              </div>
            </>
          )}
        </main>
      </div>

      {/* History Drawer Modal */}
      <TripHistory
        isOpen={isHistoryOpen}
        onClose={() => {
          setIsHistoryOpen(false)
          refreshSavedCount()
        }}
        onLoadTrip={handleLoadTripFromHistory}
        currentTripId={result?.id}
      />

      {/* Dispatch Manifest Modal */}
      <DispatchManifestModal
        isOpen={isManifestOpen}
        onClose={() => setIsManifestOpen(false)}
        result={result}
        driverDetails={driverDetails}
      />
    </div>
  )
}

function TripMetricsBar({ result }) {
  const { summary, route, stops = [] } = result
  const fuelStops = stops.filter((s) => s.kind === 'fuel').length
  const rests = stops.filter((s) => ['break', 'rest', 'restart'].includes(s.kind)).length

  return (
    <section className="card metrics-card no-print">
      <div className="metrics-head">
        <div className="route-flow-line">
          <span className="flow-dot origin" />
          <span className="flow-loc">{result.locations?.current?.label}</span>
          <span className="flow-arrow">&rarr;</span>
          <span className="flow-dot pickup" />
          <span className="flow-loc">{result.locations?.pickup?.label}</span>
          <span className="flow-arrow">&rarr;</span>
          <span className="flow-dot dropoff" />
          <span className="flow-loc">{result.locations?.dropoff?.label}</span>
        </div>
        {result.id && (
          <span className="trip-id-badge">Saved Haul #{result.id}</span>
        )}
      </div>

      <div className="metrics-grid">
        <div className="metric-tile">
          <span className="metric-lbl">Total Distance</span>
          <strong className="metric-val">{formatMiles(route.total_distance_miles)}</strong>
          <span className="metric-sub">{route.legs?.length || 2} Highway Legs</span>
        </div>
        <div className="metric-tile">
          <span className="metric-lbl">Driving Time</span>
          <strong className="metric-val">{formatDuration(summary.driving_hours)}</strong>
          <span className="metric-sub">Pure Road Time</span>
        </div>
        <div className="metric-tile">
          <span className="metric-lbl">On-Duty Time</span>
          <strong className="metric-val">{formatDuration(summary.on_duty_hours)}</strong>
          <span className="metric-sub">Loading &amp; Fueling</span>
        </div>
        <div className="metric-tile">
          <span className="metric-lbl">Total Elapsed Time</span>
          <strong className="metric-val">{formatDuration(summary.total_hours)}</strong>
          <span className="metric-sub">{result.daily_logs?.length || 1} Daily Log Sheets</span>
        </div>
        <div className="metric-tile">
          <span className="metric-lbl">Ending Cycle</span>
          <strong className="metric-val">
            {Number(summary.cycle_hours_used).toFixed(1)} / 70.0h
          </strong>
          <span className="metric-sub">
            {Math.max(0, 70 - Number(summary.cycle_hours_used)).toFixed(1)}h remaining
          </span>
        </div>
        <div className="metric-tile">
          <span className="metric-lbl">Planned Events</span>
          <strong className="metric-val">{stops.length} Stops</strong>
          <span className="metric-sub">
            {fuelStops} Fuel &middot; {rests} Rests
          </span>
        </div>
      </div>
    </section>
  )
}

function CycleUsageCard({ result }) {
  const { summary } = result
  const used = Math.min(70, Number(summary.cycle_hours_used) || 0)
  const startUsed = Math.min(70, Number(summary.cycle_hours_start) || 0)
  const tripHours = Math.max(0, used - startUsed)
  const remaining = Math.max(0, 70 - used)

  return (
    <section className="card cycle-card">
      <div className="card-head">
        <div className="card-title-row">
          <h2>70-Hour / 8-Day Duty Cycle</h2>
          <span className="badge cycle-indicator-badge">Rolling 8 Days</span>
        </div>
        <p className="muted small">
          Started with {startUsed.toFixed(1)}h used. Haul consumed {tripHours.toFixed(1)}h of duty
          clock.
        </p>
      </div>

      <div className="cycle-bar-wrap">
        <div className="cycle-bar-track">
          <div
            className="cycle-bar-segment prior"
            style={{ width: `${(startUsed / 70) * 100}%` }}
            title={`Prior Cycle: ${startUsed.toFixed(1)}h`}
          />
          <div
            className="cycle-bar-segment current-haul"
            style={{ width: `${(tripHours / 70) * 100}%` }}
            title={`This Haul: ${tripHours.toFixed(1)}h`}
          />
        </div>
        <div className="cycle-bar-labels">
          <span>0h</span>
          <span>17.5h</span>
          <span>35h (Half)</span>
          <span>52.5h</span>
          <span>70h Limit</span>
        </div>
      </div>

      <div className="cycle-legend-row">
        <span>
          <i className="swatch prior" /> Prior Consumed ({startUsed.toFixed(1)}h)
        </span>
        <span>
          <i className="swatch trip" /> This Haul ({tripHours.toFixed(1)}h)
        </span>
        <span>
          <i className="swatch remaining" /> Available ({remaining.toFixed(1)}h)
        </span>
      </div>

      <ul className="duty-breakdown-list">
        <li>
          <span>
            <i className="status-dot" style={{ background: '#64748b' }} /> Off Duty
          </span>
          <b>{formatDuration(summary.off_duty_hours)}</b>
        </li>
        <li>
          <span>
            <i className="status-dot" style={{ background: '#6366f1' }} /> Sleeper Berth (10h Resets)
          </span>
          <b>{formatDuration(summary.sleeper_hours)}</b>
        </li>
        <li>
          <span>
            <i className="status-dot" style={{ background: '#10b981' }} /> Driving (Highway)
          </span>
          <b>{formatDuration(summary.driving_hours)}</b>
        </li>
        <li>
          <span>
            <i className="status-dot" style={{ background: '#f59e0b' }} /> On Duty (Loading &amp; Fuel)
          </span>
          <b>{formatDuration(summary.on_duty_hours)}</b>
        </li>
      </ul>
    </section>
  )
}
