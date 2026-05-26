import { useState, useCallback, useRef } from 'react'
import MapView from './components/MapView'
import Sidebar from './components/Sidebar'
import DataInspector from './components/DataInspector'
import './App.css'

export default function App() {
  const [selectedFeature, setSelectedFeature] = useState(null)
  const [layers, setLayers] = useState({ lines: true, points: true, polygons: false })
  const [dateRange, setDateRange] = useState({ start: '2024-01-01', end: '2024-12-31' })
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
      // silent — map stays where it is
    }
  }, [])

  return (
    <div className="app">
      <MapView
        layers={layers}
        dateRange={dateRange}
        onFeatureSelect={setSelectedFeature}
        selectedFeature={selectedFeature}
        onMapReady={(actions) => { mapActionsRef.current = actions }}
      />
      <Sidebar
        layers={layers}
        onToggleLayer={toggleLayer}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        onSearch={handleSearch}
      />
      <DataInspector
        feature={selectedFeature}
        onClose={() => setSelectedFeature(null)}
      />
    </div>
  )
}
