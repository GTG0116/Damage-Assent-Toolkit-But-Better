import { useState, useCallback, useRef } from 'react'
import MapView from './components/MapView'
import Sidebar from './components/Sidebar'
import DataInspector from './components/DataInspector'
import { FILTERED_ALERT_TYPES, LAYER_URLS } from './constants'
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

    setPathAnim({ active: true, feature: fullFeature, playing: false, step: 0, totalSteps, speed: 100 })
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

  return (
    <div className="app">
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
      />
    </div>
  )
}
