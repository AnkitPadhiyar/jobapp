import { useEffect, useState } from 'react'

import EldLogSheet from './EldLogSheet.jsx'
import { formatDayLabel, formatDuration } from '../utils/format.js'

export default function LogBook({
  sheets = [],
  driver,
  carrier,
  vehicle,
  trailer,
  shippingDoc,
  homeTerminal,
}) {
  const [active, setActive] = useState(0)

  useEffect(() => {
    setActive(0)
  }, [sheets])

  if (!sheets?.length) return null

  const totalOnDuty = sheets.reduce((sum, sheet) => sum + (sheet.on_duty_hours || 0), 0)
  const totalDrivingMiles = sheets.reduce(
    (sum, sheet) => sum + (sheet.miles_driving_today || 0),
    0,
  )

  const handlePrevDay = () => {
    setActive((prev) => Math.max(0, prev - 1))
  }

  const handleNextDay = () => {
    setActive((prev) => Math.min(sheets.length - 1, prev + 1))
  }

  return (
    <section className="card logbook-card">
      <div className="card-head logbook-head-row">
        <div>
          <div className="logbook-badge-row">
            <h2>FMCSA Driver&rsquo;s Daily Log Sheets</h2>
            <span className="log-count-tag">
              {sheets.length} {sheets.length === 1 ? 'Calendar Day' : 'Calendar Days'}
            </span>
          </div>
          <p className="muted small">
            {formatDuration(totalOnDuty)} total on-duty time across haul &middot;{' '}
            {Number(totalDrivingMiles).toLocaleString()} driving miles
          </p>
        </div>

        <div className="logbook-actions-bar no-print">
          <button
            type="button"
            className="action-btn print-all-btn"
            onClick={() => window.print()}
            title="Print all daily log sheets to printer or save as PDF"
          >
            <span>🖨️ Print All Log Sheets (PDF)</span>
          </button>
        </div>
      </div>

      {/* Day Selector Tabs */}
      <div className="day-tabs-bar no-print">
        <div className="day-tabs-list" role="tablist">
          {sheets.map((sheet, index) => {
            const isActive = index === active
            return (
              <button
                key={sheet.date}
                role="tab"
                aria-selected={isActive}
                className={`day-tab-btn ${isActive ? 'is-active' : ''}`}
                onClick={() => setActive(index)}
              >
                <div className="tab-top-row">
                  <span className="tab-day-number">Day {sheet.day_index}</span>
                  {sheet.on_duty_hours > 0 && (
                    <span className="tab-duty-hours">
                      {formatDuration(sheet.on_duty_hours)}
                    </span>
                  )}
                </div>
                <span className="tab-date-string">{formatDayLabel(sheet.date)}</span>
                <span className="tab-miles-string">
                  {Number(sheet.miles_driving_today || 0).toLocaleString()} mi
                </span>
              </button>
            )
          })}
        </div>

        {/* Day Pager Arrows */}
        {sheets.length > 1 && (
          <div className="day-pager-arrows">
            <button
              type="button"
              className="pager-btn"
              onClick={handlePrevDay}
              disabled={active === 0}
              title="Previous Day"
            >
              &larr; Prev
            </button>
            <span className="pager-label">
              Day {active + 1} of {sheets.length}
            </span>
            <button
              type="button"
              className="pager-btn"
              onClick={handleNextDay}
              disabled={active === sheets.length - 1}
              title="Next Day"
            >
              Next &rarr;
            </button>
          </div>
        )}
      </div>

      {/* Daily Log Sheets Container */}
      <div className="log-sheets-container">
        {sheets.map((sheet, index) => (
          <div
            key={sheet.date}
            className={`log-sheet-page ${index === active ? 'active' : ''}`}
          >
            <EldLogSheet
              sheet={sheet}
              driver={driver}
              carrier={carrier}
              vehicle={vehicle}
              trailer={trailer}
              shippingDoc={shippingDoc}
              homeTerminal={homeTerminal}
            />
          </div>
        ))}
      </div>
    </section>
  )
}
