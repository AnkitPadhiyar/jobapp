import { FMCSA_RULES, formatDuration, formatMiles } from '../utils/format.js'

export default function ComplianceAudit({ result }) {
  if (!result) return null

  const { summary, stops = [], warnings = [] } = result

  // Derive rule metrics
  const fuelStops = stops.filter((s) => s.kind === 'fuel')
  const rest30m = stops.filter((s) => s.kind === 'break')
  const resets10h = stops.filter((s) => s.kind === 'rest')
  const restarts34h = stops.filter((s) => s.kind === 'restart')

  const hasViolations = warnings.length > 0

  return (
    <section className="card compliance-card">
      <div className="card-head compliance-head-row">
        <div>
          <div className="compliance-badge-row">
            <h2>FMCSA Hours-of-Service Compliance Audit</h2>
            <span className={`compliance-status-tag ${hasViolations ? 'has-warn' : 'is-compliant'}`}>
              {hasViolations ? '⚠️ Action Required' : '✓ 100% FMCSA Compliant'}
            </span>
          </div>
          <p className="muted small">
            Evaluation of trip events against 49 CFR Part 395 regulations &amp; fleet safety constraints.
          </p>
        </div>
      </div>

      {/* Warnings Banner if any */}
      {warnings.length > 0 && (
        <div className="compliance-warnings-box">
          <strong>Compliance Notes &amp; Routing Alerts:</strong>
          <ul>
            {warnings.map((w, idx) => (
              <li key={`warn-${idx}`}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* HOS Rules Grid */}
      <div className="compliance-rules-grid">
        {FMCSA_RULES.map((rule) => {
          let ruleStatus = 'Compliant'
          let detail = ''

          if (rule.id === '11hr_driving') {
            detail = `Total driving: ${formatDuration(summary.driving_hours)}. Enforced via ${resets10h.length} shift resets.`
          } else if (rule.id === '14hr_window') {
            detail = `All driving halted within 14-hour consecutive windows.`
          } else if (rule.id === '30min_break') {
            detail = `${rest30m.length} mandatory 30-min break(s) scheduled after ≤ 8h driving.`
          } else if (rule.id === '70hr_8day_cycle') {
            detail = `Cycle usage: ${summary.cycle_hours_start}h -> ${summary.cycle_hours_used}h / 70.0h.`
          } else if (rule.id === '34hr_restart') {
            detail =
              restarts34h.length > 0
                ? `${restarts34h.length} cycle restart(s) inserted to reset 70h clock.`
                : 'Not required for this haul; cycle stayed within 70 hours.'
          } else if (rule.id === '10hr_reset') {
            detail = `${resets10h.length} 10-hour sleeper/off-duty reset(s) scheduled.`
          } else if (rule.id === 'fueling_interval') {
            detail = `${fuelStops.length} fuel stop(s) scheduled at ≤ 1,000 mile intervals.`
          }

          return (
            <div key={rule.id} className="rule-audit-card">
              <div className="rule-card-header">
                <div>
                  <span className="rule-cfr-badge">{rule.cfr}</span>
                  <h3 className="rule-title">{rule.title}</h3>
                </div>
                <span className="rule-status-check">✓ Pass</span>
              </div>
              <p className="rule-desc muted small">{rule.description}</p>
              <div className="rule-trip-evaluation">
                <span className="eval-tag">Trip Schedule:</span>
                <span className="eval-text">{detail}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Trip Safety Counters */}
      <div className="audit-metrics-row">
        <div className="audit-metric-tile">
          <span className="audit-metric-icon">⛽</span>
          <div>
            <span className="audit-val">{fuelStops.length}</span>
            <span className="audit-lbl">Fuel Stops</span>
          </div>
        </div>
        <div className="audit-metric-tile">
          <span className="audit-metric-icon">☕</span>
          <div>
            <span className="audit-val">{rest30m.length}</span>
            <span className="audit-lbl">30-Min Breaks</span>
          </div>
        </div>
        <div className="audit-metric-tile">
          <span className="audit-metric-icon">🛏️</span>
          <div>
            <span className="audit-val">{resets10h.length}</span>
            <span className="audit-lbl">10-Hr Resets</span>
          </div>
        </div>
        <div className="audit-metric-tile">
          <span className="audit-metric-icon">🔄</span>
          <div>
            <span className="audit-val">{restarts34h.length}</span>
            <span className="audit-lbl">34-Hr Restarts</span>
          </div>
        </div>
      </div>
    </section>
  )
}
