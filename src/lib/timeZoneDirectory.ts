import { dateKeyInTimeZone, instantFromZonedWallTime, isValidTimeZone } from './calendarModel'

export type TimeComfortBand = 'daytime' | 'stretch' | 'night'

export interface TimeZoneEntry {
  timeZone: string
  city: string
  region: string
  shortCode: string
  aliases: string[]
}

export interface TimeZoneSnapshot {
  timeZone: string
  label: string
  shortCode: string
  offsetLabel: string
  offsetMinutes: number
  timeLabel: string
  dateKey: string
  hour: number
  minute: number
  band: TimeComfortBand
}

export interface DstTransitionInfo {
  timeZone: string
  dateKey: string
  instantIso: string
  deltaMinutes: number
  direction: 'forward' | 'back'
  summary: string
}

export interface RailHourInfo {
  label: string
  dayDiff: number
  dayBadge: string
  band: TimeComfortBand
  hour: number
}

export interface LocalTimeReadout {
  timeZone: string
  shortCode: string
  offsetLabel: string
  startTime: string
  endTime: string
  dateLabel: string
  dayDiff: number
  dayBadge: string
  band: TimeComfortBand
  crossesDate: boolean
}

const CURATED_TIME_ZONES: TimeZoneEntry[] = [
  { timeZone: 'Pacific/Honolulu', city: 'Honolulu', region: 'Hawaii, US', shortCode: 'HNL', aliases: ['hawaii', 'hst', 'hnl'] },
  { timeZone: 'America/Anchorage', city: 'Anchorage', region: 'Alaska, US', shortCode: 'ANC', aliases: ['alaska', 'akst', 'akdt', 'anc'] },
  { timeZone: 'America/Los_Angeles', city: 'San Francisco / Los Angeles', region: 'US Pacific', shortCode: 'SFO', aliases: ['sf', 'san francisco', 'la', 'los angeles', 'seattle', 'portland', 'san diego', 'silicon valley', 'pst', 'pdt', 'pt', 'pacific', 'sfo', 'lax', 'sea'] },
  { timeZone: 'America/Vancouver', city: 'Vancouver', region: 'Canada', shortCode: 'YVR', aliases: ['canada', 'pst', 'pdt', 'yvr'] },
  { timeZone: 'America/Phoenix', city: 'Phoenix', region: 'Arizona, US', shortCode: 'PHX', aliases: ['arizona', 'mst', 'phx'] },
  { timeZone: 'America/Denver', city: 'Denver / Salt Lake City', region: 'US Mountain', shortCode: 'DEN', aliases: ['denver', 'boulder', 'utah', 'salt lake', 'mst', 'mdt', 'mt', 'mountain', 'den', 'slc'] },
  { timeZone: 'America/Chicago', city: 'Chicago / Austin / Dallas', region: 'US Central', shortCode: 'CHI', aliases: ['chicago', 'austin', 'dallas', 'houston', 'minneapolis', 'cst', 'cdt', 'ct', 'central', 'ord', 'aus', 'dfw'] },
  { timeZone: 'America/Mexico_City', city: 'Mexico City', region: 'Mexico', shortCode: 'MEX', aliases: ['mexico', 'cdmx', 'mex'] },
  { timeZone: 'America/New_York', city: 'New York / Boston / DC', region: 'US Eastern', shortCode: 'NYC', aliases: ['nyc', 'new york', 'boston', 'miami', 'atlanta', 'washington', 'dc', 'philadelphia', 'est', 'edt', 'et', 'eastern', 'jfk', 'ewr', 'bos', 'mia'] },
  { timeZone: 'America/Toronto', city: 'Toronto / Montreal', region: 'Canada', shortCode: 'YYZ', aliases: ['toronto', 'montreal', 'ottawa', 'canada', 'est', 'edt', 'yyz', 'yul'] },
  { timeZone: 'America/Bogota', city: 'Bogotá / Lima', region: 'Colombia', shortCode: 'BOG', aliases: ['bogota', 'colombia', 'lima', 'peru', 'cot', 'bog'] },
  { timeZone: 'America/Santiago', city: 'Santiago', region: 'Chile', shortCode: 'SCL', aliases: ['chile', 'clt', 'scl'] },
  { timeZone: 'America/Halifax', city: 'Halifax', region: 'Canada Atlantic', shortCode: 'YHZ', aliases: ['atlantic', 'ast', 'adt', 'yhz'] },
  { timeZone: 'America/Sao_Paulo', city: 'São Paulo / Rio', region: 'Brazil', shortCode: 'SAO', aliases: ['sao paulo', 'rio', 'brazil', 'brt', 'gru', 'gig'] },
  { timeZone: 'America/Argentina/Buenos_Aires', city: 'Buenos Aires', region: 'Argentina', shortCode: 'BUE', aliases: ['argentina', 'art', 'eze'] },
  { timeZone: 'Atlantic/Reykjavik', city: 'Reykjavík', region: 'Iceland', shortCode: 'REK', aliases: ['iceland', 'gmt', 'kef'] },
  { timeZone: 'UTC', city: 'UTC', region: 'Coordinated Universal Time', shortCode: 'UTC', aliases: ['utc', 'gmt', 'zulu', 'z'] },
  { timeZone: 'Europe/London', city: 'London', region: 'United Kingdom', shortCode: 'LDN', aliases: ['uk', 'britain', 'england', 'edinburgh', 'manchester', 'gmt', 'bst', 'lhr', 'lgw', 'ldn'] },
  { timeZone: 'Europe/Dublin', city: 'Dublin', region: 'Ireland', shortCode: 'DUB', aliases: ['ireland', 'ist', 'gmt', 'dub'] },
  { timeZone: 'Europe/Lisbon', city: 'Lisbon', region: 'Portugal', shortCode: 'LIS', aliases: ['portugal', 'porto', 'wet', 'west', 'lis'] },
  { timeZone: 'Europe/Paris', city: 'Paris / Brussels', region: 'France', shortCode: 'PAR', aliases: ['france', 'paris', 'lyon', 'brussels', 'belgium', 'cet', 'cest', 'cdg', 'bru'] },
  { timeZone: 'Europe/Amsterdam', city: 'Amsterdam', region: 'Netherlands', shortCode: 'AMS', aliases: ['netherlands', 'holland', 'rotterdam', 'cet', 'cest', 'ams'] },
  { timeZone: 'Europe/Berlin', city: 'Berlin / Munich / Frankfurt', region: 'Germany', shortCode: 'BER', aliases: ['germany', 'berlin', 'munich', 'frankfurt', 'hamburg', 'cet', 'cest', 'ber', 'muc', 'fra'] },
  { timeZone: 'Europe/Zurich', city: 'Zurich / Geneva', region: 'Switzerland', shortCode: 'ZRH', aliases: ['switzerland', 'zurich', 'geneva', 'basel', 'cet', 'cest', 'zrh', 'gva'] },
  { timeZone: 'Europe/Madrid', city: 'Madrid / Barcelona', region: 'Spain', shortCode: 'MAD', aliases: ['spain', 'madrid', 'barcelona', 'cet', 'cest', 'mad', 'bcn'] },
  { timeZone: 'Europe/Rome', city: 'Rome / Milan', region: 'Italy', shortCode: 'ROM', aliases: ['italy', 'rome', 'milan', 'cet', 'cest', 'fco', 'mxp'] },
  { timeZone: 'Europe/Stockholm', city: 'Stockholm / Oslo / Copenhagen', region: 'Nordics', shortCode: 'STO', aliases: ['sweden', 'norway', 'denmark', 'stockholm', 'oslo', 'copenhagen', 'cet', 'cest', 'arn', 'osl', 'cph'] },
  { timeZone: 'Europe/Warsaw', city: 'Warsaw / Prague / Vienna', region: 'Central Europe', shortCode: 'WAW', aliases: ['poland', 'czech', 'austria', 'warsaw', 'prague', 'vienna', 'cet', 'cest', 'waw', 'prg', 'vie'] },
  { timeZone: 'Europe/Helsinki', city: 'Helsinki / Tallinn', region: 'Finland', shortCode: 'HEL', aliases: ['finland', 'estonia', 'eet', 'eest', 'hel'] },
  { timeZone: 'Europe/Athens', city: 'Athens / Bucharest', region: 'Eastern Europe', shortCode: 'ATH', aliases: ['greece', 'romania', 'eet', 'eest', 'ath'] },
  { timeZone: 'Europe/Istanbul', city: 'Istanbul', region: 'Turkey', shortCode: 'IST', aliases: ['turkey', 'trt', 'ist'] },
  { timeZone: 'Asia/Jerusalem', city: 'Tel Aviv / Jerusalem', region: 'Israel', shortCode: 'TLV', aliases: ['israel', 'tel aviv', 'jerusalem', 'idt', 'tlv'] },
  { timeZone: 'Africa/Cairo', city: 'Cairo', region: 'Egypt', shortCode: 'CAI', aliases: ['egypt', 'eet', 'cai'] },
  { timeZone: 'Africa/Johannesburg', city: 'Johannesburg / Cape Town', region: 'South Africa', shortCode: 'JNB', aliases: ['south africa', 'cape town', 'sast', 'jnb', 'cpt'] },
  { timeZone: 'Africa/Lagos', city: 'Lagos', region: 'Nigeria', shortCode: 'LOS', aliases: ['nigeria', 'wat', 'los'] },
  { timeZone: 'Africa/Nairobi', city: 'Nairobi', region: 'Kenya', shortCode: 'NBO', aliases: ['kenya', 'eat', 'nbo'] },
  { timeZone: 'Asia/Riyadh', city: 'Riyadh', region: 'Saudi Arabia', shortCode: 'RUH', aliases: ['saudi', 'ast', 'ruh'] },
  { timeZone: 'Asia/Dubai', city: 'Dubai / Abu Dhabi', region: 'UAE', shortCode: 'DXB', aliases: ['uae', 'dubai', 'abu dhabi', 'gst', 'dxb'] },
  { timeZone: 'Asia/Karachi', city: 'Karachi / Lahore', region: 'Pakistan', shortCode: 'KHI', aliases: ['pakistan', 'pkt', 'khi'] },
  { timeZone: 'Asia/Kolkata', city: 'Bengaluru / Mumbai / Delhi', region: 'India', shortCode: 'BLR', aliases: ['india', 'bangalore', 'bengaluru', 'mumbai', 'delhi', 'hyderabad', 'chennai', 'pune', 'ist', 'blr', 'bom', 'del'] },
  { timeZone: 'Asia/Dhaka', city: 'Dhaka', region: 'Bangladesh', shortCode: 'DAC', aliases: ['bangladesh', 'bst', 'dac'] },
  { timeZone: 'Asia/Bangkok', city: 'Bangkok / Ho Chi Minh', region: 'Thailand / Vietnam', shortCode: 'BKK', aliases: ['thailand', 'vietnam', 'jakarta', 'ict', 'bkk', 'sgn'] },
  { timeZone: 'Asia/Singapore', city: 'Singapore / Kuala Lumpur', region: 'Singapore', shortCode: 'SIN', aliases: ['singapore', 'malaysia', 'kuala lumpur', 'sgt', 'sin', 'kul'] },
  { timeZone: 'Asia/Hong_Kong', city: 'Hong Kong', region: 'Hong Kong', shortCode: 'HKG', aliases: ['hong kong', 'hkt', 'hkg'] },
  { timeZone: 'Asia/Shanghai', city: 'Shanghai / Beijing', region: 'China', shortCode: 'PVG', aliases: ['china', 'shanghai', 'beijing', 'shenzhen', 'cst', 'pvg', 'pek'] },
  { timeZone: 'Asia/Taipei', city: 'Taipei', region: 'Taiwan', shortCode: 'TPE', aliases: ['taiwan', 'taipei', 'tpe'] },
  { timeZone: 'Asia/Manila', city: 'Manila', region: 'Philippines', shortCode: 'MNL', aliases: ['philippines', 'pht', 'mnl'] },
  { timeZone: 'Asia/Seoul', city: 'Seoul', region: 'South Korea', shortCode: 'SEL', aliases: ['korea', 'south korea', 'seoul', 'kst', 'icn', 'sel'] },
  { timeZone: 'Asia/Tokyo', city: 'Tokyo / Osaka', region: 'Japan', shortCode: 'TYO', aliases: ['japan', 'tokyo', 'osaka', 'kyoto', 'jst', 'nrt', 'hnd', 'tyo'] },
  { timeZone: 'Australia/Perth', city: 'Perth', region: 'Western Australia', shortCode: 'PER', aliases: ['australia', 'perth', 'awst', 'per'] },
  { timeZone: 'Australia/Adelaide', city: 'Adelaide', region: 'South Australia', shortCode: 'ADL', aliases: ['adelaide', 'acst', 'acdt', 'adl'] },
  { timeZone: 'Australia/Brisbane', city: 'Brisbane', region: 'Queensland, AU', shortCode: 'BNE', aliases: ['brisbane', 'aest', 'bne'] },
  { timeZone: 'Australia/Sydney', city: 'Sydney / Melbourne', region: 'Australia Eastern', shortCode: 'SYD', aliases: ['australia', 'sydney', 'melbourne', 'canberra', 'aest', 'aedt', 'syd', 'mel'] },
  { timeZone: 'Pacific/Auckland', city: 'Auckland / Wellington', region: 'New Zealand', shortCode: 'AKL', aliases: ['new zealand', 'nz', 'auckland', 'wellington', 'christchurch', 'nzst', 'nzdt', 'akl', 'wlg'] },
]

let cachedDirectory: TimeZoneEntry[] | null = null

export function allTimeZoneEntries(): TimeZoneEntry[] {
  if (cachedDirectory) return cachedDirectory
  const byId = new Map<string, TimeZoneEntry>()
  for (const entry of CURATED_TIME_ZONES) {
    if (isValidTimeZone(entry.timeZone)) byId.set(entry.timeZone, entry)
  }
  const intlAny = Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  if (typeof intlAny.supportedValuesOf === 'function') {
    for (const tz of intlAny.supportedValuesOf('timeZone')) {
      if (byId.has(tz)) continue
      const segments = tz.split('/')
      const city = (segments[segments.length - 1] ?? tz).replace(/_/g, ' ')
      const region = segments.length > 1 ? segments[0]!.replace(/_/g, ' ') : tz
      const code = city.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'TZ'
      byId.set(tz, {
        timeZone: tz,
        city,
        region,
        shortCode: code,
        aliases: [city.toLowerCase(), region.toLowerCase()],
      })
    }
  }
  cachedDirectory = [...byId.values()]
  return cachedDirectory
}

export function timeZoneShortCode(timeZone: string): string {
  const found = CURATED_TIME_ZONES.find(e => e.timeZone === timeZone)
  if (found) return found.shortCode
  const city = (timeZone.split('/').pop() ?? timeZone).replace(/[^A-Za-z]/g, '')
  return (city.slice(0, 3) || timeZone.slice(0, 3)).toUpperCase()
}

export function timeZoneDisplayLabel(timeZone: string): string {
  const found = CURATED_TIME_ZONES.find(e => e.timeZone === timeZone)
  if (found) return found.city
  return (timeZone.split('/').pop() ?? timeZone).replace(/_/g, ' ')
}

export function offsetMinutesAt(timeZone: string, atMs: number): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(fmt.formatToParts(new Date(atMs)).map(p => [p.type, p.value]))
  const h = Number(parts.hour) === 24 ? 0 : Number(parts.hour)
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    h,
    Number(parts.minute),
    Number(parts.second),
  )
  return Math.round((asUtc - atMs) / 60_000)
}

export function formatOffsetMinutes(minutes: number): string {
  if (minutes === 0) return 'UTC'
  const sign = minutes >= 0 ? '+' : '−'
  const abs = Math.abs(minutes)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return m === 0 ? `UTC${sign}${h}` : `UTC${sign}${h}:${String(m).padStart(2, '0')}`
}

export function classifyComfortBand(hour: number, workStart = 9, workEnd = 17): TimeComfortBand {
  if (hour >= workStart && hour < workEnd) return 'daytime'
  if ((hour >= Math.max(6, workStart - 2) && hour < workStart) || (hour >= workEnd && hour < Math.min(22, workEnd + 3))) {
    return 'stretch'
  }
  return 'night'
}

export function getTimeZoneSnapshot(
  timeZone: string,
  at: Date = new Date(),
  timeFormat: '12h' | '24h' = '12h',
  workStart = 9,
  workEnd = 17,
): TimeZoneSnapshot {
  const safeTz = isValidTimeZone(timeZone) ? timeZone : 'UTC'
  const ms = at.getTime()
  const offsetMinutes = offsetMinutesAt(safeTz, ms)
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: safeTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map(p => [p.type, p.value]),
  )
  const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour)
  const minute = Number(parts.minute)
  const timeLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: timeFormat !== '24h',
  }).format(at)
  return {
    timeZone: safeTz,
    label: timeZoneDisplayLabel(safeTz),
    shortCode: timeZoneShortCode(safeTz),
    offsetLabel: formatOffsetMinutes(offsetMinutes),
    offsetMinutes,
    timeLabel,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour,
    minute,
    band: classifyComfortBand(hour, workStart, workEnd),
  }
}

export function searchTimeZones(
  query: string,
  at: Date = new Date(),
  limit = 14,
): Array<TimeZoneEntry & { offsetLabel: string; offsetMinutes: number; timeLabel: string }> {
  const q = query.trim().toLowerCase()
  const entries = allTimeZoneEntries()
  const scored: Array<{ entry: TimeZoneEntry; score: number }> = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!
    const isCurated = i < CURATED_TIME_ZONES.length
    if (!q) {
      if (isCurated) scored.push({ entry, score: 100 - i })
      continue
    }
    const tzLower = entry.timeZone.toLowerCase()
    const cityLower = entry.city.toLowerCase()
    const regionLower = entry.region.toLowerCase()
    const codeLower = entry.shortCode.toLowerCase()
    let score = 0
    if (tzLower === q || codeLower === q) score = 1000
    else if (entry.aliases.includes(q)) score = 900
    else if (cityLower.startsWith(q) || codeLower.startsWith(q)) score = 700
    else if (tzLower.includes(q) || cityLower.includes(q)) score = 500
    else if (regionLower.includes(q) || entry.aliases.some(a => a.includes(q))) score = 350
    else {
      // Check offset search like "+9", "utc-5", "gmt+1"
      const normQ = q.replace(/^(utc|gmt)/, '')
      if (/^[+-]\d{1,2}(:\d{2})?$/.test(normQ)) {
        const off = offsetMinutesAt(entry.timeZone, at.getTime())
        const offStr = formatOffsetMinutes(off).toLowerCase().replace('−', '-')
        if (offStr.includes(normQ)) score = 300
      }
    }
    if (score > 0) {
      scored.push({ entry, score: score + (isCurated ? 40 : 0) })
    }
  }
  scored.sort((a, b) => b.score - a.score || a.entry.city.localeCompare(b.entry.city))
  return scored.slice(0, limit).map(({ entry }) => {
    const snap = getTimeZoneSnapshot(entry.timeZone, at)
    return {
      ...entry,
      offsetLabel: snap.offsetLabel,
      offsetMinutes: snap.offsetMinutes,
      timeLabel: snap.timeLabel,
    }
  })
}

/** Resolve either a canonical IANA timezone or a city/airport/abbreviation query to a valid IANA zone. */
export function resolveTimeZoneInput(raw: string): string | null {
  const cleaned = raw.trim()
  if (!cleaned) return null
  if (isValidTimeZone(cleaned) && (cleaned.includes('/') || cleaned === 'UTC' || cleaned === 'GMT')) {
    return cleaned
  }
  const matches = searchTimeZones(cleaned, new Date(), 1)
  return matches[0]?.timeZone ?? null
}

/** Detect the next DST transition for a timezone within `withinDays` days from `fromMs`. */
export function upcomingDstTransition(
  timeZone: string,
  fromMs: number = Date.now(),
  withinDays = 21,
): DstTransitionInfo | null {
  if (!isValidTimeZone(timeZone)) return null
  const baseOffset = offsetMinutesAt(timeZone, fromMs)
  const dayMs = 86_400_000
  for (let d = 1; d <= withinDays; d++) {
    const probeMs = fromMs + d * dayMs
    const nextOffset = offsetMinutesAt(timeZone, probeMs)
    if (nextOffset !== baseOffset) {
      // Binary search to within 5 minutes of the exact transition instant.
      let lo = probeMs - dayMs
      let hi = probeMs
      while (hi - lo > 5 * 60_000) {
        const mid = Math.floor((lo + hi) / 2)
        if (offsetMinutesAt(timeZone, mid) === baseOffset) lo = mid
        else hi = mid
      }
      const deltaMinutes = nextOffset - baseOffset
      const direction = deltaMinutes > 0 ? 'forward' : 'back'
      const dateKey = dateKeyInTimeZone(new Date(hi), timeZone)
      const label = timeZoneDisplayLabel(timeZone)
      return {
        timeZone,
        dateKey,
        instantIso: new Date(hi).toISOString(),
        deltaMinutes,
        direction,
        summary: `${label} clocks move ${direction} ${Math.abs(deltaMinutes)}m on ${dateKey}`,
      }
    }
  }
  return null
}

function dayDiffBetweenKeys(baseKey: string, otherKey: string): number {
  if (baseKey === otherKey) return 0
  return Math.round((Date.parse(`${otherKey}T00:00:00Z`) - Date.parse(`${baseKey}T00:00:00Z`)) / 86_400_000)
}

export function railHourInfo(
  dayKey: string,
  hour: number,
  primaryTz: string,
  secondaryTz: string,
  timeFormat: '12h' | '24h' = '12h',
  workStart = 9,
  workEnd = 17,
): RailHourInfo {
  const instantIso = instantFromZonedWallTime(dayKey, hour, 0, primaryTz)
  const date = new Date(instantIso)
  const otherDateKey = dateKeyInTimeZone(date, secondaryTz)
  const dayDiff = dayDiffBetweenKeys(dayKey, otherDateKey)
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: secondaryTz,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map(p => [p.type, p.value]),
  )
  const h = Number(parts.hour) === 24 ? 0 : Number(parts.hour)
  const m = Number(parts.minute)
  let label: string
  if (timeFormat === '24h') {
    label = m === 0 ? `${String(h).padStart(2, '0')}:00` : `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  } else if (m === 0) {
    if (h === 0) label = '12a'
    else if (h < 12) label = `${h}a`
    else if (h === 12) label = '12p'
    else label = `${h - 12}p`
  } else {
    const suffix = h < 12 ? 'a' : 'p'
    const h12 = h % 12 === 0 ? 12 : h % 12
    label = `${h12}:${String(m).padStart(2, '0')}${suffix}`
  }
  return {
    label,
    dayDiff,
    dayBadge: dayDiff > 0 ? `+${dayDiff}d` : dayDiff < 0 ? `${dayDiff}d` : '',
    band: classifyComfortBand(h, workStart, workEnd),
    hour: h,
  }
}

export function localTimeReadout(
  startsAt: string,
  endsAt: string,
  timeZone: string,
  referenceTimeZone: string,
  timeFormat: '12h' | '24h' = '12h',
  workStart = 9,
  workEnd = 17,
): LocalTimeReadout {
  const safeTz = isValidTimeZone(timeZone) ? timeZone : 'UTC'
  const refTz = isValidTimeZone(referenceTimeZone) ? referenceTimeZone : safeTz
  const startDate = new Date(startsAt)
  const endDate = new Date(endsAt)
  const startKey = dateKeyInTimeZone(startDate, safeTz)
  const endKey = dateKeyInTimeZone(endDate, safeTz)
  const refKey = dateKeyInTimeZone(startDate, refTz)
  const dayDiff = dayDiffBetweenKeys(refKey, startKey)
  const fmtTime = (d: Date) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: safeTz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: timeFormat !== '24h',
    }).format(d)
  const dateLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(startDate)
  const snap = getTimeZoneSnapshot(safeTz, startDate, timeFormat, workStart, workEnd)
  return {
    timeZone: safeTz,
    shortCode: snap.shortCode,
    offsetLabel: snap.offsetLabel,
    startTime: fmtTime(startDate),
    endTime: fmtTime(endDate),
    dateLabel,
    dayDiff,
    dayBadge: dayDiff > 0 ? `+${dayDiff}d` : dayDiff < 0 ? `${dayDiff}d` : '',
    band: snap.band,
    crossesDate: startKey !== endKey,
  }
}
