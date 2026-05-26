import { useState } from 'react'
import { EF_COLORS, EF_LEGEND } from '../constants'

const THIS_YEAR = new Date().getFullYear()
const YEARS = ['all', ...Array.from({ length: 27 }, (_, i) => String(THIS_YEAR - i))]

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

export default function Sidebar({ layers, onToggleLayer, yearFilter, onYearChange, onSearch }) {
  const [query, setQuery] = useState('')
  const [layersOpen, setLayersOpen] = useState(true)
  const [legendOpen, setLegendOpen] = useState(true)

  const handleSubmit = (e) => {
    e.preventDefault()
    if (query.trim()) onSearch(query.trim())
  }

  return (
    <aside className="sidebar">
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

      {/* Layers */}
      <div className="sidebar__section">
        <button className="sidebar__accordion" onClick={() => setLayersOpen((v) => !v)}>
          <span>Layers</span>
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
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="sidebar__section-divider" />

      {/* Year filter */}
      <div className="sidebar__section">
        <div className="sidebar__field-label">Year Filter</div>
        <select
          className="sidebar__select"
          value={yearFilter}
          onChange={(e) => onYearChange(e.target.value)}
        >
          {YEARS.map((y) => (
            <option key={y} value={y}>
              {y === 'all' ? 'All Years' : y}
            </option>
          ))}
        </select>
      </div>

      <div className="sidebar__spacer" />

      <div className="sidebar__section-divider" />

      {/* Legend */}
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
                  style={{
                    background: EF_COLORS[scale],
                    boxShadow: `0 0 6px ${EF_COLORS[scale]}88`,
                  }}
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
