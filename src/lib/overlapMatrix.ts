import type { CalendarStore, CandidateSlot } from '../types'
import { dateKeyInTimeZone, eventsInRange, instantFromZonedWallTime, isValidTimeZone } from './calendarModel'
import type { ParticipantAvailability } from './meetingTimes'
import {
  classifyComfortBand,
  formatOffsetMinutes,
  localTimeReadout,
  offsetMinutesAt,
  timeZoneDisplayLabel,
  timeZoneShortCode,
  upcomingDstTransition,
  type DstTransitionInfo,
  type TimeComfortBand,
} from './timeZoneDirectory'

export interface OverlapParticipant {
  label: string
  email?: string
  timeZone: string
  workStart?: number
  workEnd?: number
}

export type OverlapCellQuality = 'golden' | 'good' | 'stretch' | 'hard' | 'owner-busy' | 'teammate-busy' | 'past'

export interface OverlapParticipantCell {
  label: string
  timeZone: string
  hour: number
  minute: number
  timeLabel: string
  band: TimeComfortBand
  dayDiff: number
  knownBusy: boolean
  knownFree: boolean
}

export interface OverlapSlotCell {
  startsAt: string
  endsAt: string
  ownerHour: number
  ownerMinute: number
  ownerLabel: string
  quality: OverlapCellQuality
  /** 0..100 fairness & comfort score across all participants. */
  score: number
  ownerBusy: boolean
  participants: OverlapParticipantCell[]
}

export interface OverlapDayRow {
  dateKey: string
  dayLabel: string
  cells: OverlapSlotCell[]
}

export interface OverlapMatrixResult {
  ownerTimeZone: string
  days: OverlapDayRow[]
  dstAlerts: DstTransitionInfo[]
  /** Suggested rotation hint when one timezone bears most of the evening/early-morning load. */
  fairnessNote: string | null
}

function busyIntervalsFromStore(
  store: CalendarStore,
  rangeStartMs: number,
  rangeEndMs: number,
  ownerTz: string,
): Array<{ start: number; end: number }> {
  const visible = new Set(store.calendars.filter(c => c.visible).map(c => c.id))
  const events = eventsInRange(
    store.events.filter(e => visible.has(e.calendarId)),
    new Date(rangeStartMs).toISOString(),
    new Date(rangeEndMs).toISOString(),
  )
  const out: Array<{ start: number; end: number }> = []
  for (const ev of events) {
    if (ev.status === 'cancelled' || ev.busyStatus === 'free') continue
    if (ev.allDay) {
      const startKey = /^\d{4}-\d{2}-\d{2}$/.test(ev.startsAt)
        ? ev.startsAt
        : dateKeyInTimeZone(ev.startsAt, ownerTz)
      const s = Date.parse(instantFromZonedWallTime(startKey, 0, 0, ownerTz))
      const e = s + 86_400_000
      out.push({ start: s, end: e })
    } else {
      const s = Date.parse(ev.startsAt)
      const e = Date.parse(ev.endsAt)
      if (Number.isFinite(s) && Number.isFinite(e) && e > s) out.push({ start: s, end: e })
    }
  }
  return out
}

function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10)
}

export function enumerateDateKeys(fromKey: string, toKey: string, maxDays = 14): string[] {
  const out: string[] = []
  let cursor = fromKey
  while (cursor <= toKey && out.length < maxDays) {
    out.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return out
}

export function buildOverlapMatrix(input: {
  store: CalendarStore
  ownerTimeZone: string
  fromDateKey: string
  toDateKey: string
  durationMinutes: number
  stepMinutes?: number
  participants: OverlapParticipant[]
  availability?: ParticipantAvailability[]
  bufferBeforeMinutes?: number
  bufferAfterMinutes?: number
  timeFormat?: '12h' | '24h'
  now?: Date
}): OverlapMatrixResult {
  const ownerTz = isValidTimeZone(input.ownerTimeZone) ? input.ownerTimeZone : 'UTC'
  const stepMinutes = input.stepMinutes ?? 60
  const durationMs = Math.max(15, input.durationMinutes) * 60_000
  const bufBeforeMs = (input.bufferBeforeMinutes ?? 0) * 60_000
  const bufAfterMs = (input.bufferAfterMinutes ?? 0) * 60_000
  const nowMs = (input.now ?? new Date()).getTime()
  const timeFormat = input.timeFormat ?? '12h'
  const dateKeys = enumerateDateKeys(input.fromDateKey, input.toDateKey, 10)
  if (!dateKeys.length) {
    return { ownerTimeZone: ownerTz, days: [], dstAlerts: [], fairnessNote: null }
  }

  const rangeStartMs = Date.parse(instantFromZonedWallTime(dateKeys[0]!, 0, 0, ownerTz)) - 86_400_000
  const rangeEndMs = Date.parse(instantFromZonedWallTime(dateKeys[dateKeys.length - 1]!, 23, 59, ownerTz)) + 86_400_000
  const ownerBusyIntervals = busyIntervalsFromStore(input.store, rangeStartMs, rangeEndMs, ownerTz)

  const participantBusyLists = input.participants.map((_, idx) => {
    const av = input.availability?.[idx]
    if (!av || av.status !== 'supplied') return null
    return av.busy.map(b => ({ start: Date.parse(b.start), end: Date.parse(b.end) }))
  })

  const ownerWorkStart = input.store.settings.availableStartHour ?? 9
  const ownerWorkEnd = input.store.settings.availableEndHour ?? 17

  const fmtHour = (date: Date, tz: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: stepMinutes < 60 ? '2-digit' : undefined,
      hour12: timeFormat !== '24h',
    }).format(date)

  const clockParts = (date: Date, tz: string) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(date)
        .map(p => [p.type, p.value]),
    )
    const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour)
    return {
      dateKey: `${parts.year}-${parts.month}-${parts.day}`,
      hour,
      minute: Number(parts.minute),
    }
  }

  const days: OverlapDayRow[] = []
  let goldenCount = 0
  const stretchBurdenByParticipant = new Map<string, number>()

  for (const dateKey of dateKeys) {
    const cells: OverlapSlotCell[] = []
    for (let m = 0; m < 24 * 60; m += stepMinutes) {
      const hour = Math.floor(m / 60)
      const minute = m % 60
      const startIso = instantFromZonedWallTime(dateKey, hour, minute, ownerTz)
      const startMs = Date.parse(startIso)
      const endMs = startMs + durationMs
      const endIso = new Date(endMs).toISOString()
      const startDate = new Date(startMs)

      const isPast = startMs < nowMs
      const ownerBusy = ownerBusyIntervals.some(b => b.start < endMs + bufAfterMs && b.end > startMs - bufBeforeMs)
      const ownerBand = classifyComfortBand(hour, ownerWorkStart, ownerWorkEnd)

      let anyTeammateBusy = false
      let allDaytime = ownerBand === 'daytime'
      let anyNight = ownerBand === 'night'
      let stretchCount = ownerBand === 'stretch' ? 1 : 0

      const pCells: OverlapParticipantCell[] = input.participants.map((p, idx) => {
        const tz = isValidTimeZone(p.timeZone) ? p.timeZone : 'UTC'
        const cp = clockParts(startDate, tz)
        const band = classifyComfortBand(cp.hour, p.workStart ?? 9, p.workEnd ?? 17)
        if (band !== 'daytime') allDaytime = false
        if (band === 'night') anyNight = true
        if (band === 'stretch') stretchCount++
        const busyList = participantBusyLists[idx]
        const knownBusy = Boolean(busyList?.some(b => b.start < endMs && b.end > startMs))
        if (knownBusy) anyTeammateBusy = true
        const dayDiff = Math.round(
          (Date.parse(`${cp.dateKey}T00:00:00Z`) - Date.parse(`${dateKey}T00:00:00Z`)) / 86_400_000,
        )
        return {
          label: p.label,
          timeZone: tz,
          hour: cp.hour,
          minute: cp.minute,
          timeLabel: fmtHour(startDate, tz),
          band,
          dayDiff,
          knownBusy,
          knownFree: Boolean(busyList && !knownBusy),
        }
      })

      let quality: OverlapCellQuality
      let score = 100
      if (isPast) {
        quality = 'past'
        score = 0
      } else if (ownerBusy) {
        quality = 'owner-busy'
        score = 0
      } else if (anyTeammateBusy) {
        quality = 'teammate-busy'
        score = 0
      } else if (allDaytime) {
        quality = 'golden'
        score = 100
        goldenCount++
      } else if (!anyNight && stretchCount <= 1) {
        quality = 'good'
        score = 80
        for (const pc of pCells) {
          if (pc.band === 'stretch') {
            stretchBurdenByParticipant.set(pc.label, (stretchBurdenByParticipant.get(pc.label) ?? 0) + 1)
          }
        }
      } else if (!anyNight) {
        quality = 'stretch'
        score = Math.max(45, 75 - stretchCount * 10)
      } else {
        quality = 'hard'
        score = 20
      }

      cells.push({
        startsAt: startIso,
        endsAt: endIso,
        ownerHour: hour,
        ownerMinute: minute,
        ownerLabel: fmtHour(startDate, ownerTz),
        quality,
        score,
        ownerBusy,
        participants: pCells,
      })
    }

    const [y, mo, d] = dateKey.split('-').map(Number)
    const dayLabel = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(y!, mo! - 1, d!)))

    days.push({ dateKey, dayLabel, cells })
  }

  // DST transition warnings across owner + all participant zones.
  const uniqueZones = [...new Set([ownerTz, ...input.participants.map(p => p.timeZone).filter(isValidTimeZone)])]
  const spanDays = Math.max(14, dateKeys.length + 7)
  const dstAlerts: DstTransitionInfo[] = []
  for (const tz of uniqueZones) {
    const info = upcomingDstTransition(tz, rangeStartMs + 86_400_000, spanDays)
    if (info) dstAlerts.push(info)
  }

  let fairnessNote: string | null = null
  if (input.participants.length > 0 && goldenCount === 0) {
    const mostStretched = [...stretchBurdenByParticipant.entries()].sort((a, b) => b[1] - a[1])[0]
    fairnessNote = mostStretched
      ? `No overlapping 9–5 window across all timezones. For recurring meetings, consider rotating early/late slots so ${mostStretched[0]} does not absorb every stretch hour.`
      : 'No overlapping 9–5 window across all timezones; stretch slots (7–9 / 17–20) are highlighted in amber.'
  }

  return { ownerTimeZone: ownerTz, days, dstAlerts, fairnessNote }
}

/** Generate clean, scannable multi-timezone proposed-times text for email, chat, or clipboard. */
export function formatProposedSlotsText(
  slots: CandidateSlot[],
  zones: Array<{ label: string; timeZone: string }>,
  options: {
    title?: string
    bookingUrl?: string
    timeFormat?: '12h' | '24h'
    referenceTimeZone: string
  },
): string {
  if (!slots.length) return ''
  const timeFormat = options.timeFormat ?? '12h'
  const cleanZones = zones.filter(z => isValidTimeZone(z.timeZone))
  const effectiveZones = cleanZones.length
    ? cleanZones
    : [{ label: timeZoneDisplayLabel(options.referenceTimeZone), timeZone: options.referenceTimeZone }]

  const lines: string[] = []
  if (options.title) lines.push(`${options.title} — proposed times:`)
  else lines.push('Proposed meeting times:')
  lines.push('')

  const sorted = [...slots].sort((a, b) => a.start.localeCompare(b.start))
  for (const slot of sorted) {
    const primary = localTimeReadout(
      slot.start,
      slot.end,
      effectiveZones[0]!.timeZone,
      options.referenceTimeZone,
      timeFormat,
    )
    if (effectiveZones.length === 1) {
      lines.push(
        `• ${primary.dateLabel}, ${primary.startTime}–${primary.endTime} ${primary.shortCode} (${primary.offsetLabel})`,
      )
    } else {
      const cols = effectiveZones.map(z => {
        const r = localTimeReadout(slot.start, slot.end, z.timeZone, effectiveZones[0]!.timeZone, timeFormat)
        const off = formatOffsetMinutes(offsetMinutesAt(z.timeZone, Date.parse(slot.start)))
        const code = z.label || timeZoneShortCode(z.timeZone)
        return `${r.startTime}–${r.endTime} ${code}${r.dayBadge ? ` (${r.dayBadge})` : ''} [${off}]`
      })
      lines.push(`• ${primary.dateLabel}: ${cols.join('  |  ')}`)
    }
  }

  if (options.bookingUrl) {
    lines.push('')
    lines.push(`Pick a time directly (auto-converts to your timezone): ${options.bookingUrl}`)
  }
  return lines.join('\n')
}
