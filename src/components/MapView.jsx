import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { featureLayer } from 'esri-leaflet'
import {
  EF_COLORS, LAYER_URLS, getEFColor, makeWhere,
  getSpcColor, getAlertColor, getLsrColor,
} from '../constants'
import 'leaflet/dist/leaflet.css'

function glowMarker(color) {
  return L.divIcon({
    html: `<div style="
      width:12px;height:12px;border-radius:50%;
      border:1.5px solid ${color};
      background:${color}33;
      box-shadow:0 0 5px ${color};
    "></div>`,
    className: '',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  })
}

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

export default function MapView({
  layers, dateRange, onFeatureSelect, selectedFeature, onMapReady,
  spcOutlook, alertsOverlay, lsrOverlay,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const layerRefs = useRef({ lines: null, points: null, polygons: null })
  const highlightRef = useRef(null)
  const loadCountRef = useRef(0)
  const whereDebounceRef = useRef(null)
  const spcLayerRef = useRef(null)
  const alertsLayerRef = useRef(null)
  const lsrLayerRef = useRef(null)
  const [isLoading, setIsLoading] = useState(false)

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
      .addAttribution('© <a href="https://www.noaa.gov">NOAA NWS</a> | © OpenStreetMap | © CARTO')
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
                radius: 16,
                color,
                weight: 2,
                opacity: 1,
                fillOpacity: 0,
                className: 'selected-ring',
              }),
          }).addTo(map)
          highlightRef.current = hl
        } catch {
          // geometry might be null
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
    const pointsLayer = makeLayer(LAYER_URLS.points, 'points', {
      fields: POINT_FIELDS,
      pointToLayer: (gj, latlng) =>
        L.marker(latlng, { icon: glowMarker(getEFColor(gj.properties)) }),
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

  // Layer visibility sync
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

  // Date range sync — debounced so rapid typing doesn't fire parallel queries
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

  // Clear highlight when inspector closes
  useEffect(() => {
    if (!selectedFeature && highlightRef.current && mapRef.current) {
      mapRef.current.removeLayer(highlightRef.current)
      highlightRef.current = null
    }
  }, [selectedFeature])

  // SPC Categorical Outlook layer
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
      .then((r) => {
        if (!r.ok) throw new Error(`SPC ${r.status}`)
        return r.json()
      })
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

  // NWS Alerts layer
  useEffect(() => {
    const map = mapRef.current
    if (alertsLayerRef.current) {
      if (map) map.removeLayer(alertsLayerRef.current)
      alertsLayerRef.current = null
    }
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
        const features = (data.features ?? []).filter((f) => f.geometry)
        const layer = L.geoJSON({ type: 'FeatureCollection', features }, {
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
        alertsLayerRef.current = layer
      })
      .catch(() => {})

    return () => controller.abort()
  }, [alertsOverlay])

  // LSR layer (IEM)
  useEffect(() => {
    const map = mapRef.current
    if (lsrLayerRef.current) {
      if (map) map.removeLayer(lsrLayerRef.current)
      lsrLayerRef.current = null
    }
    if (!lsrOverlay.enabled || !lsrOverlay.date || !map) return

    const controller = new AbortController()
    const startISO = `${lsrOverlay.date}T${lsrOverlay.time || '00:00'}:00Z`
    const endDt = new Date(startISO)
    endDt.setUTCHours(endDt.getUTCHours() + 24)
    const endISO = endDt.toISOString().replace('.000Z', 'Z')
    const url = `https://mesonet.agron.iastate.edu/geojson/lsr.py?sts=${encodeURIComponent(startISO)}&ets=${encodeURIComponent(endISO)}`

    fetch(url, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        if (!mapRef.current || controller.signal.aborted) return
        const layer = L.geoJSON(data, {
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
            lyr.bindTooltip(
              `<b>${type}${mag}</b>${city}`,
              { sticky: true, className: 'map-tooltip' }
            )
          },
        }).addTo(mapRef.current)
        lsrLayerRef.current = layer
      })
      .catch(() => {})

    return () => controller.abort()
  }, [lsrOverlay])

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
