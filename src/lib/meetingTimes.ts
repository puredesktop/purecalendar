import type { CalendarEvent, CalendarStore } from '../types'
import {
  createDraftEvent,
  dateKeyInTimeZone,
  ensureLocalCalendar,
  eventsInRange,
  firstEditableCalendarId,
  instantFromZonedWallTime,
  isValidTimeZone,
  normalizeAvailabilitySettings,
} from './calendarModel'

/**
 * Find a time: up to three ranked starts for a meeting, checked against the
 * owner's own calendar and working days/hours, shown in every participant's
 * local time, and — once one is chosen and still free — one private draft.
 *
 * What is known and what is not is kept apart throughout. The owner's busy
 * time comes from their visible calendars (the same scope as the views and
 * listCalendarEvents); a calendar whose last read failed makes the search
 * refuse rather than read as empty. Another person's busy time is used only
 * when a supported connection (the organisation's team calendar) supplied
 * it, recently; otherwise it is labelled unknown. A participant's time zone
 * says when it is day for them — never that they are free.
 */

const MINUTE = 60_000
const STEP_MINUTES = 15
const MAX_RANGE_DAYS = 62
const MAX_DURATION_MINUTES = 12 * 60
const MAX_GAP_MINUTES = 240
export const OPTIONS_WANTED = 3
/** Free/busy older than this is not trusted to qualify a time. */
export const AVAILABILITY_STALE_AFTER_MS = 15 * MINUTE
/** A convention for "daytime" in someone's zone, used only to rank — never as their working hours. */
const DAYTIME_START = 8 * 60
const DAYTIME_END = 18 * 60
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export interface MeetingParticipantInput {
  name?: string
  email?: string
  timeZone: string
}

export interface MeetingRequestInput {
  title?: string
  durationMinutes: number
  /** First day searched, YYYY-MM-DD in the owner's time zone. */
  from: string
  /** Last day searched (inclusive), YYYY-MM-DD in the owner's time zone. */
  to: string
  participants?: MeetingParticipantInput[]
  bufferBeforeMinutes?: number
  bufferAfterMinutes?: number
}

export interface MeetingParticipant {
  label: string
  name?: string
  email?: string
  timeZone: string
}

export interface MeetingRequest {
  title: string
  durationMinutes: number
  from: string
  to: string
  participants: MeetingParticipant[]
  bufferBeforeMinutes: number
  bufferAfterMinutes: number
}

export type MeetingValidation = { ok: true; request: MeetingRequest } | { ok: false; errors: string[] }

/** What a supported connection said about one participant, or why nothing is known. */
export type ParticipantAvailability =
  | { status: 'supplied'; busy: Array<{ start: string; end: string }>; checkedAt: string; source: string }
  | { status: 'unavailable'; reason: string; source: string }
  | { status: 'none' }

export interface LocalTimes {
  timeZone: string
  /** e.g. GMT+01:00 — what tells a repeated autumn hour apart. */
  offset: string
  endOffset: string
  date: string
  dateLabel: string
  start: string
  end: string
  /** Set when the meeting ends on a later local date than it starts. */
  endDateLabel?: string
  /** The local start/end with offset, parseable back to the exact instants. */
  startIso: string
  endIso: string
  text: string
}

export interface ParticipantSlot {
  label: string
  timeZone: string
  local: LocalTimes
  /** 'free' only when a supported connection said so, recently. */
  availability: 'free' | 'unknown'
  availabilityNote: string
  daytime: boolean
}

export interface MeetingOption {
  rank: number
  startsAt: string
  endsAt: string
  durationMinutes: number
  owner: LocalTimes
  participants: ParticipantSlot[]
  benefits: string[]
  tradeOffs: string[]
}

export interface MeetingSearch {
  ok: true
  request: MeetingRequest
  ownerTimeZone: string
  checkedAt: string
  options: MeetingOption[]
  /** Why fewer than three, from the counts; null when three were found. */
  shortfall: string | null
  /** What the search looked at, in a sentence each. */
  basis: string[]
  /** One per participant: what is known of their availability. */
  availabilityCaveats: string[]
  /** Per participant, what was used — kept to recheck the same sources on selection. */
  availability: ParticipantAvailability[]
}

export type MeetingSearchResult =
  | MeetingSearch
  | { ok: false; kind: 'validation' | 'owner-calendar'; errors: string[] }

// ---------------------------------------------------------------------------
// Validation

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/
/** A named IANA zone (Area/City, or UTC/GMT-style names) — not a bare offset. */
const NAMED_ZONE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/

function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = DATE_KEY.exec(value)
  if (!match) return false
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.toISOString().slice(0, 10) === value
}

export function isNamedTimeZone(value: unknown): value is string {
  return typeof value === 'string' && NAMED_ZONE.test(value) && isValidTimeZone(value)
}

function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

function readGap(value: unknown, name: string, errors: string[]): number {
  if (value === undefined || value === null || value === '') return 0
  const minutes = typeof value === 'string' ? Number(value) : value
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || !Number.isInteger(minutes)) {
    errors.push(`${name} must be a whole number of minutes.`)
    return 0
  }
  if (minutes < 0) errors.push(`${name} cannot be negative (got ${minutes}).`)
  else if (minutes > MAX_GAP_MINUTES) errors.push(`${name} can be at most ${MAX_GAP_MINUTES} minutes.`)
  return minutes
}

/** Every rule a request must meet before anything is searched or written. */
export function validateMeetingRequest(input: Partial<MeetingRequestInput> | null | undefined): MeetingValidation {
  const errors: string[] = []
  const raw = input ?? {}
  const duration = typeof raw.durationMinutes === 'string' ? Number(raw.durationMinutes) : raw.durationMinutes
  if (typeof duration !== 'number' || !Number.isFinite(duration) || !Number.isInteger(duration)) {
    errors.push('Duration must be a whole number of minutes.')
  } else if (duration <= 0) {
    errors.push(`Duration must be more than 0 minutes (got ${duration}).`)
  } else if (duration > MAX_DURATION_MINUTES) {
    errors.push(`Duration can be at most ${MAX_DURATION_MINUTES / 60} hours.`)
  }
  const fromOk = isDateKey(raw.from)
  const toOk = isDateKey(raw.to)
  if (!fromOk) errors.push('The first day must be a date written YYYY-MM-DD.')
  if (!toOk) errors.push('The last day must be a date written YYYY-MM-DD.')
  if (fromOk && toOk) {
    const span = daysBetween(raw.from!, raw.to!)
    if (span < 0) errors.push(`The last day (${raw.to}) is before the first day (${raw.from}).`)
    else if (span >= MAX_RANGE_DAYS) errors.push(`Search at most ${MAX_RANGE_DAYS} days at a time.`)
  }
  const bufferBeforeMinutes = readGap(raw.bufferBeforeMinutes, 'The gap before', errors)
  const bufferAfterMinutes = readGap(raw.bufferAfterMinutes, 'The gap after', errors)
  const participants: MeetingParticipant[] = []
  const rawParticipants = raw.participants ?? []
  if (!Array.isArray(rawParticipants)) {
    errors.push('Participants must be a list.')
  } else {
    rawParticipants.forEach((participant, index) => {
      const name = typeof participant?.name === 'string' ? participant.name.trim() : ''
      const email = typeof participant?.email === 'string' ? participant.email.trim() : ''
      const label = name || email || `Participant ${index + 1}`
      const zone = typeof participant?.timeZone === 'string' ? participant.timeZone.trim() : ''
      if (!zone) {
        errors.push(`${label} needs a time zone (an IANA name such as Europe/Berlin).`)
        return
      }
      if (!isNamedTimeZone(zone)) {
        errors.push(`"${zone}" for ${label} is not a recognised time zone. Use an IANA name such as America/New_York.`)
        return
      }
      if (email && !/^[^@\s]+@[^@\s]+$/.test(email)) {
        errors.push(`"${email}" for ${label} is not an email address.`)
        return
      }
      participants.push({ label, ...(name ? { name } : {}), ...(email ? { email } : {}), timeZone: zone })
    })
  }
  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    request: {
      title: (typeof raw.title === 'string' && raw.title.trim()) || 'Meeting',
      durationMinutes: duration as number,
      from: raw.from!,
      to: raw.to!,
      participants,
      bufferBeforeMinutes,
      bufferAfterMinutes,
    },
  }
}

// ---------------------------------------------------------------------------
// Local times

interface WallClock {
  dateKey: string
  weekday: number
  minutes: number
  offset: string
}

const wallFormats = new Map<string, Intl.DateTimeFormat>()
function wallClock(ms: number, timeZone: string): WallClock {
  let format = wallFormats.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
      timeZoneName: 'longOffset',
    })
    wallFormats.set(timeZone, format)
  }
  const parts = Object.fromEntries(format.formatToParts(new Date(ms)).map(part => [part.type, part.value]))
  const dateKey = `${parts.year}-${parts.month}-${parts.day}`
  const offset = parts.timeZoneName === 'GMT' ? 'GMT+00:00' : (parts.timeZoneName ?? 'GMT+00:00')
  return {
    dateKey,
    weekday: new Date(`${dateKey}T00:00:00Z`).getUTCDay(),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    offset,
  }
}

const pad = (value: number): string => String(value).padStart(2, '0')
const clock = (minutes: number): string => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`
const isoOffset = (offset: string): string => (offset === 'GMT+00:00' ? 'Z' : offset.slice(3))

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Mon 2 Nov 2026": the calendar date itself, in no zone. */
function dateLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const weekday = WEEKDAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]!.slice(0, 3)
  return `${weekday} ${day} ${MONTHS[month - 1]} ${year}`
}

/** A meeting's start and end as one person's clock shows them, with the zone named. */
export function localTimes(startsAt: string, endsAt: string, timeZone: string): LocalTimes {
  const start = wallClock(Date.parse(startsAt), timeZone)
  const end = wallClock(Date.parse(endsAt), timeZone)
  const startText = clock(start.minutes)
  const endText = clock(end.minutes)
  const crossesDate = end.dateKey !== start.dateKey
  const offsetText = start.offset === end.offset ? start.offset : `${start.offset} → ${end.offset}`
  return {
    timeZone,
    offset: start.offset,
    endOffset: end.offset,
    date: start.dateKey,
    dateLabel: dateLabel(start.dateKey),
    start: startText,
    end: endText,
    ...(crossesDate ? { endDateLabel: dateLabel(end.dateKey) } : {}),
    startIso: `${start.dateKey}T${startText}:00${isoOffset(start.offset)}`,
    endIso: `${end.dateKey}T${endText}:00${isoOffset(end.offset)}`,
    text: `${dateLabel(start.dateKey)}, ${startText}–${crossesDate ? `${dateLabel(end.dateKey)}, ` : ''}${endText} ${timeZone} (${offsetText})`,
  }
}

// ---------------------------------------------------------------------------
// The owner's calendar

interface Interval {
  start: number
  end: number
}

/** The calendars a search reads: the visible ones, as the views and listCalendarEvents do. */
export function calendarsInScope(store: CalendarStore): CalendarStore['calendars'] {
  return store.calendars.filter(calendar => calendar.visible)
}

/**
 * Why the owner's calendar cannot be trusted for this search, or null. A
 * calendar whose events could not be read (this fetch, or its account in
 * error) would otherwise look empty, and every time on it would look free.
 */
export function ownerCalendarProblem(store: CalendarStore | null | undefined): string | null {
  if (!store) return 'Your calendar has not loaded yet, so free time cannot be worked out. Try again in a moment.'
  const failed = new Set(store.failedCalendarIds ?? [])
  const sourceError = new Set(store.sources.filter(source => source.syncState === 'error').map(source => source.id))
  const broken = calendarsInScope(store).filter(calendar => failed.has(calendar.id) || sourceError.has(calendar.sourceId))
  if (!broken.length) return null
  const names = broken.map(calendar => calendar.name).join(', ')
  return `${names} could not be read, so its busy times are unknown. Refresh, or hide ${broken.length === 1 ? 'that calendar' : 'those calendars'}, then search again — no times are suggested meanwhile.`
}

function allDayKey(value: string, timeZone: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : dateKeyInTimeZone(value, timeZone)
}

/**
 * The owner's busy time between two instants: events on visible calendars,
 * recurring ones expanded (excluded starts left out, moved instances as their
 * own events), cancelled ones and those marked free left out. Drafts count:
 * they are holds on the owner's time. An all-day event blocks its whole
 * day(s) in the owner's zone.
 */
export function ownerBusyIntervals(store: CalendarStore, fromMs: number, toMs: number, ownerTimeZone: string): Interval[] {
  const scope = new Set(calendarsInScope(store).map(calendar => calendar.id))
  // Padded a day each side so all-day events (stored as dates) and buffers are caught.
  const from = new Date(fromMs - 2 * 86_400_000).toISOString()
  const to = new Date(toMs + 2 * 86_400_000).toISOString()
  const events = eventsInRange(
    store.events.filter(event => scope.has(event.calendarId)),
    from,
    to,
  )
  const intervals: Interval[] = []
  for (const event of events) {
    if (event.busyStatus === 'free') continue
    let start: number
    let end: number
    if (event.allDay) {
      const zone = isValidTimeZone(event.timeZone) ? event.timeZone : ownerTimeZone
      const startKey = allDayKey(event.startsAt, zone)
      let endKey = allDayKey(event.endsAt || event.startsAt, zone)
      if (endKey <= startKey) endKey = addDays(startKey, 1)
      start = Date.parse(instantFromZonedWallTime(startKey, 0, 0, ownerTimeZone))
      end = Date.parse(instantFromZonedWallTime(endKey, 0, 0, ownerTimeZone))
    } else {
      start = Date.parse(event.startsAt)
      end = Date.parse(event.endsAt)
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
    if (end <= fromMs - 2 * 86_400_000 || start >= toMs + 2 * 86_400_000) continue
    intervals.push({ start, end })
  }
  return intervals.sort((a, b) => a.start - b.start || a.end - b.end)
}

const overlaps = (intervals: Interval[], start: number, end: number): boolean =>
  intervals.some(interval => interval.start < end && interval.end > start)

// ---------------------------------------------------------------------------
// Participants

function isStale(availability: ParticipantAvailability, nowMs: number): boolean {
  if (availability.status !== 'supplied') return false
  const checked = Date.parse(availability.checkedAt)
  return !Number.isFinite(checked) || nowMs - checked > AVAILABILITY_STALE_AFTER_MS
}

/** Free/busy that may qualify a time: supplied by a connection, and recent. */
function usableBusy(availability: ParticipantAvailability | undefined, nowMs: number): Interval[] | null {
  if (!availability || availability.status !== 'supplied' || isStale(availability, nowMs)) return null
  return availability.busy
    .map(time => ({ start: Date.parse(time.start), end: Date.parse(time.end) }))
    .filter(time => Number.isFinite(time.start) && Number.isFinite(time.end) && time.end > time.start)
}

function minutesAgo(iso: string, nowMs: number): string {
  const minutes = Math.max(0, Math.round((nowMs - Date.parse(iso)) / MINUTE))
  return minutes === 0 ? 'just now' : `${minutes} minute${minutes === 1 ? '' : 's'} ago`
}

/** One sentence on what is known of a participant's availability. */
export function availabilityCaveat(participant: MeetingParticipant, availability: ParticipantAvailability | undefined, nowMs: number): string {
  if (!availability || availability.status === 'none') {
    return `${participant.label}: availability unknown — no connected calendar shares their free/busy. Their time zone only shows their local time, not whether they are free.`
  }
  if (availability.status === 'unavailable') {
    return `${participant.label}: availability unknown — their ${availability.source} free/busy could not be read (${availability.reason}).`
  }
  if (isStale(availability, nowMs)) {
    return `${participant.label}: availability unknown — their ${availability.source} free/busy was read ${minutesAgo(availability.checkedAt, nowMs)}, too long ago to rely on.`
  }
  return `${participant.label}: free/busy from the ${availability.source}, read ${minutesAgo(availability.checkedAt, nowMs)}; times busy there are left out. Still theirs to confirm.`
}

function slotNote(availability: ParticipantAvailability | undefined, nowMs: number): { availability: 'free' | 'unknown'; note: string } {
  if (usableBusy(availability, nowMs) && availability?.status === 'supplied') {
    return { availability: 'free', note: `Free on the ${availability.source} (read ${minutesAgo(availability.checkedAt, nowMs)})` }
  }
  if (availability?.status === 'unavailable') return { availability: 'unknown', note: 'Availability unknown (their calendar could not be read)' }
  if (availability?.status === 'supplied') return { availability: 'unknown', note: 'Availability unknown (their free/busy is out of date)' }
  return { availability: 'unknown', note: 'Availability unknown' }
}

// ---------------------------------------------------------------------------
// The search

interface OwnerHours {
  days: number[]
  startMinutes: number
  endMinutes: number
}

function ownerHours(store: CalendarStore): OwnerHours {
  const availability = normalizeAvailabilitySettings(store.settings)
  return {
    days: availability.availableDays,
    startMinutes: availability.availableStartHour * 60,
    endMinutes: availability.availableEndHour * 60,
  }
}

function describeHours(hours: OwnerHours): string {
  const days = hours.days.map(day => WEEKDAY_NAMES[day]!.slice(0, 3)).join(', ')
  return `${days} ${clock(hours.startMinutes)}–${hours.endMinutes === 24 * 60 ? '24:00' : clock(hours.endMinutes)}`
}

type Rejection = 'past' | 'hours' | 'owner' | 'participant'

interface CandidateCheck {
  ok: boolean
  reason?: Rejection
  busyParticipants?: string[]
}

interface SearchContext {
  request: MeetingRequest
  ownerTimeZone: string
  hours: OwnerHours
  busy: Interval[]
  participantBusy: Array<Interval[] | null>
  nowMs: number
  rangeStart: number
  rangeEnd: number
}

function withinOwnerHours(start: number, end: number, context: SearchContext): boolean {
  const first = wallClock(start, context.ownerTimeZone)
  // The minute before the end, so a meeting ending at 17:00 (or midnight) is on the same day.
  const last = wallClock(end - MINUTE, context.ownerTimeZone)
  if (first.dateKey !== last.dateKey) return false
  if (!context.hours.days.includes(first.weekday)) return false
  return first.minutes >= context.hours.startMinutes && last.minutes + 1 <= context.hours.endMinutes
}

function checkCandidate(start: number, context: SearchContext): CandidateCheck {
  const end = start + context.request.durationMinutes * MINUTE
  if (start < context.rangeStart || end > context.rangeEnd) return { ok: false, reason: 'hours' }
  if (start < context.nowMs) return { ok: false, reason: 'past' }
  if (!withinOwnerHours(start, end, context)) return { ok: false, reason: 'hours' }
  const guardedStart = start - context.request.bufferBeforeMinutes * MINUTE
  const guardedEnd = end + context.request.bufferAfterMinutes * MINUTE
  if (overlaps(context.busy, guardedStart, guardedEnd)) return { ok: false, reason: 'owner' }
  const busyParticipants = context.request.participants
    .filter((_, index) => {
      const busy = context.participantBusy[index]
      return busy ? overlaps(busy, start, end) : false
    })
    .map(participant => participant.label)
  if (busyParticipants.length) return { ok: false, reason: 'participant', busyParticipants }
  return { ok: true }
}

interface Scored {
  start: number
  end: number
  dayKey: string
  score: number
  benefits: string[]
  tradeOffs: string[]
  participants: ParticipantSlot[]
}

function scoreCandidate(start: number, context: SearchContext, availability: ParticipantAvailability[]): Scored {
  const { request, ownerTimeZone, busy, hours } = context
  const end = start + request.durationMinutes * MINUTE
  const startsAt = new Date(start).toISOString()
  const endsAt = new Date(end).toISOString()
  const ownerClock = wallClock(start, ownerTimeZone)
  const benefits: string[] = []
  const tradeOffs: string[] = []
  let score = 0

  const participants: ParticipantSlot[] = request.participants.map((participant, index) => {
    const local = localTimes(startsAt, endsAt, participant.timeZone)
    const first = wallClock(start, participant.timeZone)
    const last = wallClock(end - MINUTE, participant.timeZone)
    const daytime =
      first.dateKey === last.dateKey &&
      first.weekday >= 1 &&
      first.weekday <= 5 &&
      first.minutes >= DAYTIME_START &&
      last.minutes + 1 <= DAYTIME_END
    const note = slotNote(availability[index], context.nowMs)
    return { label: participant.label, timeZone: participant.timeZone, local, availability: note.availability, availabilityNote: note.note, daytime }
  })

  const daytimeFor = participants.filter(slot => slot.daytime).map(slot => `${slot.label} (${slot.local.start} ${slot.timeZone})`)
  const outside = participants.filter(slot => !slot.daytime)
  if (daytimeFor.length) {
    benefits.push(`Weekday daytime (08:00–18:00) for ${daytimeFor.join(', ')}.`)
  }
  for (const slot of outside) {
    score += 100
    const weekday = WEEKDAY_NAMES[new Date(`${slot.local.date}T00:00:00Z`).getUTCDay()]
    tradeOffs.push(
      `${slot.local.start}–${slot.local.end} on ${weekday} for ${slot.label} (${slot.timeZone}) — outside weekday 08:00–18:00 there.`,
    )
  }
  const freeFor = participants.filter(slot => slot.availability === 'free').map(slot => slot.label)
  if (freeFor.length) benefits.push(`Shown free on the connected calendar for ${freeFor.join(', ')}.`)

  // Next to an existing commitment (gaps included) rather than in the middle of open time.
  const guardedStart = start - request.bufferBeforeMinutes * MINUTE
  const guardedEnd = end + request.bufferAfterMinutes * MINUTE
  const near = 15 * MINUTE
  const before = busy.filter(interval => interval.end <= guardedStart).reduce<number | null>((latest, interval) => (latest === null || interval.end > latest ? interval.end : latest), null)
  const after = busy.filter(interval => interval.start >= guardedEnd).reduce<number | null>((earliest, interval) => (earliest === null || interval.start < earliest ? interval.start : earliest), null)
  const dayStart = Date.parse(instantFromZonedWallTime(ownerClock.dateKey, Math.floor(hours.startMinutes / 60), hours.startMinutes % 60, ownerTimeZone))
  const dayEnd =
    hours.endMinutes >= 24 * 60
      ? Date.parse(instantFromZonedWallTime(addDays(ownerClock.dateKey, 1), 0, 0, ownerTimeZone))
      : Date.parse(instantFromZonedWallTime(ownerClock.dateKey, Math.floor(hours.endMinutes / 60), hours.endMinutes % 60, ownerTimeZone))
  const adjacentBefore = before !== null && guardedStart - before <= near
  const adjacentAfter = after !== null && after - guardedEnd <= near
  const atEdge = guardedStart - dayStart <= near || dayEnd - guardedEnd <= near
  if (adjacentBefore || adjacentAfter) {
    benefits.push(`Next to something already on your calendar${request.bufferBeforeMinutes || request.bufferAfterMinutes ? ' (gaps kept)' : ''}, so your longer open time stays whole.`)
  } else if (atEdge) {
    score += 3
    benefits.push('At the edge of your working day, so the middle of the day stays open.')
  } else {
    score += 10
    const openFrom = Math.max(before ?? dayStart, dayStart)
    const openTo = Math.min(after ?? dayEnd, dayEnd)
    const openHours = Math.round(((openTo - openFrom) / (60 * MINUTE)) * 10) / 10
    tradeOffs.push(`Falls inside ${openHours} open hours on your calendar, splitting time you could use for focused work.`)
  }

  if (request.participants.length) {
    const lateFriday = ownerClock.weekday === 5 && ownerClock.minutes >= 15 * 60
    const earlyMonday = ownerClock.weekday === 1 && ownerClock.minutes < 10 * 60
    if (lateFriday || earlyMonday) {
      score += 20
      tradeOffs.push(lateFriday ? 'Late on a Friday for you — a last-resort slot for a meeting with others.' : 'Early on a Monday for you — a last-resort slot for a meeting with others.')
    }
  }

  return { start, end, dayKey: ownerClock.dateKey, score, benefits, tradeOffs, participants }
}

function shortfallText(found: number, counts: Record<Rejection, number>, total: number, context: SearchContext): string {
  const parts: string[] = []
  if (counts.hours) parts.push(`${counts.hours} fall outside your working hours (${describeHours(context.hours)}, ${context.ownerTimeZone}) or the dates searched`)
  if (counts.past) parts.push(`${counts.past} are already past`)
  if (counts.owner) {
    const gaps = context.request.bufferBeforeMinutes || context.request.bufferAfterMinutes
    parts.push(`${counts.owner} would overlap something on your calendar${gaps ? ` or the ${context.request.bufferBeforeMinutes}-minute gap before / ${context.request.bufferAfterMinutes}-minute gap after` : ''}`)
  }
  if (counts.participant) parts.push(`${counts.participant} clash with a participant's connected calendar`)
  const head =
    found === 0
      ? `No time qualifies for a ${context.request.durationMinutes}-minute meeting between ${dateLabel(context.request.from)} and ${dateLabel(context.request.to)}.`
      : `Only ${found} time${found === 1 ? '' : 's'} qualif${found === 1 ? 'ies' : 'y'} (${OPTIONS_WANTED} were asked for).`
  const detail = total
    ? ` Of the ${total} quarter-hour starts checked, ${parts.join('; ')}.`
    : ''
  const advice =
    found < OPTIONS_WANTED
      ? ' Widen the dates, shorten the meeting or the gaps, or change your working hours in Settings to see more.'
      : ''
  return `${head}${detail}${advice}`
}

/**
 * Up to three ranked starts. Ranking (lower score first, then earlier): every
 * participant whose local time falls outside weekday daytime costs most; a
 * time inside a long open stretch of the owner's day costs more than one next
 * to an existing commitment or at the day's edge; late Friday / early Monday
 * cost a little when others are invited. The three are spread over different
 * days and do not overlap when the candidates allow.
 */
/**
 * The owner's calendar for a search: the store, its zone, and — when some of
 * its calendars are only read for a window ahead (Google, the team calendar,
 * feeds) — the last instant every one of them was read up to. Past it the
 * calendar is not known, so nothing there is suggested or drafted.
 */
export interface OwnerCalendarRead {
  store: CalendarStore
  timeZone: string
  coveredUntil?: string | null
}

type OwnerInput = { store: CalendarStore | null | undefined; timeZone: string; now: Date; coveredUntil?: string | null }

function prepareSearch(
  input: Partial<MeetingRequestInput>,
  owner: OwnerInput,
  availability: ParticipantAvailability[],
): { ok: true; context: SearchContext; store: CalendarStore; aligned: ParticipantAvailability[] } | { ok: false; kind: 'validation' | 'owner-calendar'; errors: string[] } {
  const validation = validateMeetingRequest(input)
  if (!validation.ok) return { ok: false, kind: 'validation', errors: validation.errors }
  const request = validation.request
  const problem = ownerCalendarProblem(owner.store)
  if (problem || !owner.store) return { ok: false, kind: 'owner-calendar', errors: [problem ?? 'Your calendar is not available.'] }
  if (!isValidTimeZone(owner.timeZone)) {
    return { ok: false, kind: 'owner-calendar', errors: [`Your calendar's time zone "${owner.timeZone}" is not recognised; set it in Settings.`] }
  }
  const store = owner.store
  const ownerTimeZone = owner.timeZone
  const nowMs = owner.now.getTime()
  const rangeStart = Date.parse(instantFromZonedWallTime(request.from, 0, 0, ownerTimeZone))
  const rangeEnd = Date.parse(instantFromZonedWallTime(addDays(request.to, 1), 0, 0, ownerTimeZone))
  const covered = owner.coveredUntil ? Date.parse(owner.coveredUntil) : Number.POSITIVE_INFINITY
  if (rangeEnd + request.bufferAfterMinutes * MINUTE > covered) {
    const last = localTimes(new Date(covered - MINUTE).toISOString(), new Date(covered - MINUTE).toISOString(), ownerTimeZone)
    return {
      ok: false,
      kind: 'owner-calendar',
      errors: [`Your calendars are only read up to ${last.dateLabel}, so later times cannot be checked. Search dates up to ${last.dateLabel}.`],
    }
  }
  const aligned = request.participants.map((_, index) => availability[index] ?? ({ status: 'none' } as const))
  return {
    ok: true,
    store,
    aligned,
    context: {
      request,
      ownerTimeZone,
      hours: ownerHours(store),
      busy: ownerBusyIntervals(store, rangeStart, rangeEnd, ownerTimeZone),
      participantBusy: aligned.map(item => usableBusy(item, nowMs)),
      nowMs,
      rangeStart,
      rangeEnd,
    },
  }
}

/** Every quarter-hour start in the range, checked: the eligible ones and why the rest were not. */
function scanCandidates(context: SearchContext): { eligible: number[]; counts: Record<Rejection, number>; total: number } {
  const step = STEP_MINUTES * MINUTE
  const counts: Record<Rejection, number> = { past: 0, hours: 0, owner: 0, participant: 0 }
  const eligible: number[] = []
  let total = 0
  for (let start = Math.ceil(context.rangeStart / step) * step; start + context.request.durationMinutes * MINUTE <= context.rangeEnd; start += step) {
    total += 1
    const check = checkCandidate(start, context)
    if (check.ok) eligible.push(start)
    else counts[check.reason!] += 1
  }
  return { eligible, counts, total }
}

/** All eligible starts (ISO instants, ascending) — what the ranking chooses from. */
export function eligibleMeetingStarts(
  input: Partial<MeetingRequestInput>,
  owner: OwnerInput,
  availability: ParticipantAvailability[] = [],
): string[] {
  const prepared = prepareSearch(input, owner, availability)
  if (!prepared.ok) return []
  return scanCandidates(prepared.context).eligible.map(start => new Date(start).toISOString())
}

export function findMeetingTimes(
  input: Partial<MeetingRequestInput>,
  owner: OwnerInput,
  availability: ParticipantAvailability[] = [],
): MeetingSearchResult {
  const prepared = prepareSearch(input, owner, availability)
  if (!prepared.ok) return prepared
  const { context, store, aligned } = prepared
  const { request, ownerTimeZone, nowMs } = context
  const { eligible, counts, total } = scanCandidates(context)

  const scored = eligible.map(start => scoreCandidate(start, context, aligned)).sort((a, b) => a.score - b.score || a.start - b.start)
  const chosen: Scored[] = []
  const clash = (candidate: Scored) => chosen.some(item => item.start < candidate.end && item.end > candidate.start)
  // Different days first, then times that do not overlap, then any distinct start.
  for (const candidate of scored) {
    if (chosen.length >= OPTIONS_WANTED) break
    if (!chosen.some(item => item.dayKey === candidate.dayKey) && !clash(candidate)) chosen.push(candidate)
  }
  for (const candidate of scored) {
    if (chosen.length >= OPTIONS_WANTED) break
    if (!chosen.includes(candidate) && !clash(candidate)) chosen.push(candidate)
  }
  for (const candidate of scored) {
    if (chosen.length >= OPTIONS_WANTED) break
    if (!chosen.includes(candidate)) chosen.push(candidate)
  }

  const earliest = eligible[0]
  const options: MeetingOption[] = chosen.map((candidate, index) => {
    const startsAt = new Date(candidate.start).toISOString()
    const endsAt = new Date(candidate.end).toISOString()
    const benefits = [...candidate.benefits]
    const tradeOffs = [...candidate.tradeOffs]
    if (candidate.start === earliest) benefits.unshift('The earliest time that qualifies.')
    if (index > 0 && chosen.slice(0, index).some(item => item.dayKey === candidate.dayKey)) {
      tradeOffs.push('Same day as a higher-ranked option — fewer days qualified.')
    }
    if (index > 0 && chosen.slice(0, index).some(item => item.start < candidate.end && item.end > candidate.start)) {
      tradeOffs.push('Overlaps a higher-ranked option — offer one or the other.')
    }
    return {
      rank: index + 1,
      startsAt,
      endsAt,
      durationMinutes: request.durationMinutes,
      owner: localTimes(startsAt, endsAt, ownerTimeZone),
      participants: candidate.participants,
      benefits,
      tradeOffs,
    }
  })

  const scope = calendarsInScope(store)
  const gapText =
    request.bufferBeforeMinutes || request.bufferAfterMinutes
      ? ` with ${request.bufferBeforeMinutes} minutes clear before and ${request.bufferAfterMinutes} after`
      : ''
  return {
    ok: true,
    request,
    ownerTimeZone,
    checkedAt: owner.now.toISOString(),
    options,
    shortfall: options.length < OPTIONS_WANTED ? shortfallText(options.length, counts, total, context) : null,
    basis: [
      `Your working hours: ${describeHours(context.hours)} (${ownerTimeZone}).`,
      `Checked against ${scope.length} visible calendar${scope.length === 1 ? '' : 's'}${gapText}; events marked free and cancelled ones do not block.`,
    ],
    availabilityCaveats: request.participants.map((participant, index) => availabilityCaveat(participant, aligned[index], nowMs)),
    availability: aligned,
  }
}

// ---------------------------------------------------------------------------
// Proposal wording

/**
 * Text to copy into a message: each option in every participant's local time
 * with the zone named, and what is (not) known about their availability.
 * Nothing from the owner's other events goes in.
 */
export function meetingProposalText(search: MeetingSearch, options: MeetingOption[] = search.options): string {
  const { request } = search
  const lines: string[] = []
  const who = request.participants.map(participant => participant.label)
  lines.push(`${request.title} — ${request.durationMinutes} minutes`)
  if (!options.length) {
    lines.push('', 'I could not find a time that suits my calendar in those dates. Could you suggest a few times that work for you?')
    return lines.join('\n')
  }
  lines.push('', `Could one of these times work${who.length ? ` for ${who.join(', ')}` : ''}?`)
  for (const option of options) {
    lines.push('', `Option ${option.rank}: ${option.owner.text} — my time`)
    for (const slot of option.participants) lines.push(`  ${slot.label}: ${slot.local.text}`)
  }
  const unknown = request.participants.filter((_, index) => search.availability[index]?.status !== 'supplied' || !options.every(option => option.participants[index]?.availability === 'free'))
  const known = request.participants.filter(participant => !unknown.includes(participant))
  const checked = localTimes(search.checkedAt, search.checkedAt, search.ownerTimeZone)
  lines.push('', `These times are free on my calendar as of ${checked.start} ${search.ownerTimeZone} on ${checked.dateLabel}.`)
  if (unknown.length) {
    lines.push(`I can't see ${unknown.map(participant => participant.label).join(', ')}'s calendar${unknown.length === 1 ? '' : 's'}, so I don't know whether these suit — please pick one or suggest another time.`)
  }
  if (known.length) {
    lines.push(`${known.map(participant => participant.label).join(', ')} ${known.length === 1 ? 'looks' : 'look'} free then on our shared calendar, but please confirm.`)
  }
  lines.push('Nothing is booked until we agree on a time.')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Choosing one: recheck, then one private draft

export interface MeetingDraftDeps {
  /** The owner's calendar as it is now — refreshed, not the copy the search used. */
  readOwner: () => Promise<OwnerCalendarRead>
  /**
   * Re-read the participants whose free/busy qualified the time. Throws, or
   * answers anything but 'supplied', when it cannot.
   */
  readParticipants?: (participants: MeetingParticipant[], from: string, to: string) => Promise<ParticipantAvailability[]>
  /** Puts the draft on the calendar (the same path as New event / createCalendarDraft). */
  saveDraft: (event: CalendarEvent, store: CalendarStore) => Promise<void> | void
  now?: () => Date
}

export type MeetingDraftOutcome =
  | { kind: 'created'; event: CalendarEvent; summary: string }
  | { kind: 'already-created'; event: CalendarEvent; summary: string }
  | { kind: 'invalid'; errors: string[] }
  | { kind: 'conflict'; reason: string }
  | { kind: 'recheck-failed'; reason: string }
  /** The draft made for this choice has been edited since: left as it is, and not passed off as the choice. */
  | { kind: 'draft-changed'; event: CalendarEvent; reason: string }

/** One key per request (who, how long, which dates, which gaps), whatever start is chosen. */
export function meetingRequestKey(request: MeetingRequest): string {
  return JSON.stringify([
    request.title,
    request.durationMinutes,
    request.from,
    request.to,
    request.bufferBeforeMinutes,
    request.bufferAfterMinutes,
    request.participants.map(participant => [participant.label, participant.email ?? '', participant.timeZone]),
  ])
}

/** One key per request and chosen start: what a repeated submission is recognised by. */
export function meetingDraftKey(request: MeetingRequest, startsAt: string): string {
  return JSON.stringify([
    request.title,
    request.durationMinutes,
    new Date(startsAt).toISOString(),
    request.participants.map(participant => [participant.label, participant.email ?? '', participant.timeZone]),
  ])
}

const emailsOf = (emails: string[]): string => JSON.stringify(emails.map(email => email.trim().toLowerCase()).sort())

/** A draft already on the calendar for this very meeting: same title, instant, length and people listed. */
function sameDraft(event: CalendarEvent, draft: { title: string; startsAt: string; endsAt: string; emails: string[] }): boolean {
  return (
    event.lifecycle === 'draft' &&
    event.title === draft.title &&
    Date.parse(event.startsAt) === Date.parse(draft.startsAt) &&
    Date.parse(event.endsAt) === Date.parse(draft.endsAt) &&
    emailsOf(event.attendees.map(attendee => attendee.email)) === emailsOf(draft.emails)
  )
}

function summaryOf(event: CalendarEvent, request: MeetingRequest, timeZone: string): string {
  const times = localTimes(event.startsAt, event.endsAt, timeZone)
  const listed = event.attendees.length ? ` ${event.attendees.map(attendee => attendee.name || attendee.email).join(', ')} listed, not invited.` : ''
  return `Private draft "${request.title}" on ${times.text}.${listed} Nobody has been told; set its Stage to Active when you are ready to send it.`
}

/**
 * The selected time, rechecked against the owner's calendar as it is now and
 * against any participant free/busy that qualified it, then saved as one
 * private draft (never activated, nobody invited, nothing else changed).
 * Repeated submissions of the same choice return the first draft.
 */
export function createMeetingDraftFlow() {
  const settled = new Map<string, CalendarEvent>()
  const pending = new Map<string, Promise<MeetingDraftOutcome>>()

  async function run(
    input: Partial<MeetingRequestInput>,
    startsAt: string,
    qualifiedBy: ParticipantAvailability[],
    deps: MeetingDraftDeps,
  ): Promise<MeetingDraftOutcome> {
    const validation = validateMeetingRequest(input)
    if (!validation.ok) return { kind: 'invalid', errors: validation.errors }
    const request = validation.request
    const start = Date.parse(startsAt)
    if (!Number.isFinite(start)) return { kind: 'invalid', errors: [`"${startsAt}" is not a time. Choose one of the suggested options.`] }
    const key = meetingDraftKey(request, startsAt)
    const inFlight = pending.get(key)
    if (inFlight) {
      const first = await inFlight
      return first.kind === 'created' ? { kind: 'already-created', event: first.event, summary: first.summary } : first
    }
    const attempt = (async (): Promise<MeetingDraftOutcome> => {
      let owner: OwnerCalendarRead
      try {
        owner = await deps.readOwner()
      } catch (error) {
        return { kind: 'recheck-failed', reason: `Your calendar could not be re-read (${error instanceof Error ? error.message : String(error)}). No draft was made; try again.` }
      }
      const endsAt = new Date(start + request.durationMinutes * MINUTE).toISOString()
      const iso = new Date(start).toISOString()
      // Drafted already from this choice (and still as chosen), or an identical draft on the calendar: not again.
      const intended = {
        title: request.title,
        startsAt: iso,
        endsAt,
        emails: request.participants.flatMap(participant => (participant.email ? [participant.email] : [])),
      }
      const earlier = settled.get(key)
      const earlierNow = earlier ? owner.store.events.find(event => event.id === earlier.id) : undefined
      if (earlier && !earlierNow) settled.delete(key)
      if (earlierNow && !sameDraft(earlierNow, intended)) {
        // Edited since (time, length, people, title or stage): it is no longer this choice. Leave it be, say so, and
        // let a further choice of the same time make a new draft.
        settled.delete(key)
        const times = localTimes(earlierNow.startsAt, earlierNow.endsAt, owner.timeZone)
        const listed = earlierNow.attendees.length ? ` with ${earlierNow.attendees.map(attendee => attendee.name || attendee.email).join(', ')}` : ''
        const stage = earlierNow.lifecycle === 'draft' ? 'a draft' : 'no longer a draft'
        return {
          kind: 'draft-changed',
          event: earlierNow,
          reason: `The draft made for this time has been changed since: it is now "${earlierNow.title}", ${times.text}${listed}, ${stage}. It was left as it is and no new draft was made; choose this time again to draft it afresh.`,
        }
      }
      const existing = earlierNow ?? owner.store.events.find(event => sameDraft(event, intended))
      if (existing) {
        settled.set(key, existing)
        return { kind: 'already-created', event: existing, summary: `Already drafted: ${existing.title}. No second draft was made.` }
      }
      const problem = ownerCalendarProblem(owner.store)
      if (problem) return { kind: 'recheck-failed', reason: `${problem} No draft was made.` }

      // Participants whose free/busy qualified this time must be re-read; a failed read stops the draft.
      const now = (deps.now ?? (() => new Date()))()
      const required = request.participants.filter((_, index) => qualifiedBy[index]?.status === 'supplied')
      let fresh: ParticipantAvailability[] = request.participants.map((_, index) => qualifiedBy[index] ?? { status: 'none' })
      if (required.length) {
        if (!deps.readParticipants) {
          return { kind: 'recheck-failed', reason: `${required.map(participant => participant.label).join(', ')}'s free/busy cannot be re-read here. No draft was made.` }
        }
        let reread: ParticipantAvailability[]
        try {
          reread = await deps.readParticipants(required, iso, endsAt)
        } catch (error) {
          return {
            kind: 'recheck-failed',
            reason: `${required.map(participant => participant.label).join(', ')}'s free/busy could not be re-read (${error instanceof Error ? error.message : String(error)}). No draft was made; try again.`,
          }
        }
        let cursor = 0
        fresh = request.participants.map((_, index) => {
          if (qualifiedBy[index]?.status !== 'supplied') return { status: 'none' } as const
          return reread[cursor++] ?? ({ status: 'unavailable', reason: 'no answer', source: 'team calendar' } as const)
        })
        // A recheck must give fresh, usable free/busy: unreadable or out-of-date answers stop the draft.
        const failed = request.participants.filter(
          (_, index) => qualifiedBy[index]?.status === 'supplied' && usableBusy(fresh[index], now.getTime()) === null,
        )
        if (failed.length) {
          const reasons = failed.map(participant => {
            const item = fresh[request.participants.indexOf(participant)]!
            return item.status === 'unavailable'
              ? `${participant.label} (${item.reason})`
              : item.status === 'supplied'
                ? `${participant.label} (their free/busy came back out of date)`
                : participant.label
          })
          return { kind: 'recheck-failed', reason: `Could not re-check ${reasons.join(', ')}. No draft was made; try again.` }
        }
      }

      const prepared = prepareSearch(input, { store: owner.store, timeZone: owner.timeZone, now, coveredUntil: owner.coveredUntil }, fresh)
      if (!prepared.ok) return { kind: 'recheck-failed', reason: `${prepared.errors.join(' ')} No draft was made.` }
      const check = checkCandidate(start, prepared.context)
      if (!check.ok) {
        const reason =
          check.reason === 'owner'
            ? 'Something now on your calendar overlaps this time or its gaps.'
            : check.reason === 'participant'
              ? `${check.busyParticipants!.join(', ')} ${check.busyParticipants!.length === 1 ? 'is' : 'are'} now busy then.`
              : check.reason === 'past'
                ? 'This time has already passed.'
                : 'This time is no longer inside your working hours or the dates searched.'
        return { kind: 'conflict', reason: `${reason} No draft was made — search again for fresh options.` }
      }

      let store = owner.store
      let calendarId = firstEditableCalendarId(store)
      if (!calendarId) {
        const ensured = ensureLocalCalendar(store)
        store = ensured.store
        calendarId = ensured.calendarId
      }
      const event = createDraftEvent(calendarId, iso, request.title, owner.timeZone)
      event.endsAt = endsAt
      event.attendees = request.participants
        .filter(participant => participant.email)
        .map(participant => ({ name: participant.name ?? participant.email!, email: participant.email!, response: 'needsAction' as const }))
      await deps.saveDraft(event, store)
      settled.set(key, event)
      return { kind: 'created', event, summary: summaryOf(event, request, owner.timeZone) }
    })()
    pending.set(key, attempt)
    try {
      return await attempt
    } finally {
      pending.delete(key)
    }
  }

  return { run, forget: () => { settled.clear(); pending.clear() } }
}

/** The store with a new draft added (and the calendar on this computer, when the draft was put there). */
export function withMeetingDraft(store: CalendarStore, draft: CalendarEvent): CalendarStore {
  const base = store.calendars.some(calendar => calendar.id === draft.calendarId) ? store : ensureLocalCalendar(store).store
  return { ...base, events: [...base.events, draft] }
}

/** The one flow the panel and the agent tool share, so a choice made in either is not drafted twice. */
export const meetingDraftFlow = createMeetingDraftFlow()
