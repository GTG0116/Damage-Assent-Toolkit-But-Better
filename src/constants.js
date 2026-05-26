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
  EF4: '#FF2200',
  EF5: '#A855F7',
  TSTM: '#AAFF40',
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

// ─── SPC Categorical Outlook ───────────────────────────────────────────────
export const SPC_COLORS = {
  TSTM: '#c1e9c1',
  MRGL: '#66a366',
  SLGT: '#ffe066',
  ENH:  '#ffa040',
  MDT:  '#ff4040',
  HIGH: '#ff00ff',
}

export const SPC_LEGEND = [
  { key: 'TSTM', label: 'TSTM', desc: 'General Thunder' },
  { key: 'MRGL', label: 'MRGL', desc: 'Marginal' },
  { key: 'SLGT', label: 'SLGT', desc: 'Slight' },
  { key: 'ENH',  label: 'ENH',  desc: 'Enhanced' },
  { key: 'MDT',  label: 'MDT',  desc: 'Moderate' },
  { key: 'HIGH', label: 'HIGH', desc: 'High' },
]

export const SPC_TIMES = [
  { value: '0100', label: '01:00 UTC' },
  { value: '0600', label: '06:00 UTC' },
  { value: '1200', label: '12:00 UTC' },
  { value: '1300', label: '13:00 UTC' },
  { value: '1630', label: '16:30 UTC' },
  { value: '2000', label: '20:00 UTC' },
]

export function getSpcColor(label = '') {
  return SPC_COLORS[label.toString().toUpperCase().trim()] ?? '#888888'
}

// ─── NWS Alert types shown on map (matches screenshot) ────────────────────
export const FILTERED_ALERT_TYPES = [
  'Tornado Warning',
  'Tornado Watch',
  'Severe Thunderstorm Warning',
  'Severe Thunderstorm Watch',
  'Flash Flood Warning',
  'Winter Storm Watch',
  'Winter Storm Warning',
  'Blizzard Warning',
  'Snow Squall Warning',
  'Storm Surge Warning',
  'Storm Surge Watch',
  'Tropical Storm Warning',
  'Tropical Storm Watch',
  'Hurricane Warning',
  'Hurricane Watch',
  'Typhoon Warning',
  'Typhoon Watch',
  'Extreme Wind Warning',
  'Special Weather Statement',
]

// ─── NWS Alert event colors ────────────────────────────────────────────────
export const ALERT_COLORS = {
  'Tornado Warning':             '#FF2020',
  'Tornado Watch':               '#C896FF',
  'Severe Thunderstorm Warning': '#FFA500',
  'Severe Thunderstorm Watch':   '#FFD700',
  'Flash Flood Warning':         '#00FF00',
  'Winter Storm Watch':          '#4682B4',
  'Winter Storm Warning':        '#FF69B4',
  'Blizzard Warning':            '#FF4500',
  'Snow Squall Warning':         '#C0A8D8',
  'Storm Surge Warning':         '#9B30FF',
  'Storm Surge Watch':           '#7B68EE',
  'Tropical Storm Warning':      '#FA8072',
  'Tropical Storm Watch':        '#FFB6C1',
  'Hurricane Warning':           '#DC143C',
  'Hurricane Watch':             '#FF00FF',
  'Typhoon Warning':             '#FF1493',
  'Typhoon Watch':               '#DA70D6',
  'Extreme Wind Warning':        '#FF8C00',
  'Special Weather Statement':   '#40E0D0',
}

export function getAlertColor(event = '') {
  return ALERT_COLORS[event] ?? '#94A3B8'
}

// ─── LSR type colors ───────────────────────────────────────────────────────
export const LSR_COLORS = {
  'TORNADO':          '#FF0000',
  'HAIL':             '#00DD00',
  'TSTM WND DMG':     '#FFA500',
  'TSTM WND GST':     '#FFD700',
  'HEAVY RAIN':       '#00BFFF',
  'FLOOD':            '#00FA9A',
  'FLASH FLOOD':      '#00CC77',
  'SNOW':             '#87CEEB',
  'BLIZZARD':         '#4682B4',
  'FUNNEL CLOUD':     '#FF8C00',
  'WATERSPOUT':       '#00CED1',
  'NON-TSTM WND DMG': '#FF6347',
  'NON-TSTM WND GST': '#FFC107',
  'LIGHTNING':        '#FFFF40',
  'WILDFIRE':         '#FF4500',
  'LANDSLIDE':        '#8B4513',
  'AVALANCHE':        '#ADD8E6',
  'FREEZING RAIN':    '#C0C0FF',
  'ICE STORM':        '#9370DB',
}

export function getLsrColor(typetext = '') {
  return LSR_COLORS[typetext.toString().toUpperCase().trim()] ?? '#94A3B8'
}

// ─── Radar utilities — IEM NEXRAD WMS (historical archive) ────────────────
// IEM serves NEXRAD composite reflectivity via WMS; tile cache 404s on cold paths.
// The WMS endpoint reliably serves any historical date via the TIME parameter.
export const IEM_WMS_URL = 'https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q.cgi'
export const IEM_WMS_LAYER = 'nexrad-n0q-900913'

// Returns array of frameIds (YYYYMMDDHHII) every 5 min for a given date
export function generateRadarFrames(date) {
  if (!date) return []
  const [year, month, day] = date.split('-')
  const frames = []
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 5) {
      frames.push(
        `${year}${month}${day}${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`
      )
    }
  }
  return frames
}

// Convert YYYYMMDDHHII → ISO 8601 UTC string for WMS TIME param
export function frameIdToIso(frameId) {
  return `${frameId.slice(0,4)}-${frameId.slice(4,6)}-${frameId.slice(6,8)}T${frameId.slice(8,10)}:${frameId.slice(10,12)}:00Z`
}

// Convert date + HH:MM → ISO 8601 UTC string (snapped to 5-min boundary)
export function timeToIso(date, time) {
  if (!date) return null
  const [hh = '00', mm = '00'] = (time || '00:00').split(':')
  const min5 = String(Math.floor(parseInt(mm) / 5) * 5).padStart(2, '0')
  return `${date}T${hh.padStart(2, '0')}:${min5}:00Z`
}

// Convert epoch ms → ISO 8601 UTC string snapped to nearest 5 min
export function msToIso(ms) {
  const d = new Date(ms)
  const min5 = Math.floor(d.getUTCMinutes() / 5) * 5
  return [
    d.getUTCFullYear(), '-',
    String(d.getUTCMonth() + 1).padStart(2, '0'), '-',
    String(d.getUTCDate()).padStart(2, '0'), 'T',
    String(d.getUTCHours()).padStart(2, '0'), ':',
    String(min5).padStart(2, '0'), ':00Z',
  ].join('')
}
