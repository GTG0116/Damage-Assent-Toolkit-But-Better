import { useState, useCallback, useRef } from 'react'
import MapView from './components/MapView'
import Sidebar from './components/Sidebar'
import DataInspector from './components/DataInspector'
import { FILTERED_ALERT_TYPES, LAYER_URLS, EF_COLORS } from './constants'
import './App.css'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function toMs(val) {
  if (val === null || val === undefined) return null
  if (typeof val === 'number') return val
  const d = new Date(val)
  return isNaN(d) ? null : d.getTime()
}

export default function App() {
  const [selectedFeature, setSelectedFeature] = useState(null)
  const [layers, setLayers] = useState({ lines: false, points: false, polygons: false })
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [inspectorMinimized, setInspectorMinimized] = useState(false)
  const [dateRange, setDateRange] = useState(() => {
    const start = new Date()
    const end = new Date()
    end.setDate(end.getDate() + 3)
    const fmt = (d) => d.toISOString().slice(0, 10)
    return { start: fmt(start), end: fmt(end) }
  })
  const [spcOutlook, setSpcOutlook] = useState({ enabled: false, date: todayStr(), time: '0100' })
  const [alertsOverlay, setAlertsOverlay] = useState({ enabled: false, date: todayStr(), time: '00:00' })
  const [lsrOverlay, setLsrOverlay] = useState({ enabled: false, date: todayStr(), time: '00:00' })
  const [alertTypes, setAlertTypes] = useState(() => new Set(FILTERED_ALERT_TYPES))
  const [radarOverlay, setRadarOverlay] = useState({
    enabled: false, date: todayStr(), time: '00:00', playing: false, speed: 200,
  })
  const [pathAnim, setPathAnim] = useState({
    active: false, feature: null, playing: false, step: 0, totalSteps: 120, speed: 120,
  })
  const mapActionsRef = useRef(null)

  const toggleLayer = useCallback((key) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const handleSearch = useCallback(async (query) => {
    if (!mapActionsRef.current) return
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
        { headers: { 'Accept-Language': 'en' } }
      )
      const data = await res.json()
      if (data[0]) {
        mapActionsRef.current.flyTo(parseFloat(data[0].lat), parseFloat(data[0].lon), 8)
      }
    } catch {
      // silent
    }
  }, [])

  // Async: re-query the FeatureServer for the selected line without simplification
  // so the animation uses the full-resolution geometry.
  const handleFeatureSelect = useCallback(async (sel) => {
    setSelectedFeature(sel)
    setInspectorMinimized(false)
    if (!sel) {
      setPathAnim((prev) => ({ ...prev, active: false, playing: false, step: 0, feature: null }))
      return
    }
    if (sel.type !== 'lines' || !sel.feature?.geometry) return

    const props = sel.feature.properties ?? {}
    const oid = props.OBJECTID

    let fullFeature = sel.feature
    if (oid) {
      try {
        const fields = 'OBJECTID,efscale,efnum,maxwind,stormdate,starttime,endtime,length,width,injuries,fatalities,propdamage,cropdamage,wfo,comments'
        const url = `${LAYER_URLS.lines}/query?where=OBJECTID%3D${oid}&outFields=${fields}&f=geojson&outSR=4326&returnGeometry=true`
        const res = await fetch(url)
        const gj = await res.json()
        const feat = gj.features?.[0]
        if (feat?.geometry?.coordinates?.length) {
          fullFeature = {
            ...sel.feature,
            geometry: feat.geometry,
            properties: { ...props, ...(feat.properties ?? {}) },
          }
        }
      } catch {
        // fall back to simplified geometry already in the feature
      }
    }

    // Derive event date
    let dateStr = todayStr()
    const rawDate = fullFeature.properties?.stormdate ?? fullFeature.properties?.starttime
    if (rawDate) {
      const ms = toMs(rawDate)
      if (ms) dateStr = new Date(ms).toISOString().slice(0, 10)
    }

    const coords =
      fullFeature.geometry.type === 'LineString'
        ? fullFeature.geometry.coordinates
        : fullFeature.geometry.type === 'MultiLineString'
          ? fullFeature.geometry.coordinates.flat()
          : []

    // 1 step per coordinate keeps the path drawing smooth; cap at 300 steps
    const totalSteps = Math.max(60, Math.min(coords.length, 300))

    setPathAnim({ active: true, feature: fullFeature, playing: false, step: 0, totalSteps, speed: 120 })
    setRadarOverlay((prev) => ({ ...prev, enabled: true, date: dateStr, time: '00:00', playing: false }))
    setLsrOverlay((prev) => ({ ...prev, enabled: true, date: dateStr, time: '00:00' }))
    setAlertsOverlay((prev) => ({ ...prev, enabled: true, date: dateStr, time: '00:00' }))
  }, [])

  const toggleAlertType = useCallback((type) => {
    setAlertTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }, [])

  const handlePathAnimUpdate = useCallback((step) => {
    setPathAnim((prev) => ({ ...prev, step }))
  }, [])

  const handlePathAnimDone = useCallback(() => {
    setPathAnim((prev) => ({ ...prev, playing: false, step: prev.totalSteps }))
  }, [])

  const handleClosePathAnim = useCallback(() => {
    setPathAnim((prev) => ({ ...prev, active: false, playing: false, step: 0, feature: null }))
  }, [])

  const animEfKey = pathAnim.feature
    ? (pathAnim.feature.properties?.efscale ?? '').toString().toUpperCase().trim()
    : ''
  const animEfColor = EF_COLORS[animEfKey] ?? EF_COLORS.default
  const animProgress = pathAnim.totalSteps > 0
    ? Math.round((pathAnim.step / pathAnim.totalSteps) * 100)
    : 0

  return (
    <div className="app">
      {sidebarOpen && (
        <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
      )}

      <button
        className={`mobile-menu-btn${sidebarOpen ? ' mobile-menu-btn--open' : ''}`}
        onClick={() => setSidebarOpen((v) => !v)}
        aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
      >
        {sidebarOpen ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        )}
      </button>

      <MapView
        layers={layers}
        dateRange={dateRange}
        onFeatureSelect={handleFeatureSelect}
        selectedFeature={selectedFeature}
        onMapReady={(actions) => { mapActionsRef.current = actions }}
        spcOutlook={spcOutlook}
        alertsOverlay={alertsOverlay}
        alertTypes={alertTypes}
        lsrOverlay={lsrOverlay}
        radarOverlay={radarOverlay}
        pathAnim={pathAnim}
        onPathAnimUpdate={handlePathAnimUpdate}
        onPathAnimDone={handlePathAnimDone}
      />
      <Sidebar
        mobileOpen={sidebarOpen}
        onMobileClose={() => setSidebarOpen(false)}
        layers={layers}
        onToggleLayer={toggleLayer}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        onSearch={handleSearch}
        spcOutlook={spcOutlook}
        onSpcChange={setSpcOutlook}
        alertsOverlay={alertsOverlay}
        onAlertsChange={setAlertsOverlay}
        alertTypes={alertTypes}
        onToggleAlertType={toggleAlertType}
        lsrOverlay={lsrOverlay}
        onLsrChange={setLsrOverlay}
        radarOverlay={radarOverlay}
        onRadarChange={setRadarOverlay}
        pathAnim={pathAnim}
        onPathAnimChange={setPathAnim}
        onClosePathAnim={handleClosePathAnim}
      />
      <DataInspector
        feature={selectedFeature}
        onClose={() => handleFeatureSelect(null)}
        minimized={inspectorMinimized}
        onToggleMinimize={() => setInspectorMinimized((v) => !v)}
      />

      {/* Mobile-only playback bar — floats above the inspector bottom sheet */}
      {pathAnim.active && (
        <div className={`mobile-playback-bar${selectedFeature && !inspectorMinimized ? ' mobile-playback-bar--above-sheet' : ''}`}>
          <button
            className="mobile-playback-btn"
            onClick={() => setPathAnim((prev) => ({ ...prev, playing: !prev.playing }))}
            aria-label={pathAnim.playing ? 'Pause' : 'Play'}
          >
            {pathAnim.playing ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5,3 19,12 5,21"/>
              </svg>
            )}
          </button>
          <div className="mobile-playback-track">
            <div className="mobile-playback-fill" style={{ width: `${animProgress}%`, background: animEfColor }} />
          </div>
          {animEfKey && (
            <span className="mobile-playback-ef" style={{ color: animEfColor }}>{animEfKey}</span>
          )}
          <span className="mobile-playback-pct">{animProgress}%</span>
        </div>
      )}
    </div>
  )
}
