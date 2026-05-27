import { useEffect, useRef, useState, useCallback } from 'react'
import L from 'leaflet'
import { featureLayer } from 'esri-leaflet'
import {
  LAYER_URLS, getEFColor, makeWhere,
  getSpcColor, getAlertColor, getLsrColor,
  generateRadarFrames, frameIdToIso, timeToIso, msToIso,
  IEM_WMS_URL, IEM_WMS_LAYER,
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

// Cumulative Euclidean distances along a coordinate array [[lon,lat],...]
function buildCumDists(coords) {
  let total = 0
  const cumDists = [0]
  for (let i = 1; i < coords.length; i++) {
    const dx = coords[i][0] - coords[i - 1][0]
    const dy = coords[i][1] - coords[i - 1][1]
    total += Math.sqrt(dx * dx + dy * dy)
    cumDists.push(total)
  }
  return { cumDists, totalDist: total }
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
  // Path animation overlays
  const pathAnimLayerRef = useRef(null)   // growing polyline
  const pathAnimHeadRef = useRef(null)    // moving head marker
  const pathAnimPointsRef = useRef([])    // [{marker, trackRatio}] actual survey points
  const animStepRef = useRef(0)
  const animIntervalRef = useRef(null)
  const pathAnimActiveRef = useRef(false)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => { pathAnimActiveRef.current = pathAnim.active }, [pathAnim.active])

  // Filter LSR layer to events up to maxMs (used during path animation)
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

  // Apply one animation frame: advance path, move head, sync radar + LSR + survey points
  const applyAnimFrame = useCallback((step, totalSteps, feature) => {
    const coords = getCoords(feature?.geometry)
    if (!coords.length || !mapRef.current) return
    const ratio = totalSteps > 0 ? step / totalSteps : 0

    // Reveal path coordinates proportionally
    const numPts = step === 0 ? 1 : Math.max(2, Math.ceil(ratio * coords.length))
    const latLngs = coords.slice(0, numPts).map(([lon, lat]) => [lat, lon])
    if (pathAnimLayerRef.current) pathAnimLayerRef.current.setLatLngs(latLngs)

    // Move the head marker to the current leading point
    const headCoord = coords[Math.min(numPts - 1, coords.length - 1)]
    if (pathAnimHeadRef.current && headCoord) {
      pathAnimHeadRef.current.setLatLng([headCoord[1], headCoord[0]])
    }

    // Show survey points that fall at or before the current animation position
    const map = mapRef.current
    pathAnimPointsRef.current.forEach(({ marker, trackRatio }) => {
      if (ratio >= trackRatio) {
        if (!map.hasLayer(marker)) marker.addTo(map)
      } else {
        if (map.hasLayer(marker)) map.removeLayer(marker)
      }
    })

    // Sync radar and LSR to the interpolated wall-clock time of the tornado
    const startMs = toMs(feature?.properties?.starttime)
    const endMs = toMs(feature?.properties?.endtime)
    if (startMs !== null && endMs !== null && endMs > startMs) {
      const currentMs = startMs + ratio * (endMs - startMs)
      if (radarLayerRef.current) {
        radarLayerRef.current.setParams({ TIME: msToIso(currentMs) })
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
            style: { color, weight: type === 'lines' ? 5 : 2, opacity: 1, fillColor: color, fillOpacity: 0.12 },
            pointToLayer: (_, latlng) =>
              L.circleMarker(latlng, { radius: 14, color, weight: 2, opacity: 1, fillOpacity: 0, className: 'selected-ring' }),
          }).addTo(map)
          highlightRef.current = hl
        } catch {}

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

    // Plain SVG circleMarkers — no divIcon, no box-shadow, much lighter
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

    onMapReady({ flyTo: (lat, lon, zoom = 8) => map.flyTo([lat, lon], zoom, { duration: 1.5 }) })

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
    if (spcLayerRef.current) { if (map) map.removeLayer(spcLayerRef.current); spcLayerRef.current = null }
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
            lyr.bindTooltip(`<b>SPC: ${label}</b>${label2 ? `<br>${label2}` : ''}`, { sticky: true, className: 'map-tooltip' })
          },
        }).addTo(mapRef.current)
        spcLayerRef.current = layer
      })
      .catch(() => {})

    return () => controller.abort()
  }, [spcOutlook])

  // ── NWS Alerts — fetch, cache, and apply type filter ─────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (alertsLayerRef.current) { if (map) map.removeLayer(alertsLayerRef.current); alertsLayerRef.current = null }
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
        const allFeatures = (data.features ?? []).filter(
          (f) => f.geometry && FILTERED_ALERT_TYPES.includes(f.properties?.event ?? '')
        )
        alertsAllDataRef.current = allFeatures
        const features = allFeatures.filter((f) => alertTypes.has(f.properties?.event ?? ''))
        alertsLayerRef.current = L.geoJSON({ type: 'FeatureCollection', features }, {
          style: (feature) => {
            const color = getAlertColor(feature.properties?.event ?? '')
            return { color, weight: 2, opacity: 0.88, fillColor: color, fillOpacity: 0.22 }
          },
          onEachFeature: (feature, lyr) => {
            const event = feature.properties?.event ?? 'Alert'
            const area = feature.properties?.areaDesc ?? ''
            lyr.bindTooltip(`<b>${event}</b>${area ? `<br>${area}` : ''}`, { sticky: true, className: 'map-tooltip' })
          },
        }).addTo(mapRef.current)
      })
      .catch(() => {})

    return () => controller.abort()
  }, [alertsOverlay])

  // ── Alert type filter — client-side, no re-fetch ──────────────────────────
  useEffect(() => {
    const allData = alertsAllDataRef.current
    if (!mapRef.current || !alertsLayerRef.current || !allData) return
    alertsLayerRef.current.clearLayers()
    const features = allData.filter((f) => alertTypes.has(f.properties?.event ?? ''))
    alertsLayerRef.current.addData({ type: 'FeatureCollection', features })
  }, [alertTypes])

  // ── LSR layer ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (lsrGeoLayerRef.current) { if (map) map.removeLayer(lsrGeoLayerRef.current); lsrGeoLayerRef.current = null }
    lsrAllDataRef.current = null
    if (!lsrOverlay.enabled || !lsrOverlay.date || !map) return

    lsrGeoLayerRef.current = L.geoJSON(null, {
      pointToLayer: (feature, latlng) => {
        const color = getLsrColor(feature.properties?.typetext ?? '')
        return L.circleMarker(latlng, { radius: 6, fillColor: color, color: '#000', weight: 1, opacity: 1, fillOpacity: 0.9 })
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
        if (!pathAnimActiveRef.current) lsrGeoLayerRef.current.addData(data)
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

  // ── LSR visibility when animation starts/stops ────────────────────────────
  useEffect(() => {
    const layer = lsrGeoLayerRef.current
    const data = lsrAllDataRef.current
    if (!layer || !data) return
    if (!pathAnim.active) {
      layer.clearLayers()
      layer.addData(data)
    } else {
      layer.clearLayers()
    }
  }, [pathAnim.active])

  // ── Radar — IEM NEXRAD WMS (supports TIME parameter for historical data) ───
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (radarLayerRef.current) { map.removeLayer(radarLayerRef.current); radarLayerRef.current = null }
    if (!radarOverlay.enabled || !radarOverlay.date) return

    const isoStr = timeToIso(radarOverlay.date, radarOverlay.time)
    if (!isoStr) return

    radarLayerRef.current = L.tileLayer.wms(IEM_WMS_URL, {
      layers: IEM_WMS_LAYER,
      format: 'image/png',
      transparent: true,
      version: '1.1.1',
      TIME: isoStr,
      opacity: 0.65,
    }).addTo(map)
  }, [radarOverlay.enabled, radarOverlay.date])

  // ── Radar time sync when time changes (no layer recreation) ──────────────
  useEffect(() => {
    if (!radarLayerRef.current || !radarOverlay.enabled) return
    const isoStr = timeToIso(radarOverlay.date, radarOverlay.time)
    if (isoStr) radarLayerRef.current.setParams({ TIME: isoStr })
  }, [radarOverlay.time, radarOverlay.enabled, radarOverlay.date])

  // ── Radar standalone playback — seek to start position when playback begins or date changes
  useEffect(() => {
    if (!radarOverlay.playing || !radarOverlay.enabled) return
    const frames = generateRadarFrames(radarOverlay.date)
    if (!frames.length) return
    const [hh = '0', mm = '0'] = (radarOverlay.time || '00:00').split(':')
    radarFrameIdxRef.current = Math.min(
      Math.floor((parseInt(hh) * 60 + parseInt(mm)) / 5),
      frames.length - 1
    )
  }, [radarOverlay.playing, radarOverlay.date, radarOverlay.enabled])

  // ── Radar standalone playback — manage interval (speed changes don't reset position) ─
  useEffect(() => {
    if (!radarOverlay.playing || !radarOverlay.enabled || pathAnim.playing) return

    const frames = generateRadarFrames(radarOverlay.date)
    if (!frames.length) return

    const interval = setInterval(() => {
      radarFrameIdxRef.current = (radarFrameIdxRef.current + 1) % frames.length
      if (radarLayerRef.current) {
        radarLayerRef.current.setParams({ TIME: frameIdToIso(frames[radarFrameIdxRef.current]) })
      }
    }, radarOverlay.speed)

    return () => clearInterval(interval)
  }, [radarOverlay.playing, radarOverlay.enabled, radarOverlay.date, radarOverlay.speed, pathAnim.playing])

  // ── Path animation — setup overlays + fetch full-res survey points ────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Clean up previous animation state
    if (animIntervalRef.current) { clearInterval(animIntervalRef.current); animIntervalRef.current = null }
    if (pathAnimLayerRef.current) { map.removeLayer(pathAnimLayerRef.current); pathAnimLayerRef.current = null }
    if (pathAnimHeadRef.current) { map.removeLayer(pathAnimHeadRef.current); pathAnimHeadRef.current = null }
    pathAnimPointsRef.current.forEach(({ marker }) => { try { map.removeLayer(marker) } catch {} })
    pathAnimPointsRef.current = []

    if (!pathAnim.active || !pathAnim.feature?.geometry) return

    const coords = getCoords(pathAnim.feature.geometry)
    if (!coords.length) return

    const color = getEFColor(pathAnim.feature.properties)
    animStepRef.current = 0

    // Path polyline (starts empty; filled by applyAnimFrame)
    pathAnimLayerRef.current = L.polyline([], { color, weight: 5, opacity: 0.95 }).addTo(map)

    // Moving head indicator
    pathAnimHeadRef.current = L.circleMarker([coords[0][1], coords[0][0]], {
      radius: 9,
      fillColor: color,
      color: '#fff',
      weight: 2.5,
      fillOpacity: 1,
    }).addTo(map)

    // Fetch actual NOAA survey points for this storm date, clipped to the track bbox
    const stormMs = toMs(pathAnim.feature.properties?.stormdate ?? pathAnim.feature.properties?.starttime)
    if (stormMs) {
      const dateStr = new Date(stormMs).toISOString().slice(0, 10)
      const lons = coords.map((c) => c[0])
      const lats = coords.map((c) => c[1])
      const pad = 0.3
      const xmin = Math.min(...lons) - pad
      const xmax = Math.max(...lons) + pad
      const ymin = Math.min(...lats) - pad
      const ymax = Math.max(...lats) + pad

      const where = `stormdate >= timestamp '${dateStr} 00:00:00' AND stormdate <= timestamp '${dateStr} 23:59:59'`
      const qUrl = [
        `${LAYER_URLS.points}/query`,
        `?where=${encodeURIComponent(where)}`,
        `&geometry=${xmin},${ymin},${xmax},${ymax}`,
        `&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects`,
        `&outFields=OBJECTID,efscale,efnum,damage_txt&f=geojson&outSR=4326&returnGeometry=true`,
      ].join('')

      fetch(qUrl)
        .then((r) => r.json())
        .then((data) => {
          if (!mapRef.current || !pathAnimActiveRef.current) return
          const { cumDists, totalDist } = buildCumDists(coords)
          const newPoints = []

          ;(data.features ?? []).forEach((f) => {
            if (!f.geometry?.coordinates) return
            const [plon, plat] = f.geometry.coordinates

            // Find which coordinate along the track this point is nearest to
            let nearestI = 0
            let minDist2 = Infinity
            for (let i = 0; i < coords.length; i++) {
              const dx = coords[i][0] - plon
              const dy = coords[i][1] - plat
              const d2 = dx * dx + dy * dy
              if (d2 < minDist2) { minDist2 = d2; nearestI = i }
            }
            const trackRatio = totalDist > 0 ? cumDists[nearestI] / totalDist : 0

            const efColor = getEFColor(f.properties)
            const marker = L.circleMarker([plat, plon], {
              radius: 7,
              fillColor: efColor,
              color: '#fff',
              weight: 1.5,
              fillOpacity: 0.92,
            })
            const label = f.properties?.efscale ? f.properties.efscale.toString().toUpperCase() : 'Survey'
            const desc = f.properties?.damage_txt ? `<br>${f.properties.damage_txt.slice(0, 60)}…` : ''
            marker.bindTooltip(`<b>${label} — Survey Point</b>${desc}`, { sticky: true, className: 'map-tooltip' })

            newPoints.push({ marker, trackRatio })
          })

          // Sort by track position so they reveal in geographic order
          newPoints.sort((a, b) => a.trackRatio - b.trackRatio)
          pathAnimPointsRef.current = newPoints

          // If animation already advanced past some points, show them now
          if (animStepRef.current > 0) {
            const ratio = animStepRef.current / pathAnim.totalSteps
            newPoints.forEach(({ marker, trackRatio }) => {
              if (ratio >= trackRatio) marker.addTo(mapRef.current)
            })
          }
        })
        .catch(() => {})
    }
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

    animIntervalRef.current = setInterval(() => {
      animStepRef.current = Math.min(animStepRef.current + 1, totalSteps)
      const step = animStepRef.current

      applyAnimFrame(step, totalSteps, feature)
      onPathAnimUpdate(step)

      if (step >= totalSteps) {
        clearInterval(animIntervalRef.current)
        animIntervalRef.current = null
        onPathAnimDone()
      }
    }, speed)

    return () => { clearInterval(animIntervalRef.current); animIntervalRef.current = null }
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
