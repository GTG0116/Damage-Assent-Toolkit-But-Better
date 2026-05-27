import { useState } from 'react'
import {
  EF_COLORS, EF_LEGEND, SPC_COLORS, SPC_LEGEND, SPC_TIMES,
  FILTERED_ALERT_TYPES, ALERT_COLORS, getEFColor,
} from '../constants'

const PRESETS = [
  { id: '3out', label: 'Next 3 days', days: [0, 3] },
  { id: '3back', label: 'Past 3 days', days: [-3, 0] },
  { id: '7back', label: 'Past 7 days', days: [-7, 0] },
  { id: '14back', label: 'Past 14 days', days: [-14, 0] },
]

function presetFromRange({ start, end }) {
  if (!start || !end) return 'custom'
  const today = new Date()
  const fmt = (d) => d.toISOString().slice(0, 10)
  for (const p of PRESETS) {
    const s = new Date(today); s.setDate(s.getDate() + p.days[0])
    const e = new Date(today); e.setDate(e.getDate() + p.days[1])
    if (start === fmt(s) && end === fmt(e)) return p.id
  }
  return 'custom'
}

function toMs(val) {
  if (val === null || val === undefined) return null
  if (typeof val === 'number') return val
  const d = new Date(val)
  return isNaN(d) ? null : d.getTime()
}

const UTC_MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function fmtUtc(ms) {
  if (!ms) return null
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${UTC_MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`
}

function interpAnimTime(pathAnim) {
  if (!pathAnim.active || !pathAnim.feature) return null
  const props = pathAnim.feature.properties ?? {}
  const startMs = toMs(props.starttime)
  const endMs = toMs(props.endtime)
  if (startMs === null || endMs === null) return null
  const ratio = pathAnim.totalSteps > 0 ? pathAnim.step / pathAnim.totalSteps : 0
  return startMs + ratio * (endMs - startMs)
}

const LAYERS = [
  {
    key: 'lines',
    label: 'Damage Tracks',
    desc: 'Tornado & wind damage paths',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M2 8 Q5 4 8 8 Q11 12 14 8" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
      </svg>
    ),
  },
  {
    key: 'points',
    label: 'Survey Points',
    desc: 'Individual damage survey locations',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="4" stroke="#94A3B8" strokeWidth="1.5"/>
        <circle cx="8" cy="8" r="1.5" fill="#94A3B8"/>
      </svg>
    ),
  },
  {
    key: 'polygons',
    label: 'Survey Areas',
    desc: 'Damage assessment polygons',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M3 5 L8 2 L13 5 L13 11 L8 14 L3 11 Z" stroke="#94A3B8" strokeWidth="1.5" fill="none"/>
      </svg>
    ),
  },
]

const RADAR_SPEEDS = [
  { label: 'Slow', ms: 500 },
  { label: 'Normal', ms: 200 },
  { label: 'Fast', ms: 80 },
]

const ANIM_SPEEDS = [
  { label: 'Slow', ms: 300 },
  { label: 'Normal', ms: 120 },
  { label: 'Fast', ms: 40 },
]

export default function Sidebar({
  mobileOpen, onMobileClose,
  layers, onToggleLayer,
  dateRange, onDateRangeChange,
  onSearch,
  spcOutlook, onSpcChange,
  alertsOverlay, onAlertsChange,
  alertTypes, onToggleAlertType,
  lsrOverlay, onLsrChange,
  radarOverlay, onRadarChange,
  pathAnim, onPathAnimChange, onClosePathAnim,
}) {
  const [query, setQuery] = useState('')
  const [layersOpen, setLayersOpen] = useState(true)
  const [legendOpen, setLegendOpen] = useState(false)
  const [spcOpen, setSpcOpen] = useState(false)
  const [radarOpen, setRadarOpen] = useState(false)
  const [alertsOpen, setAlertsOpen] = useState(false)
  const [alertsFilterOpen, setAlertsFilterOpen] = useState(false)
  const [lsrOpen, setLsrOpen] = useState(false)

  const activePreset = presetFromRange(dateRange)
  const daySpan = dateRange.start && dateRange.end
    ? Math.round((new Date(dateRange.end) - new Date(dateRange.start)) / 86400000)
    : null
  const warnLargeRange = daySpan !== null && daySpan > 14

  const handlePresetSelect = (id) => {
    const preset = PRESETS.find((p) => p.id === id)
    if (!preset) return
    const today = new Date()
    const s = new Date(today); s.setDate(s.getDate() + preset.days[0])
    const e = new Date(today); e.setDate(e.getDate() + preset.days[1])
    const fmt = (d) => d.toISOString().slice(0, 10)
    onDateRangeChange({ start: fmt(s), end: fmt(e) })
  }

  const handleDateInput = (key, val) => {
    onDateRangeChange({ ...dateRange, [key]: val })
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (query.trim()) onSearch(query.trim())
  }

  const progressPct = pathAnim.totalSteps > 0
    ? Math.round((pathAnim.step / pathAnim.totalSteps) * 100)
    : 0

  const animCurrentMs = interpAnimTime(pathAnim)
  const animEF = pathAnim.feature?.properties?.efscale
    ? pathAnim.feature.properties.efscale.toString().toUpperCase().trim()
    : null
  const animColor = animEF ? (EF_COLORS[animEF] ?? EF_COLORS.default) : EF_COLORS.default

  return (
    <aside className={`sidebar${mobileOpen ? ' sidebar--mobile-open' : ''}`}>
      {/* Header */}
      <div className="sidebar__header">
        <div className="sidebar__logo">
          <div className="sidebar__logo-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                stroke="#00F5FF"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div>
            <div className="sidebar__logo-title">NOAA DAT</div>
            <div className="sidebar__logo-sub">Damage Assessment Toolkit</div>
          </div>
        </div>
      </div>

      {/* Search */}
      <form className="sidebar__search" onSubmit={handleSubmit}>
        <input
          type="text"
          className="sidebar__search-input"
          placeholder="Search city, state, or coordinates…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="sidebar__search-btn" aria-label="Search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
        </button>
      </form>

      <div className="sidebar__section-divider" />

      {/* ── Path Animation Panel ───────────────────────────────────────────── */}
      {pathAnim.active && (
        <>
          <div className="sidebar__anim-panel">
            <div className="sidebar__anim-header">
              <div className="sidebar__anim-title">
                {animEF && (
                  <span className="sidebar__anim-ef" style={{ color: animColor }}>
                    {animEF}
                  </span>
                )}
                <span className="sidebar__anim-label">Tornado Path</span>
              </div>
              <button className="sidebar__anim-close" onClick={onClosePathAnim} title="Dismiss">✕</button>
            </div>

            <div className="sidebar__anim-progress">
              <div
                className="sidebar__anim-progress-fill"
                style={{ width: `${progressPct}%`, background: animColor }}
              />
            </div>

            <div className="sidebar__anim-btns">
              <button
                className="sidebar__anim-btn sidebar__anim-btn--play"
                onClick={() => onPathAnimChange((prev) => ({ ...prev, playing: !prev.playing }))}
              >
                {pathAnim.playing ? '⏸ Pause' : '▶ Play'}
              </button>
              <button
                className="sidebar__anim-btn"
                onClick={() => onPathAnimChange((prev) => ({ ...prev, playing: false, step: 0 }))}
                title="Reset"
              >
                ↺
              </button>
              <span className="sidebar__anim-time">
                {animCurrentMs ? fmtUtc(animCurrentMs) : `${progressPct}%`}
              </span>
            </div>

            <div className="sidebar__speed-btns">
              {ANIM_SPEEDS.map(({ label, ms }) => (
                <button
                  key={label}
                  className={`sidebar__speed-btn${pathAnim.speed === ms ? ' active' : ''}`}
                  onClick={() => onPathAnimChange((prev) => ({ ...prev, speed: ms }))}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="sidebar__section-divider" />
        </>
      )}

      {/* DAT Layers */}
      <div className="sidebar__section">
        <button className="sidebar__accordion" onClick={() => setLayersOpen((v) => !v)}>
          <span>Damage Layers</span>
          <span className={`sidebar__chevron${layersOpen ? ' open' : ''}`}>›</span>
        </button>
        {layersOpen && (
          <div className="sidebar__layer-list">
            {LAYERS.map(({ key, label, desc, icon }) => (
              <div key={key} className="sidebar__layer-toggle" onClick={() => onToggleLayer(key)}>
                <span className="sidebar__layer-icon">{icon}</span>
                <div className="sidebar__layer-info">
                  <span className="sidebar__layer-name">{label}</span>
                  <span className="sidebar__layer-desc">{desc}</span>
                </div>
                <div
                  className={`sidebar__toggle${layers[key] ? ' on' : ''}`}
                  role="switch"
                  aria-checked={layers[key]}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="sidebar__section-divider" />

      {/* Date filter */}
      <div className="sidebar__section">
        <div className="sidebar__field-label">Date Filter</div>
        <select
          className="sidebar__select"
          value={activePreset}
          onChange={(e) => handlePresetSelect(e.target.value)}
        >
          {activePreset === 'custom' && (
            <option value="custom" disabled>Custom range</option>
          )}
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        {warnLargeRange && (
          <div className="sidebar__range-warn">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            {daySpan} days — may be slow on mobile
          </div>
        )}
        <div className="sidebar__date-inputs">
          <div className="sidebar__date-row">
            <span className="sidebar__date-label">From</span>
            <input
              type="date"
              className="sidebar__date-input"
              value={dateRange.start}
              onChange={(e) => handleDateInput('start', e.target.value)}
            />
          </div>
          <div className="sidebar__date-row">
            <span className="sidebar__date-label">To</span>
            <input
              type="date"
              className="sidebar__date-input"
              value={dateRange.end}
              onChange={(e) => handleDateInput('end', e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="sidebar__section-divider" />

      {/* SPC Day 1 Outlook */}
      <div className="sidebar__section">
        <button className="sidebar__accordion" onClick={() => setSpcOpen((v) => !v)}>
          <span>SPC Day 1 Outlook</span>
          <div className="sidebar__accordion-right">
            <div
              className={`sidebar__toggle sidebar__toggle--sm${spcOutlook.enabled ? ' on' : ''}`}
              role="switch"
              aria-checked={spcOutlook.enabled}
              onClick={(e) => {
                e.stopPropagation()
                onSpcChange({ ...spcOutlook, enabled: !spcOutlook.enabled })
              }}
            />
            <span className={`sidebar__chevron${spcOpen ? ' open' : ''}`}>›</span>
          </div>
        </button>
        {spcOpen && (
          <div className="sidebar__overlay-controls">
            <div className="sidebar__date-row">
              <span className="sidebar__date-label">Date</span>
              <input
                type="date"
                className="sidebar__date-input"
                value={spcOutlook.date}
                onChange={(e) => onSpcChange({ ...spcOutlook, date: e.target.value })}
              />
            </div>
            <div className="sidebar__date-row" style={{ marginTop: 5 }}>
              <span className="sidebar__date-label">Time</span>
              <select
                className="sidebar__select sidebar__select--sm"
                value={spcOutlook.time}
                onChange={(e) => onSpcChange({ ...spcOutlook, time: e.target.value })}
              >
                {SPC_TIMES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="sidebar__overlay-legend">
              {SPC_LEGEND.map(({ key, label, desc }) => (
                <div key={key} className="sidebar__legend-row">
                  <div
                    className="sidebar__legend-swatch"
                    style={{ background: SPC_COLORS[key] }}
                  />
                  <span className="sidebar__legend-label" style={{ width: 42 }}>{label}</span>
                  <span className="sidebar__legend-range">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="sidebar__section-divider" />

      {/* ── Radar ─────────────────────────────────────────────────────────── */}
      <div className="sidebar__section">
        <button className="sidebar__accordion" onClick={() => setRadarOpen((v) => !v)}>
          <span>NEXRAD Radar</span>
          <div className="sidebar__accordion-right">
            <div
              className={`sidebar__toggle sidebar__toggle--sm${radarOverlay.enabled ? ' on' : ''}`}
              role="switch"
              aria-checked={radarOverlay.enabled}
              onClick={(e) => {
                e.stopPropagation()
                onRadarChange({ ...radarOverlay, enabled: !radarOverlay.enabled, playing: false })
              }}
            />
            <span className={`sidebar__chevron${radarOpen ? ' open' : ''}`}>›</span>
          </div>
        </button>
        {radarOpen && (
          <div className="sidebar__overlay-controls">
            <div className="sidebar__overlay-note">
              IEM composite NEXRAD reflectivity. Frames at 5-min intervals; older archives may have gaps.
            </div>
            <div className="sidebar__date-row">
              <span className="sidebar__date-label">Date</span>
              <input
                type="date"
                className="sidebar__date-input"
                value={radarOverlay.date}
                onChange={(e) => onRadarChange({ ...radarOverlay, date: e.target.value, playing: false })}
              />
            </div>
            <div className="sidebar__date-row" style={{ marginTop: 5 }}>
              <span className="sidebar__date-label">Time</span>
              <input
                type="time"
                className="sidebar__date-input"
                value={radarOverlay.time}
                onChange={(e) => onRadarChange({ ...radarOverlay, time: e.target.value, playing: false })}
              />
            </div>
            <div className="sidebar__anim-btns" style={{ marginTop: 8 }}>
              <button
                className={`sidebar__anim-btn${radarOverlay.playing ? '' : ' sidebar__anim-btn--play'}`}
                style={radarOverlay.playing ? { borderColor: 'rgba(255,160,0,0.4)', color: '#FFA500' } : {}}
                onClick={() => onRadarChange({ ...radarOverlay, playing: !radarOverlay.playing })}
                disabled={pathAnim.playing}
                title={pathAnim.playing ? 'Controlled by path animation' : undefined}
              >
                {radarOverlay.playing ? '⏸ Pause Loop' : '▶ Play Loop'}
              </button>
            </div>
            <div className="sidebar__speed-btns">
              {RADAR_SPEEDS.map(({ label, ms }) => (
                <button
                  key={label}
                  className={`sidebar__speed-btn${radarOverlay.speed === ms ? ' active' : ''}`}
                  onClick={() => onRadarChange({ ...radarOverlay, speed: ms })}
                >
                  {label}
                </button>
              ))}
            </div>
            {pathAnim.playing && (
              <div className="sidebar__overlay-note" style={{ marginTop: 6, borderColor: 'rgba(0,245,255,0.15)', color: '#64748B' }}>
                Radar synced to path animation
              </div>
            )}
          </div>
        )}
      </div>

      <div className="sidebar__section-divider" />

      {/* NWS Alerts */}
      <div className="sidebar__section">
        <button className="sidebar__accordion" onClick={() => setAlertsOpen((v) => !v)}>
          <span>NWS Alerts</span>
          <div className="sidebar__accordion-right">
            <div
              className={`sidebar__toggle sidebar__toggle--sm${alertsOverlay.enabled ? ' on' : ''}`}
              role="switch"
              aria-checked={alertsOverlay.enabled}
              onClick={(e) => {
                e.stopPropagation()
                onAlertsChange({ ...alertsOverlay, enabled: !alertsOverlay.enabled })
              }}
            />
            <span className={`sidebar__chevron${alertsOpen ? ' open' : ''}`}>›</span>
          </div>
        </button>
        {alertsOpen && (
          <div className="sidebar__overlay-controls">
            <div className="sidebar__overlay-note">
              Shows active alerts in a 24-hour window from the selected date/time (UTC).
            </div>
            <div className="sidebar__date-row">
              <span className="sidebar__date-label">Date</span>
              <input
                type="date"
                className="sidebar__date-input"
                value={alertsOverlay.date}
                onChange={(e) => onAlertsChange({ ...alertsOverlay, date: e.target.value })}
              />
            </div>
            <div className="sidebar__date-row" style={{ marginTop: 5 }}>
              <span className="sidebar__date-label">Time</span>
              <input
                type="time"
                className="sidebar__date-input"
                value={alertsOverlay.time}
                onChange={(e) => onAlertsChange({ ...alertsOverlay, time: e.target.value })}
              />
            </div>

            {/* Alert type filters */}
            <button
              className="sidebar__accordion"
              style={{ marginTop: 8, fontSize: 10, padding: '6px 0' }}
              onClick={() => setAlertsFilterOpen((v) => !v)}
            >
              <span style={{ color: '#475569' }}>
                Filter Types ({alertTypes.size}/{FILTERED_ALERT_TYPES.length})
              </span>
              <span className={`sidebar__chevron${alertsFilterOpen ? ' open' : ''}`}>›</span>
            </button>

            {alertsFilterOpen && (
              <div className="sidebar__filter-list">
                <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                  <button
                    className="sidebar__speed-btn"
                    style={{ flex: 'none', padding: '3px 8px' }}
                    onClick={() => FILTERED_ALERT_TYPES.forEach((t) => { if (!alertTypes.has(t)) onToggleAlertType(t) })}
                  >
                    All
                  </button>
                  <button
                    className="sidebar__speed-btn"
                    style={{ flex: 'none', padding: '3px 8px' }}
                    onClick={() => FILTERED_ALERT_TYPES.filter((t) => alertTypes.has(t)).forEach((t) => onToggleAlertType(t))}
                  >
                    None
                  </button>
                </div>
                {FILTERED_ALERT_TYPES.map((type) => {
                  const on = alertTypes.has(type)
                  return (
                    <div
                      key={type}
                      className="sidebar__filter-item"
                      onClick={() => onToggleAlertType(type)}
                    >
                      <div className={`sidebar__filter-check${on ? ' checked' : ''}`}>
                        {on && (
                          <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                            <polyline points="1.5,5 4,7.5 8.5,2" stroke="#00F5FF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                      <div
                        className="sidebar__legend-swatch"
                        style={{ background: ALERT_COLORS[type] ?? '#94A3B8', width: 9, height: 9 }}
                      />
                      <span className="sidebar__filter-label">{type}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="sidebar__section-divider" />

      {/* Local Storm Reports */}
      <div className="sidebar__section">
        <button className="sidebar__accordion" onClick={() => setLsrOpen((v) => !v)}>
          <span>Local Storm Reports</span>
          <div className="sidebar__accordion-right">
            <div
              className={`sidebar__toggle sidebar__toggle--sm${lsrOverlay.enabled ? ' on' : ''}`}
              role="switch"
              aria-checked={lsrOverlay.enabled}
              onClick={(e) => {
                e.stopPropagation()
                onLsrChange({ ...lsrOverlay, enabled: !lsrOverlay.enabled })
              }}
            />
            <span className={`sidebar__chevron${lsrOpen ? ' open' : ''}`}>›</span>
          </div>
        </button>
        {lsrOpen && (
          <div className="sidebar__overlay-controls">
            <div className="sidebar__overlay-note">
              Shows IEM LSRs in a 24-hour window from the selected date/time (UTC).
              {pathAnim.active && ' During animation, LSRs appear progressively as the tornado advances.'}
            </div>
            <div className="sidebar__date-row">
              <span className="sidebar__date-label">Date</span>
              <input
                type="date"
                className="sidebar__date-input"
                value={lsrOverlay.date}
                onChange={(e) => onLsrChange({ ...lsrOverlay, date: e.target.value })}
              />
            </div>
            <div className="sidebar__date-row" style={{ marginTop: 5 }}>
              <span className="sidebar__date-label">Time</span>
              <input
                type="time"
                className="sidebar__date-input"
                value={lsrOverlay.time}
                onChange={(e) => onLsrChange({ ...lsrOverlay, time: e.target.value })}
              />
            </div>
          </div>
        )}
      </div>

      <div className="sidebar__spacer" />

      <div className="sidebar__section-divider" />

      {/* EF Scale Legend */}
      <div className="sidebar__section">
        <button className="sidebar__accordion" onClick={() => setLegendOpen((v) => !v)}>
          <span>EF Scale</span>
          <span className={`sidebar__chevron${legendOpen ? ' open' : ''}`}>›</span>
        </button>
        {legendOpen && (
          <div className="sidebar__legend">
            {EF_LEGEND.map(({ scale, label, range }) => (
              <div key={scale} className="sidebar__legend-row">
                <div
                  className="sidebar__legend-swatch"
                  style={{ background: EF_COLORS[scale] }}
                />
                <span className="sidebar__legend-label">{label}</span>
                <span className="sidebar__legend-range">{range}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="sidebar__footer">
        <span>NOAA NWS DAT</span>
        <span className="sidebar__footer-note">Data is preliminary</span>
      </div>
    </aside>
  )
}
