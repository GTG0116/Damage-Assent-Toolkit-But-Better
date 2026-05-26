import { useEffect, useRef, useState, useCallback } from 'react'
import L from 'leaflet'
import { featureLayer } from 'esri-leaflet'
import {
  LAYER_URLS, getEFColor, makeWhere,
  getSpcColor, getAlertColor, getLsrColor,
  generateRadarFrames, radarTileUrl, timeToFrameId,
  FILTERED_ALERT_TYPES,
} from '../constants'
import 'leaflet/dist/leaflet.css'

function lineStyle(feature) {
  const color = getEFColor(feature.properties)
  return { color, weight: 3, opacity: 0.88, lineCap: 'round', lineJoin: 'round' }
}

function polygonStyle(feature) {
  const color = getEFColor(feature.properties)
  return { color, weight: 2, opacity: 0.82, fillColor: color, fillOpacity: 0.14 }
}

const LINE_FIELDS = [
  'OBJECTID', 'efscale', 'efnum', 'maxwind', 'stormdate', 'starttime', 'endtime',
  'length', 'width', 'injuries', 'fatalities', 'propdamage', 'cropdamage', 'wfo', 'comments',
]
const POINT_FIELDS = [
  'OBJECTID', 'efscale', 'windspeed', 'stormdate', 'surveydate', 'surveytype',
  'injuries', 'deaths', 'office', 'damage_txt', 'dod_txt', 'comments', 'lat', 'lon',
]
const POLYGON_FIELDS = ['OBJECTID', 'efscale', 'stormdate', 'office', 'comments']

function toMs(val) {
  if (val === null || val === undefined) return null
  if (typeof val === 'number') return val
  const d = new Date(val)
  return isNaN(d) ? null : d.getTime()
}

function getCoords(geometry) {
  if (!geometry) return []
  if (geometry.type === 'LineString') return geometry.coordinates
  if (geometry.type === 'MultiLineString') return geometry.coordinates.flat()
  return []
}

export default function MapView({
  layers, dateRange, onFeatureSelect, selectedFeature, onMapReady,
  spcOutlook, alertsOverlay, alertTypes, lsrOverlay,
  radarOverlay, pathAnim, onPathAnimUpdate, onPathAnimDone,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const layerRefs = useRef({ lines: null, points: null, polygons: null })
  const highlightRef = useRef(null)
  const loadCountRef = useRef(0)
  const whereDebounceRef = useRef(null)
  const spcLayerRef = useRef(null)
  const alertsLayerRef = useRef(null)
  const alertsAllDataRef = useRef(null)
  const lsrGeoLayerRef = useRef(null)
  const lsrAllDataRef = useRef(null)
  const radarLayerRef = useRef(null)
  const radarFrameIdxRef = useRef(0)
  const pathAnimLayerRef = useRef(null)
  const pathAnimHeadRef = useRef(null)
  const pathDamageMarkersRef = useRef([])
  const animStepRef = useRef(0)
  const animIntervalRef = useRef(null)
  const pathAnimActiveRef = useRef(false)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => { pathAnimActiveRef.current = pathAnim.active }, [pathAnim.active])

  const filterLsrByTime = useCallback((maxMs) => {
    const layer = lsrGeoLayerRef.current
    const data = lsrAllDataRef.current
    if (!layer || !data) return
    layer.clearLayers()
    const filtered = (data.features ?? []).filter((f) => {
      const v = f.properties?.valid
      if (!v) return true
      return new Date(v).getTime() <= maxMs
    })
    if (filtered.length) layer.addData({ type: 'FeatureCollection', features: filtered })
  }, [])

  const applyAnimFrame = useCallback((step, totalSteps, feature) => {
    const coords = getCoords(feature?.geometry)
    if (!coords.length || !mapRef.current) return
    const ratio = totalSteps > 0 ? step / totalSteps : 0
    const numPts = step === 0 ? 1 : Math.max(2, Math.ceil(ratio * coords.length))

    const latLngs = coords.slice(0, numPts).map(([lon, lat]) => [lat, lon])
    if (pathAnimLayerRef.current) pathAnimLayerRef.current.setLatLngs(latLngs)

    const headCoord = coords[Math.min(numPts - 1, coords.length - 1)]
    if (pathAnimHeadRef.current && headCoord) {
      pathAnimHeadRef.current.setLatLng([headCoord[1], headCoord[0]])
    }

    // Sync radar time
    const startMs = toMs(feature?.properties?.starttime)
    const endMs = toMs(feature?.properties?.endtime)
    if (startMs !== null && endMs !== null && endMs > startMs) {
      const currentMs = startMs + ratio * (endMs - startMs)
      if (radarLayerRef.current) {
        const d = new Date(currentMs)
        const min5 = Math.floor(d.getUTCMinutes() / 5) * 5
        const frameId = [
          String(d.getUTCFullYear()),
          String(d.getUTCMonth() + 1).padStart(2, '0'),
          String(d.getUTCDate()).padStart(2, '0'),
          String(d.getUTCHours()).padStart(2, '0'),
          String(min5).padStart(2, '0'),
        ].join('')
        radarLayerRef.current.setUrl(radarTileUrl(frameId))
      }
      filterLsrByTime(currentMs)
    }
  }, [filterLsrByTime])

  // ── Map init ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = L.map(containerRef.current, {
      center: [38.5, -96],
      zoom: 5,
      zoomControl: false,
      attributionControl: false,
    })

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxZoom: 20,
    }).addTo(map)

    L.control.zoom({ position: 'bottomright' }).addTo(map)
    L.control
      .attribution({ position: 'bottomright', prefix: false })
      .addAttribution('© <a href="https://www.noaa.gov">NOAA NWS</a> | © OpenStreetMap | © CARTO | © IEM')
      .addTo(map)

    const trackLoad = (delta) => {
      loadCountRef.current = Math.max(0, loadCountRef.current + delta)
      setIsLoading(loadCountRef.current > 0)
    }

    const where = makeWhere(dateRange.start, dateRange.end)

    function makeLayer(url, type, opts) {
      const layer = featureLayer({ url, where, ...opts })
      layer.on('click', (e) => {
        const feature = e.layer.feature
        const color = getEFColor(feature.properties)

        if (highlightRef.current) {
          map.removeLayer(highlightRef.current)
          highlightRef.current = null
        }

        try {
          const hl = L.geoJSON(feature, {
            style: {
              color,
              weight: type === 'lines' ? 5 : 2,
              opacity: 1,
              fillColor: color,
              fillOpacity: 0.12,
            },
            pointToLayer: (_, latlng) =>
              L.circleMarker(latlng, {
                radius: 14,
                color,
                weight: 2,
                opacity: 1,
                fillOpacity: 0,
                className: 'selected-ring',
              }),
          }).addTo(map)
          highlightRef.current = hl
        } catch {
          // null geometry
        }

        onFeatureSelect({ feature, type })
      })
      layer.on('loading', () => trackLoad(1))
      layer.on('load', () => trackLoad(-1))
      return layer
    }

    const linesLayer = makeLayer(LAYER_URLS.lines, 'lines', {
      style: lineStyle,
      fields: LINE_FIELDS,
      simplifyFactor: 0.5,
      precision: 4,
    })

    // Simple SVG circle markers — no box-shadow, no divIcon overhead
    const pointsLayer = makeLayer(LAYER_URLS.points, 'points', {
      fields: POINT_FIELDS,
      pointToLayer: (gj, latlng) =>
        L.circleMarker(latlng, {
          radius: 5,
          fillColor: getEFColor(gj.properties),
          color: 'rgba(255,255,255,0.35)',
          weight: 1,
          fillOpacity: 0.88,
        }),
    })

    const polygonsLayer = makeLayer(LAYER_URLS.polygons, 'polygons', {
      style: polygonStyle,
      fields: POLYGON_FIELDS,
      simplifyFactor: 0.5,
      precision: 4,
    })

    if (layers.lines) linesLayer.addTo(map)
    if (layers.points) pointsLayer.addTo(map)
    if (layers.polygons) polygonsLayer.addTo(map)

    layerRefs.current = { lines: linesLayer, points: pointsLayer, polygons: polygonsLayer }
    mapRef.current = map

    onMapReady({
      flyTo: (lat, lon, zoom = 8) => map.flyTo([lat, lon], zoom, { duration: 1.5 }),
    })

    return () => {
      map.remove()
      mapRef.current = null
      layerRefs.current = {}
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Layer visibility sync ─────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    Object.entries(layerRefs.current).forEach(([key, layer]) => {
      if (!layer) return
      const on = layers[key]
      if (on && !map.hasLayer(layer)) layer.addTo(map)
      if (!on && map.hasLayer(layer)) map.removeLayer(layer)
    })
  }, [layers])

  // ── Date range sync ───────────────────────────────────────────────────────
  useEffect(() => {
    clearTimeout(whereDebounceRef.current)
    whereDebounceRef.current = setTimeout(() => {
      const where = makeWhere(dateRange.start, dateRange.end)
      Object.values(layerRefs.current).forEach((layer) => {
        if (layer?.setWhere) layer.setWhere(where)
      })
    }, 500)
    return () => clearTimeout(whereDebounceRef.current)
  }, [dateRange])

  // ── Clear highlight when inspector closes ─────────────────────────────────
  useEffect(() => {
    if (!selectedFeature && highlightRef.current && mapRef.current) {
      mapRef.current.removeLayer(highlightRef.current)
      highlightRef.current = null
    }
  }, [selectedFeature])

  // ── SPC layer ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (spcLayerRef.current) {
      if (map) map.removeLayer(spcLayerRef.current)
      spcLayerRef.current = null
    }
    if (!spcOutlook.enabled || !spcOutlook.date || !spcOutlook.time || !map) return

    const controller = new AbortController()
    const [year, month, day] = spcOutlook.date.split('-')
    const dateStr = `${year}${month}${day}`
    const url = `https://www.spc.noaa.gov/products/outlook/archive/${year}/day1otlk_${dateStr}_${spcOutlook.time}_cat.nolyr.geojson`

    fetch(url, { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error(); return r.json() })
      .then((data) => {
        if (!mapRef.current || controller.signal.aborted) return
        const layer = L.geoJSON(data, {
          style: (feature) => {
            const label = feature.properties?.LABEL ?? feature.properties?.label ?? ''
            const color = getSpcColor(label)
            return { color, weight: 1.5, opacity: 0.9, fillColor: color, fillOpacity: 0.28 }
          },
          onEachFeature: (feature, lyr) => {
            const label = feature.properties?.LABEL ?? feature.properties?.label ?? 'Unknown'
            const label2 = feature.properties?.LABEL2 ?? feature.properties?.label2 ?? ''
            lyr.bindTooltip(
              `<b>SPC: ${label}</b>${label2 ? `<br>${label2}` : ''}`,
              { sticky: true, className: 'map-tooltip' }
            )
          },
        }).addTo(mapRef.current)
        spcLayerRef.current = layer
      })
      .catch(() => {})

    return () => controller.abort()
  }, [spcOutlook])

  // ── NWS Alerts — fetch and cache ─────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (alertsLayerRef.current) {
      if (map) map.removeLayer(alertsLayerRef.current)
      alertsLayerRef.current = null
    }
    alertsAllDataRef.current = null
    if (!alertsOverlay.enabled || !alertsOverlay.date || !map) return

    const controller = new AbortController()
    const startISO = `${alertsOverlay.date}T${alertsOverlay.time || '00:00'}:00Z`
    const endDt = new Date(startISO)
    endDt.setUTCHours(endDt.getUTCHours() + 24)
    const endISO = endDt.toISOString().replace('.000Z', 'Z')
    const url = `https://api.weather.gov/alerts?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}&limit=500&status=actual`

    fetch(url, { signal: controller.signal, headers: { Accept: 'application/geo+json' } })
      .then((r) => r.json())
      .then((data) => {
        if (!mapRef.current || controller.signal.aborted) return

        // Only keep the 19 alert types from the screenshot
        const allFeatures = (data.features ?? []).filter(
          (f) => f.geometry && FILTERED_ALERT_TYPES.includes(f.properties?.event ?? '')
        )
        alertsAllDataRef.current = allFeatures

        // Apply current alertTypes filter
        const currentAlertTypes = alertTypes
        const features = allFeatures.filter((f) => currentAlertTypes.has(f.properties?.event ?? ''))

        alertsLayerRef.current = L.geoJSON({ type: 'FeatureCollection', features }, {
          style: (feature) => {
            const color = getAlertColor(feature.properties?.event ?? '')
            return { color, weight: 2, opacity: 0.88, fillColor: color, fillOpacity: 0.22 }
          },
          onEachFeature: (feature, lyr) => {
            const event = feature.properties?.event ?? 'Alert'
            const area = feature.properties?.areaDesc ?? ''
            lyr.bindTooltip(
              `<b>${event}</b>${area ? `<br>${area}` : ''}`,
              { sticky: true, className: 'map-tooltip' }
            )
          },
        }).addTo(mapRef.current)
      })
      .catch(() => {})

    return () => controller.abort()
  }, [alertsOverlay]) // alertTypes handled by separate effect below

  // ── Alert type filter — client-side, no re-fetch ──────────────────────────
  useEffect(() => {
    const map = mapRef.current
    const allData = alertsAllDataRef.current
    if (!map || !alertsLayerRef.current || !allData) return

    alertsLayerRef.current.clearLayers()
    const features = allData.filter((f) => alertTypes.has(f.properties?.event ?? ''))
    alertsLayerRef.current.addData({ type: 'FeatureCollection', features })
  }, [alertTypes])

  // ── LSR layer ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (lsrGeoLayerRef.current) {
      if (map) map.removeLayer(lsrGeoLayerRef.current)
      lsrGeoLayerRef.current = null
    }
    lsrAllDataRef.current = null
    if (!lsrOverlay.enabled || !lsrOverlay.date || !map) return

    lsrGeoLayerRef.current = L.geoJSON(null, {
      pointToLayer: (feature, latlng) => {
        const color = getLsrColor(feature.properties?.typetext ?? '')
        return L.circleMarker(latlng, {
          radius: 6,
          fillColor: color,
          color: '#000',
          weight: 1,
          opacity: 1,
          fillOpacity: 0.9,
        })
      },
      onEachFeature: (feature, lyr) => {
        const p = feature.properties ?? {}
        const type = p.typetext ?? 'LSR'
        const mag = p.magnitude ? ` ${p.magnitude}` : ''
        const city = p.city ? ` — ${p.city}, ${p.st ?? ''}` : ''
        lyr.bindTooltip(`<b>${type}${mag}</b>${city}`, { sticky: true, className: 'map-tooltip' })
      },
    }).addTo(map)

    const controller = new AbortController()
    const startISO = `${lsrOverlay.date}T${lsrOverlay.time || '00:00'}:00Z`
    const endDt = new Date(startISO)
    endDt.setUTCHours(endDt.getUTCHours() + 24)
    const endISO = endDt.toISOString().replace('.000Z', 'Z')
    const url = `https://mesonet.agron.iastate.edu/geojson/lsr.py?sts=${encodeURIComponent(startISO)}&ets=${encodeURIComponent(endISO)}`

    fetch(url, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        if (!mapRef.current || controller.signal.aborted || !lsrGeoLayerRef.current) return
        lsrAllDataRef.current = data
        // If animation is active, keep hidden (animation will populate progressively)
        if (!pathAnimActiveRef.current) {
          lsrGeoLayerRef.current.addData(data)
        }
      })
      .catch(() => {})

    return () => {
      controller.abort()
      if (mapRef.current && lsrGeoLayerRef.current) {
        mapRef.current.removeLayer(lsrGeoLayerRef.current)
        lsrGeoLayerRef.current = null
      }
      lsrAllDataRef.current = null
    }
  }, [lsrOverlay])

  // ── LSR visibility when animation active/inactive ─────────────────────────
  useEffect(() => {
    const layer = lsrGeoLayerRef.current
    const data = lsrAllDataRef.current
    if (!layer || !data) return
    if (!pathAnim.active) {
      layer.clearLayers()
      layer.addData(data)
    } else {
      layer.clearLayers() // animation will re-add progressively
    }
  }, [pathAnim.active])

  // ── Radar layer — create when enabled ────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (radarLayerRef.current) {
      map.removeLayer(radarLayerRef.current)
      radarLayerRef.current = null
    }
    if (!radarOverlay.enabled || !radarOverlay.date) return

    const frameId = timeToFrameId(radarOverlay.date, radarOverlay.time)
    if (!frameId) return
    radarLayerRef.current = L.tileLayer(radarTileUrl(frameId), {
      opacity: 0.65,
      zIndex: 5,
    }).addTo(map)
  }, [radarOverlay.enabled, radarOverlay.date]) // time handled below

  // ── Radar URL sync when time changes ─────────────────────────────────────
  useEffect(() => {
    if (!radarLayerRef.current || !radarOverlay.enabled) return
    const frameId = timeToFrameId(radarOverlay.date, radarOverlay.time)
    if (frameId) radarLayerRef.current.setUrl(radarTileUrl(frameId))
  }, [radarOverlay.time, radarOverlay.enabled, radarOverlay.date])

  // ── Radar playback ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!radarOverlay.playing || !radarOverlay.enabled) return
    if (pathAnim.playing) return // path animation owns radar during its playback

    const frames = generateRadarFrames(radarOverlay.date)
    if (!frames.length) return

    // Seed frame index from current time setting
    const [hh = '0', mm = '0'] = (radarOverlay.time || '00:00').split(':')
    radarFrameIdxRef.current = Math.min(
      Math.floor((parseInt(hh) * 60 + parseInt(mm)) / 5),
      frames.length - 1
    )

    const interval = setInterval(() => {
      radarFrameIdxRef.current = (radarFrameIdxRef.current + 1) % frames.length
      const frameId = frames[radarFrameIdxRef.current]
      if (radarLayerRef.current) radarLayerRef.current.setUrl(radarTileUrl(frameId))
    }, radarOverlay.speed)

    return () => clearInterval(interval)
  }, [radarOverlay.playing, radarOverlay.enabled, radarOverlay.date, radarOverlay.speed])

  // ── Path animation — setup layers when feature changes ───────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Always clean up first
    if (animIntervalRef.current) { clearInterval(animIntervalRef.current); animIntervalRef.current = null }
    if (pathAnimLayerRef.current) { map.removeLayer(pathAnimLayerRef.current); pathAnimLayerRef.current = null }
    if (pathAnimHeadRef.current) { map.removeLayer(pathAnimHeadRef.current); pathAnimHeadRef.current = null }
    pathDamageMarkersRef.current.forEach((m) => { try { map.removeLayer(m) } catch {} })
    pathDamageMarkersRef.current = []

    if (!pathAnim.active || !pathAnim.feature?.geometry) return

    const coords = getCoords(pathAnim.feature.geometry)
    if (!coords.length) return

    const color = getEFColor(pathAnim.feature.properties)
    animStepRef.current = 0

    pathAnimLayerRef.current = L.polyline([], { color, weight: 5, opacity: 0.95 }).addTo(map)
    pathAnimHeadRef.current = L.circleMarker([coords[0][1], coords[0][0]], {
      radius: 9,
      fillColor: color,
      color: '#fff',
      weight: 2.5,
      fillOpacity: 1,
    }).addTo(map)
  }, [pathAnim.active, pathAnim.feature])

  // ── Path animation — apply step when changed externally (reset / seek) ───
  useEffect(() => {
    if (pathAnim.playing) return
    if (!pathAnim.active || !pathAnim.feature?.geometry) return
    animStepRef.current = pathAnim.step
    applyAnimFrame(pathAnim.step, pathAnim.totalSteps, pathAnim.feature)
  }, [pathAnim.step, pathAnim.playing, pathAnim.active, pathAnim.feature, pathAnim.totalSteps, applyAnimFrame])

  // ── Path animation — playback loop ────────────────────────────────────────
  useEffect(() => {
    if (!pathAnim.playing || !pathAnim.active || !pathAnim.feature?.geometry) return

    const { totalSteps, speed, feature } = pathAnim
    const color = getEFColor(feature.properties)

    animIntervalRef.current = setInterval(() => {
      animStepRef.current = Math.min(animStepRef.current + 1, totalSteps)
      const step = animStepRef.current

      applyAnimFrame(step, totalSteps, feature)

      // Add a damage dot every 6 steps (visual breadcrumb trail)
      if (step % 6 === 0 && pathAnimLayerRef.current) {
        const latLngs = pathAnimLayerRef.current.getLatLngs()
        const last = latLngs[latLngs.length - 1]
        if (last && mapRef.current) {
          const dot = L.circleMarker(last, {
            radius: 3,
            fillColor: color,
            color: 'rgba(255,255,255,0.3)',
            weight: 1,
            fillOpacity: 0.75,
          }).addTo(mapRef.current)
          pathDamageMarkersRef.current.push(dot)
        }
      }

      onPathAnimUpdate(step)

      if (step >= totalSteps) {
        clearInterval(animIntervalRef.current)
        animIntervalRef.current = null
        onPathAnimDone()
      }
    }, speed)

    return () => {
      clearInterval(animIntervalRef.current)
      animIntervalRef.current = null
    }
  }, [pathAnim.playing, pathAnim.active, pathAnim.totalSteps, pathAnim.speed, pathAnim.feature, applyAnimFrame, onPathAnimUpdate, onPathAnimDone])

  return (
    <>
      <div ref={containerRef} className="map-container" />
      <div className={`loading-indicator${isLoading ? '' : ' hidden'}`}>
        <div className="loading-spinner" />
        Loading data…
      </div>
    </>
  )
}
