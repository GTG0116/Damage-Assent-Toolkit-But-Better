const FS_BASE =
  'https://services.dat.noaa.gov/arcgis/rest/services/nws_damageassessmenttoolkit/DamageViewer/FeatureServer'

export const LAYER_URLS = {
  points: `${FS_BASE}/0`,
  lines: `${FS_BASE}/1`,
  polygons: `${FS_BASE}/2`,
}

export const EF_COLORS = {
  EF0: '#00F5FF',
  EF1: '#00FF88',
  EF2: '#FFBB00',
  EF3: '#FF6B00',
  EF4: '#FF00AA',
  EF5: '#FF0033',
  TSTM: '#A855F7',
  WIND: '#818CF8',
  UNKNOWN: '#94A3B8',
  default: '#94A3B8',
}

export const EF_LEGEND = [
  { scale: 'EF0', label: 'EF0', range: '65–85 mph' },
  { scale: 'EF1', label: 'EF1', range: '86–110 mph' },
  { scale: 'EF2', label: 'EF2', range: '111–135 mph' },
  { scale: 'EF3', label: 'EF3', range: '136–165 mph' },
  { scale: 'EF4', label: 'EF4', range: '166–200 mph' },
  { scale: 'EF5', label: 'EF5', range: '> 200 mph' },
  { scale: 'TSTM', label: 'TSTM', range: 'Thunderstorm Wind' },
]

export function getEFColor(properties = {}) {
  const raw = properties?.efscale ?? properties?.efnum
  if (raw === null || raw === undefined) return EF_COLORS.default
  const key = raw.toString().toUpperCase().trim()
  if (EF_COLORS[key]) return EF_COLORS[key]
  // efnum is 0-5 integer
  const numKey = `EF${raw}`
  return EF_COLORS[numKey] ?? EF_COLORS.default
}

// ArcGIS REST expects timestamp literals — epoch ms are not reliably accepted
export function makeWhere(start, end) {
  if (!start && !end) return '1=1'
  if (start && end)
    return `stormdate >= timestamp '${start} 00:00:00' AND stormdate <= timestamp '${end} 23:59:59'`
  if (start) return `stormdate >= timestamp '${start} 00:00:00'`
  return `stormdate <= timestamp '${end} 23:59:59'`
}
