import { useState } from 'react'

import { buildDispatchManifest } from '../utils/format.js'

export default function DispatchManifestModal({
  isOpen,
  onClose,
  result,
  driverDetails,
}) {
  const [copied, setCopied] = useState(false)

  if (!isOpen || !result) return null

  const manifestText = buildDispatchManifest(result, driverDetails)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(manifestText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      alert('Could not copy to clipboard.')
    }
  }

  const handleDownloadTxt = () => {
    const blob = new Blob([manifestText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `dispatch-manifest-${result.inputs?.current_location?.replace(/[^a-zA-Z0-9]/g, '_') || 'haul'}.txt`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleDownloadJson = () => {
    const blob = new Blob([JSON.stringify(result, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `trip-plan-${result.id || 'export'}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card manifest-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title-wrap">
            <span className="modal-icon">📜</span>
            <div>
              <h3>Driver Dispatch Manifest &amp; Export</h3>
              <p className="muted small">
                Standard dispatch instructions, mile markers, and FMCSA stop windows.
              </p>
            </div>
          </div>
          <button type="button" className="close-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="modal-body manifest-body">
          <pre className="manifest-pre">{manifestText}</pre>
        </div>

        <div className="modal-foot">
          <div className="manifest-export-actions">
            <button
              type="button"
              className={`ghost-btn ${copied ? 'btn-copied' : ''}`}
              onClick={handleCopy}
            >
              {copied ? '✓ Copied to Clipboard!' : '📋 Copy to Clipboard'}
            </button>
            <button type="button" className="ghost-btn" onClick={handleDownloadTxt}>
              ⬇️ Download .TXT Manifest
            </button>
            <button type="button" className="ghost-btn" onClick={handleDownloadJson}>
              💾 Export JSON Payload
            </button>
          </div>
          <button type="button" className="primary-btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
