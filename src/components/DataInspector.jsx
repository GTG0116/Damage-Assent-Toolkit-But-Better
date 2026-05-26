import { useEffect, useState } from 'react'
import { EF_COLORS, LAYER_URLS, getEFColor } from '../constants'

const POINT_FIELDS = [
  { key: 'efscale', label: 'EF Scale', mono: true, highlight: true },
  { key: 'windspeed', label: 'Wind Speed', mono: true },
  { key: 'stormdate', label: 'Storm Date', date: true },
  { key: 'surveydate', label: 'Survey Date', date: true },
  { key: 'surveytype', label: 'Survey Type' },
  { key: 'injuries', label: 'Injuries', mono: true },
  { key: 'deaths', label: 'Deaths', mono: true },
  { key: 'office', label: 'WFO Office' },
  { key: 'damage_txt', label: 'Damage Description' },
  { key: 'dod_txt', label: 'Degree of Damage' },
  { key: 'comments', label: 'Comments' },
]

const LINE_FIELDS = [
  { key: 'efscale', label: 'EF Scale', mono: true, highlight: true },
  { key: 'maxwind', label: 'Max Wind (mph)', mono: true },
  { key: 'stormdate', label: 'Storm Date', date: true },
  { key: 'starttime', label: 'Start Time', date: true },
  { key: 'endtime', label: 'End Time', date: true },
  { key: 'length', label: 'Track Length (mi)', mono: true },
  { key: 'width', label: 'Width (yd)', mono: true },
  { key: 'injuries', label: 'Injuries', mono: true },
  { key: 'fatalities', label: 'Fatalities', mono: true },
  { key: 'propdamage', label: 'Property Damage', currency: true },
  { key: 'cropdamage', label: 'Crop Damage', currency: true },
  { key: 'wfo', label: 'WFO Office' },
  { key: 'comments', label: 'Comments' },
]

const POLYGON_FIELDS = [
  { key: 'efscale', label: 'EF Scale', mono: true, highlight: true },
  { key: 'stormdate', label: 'Storm Date', date: true },
  { key: 'office', label: 'WFO Office' },
  { key: 'comments', label: 'Comments' },
]

const FIELD_MAP = { lines: LINE_FIELDS, points: POINT_FIELDS, polygons: POLYGON_FIELDS }

const TYPE_LABELS = { lines: 'Damage Track', points: 'Survey Point', polygons: 'Survey Area' }

function fmt(field, value) {
  if (value === null || value === undefined || value === '') return null
  if (field.date) {
    const d = new Date(value)
    if (isNaN(d)) return String(value)
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
  if (field.currency) {
    const n = parseFloat(value)
    if (!n || n <= 0) return null
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
  }
  return String(value)
}

export default function DataInspector({ feature, onClose }) {
  const open = !!feature
  const props = feature?.feature?.properties ?? {}
  const type = feature?.type ?? 'points'
  const fields = FIELD_MAP[type] ?? POINT_FIELDS

  const efscale = (props.efscale ?? '').toString().toUpperCase().trim() || 'Unknown'
  const accentColor = getEFColor(props)
  const accentGlow = EF_COLORS[efscale] ? `0 0 16px ${accentColor}55` : 'none'

  const [images, setImages] = useState([])
  const [imagesLoading, setImagesLoading] = useState(false)

  useEffect(() => {
    setImages([])
    if (feature?.type !== 'points') return
    const oid = feature?.feature?.properties?.OBJECTID
    if (!oid) return

    setImagesLoading(true)
    const controller = new AbortController()
    fetch(`${LAYER_URLS.points}/${oid}/attachments?f=json`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        const imgs = (data.attachmentInfos ?? [])
          .filter((a) => a.contentType?.startsWith('image/'))
          .map((a) => `${LAYER_URLS.points}/${oid}/attachments/${a.id}`)
        setImages(imgs)
      })
      .catch(() => {})
      .finally(() => setImagesLoading(false))

    return () => controller.abort()
  }, [feature])

  return (
    <div className={`inspector${open ? ' inspector--open' : ''}`}>
      <div
        className="inspector__header"
        style={{ borderLeftColor: open ? accentColor : 'transparent' }}
      >
        <div className="inspector__title">
          <span
            className="inspector__ef-badge"
            style={{ color: accentColor, textShadow: accentGlow }}
          >
            {efscale}
          </span>
          <span className="inspector__type-label">{TYPE_LABELS[type] ?? 'Damage Record'}</span>
        </div>
        <button className="inspector__close" onClick={onClose}>✕</button>
      </div>

      <div className="inspector__body">
        {fields.map(({ key, label, mono, highlight, date, currency }) => {
          const raw = props[key]
          const display = fmt({ date, currency }, raw)
          return (
            <div key={key} className="inspector__row">
              <span className="inspector__key">{label}</span>
              {display ? (
                <span
                  className={`inspector__val${mono || highlight ? ' inspector__val--mono' : ''}${highlight ? ' inspector__val--highlight' : ''}`}
                  style={highlight ? { color: accentColor, textShadow: `0 0 10px ${accentColor}66` } : {}}
                >
                  {display}
                </span>
              ) : (
                <span className="inspector__val inspector__val--empty">—</span>
              )}
            </div>
          )
        })}

        {/* Photos section — points only */}
        {type === 'points' && (
          <div className="inspector__photos">
            <div className="inspector__photos-header">
              <span className="inspector__key">Photos</span>
              {!imagesLoading && images.length > 0 && (
                <span className="inspector__photos-count">{images.length}</span>
              )}
            </div>
            {imagesLoading ? (
              <div className="inspector__photos-loading">
                <div className="loading-spinner" style={{ width: 11, height: 11 }} />
                Checking for photos…
              </div>
            ) : images.length > 0 ? (
              <div className="inspector__photo-grid">
                {images.map((url, i) => (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inspector__photo-link"
                  >
                    <img
                      src={url}
                      alt={`Survey photo ${i + 1}`}
                      className="inspector__photo-thumb"
                      onError={(e) => { e.currentTarget.parentElement.style.display = 'none' }}
                    />
                    <div className="inspector__photo-overlay">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                        <polyline points="15 3 21 3 21 9"/>
                        <line x1="10" y1="14" x2="21" y2="3"/>
                      </svg>
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <div className="inspector__photos-empty">No photos attached</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
