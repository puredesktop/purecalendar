import type { CalendarDraftIntent } from '@purescience/platform-ui/bridge/calendarDraftIntent'
import type {
  CalendarInviteIntent,
  CalendarInviteResponse,
} from '@purescience/platform-ui/bridge/calendarInviteIntent'
import { parseRfc5545Recurrence } from './googleRecurrence'
import type {
  BusyStatus,
  Calendar,
  CalendarEvent,
  CalendarSettings,
  CalendarStore,
  CalendarTask,
  EventAttendee,
  EventReminder,
  RecurrenceRule,
} from '../types'

const DAY_MS = 24 * 60 * 60 * 1000
const FALLBACK_TIME_ZONE = 'UTC'
const DEFAULT_AVAILABLE_DAYS = [1, 2, 3, 4, 5]

export interface NormalizedAvailabilitySettings {
  availableDays: number[]
  availableStartHour: number
  availableEndHour: number
}

export interface CalendarSearchResult {
  id: string
  type: 'event' | 'task' | 'person' | 'location'
  title: string
  subtitle: string
  startsAt?: string
  eventId?: string
  taskId?: string
  timeZone?: string
  recurrenceRule?: RecurrenceRule | null
}

export interface CalendarEventUndo {
  id: string
  eventId: string
  action: 'create' | 'move' | 'resize' | 'cancel' | 'edit'
  before: CalendarEvent
  after: CalendarEvent
  createdAt: string
}

export type RecurrenceEditScope = 'this' | 'following' | 'all'

export interface QuickCalendarEventDraft {
  title: string
  startsAt: string
  endsAt: string
}

export interface CalendarSyncSummary {
  synced: number
  pending: number
  failed: number
  conflict: number
}

export type CalendarSyncRecoveryAction = 'retry' | 'resolve'

const ATTENDEE_WITH_NAME_PATTERN = /^(.*?)\s*<([^<>@\s]+@[^<>@\s]+)>$/
const EMAIL_PATTERN = /^[^@\s,;<>]+@[^@\s,;<>]+$/

export function systemTimeZone(): string {
  try {
    return (
      Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIME_ZONE
    )
  } catch {
    // Deliberately silent: Intl feature detection — UTC is the documented
    // fallback on environments without timezone data.
    return FALLBACK_TIME_ZONE
  }
}

const validTimeZoneCache = new Map<string, boolean>()

export function isValidTimeZone(
  timeZone: string | undefined,
): timeZone is string {
  if (!timeZone) return false
  const cached = validTimeZoneCache.get(timeZone)
  if (cached !== undefined) return cached
  let valid = false
  try {
    new Intl.DateTimeFormat(undefined, { timeZone }).format(new Date())
    valid = true
  } catch {
    // Deliberately silent: the throw IS the validation result here.
    valid = false
  }
  if (validTimeZoneCache.size >= 64) {
    const oldest = validTimeZoneCache.keys().next().value
    if (oldest !== undefined) validTimeZoneCache.delete(oldest)
  }
  validTimeZoneCache.set(timeZone, valid)
  return valid
}

export function resolveCalendarTimeZone(settings: CalendarSettings): {
  mode: 'system' | 'fixed'
  timeZone: string
  systemTimeZone: string
  fallback: boolean
} {
  const system = systemTimeZone()
  if (settings.timeZoneMode === 'fixed') {
    if (isValidTimeZone(settings.timeZone)) {
      return {
        mode: 'fixed',
        timeZone: settings.timeZone,
        systemTimeZone: system,
        fallback: false,
      }
    }
    return {
      mode: 'system',
      timeZone: system,
      systemTimeZone: system,
      fallback: true,
    }
  }
  return {
    mode: 'system',
    timeZone: system,
    systemTimeZone: system,
    fallback: false,
  }
}

export function normalizeAvailabilitySettings(
  settings: CalendarSettings,
): NormalizedAvailabilitySettings {
  const availableDays = settings.availableDays?.filter(
    day => Number.isInteger(day) && day >= 0 && day <= 6,
  )
  const availableStartHour = Number.isFinite(settings.availableStartHour)
    ? settings.availableStartHour
    : settings.workStart
  const availableEndHour = Number.isFinite(settings.availableEndHour)
    ? settings.availableEndHour
    : settings.workEnd
  const startHour = Math.min(
    23,
    Math.max(0, Math.floor(availableStartHour ?? 9)),
  )
  const endHour = Math.min(
    24,
    Math.max(startHour + 1, Math.floor(availableEndHour ?? 17)),
  )
  return {
    availableDays:
      availableDays && availableDays.length > 0
        ? Array.from(new Set(availableDays)).sort()
        : DEFAULT_AVAILABLE_DAYS,
    availableStartHour: startHour,
    availableEndHour: endHour,
  }
}

export function isAvailableWallTime(
  settings: CalendarSettings,
  day: Date | string,
  hour: number,
  timeZone = systemTimeZone(),
): boolean {
  const availability = normalizeAvailabilitySettings(settings)
  const date = day instanceof Date ? day : new Date(day)
  const parts = zonedParts(date, timeZone)
  const zonedWeekday = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day),
  ).getUTCDay()
  return (
    availability.availableDays.includes(zonedWeekday) &&
    hour >= availability.availableStartHour &&
    hour < availability.availableEndHour
  )
}

export function formatEventAttendeesText(attendees: EventAttendee[]): string {
  return attendees
    .map(attendee => {
      const name = attendee.name.trim()
      const email = attendee.email.trim()
      return name && name !== email ? `${name} <${email}>` : email
    })
    .filter(Boolean)
    .join('\n')
}

export function parseEventAttendeesText(input: string): EventAttendee[] {
  const seen = new Set<string>()
  return input
    .split(/[\n;,]+/)
    .map(part => part.trim())
    .filter(Boolean)
    .map((part): EventAttendee | null => {
      const match = part.match(ATTENDEE_WITH_NAME_PATTERN)
      if (match) {
        return {
          name: match[1].trim() || match[2].trim(),
          email: match[2].trim().toLowerCase(),
          response: 'needsAction' as const,
        }
      }
      if (EMAIL_PATTERN.test(part)) {
        return {
          name: part.trim(),
          email: part.trim().toLowerCase(),
          response: 'needsAction' as const,
        }
      }
      const pieces = part.split(/\s+/)
      const email = pieces.find(piece => EMAIL_PATTERN.test(piece))
      if (!email) return null
      return {
        name: part.replace(email, '').trim() || email,
        email: email.toLowerCase(),
        response: 'needsAction' as const,
      }
    })
    .filter((attendee): attendee is EventAttendee => Boolean(attendee))
    .filter(attendee => {
      if (seen.has(attendee.email)) return false
      seen.add(attendee.email)
      return true
    })
}

export function formatEventReminderMinutes(reminders: EventReminder[]): string {
  return reminders
    .map(reminder => Math.max(0, Math.floor(reminder.minutesBefore)))
    .filter((minutes, index, all) => all.indexOf(minutes) === index)
    .sort((left, right) => left - right)
    .join(', ')
}

export function parseEventReminderMinutes(input: string): EventReminder[] {
  return input
    .split(/[\n,;]+/)
    .map(part => Number.parseInt(part.trim(), 10))
    .filter(minutes => Number.isFinite(minutes) && minutes >= 0)
    .map(minutes => Math.min(24 * 60, Math.floor(minutes)))
    .filter((minutes, index, all) => all.indexOf(minutes) === index)
    .sort((left, right) => left - right)
    .map(minutesBefore => ({
      id: `reminder_${minutesBefore}`,
      minutesBefore,
    }))
}

// Recurrence expansion converts many instants in the same zone. Reuse the
// formatter (which still computes the offset per date) with bounded storage.
const zonedFormatters = new Map<string, Intl.DateTimeFormat>()
function zonedFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = zonedFormatters.get(timeZone)
  if (cached) return cached
  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
  } catch {
    const fallback = systemTimeZone()
    const cachedFallback = zonedFormatters.get(fallback)
    if (cachedFallback) return cachedFallback
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: fallback,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    zonedFormatters.set(fallback, formatter)
    return formatter
  }
  if (zonedFormatters.size >= 32) {
    const oldest = zonedFormatters.keys().next().value
    if (oldest !== undefined) zonedFormatters.delete(oldest)
  }
  zonedFormatters.set(timeZone, formatter)
  return formatter
}

function zonedParts(
  date: Date,
  timeZone: string,
): {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
} {
  const parts = zonedFormatter(timeZone).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  }
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone)
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  )
  return asUtc - date.getTime()
}

export function instantFromZonedWallTime(
  dateKey: string,
  hour: number,
  minute: number,
  timeZone: string,
): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const guessedUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0)
  const first = guessedUtc - timeZoneOffsetMs(new Date(guessedUtc), timeZone)
  const second = guessedUtc - timeZoneOffsetMs(new Date(first), timeZone)
  return new Date(second).toISOString()
}

const BARE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Parse an event boundary (`startsAt` / `endsAt`) into epoch milliseconds.
 * Bare `YYYY-MM-DD` all-day dates from Google or Team calendars are resolved
 * at local midnight in `timeZone` rather than UTC midnight (which would shift
 * them 1 day early in negative-UTC timezones).
 */
export function parseEventBoundMs(iso: string, timeZone?: string): number {
  const trimmed = iso.trim()
  if (!trimmed) return Number.NaN
  if (BARE_DATE_RE.test(trimmed)) {
    const tz = timeZone && isValidTimeZone(timeZone) ? timeZone : systemTimeZone()
    return Date.parse(instantFromZonedWallTime(trimmed, 0, 0, tz))
  }
  return Date.parse(trimmed)
}

export function dateKeyInTimeZone(
  iso: string | Date,
  timeZone: string,
): string {
  if (typeof iso === 'string' && BARE_DATE_RE.test(iso.trim())) {
    return iso.trim()
  }
  const date = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const parts = zonedParts(date, timeZone || systemTimeZone())
  return `${parts.year.toString().padStart(4, '0')}-${parts.month
    .toString()
    .padStart(2, '0')}-${parts.day.toString().padStart(2, '0')}`
}

/**
 * The last INCLUSIVE calendar day (`YYYY-MM-DD`) covered by an all-day event.
 * Stored `endsAt` is exclusive (RFC 5545 / Google), so a 1-day event on
 * 2026-07-10 has `endsAt` on 2026-07-11 and inclusive end date `2026-07-10`.
 */
export function allDayInclusiveEndDateKey(
  event: Pick<CalendarEvent, 'startsAt' | 'endsAt' | 'timeZone'>,
  fallbackTimeZone: string = systemTimeZone(),
): string {
  const tz = isValidTimeZone(event.timeZone) ? event.timeZone : fallbackTimeZone
  const startKey = dateKeyInTimeZone(event.startsAt, tz)
  const endKey = dateKeyInTimeZone(event.endsAt, tz)
  if (!startKey || !endKey) return startKey || endKey
  const prev = addDaysToDateKey(endKey, -1)
  return prev >= startKey ? prev : startKey
}

/**
 * Convert inclusive start/end `YYYY-MM-DD` date inputs from the UI into stored
 * all-day `[startsAt, endsAt)` boundaries in `timeZone`.
 */
export function allDayRangeFromInclusiveDates(
  startDateKey: string,
  inclusiveEndDateKey: string,
  timeZone: string,
): { startsAt: string; endsAt: string } {
  const safeZone = isValidTimeZone(timeZone) ? timeZone : systemTimeZone()
  const endKey = inclusiveEndDateKey >= startDateKey ? inclusiveEndDateKey : startDateKey
  return {
    startsAt: instantFromZonedWallTime(startDateKey, 0, 0, safeZone),
    endsAt: instantFromZonedWallTime(addDaysToDateKey(endKey, 1), 0, 0, safeZone),
  }
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

function weekdayForDateKey(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/**
 * Patch for toggling an event's all-day flag. Turning all-day ON must snap
 * the times to day boundaries in the display timezone — flipping only the
 * flag leaves a wall-clock time (e.g. 14:30) on the event, which renders the
 * "all-day" event on the wrong day for negative-UTC-offset timezones and
 * round-trips through a date-only sync (`.slice(0, 10)`) onto a different
 * day than displayed. Turning it OFF keeps the times for the user to edit.
 */
export function allDayEventPatch(
  event: Pick<CalendarEvent, 'startsAt' | 'endsAt'>,
  allDay: boolean,
  timeZone: string,
): Partial<CalendarEvent> {
  if (!allDay) return { allDay: false }
  const startKey = dateKeyInTimeZone(event.startsAt, timeZone)
  const startsAt = instantFromZonedWallTime(startKey, 0, 0, timeZone)
  const endKey = dateKeyInTimeZone(event.endsAt, timeZone)
  const endMidnight = instantFromZonedWallTime(endKey, 0, 0, timeZone)
  // Exclusive end boundary: an event ending mid-day on E covers through E
  // (ends at E+1 00:00); one ending exactly at E 00:00 does not include E.
  let endsAt =
    Date.parse(event.endsAt) <= Date.parse(endMidnight)
      ? endMidnight
      : instantFromZonedWallTime(addDaysToDateKey(endKey, 1), 0, 0, timeZone)
  if (Date.parse(endsAt) <= Date.parse(startsAt)) {
    endsAt = instantFromZonedWallTime(
      addDaysToDateKey(startKey, 1),
      0,
      0,
      timeZone,
    )
  }
  return { allDay: true, startsAt, endsAt }
}

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
}

export function parseQuickCalendarEvent(
  input: string,
  options: {
    now?: Date
    timeZone?: string
    defaultHour?: number
    defaultMinute?: number
    defaultDurationMinutes?: number
  } = {},
): QuickCalendarEventDraft | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const timeZone =
    options.timeZone && isValidTimeZone(options.timeZone)
      ? options.timeZone
      : systemTimeZone()
  const now = options.now ?? new Date()
  const baseDateKey = dateKeyInTimeZone(now, timeZone)
  let dateKey = baseDateKey
  let title = trimmed

  const isoDateMatch = title.match(/\b(\d{4}-\d{2}-\d{2})\b/)
  if (isoDateMatch) {
    dateKey = isoDateMatch[1]
    title = title.replace(isoDateMatch[0], ' ')
  } else {
    const relativeMatch = title.match(/\b(today|tomorrow)\b/i)
    if (relativeMatch) {
      dateKey =
        relativeMatch[1].toLowerCase() === 'tomorrow'
          ? addDaysToDateKey(baseDateKey, 1)
          : baseDateKey
      title = title.replace(relativeMatch[0], ' ')
    } else {
      const weekdayMatch = title.match(
        /\b(sun(?:day)?|mon(?:day)?|tue(?:s|sday|day)?|wed(?:nesday)?|thu(?:r|rs|rsday|rday|day)?|fri(?:day)?|sat(?:urday)?)\b/i,
      )
      if (weekdayMatch) {
        const target = WEEKDAY_INDEX[weekdayMatch[1].toLowerCase()]
        if (target !== undefined) {
          const current = weekdayForDateKey(baseDateKey)
          const daysAhead = (target - current + 7) % 7 || 7
          dateKey = addDaysToDateKey(baseDateKey, daysAhead)
          title = title.replace(weekdayMatch[0], ' ')
        }
      }
    }
  }

  let hour = options.defaultHour ?? 9
  let minute = options.defaultMinute ?? 0
  // Require at least one explicit time marker (`at`, `:MM`, or `am|pm`) so
  // ordinary numbers in titles ("1-on-1", "Sprint 14 review", "Q3 planning")
  // are never mistaken for clock hours.
  const timeMatch = title.match(
    /(?:\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b|\b(\d{1,2}):(\d{2})\s*(am|pm)?\b|\b(\d{1,2})\s*(am|pm)\b)/i,
  )
  if (timeMatch) {
    const parsedHour = Number(timeMatch[1] ?? timeMatch[4] ?? timeMatch[7])
    const parsedMinute = Number(timeMatch[2] ?? timeMatch[5] ?? '0')
    const meridiem = (timeMatch[3] ?? timeMatch[6] ?? timeMatch[8])?.toLowerCase()
    if (parsedHour <= 23 && parsedMinute <= 59) {
      if (meridiem === 'pm' && parsedHour < 12) hour = parsedHour + 12
      else if (meridiem === 'am' && parsedHour === 12) hour = 0
      else hour = parsedHour
      minute = parsedMinute
      title = title.replace(timeMatch[0], ' ')
    }
  }

  const cleanTitle = title
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-:,\s]+|[-:,\s]+$/g, '')
  const startsAt = instantFromZonedWallTime(dateKey, hour, minute, timeZone)
  const endsAt = new Date(
    Date.parse(startsAt) + (options.defaultDurationMinutes ?? 30) * 60 * 1000,
  ).toISOString()
  return {
    title: cleanTitle || 'New event',
    startsAt,
    endsAt,
  }
}

export function formatTimeInTimeZone(iso: string, timeZone: string): string {
  const safeZone = isValidTimeZone(timeZone) ? timeZone : systemTimeZone()
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: safeZone,
  }).format(new Date(iso))
}

export function formatDayInTimeZone(
  iso: string | Date,
  timeZone: string,
): string {
  const safeZone = isValidTimeZone(timeZone) ? timeZone : systemTimeZone()
  if (typeof iso === 'string' && BARE_DATE_RE.test(iso.trim())) {
    const noon = instantFromZonedWallTime(iso.trim(), 12, 0, safeZone)
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: safeZone,
    }).format(new Date(noon))
  }
  const date = iso instanceof Date ? iso : new Date(iso)
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: safeZone,
  }).format(date)
}

export function dateTimeLocalValueInTimeZone(
  iso: string | undefined,
  timeZone: string,
): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const parts = zonedParts(date, timeZone)
  return `${parts.year.toString().padStart(4, '0')}-${parts.month
    .toString()
    .padStart(2, '0')}-${parts.day.toString().padStart(2, '0')}T${parts.hour
    .toString()
    .padStart(2, '0')}:${parts.minute.toString().padStart(2, '0')}`
}

export function dateTimeLocalToIsoInTimeZone(
  value: string,
  timeZone: string,
): string | null {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/)
  if (!match) return null
  return instantFromZonedWallTime(
    match[1],
    Number(match[2]),
    Number(match[3]),
    timeZone,
  )
}


/**
 * Shift an instant by whole days/months in the wall clock of `timeZone`.
 * Project onto the zone's wall time, shift there, then resolve back to a
 * real instant with the same two-pass offset iteration as
 * `instantFromZonedWallTime`. This keeps a recurring event's LOCAL time
 * stable across DST transitions regardless of the machine's own timezone
 * (`setDate`/`setMonth` shift in the runtime zone, which corrupts wall
 * times whenever it does not share the event zone's transition dates).
 */
function shiftWallTimeInZone(
  iso: string,
  timeZone: string,
  shift: { days?: number; months?: number },
): string {
  const date = new Date(iso)
  const wall = new Date(date.getTime() + timeZoneOffsetMs(date, timeZone))
  if (shift.months) wall.setUTCMonth(wall.getUTCMonth() + shift.months)
  if (shift.days) wall.setUTCDate(wall.getUTCDate() + shift.days)
  const target = wall.getTime()
  const first = target - timeZoneOffsetMs(new Date(target), timeZone)
  const second = target - timeZoneOffsetMs(new Date(first), timeZone)
  return new Date(second).toISOString()
}

/**
 * Occurrence N of a rule, always shifted from the BASE start rather than
 * chained off occurrence N-1: when one occurrence lands in a spring-forward
 * gap it resolves to a shifted wall time, and chaining would propagate that
 * shift to every later occurrence instead of returning to the series' wall
 * time the next day.
 */
function occurrenceStartsAt(
  baseIso: string,
  rule: RecurrenceRule,
  index: number,
  timeZone: string,
): string {
  if (index === 0) return baseIso
  if (rule.frequency === 'daily')
    return shiftWallTimeInZone(baseIso, timeZone, {
      days: rule.interval * index,
    })
  if (rule.frequency === 'weekly')
    return shiftWallTimeInZone(baseIso, timeZone, {
      days: rule.interval * 7 * index,
    })
  return shiftWallTimeInZone(baseIso, timeZone, {
    months: rule.interval * index,
  })
}

export function expandRecurringEvent(
  event: CalendarEvent,
  rangeStart: string,
  rangeEnd: string,
): CalendarEvent[] {
  const timeZone = isValidTimeZone(event.timeZone)
    ? event.timeZone
    : systemTimeZone()
  const rangeStartMs = parseEventBoundMs(rangeStart, timeZone)
  const rangeEndMs = parseEventBoundMs(rangeEnd, timeZone)
  const baseStartMs = parseEventBoundMs(event.startsAt, timeZone)
  const baseEndMs = parseEventBoundMs(event.endsAt, timeZone)

  const overlapsWindow = (startMs: number, endMs: number): boolean => {
    if (Number.isFinite(rangeStartMs) && Number.isFinite(rangeEndMs) && Number.isFinite(startMs) && Number.isFinite(endMs)) {
      return endMs > rangeStartMs && startMs < rangeEndMs
    }
    return event.endsAt > rangeStart && event.startsAt < rangeEnd
  }

  if (!event.recurrenceRule) {
    return overlapsWindow(baseStartMs, baseEndMs) ? [event] : []
  }

  const rule = event.recurrenceRule
  const interval = Math.max(1, Math.floor(rule.interval || 1))
  const excludedStartsAt = new Set(rule.excludedStartsAt ?? [])
  const excludedMs = new Set(
    (rule.excludedStartsAt ?? [])
      .map(value => parseEventBoundMs(value, timeZone))
      .filter(Number.isFinite),
  )
  const duration = baseEndMs - baseStartMs
  if (!Number.isFinite(duration) || !Number.isFinite(baseStartMs)) {
    return overlapsWindow(baseStartMs, baseEndMs) ? [event] : []
  }

  const allDaySpanDays = event.allDay
    ? Math.max(1, Math.round(duration / DAY_MS))
    : 0
  const baseNormalizedStart = BARE_DATE_RE.test(event.startsAt.trim())
    ? instantFromZonedWallTime(event.startsAt.trim(), 0, 0, timeZone)
    : event.startsAt
  const untilMs = rule.until
    ? BARE_DATE_RE.test(rule.until.trim())
      ? parseEventBoundMs(addDaysToDateKey(rule.until.trim(), 1), timeZone) - 1
      : Date.parse(rule.until)
    : Number.POSITIVE_INFINITY

  const instances: CalendarEvent[] = []
  let index = 0
  // Fast-forward unbounded or long-running daily/weekly series that started
  // far before `rangeStart`, so multi-year daily standups never get cut off.
  if (
    Number.isFinite(rangeStartMs) &&
    baseStartMs + duration < rangeStartMs &&
    (rule.frequency === 'daily' || rule.frequency === 'weekly')
  ) {
    const stepDays = rule.frequency === 'daily' ? interval : interval * 7
    const roughJump = Math.floor((rangeStartMs - (baseStartMs + duration)) / (stepDays * DAY_MS)) - 2
    if (roughJump > 0) index = roughJump
  }

  const maxIndex =
    typeof rule.count === 'number' && Number.isFinite(rule.count)
      ? Math.max(0, Math.floor(rule.count))
      : index + 20_000
  let safety = 0
  while (index < maxIndex && safety < 25_000) {
    safety += 1
    const startsAt =
      index === 0
        ? event.startsAt
        : occurrenceStartsAt(baseNormalizedStart, { ...rule, interval }, index, timeZone)
    const startMs = parseEventBoundMs(startsAt, timeZone)
    if (!Number.isFinite(startMs)) break
    if (startMs > untilMs) break
    if (Number.isFinite(rangeEndMs) && startMs >= rangeEndMs) break

    const endsAt = event.allDay
      ? shiftWallTimeInZone(
          BARE_DATE_RE.test(startsAt.trim())
            ? instantFromZonedWallTime(startsAt.trim(), 0, 0, timeZone)
            : startsAt,
          timeZone,
          { days: allDaySpanDays },
        )
      : new Date(startMs + duration).toISOString()
    const endMs = parseEventBoundMs(endsAt, timeZone)

    const isExcluded =
      excludedStartsAt.has(startsAt) || excludedMs.has(startMs)
    if (!isExcluded && overlapsWindow(startMs, endMs)) {
      instances.push({
        ...event,
        id: index === 0 ? event.id : `${event.id}#${index}`,
        startsAt,
        endsAt,
      })
    }
    index += 1
  }
  return instances
}

export function recurrenceBaseEventId(eventId: string): string {
  return eventId.split('#')[0]
}

export function recurrenceInstanceIndex(eventId: string): number {
  const match = eventId.match(/#(\d+)$/)
  return match ? Number(match[1]) : 0
}

/**
 * Resolve the concrete occurrence `#N` of a recurring `baseEvent` so scoped
 * edits/deletions from agent tools act on occurrence `#N`'s actual timestamps
 * rather than occurrence `#0`.
 */
export function resolveRecurringOccurrence(
  baseEvent: CalendarEvent,
  eventId: string,
): CalendarEvent {
  const index = recurrenceInstanceIndex(eventId)
  if (!baseEvent.recurrenceRule || index <= 0) {
    return { ...baseEvent, id: eventId }
  }
  const timeZone = isValidTimeZone(baseEvent.timeZone)
    ? baseEvent.timeZone
    : systemTimeZone()
  const interval = Math.max(1, Math.floor(baseEvent.recurrenceRule.interval || 1))
  const baseStartMs = parseEventBoundMs(baseEvent.startsAt, timeZone)
  const baseEndMs = parseEventBoundMs(baseEvent.endsAt, timeZone)
  const duration = Math.max(60_000, baseEndMs - baseStartMs)
  const baseNormalizedStart = BARE_DATE_RE.test(baseEvent.startsAt.trim())
    ? instantFromZonedWallTime(baseEvent.startsAt.trim(), 0, 0, timeZone)
    : baseEvent.startsAt
  const startsAt = occurrenceStartsAt(
    baseNormalizedStart,
    { ...baseEvent.recurrenceRule, interval },
    index,
    timeZone,
  )
  const startMs = parseEventBoundMs(startsAt, timeZone)
  const allDaySpanDays = baseEvent.allDay
    ? Math.max(
        1,
        Math.round(
          (Date.parse(`${dateKeyInTimeZone(baseEvent.endsAt, timeZone)}T00:00:00Z`) -
            Date.parse(`${dateKeyInTimeZone(baseEvent.startsAt, timeZone)}T00:00:00Z`)) /
            DAY_MS,
        ),
      )
    : 0
  const endsAt = baseEvent.allDay
    ? shiftWallTimeInZone(
        BARE_DATE_RE.test(startsAt.trim())
          ? instantFromZonedWallTime(startsAt.trim(), 0, 0, timeZone)
          : startsAt,
        timeZone,
        { days: allDaySpanDays },
      )
    : new Date(startMs + duration).toISOString()
  return {
    ...baseEvent,
    id: eventId,
    startsAt,
    endsAt,
  }
}

/**
 * Compute the event id that will represent the edited occurrence after
 * `applyRecurringEventEdit(events, instance, patch, scope)`.
 * Provider-backed (`g:`) split/detached copies drop the `g:` prefix so sync
 * creates them as new Google events rather than PATCHing a nonexistent id.
 */
export function recurringEditResultId(
  eventId: string,
  scope: RecurrenceEditScope,
): string {
  const baseId = recurrenceBaseEventId(eventId)
  const index = recurrenceInstanceIndex(eventId)
  if (scope === 'all' || (scope === 'following' && index === 0)) {
    return baseId
  }
  const safeBase = baseId.startsWith('g:')
    ? `evt_${baseId.slice(2).replace(/[^a-zA-Z0-9_-]/g, '_')}`
    : baseId
  if (scope === 'following') {
    return `${safeBase}_following_${index}`
  }
  return `${safeBase}_only_${index}`
}

function splitFollowingRecurrence(
  baseEvent: CalendarEvent,
  instance: CalendarEvent,
  patch: Partial<CalendarEvent>,
): { base: CalendarEvent; following: CalendarEvent } {
  const index = recurrenceInstanceIndex(instance.id)
  const splitStartMs = parseEventBoundMs(instance.startsAt, baseEvent.timeZone)
  const remainingExclusions = (baseEvent.recurrenceRule?.excludedStartsAt ?? []).filter(
    iso => parseEventBoundMs(iso, baseEvent.timeZone) >= splitStartMs,
  )
  const priorExclusions = (baseEvent.recurrenceRule?.excludedStartsAt ?? []).filter(
    iso => parseEventBoundMs(iso, baseEvent.timeZone) < splitStartMs,
  )
  const nextRule: RecurrenceRule | undefined = baseEvent.recurrenceRule
    ? {
        ...baseEvent.recurrenceRule,
        count:
          typeof baseEvent.recurrenceRule.count === 'number'
            ? Math.max(1, baseEvent.recurrenceRule.count - index)
            : undefined,
        excludedStartsAt: remainingExclusions.length ? remainingExclusions : undefined,
      }
    : undefined
  const baseRule: RecurrenceRule | undefined = baseEvent.recurrenceRule
    ? {
        ...baseEvent.recurrenceRule,
        count:
          typeof baseEvent.recurrenceRule.count === 'number'
            ? Math.max(1, index)
            : undefined,
        until:
          typeof baseEvent.recurrenceRule.count === 'number'
            ? undefined
            : new Date(splitStartMs - 1).toISOString(),
        excludedStartsAt: priorExclusions.length ? priorExclusions : undefined,
      }
    : undefined
  const followingId = recurringEditResultId(instance.id, 'following')
  return {
    base: { ...baseEvent, recurrenceRule: baseRule, syncState: 'pending' },
    following: {
      ...baseEvent,
      ...instance,
      ...patch,
      id: followingId,
      recurrenceRule: nextRule,
      syncState: 'pending',
    },
  }
}

export function applyRecurringEventEdit(
  events: CalendarEvent[],
  instance: CalendarEvent,
  patch: Partial<CalendarEvent>,
  scope: RecurrenceEditScope,
): CalendarEvent[] {
  const baseId = recurrenceBaseEventId(instance.id)
  const baseEvent = events.find(event => event.id === baseId)
  const index = recurrenceInstanceIndex(instance.id)
  if (!baseEvent?.recurrenceRule || scope === 'all' || (scope === 'following' && index === 0)) {
    return events.map(event => {
      if (event.id !== baseId) return event
      // When editing "all events" from a later occurrence (#index > 0), preserve
      // the series' original start date and apply only the time/duration delta.
      let adjustedPatch = patch
      if (baseEvent && index > 0 && (patch.startsAt !== undefined || patch.endsAt !== undefined)) {
        const instStartMs = parseEventBoundMs(instance.startsAt, baseEvent.timeZone)
        const baseStartMs = parseEventBoundMs(baseEvent.startsAt, baseEvent.timeZone)
        const nextInstStartMs =
          patch.startsAt !== undefined
            ? parseEventBoundMs(patch.startsAt, baseEvent.timeZone)
            : instStartMs
        const nextInstEndMs =
          patch.endsAt !== undefined
            ? parseEventBoundMs(patch.endsAt, baseEvent.timeZone)
            : parseEventBoundMs(instance.endsAt, baseEvent.timeZone)
        if (
          Number.isFinite(instStartMs) &&
          Number.isFinite(baseStartMs) &&
          Number.isFinite(nextInstStartMs) &&
          Number.isFinite(nextInstEndMs)
        ) {
          const shiftMs = nextInstStartMs - instStartMs
          const nextDuration = Math.max(60_000, nextInstEndMs - nextInstStartMs)
          const shiftedBaseStart = new Date(baseStartMs + shiftMs).toISOString()
          const shiftedBaseEnd = new Date(baseStartMs + shiftMs + nextDuration).toISOString()
          adjustedPatch = {
            ...patch,
            startsAt: shiftedBaseStart,
            endsAt: shiftedBaseEnd,
          }
        }
      }
      return { ...event, ...adjustedPatch, syncState: 'pending' }
    })
  }
  if (scope === 'following') {
    const { base, following } = splitFollowingRecurrence(
      baseEvent,
      instance,
      patch,
    )
    return events
      .map(event => (event.id === baseId ? base : event))
      .concat(following)
  }
  const recurrenceRule = baseEvent.recurrenceRule
  const excludedStartsAt = Array.from(
    new Set([...(recurrenceRule.excludedStartsAt ?? []), instance.startsAt]),
  ).sort()
  const exception = {
    ...baseEvent,
    ...instance,
    ...patch,
    id: recurringEditResultId(instance.id, 'this'),
    recurrenceRule: undefined,
    syncState: 'pending' as const,
  }
  return events
    .map(event =>
      event.id === baseId
        ? {
            ...event,
            recurrenceRule: { ...recurrenceRule, excludedStartsAt },
            syncState: 'pending' as const,
          }
        : event,
    )
    .concat(exception)
}

/**
 * Delete a recurring occurrence according to `scope`:
 * - `'all'` deletes the entire base series (with provider tombstone).
 * - `'this'` excludes only this occurrence's `startsAt` from the base rule.
 * - `'following'` truncates the series before this occurrence (or deletes the
 *   whole series if deleting occurrence #0).
 */
export function removeRecurringEventOccurrence(
  store: CalendarStore,
  instance: CalendarEvent,
  scope: RecurrenceEditScope,
): CalendarStore {
  const baseId = recurrenceBaseEventId(instance.id)
  const baseEvent = store.events.find(event => event.id === baseId)
  if (!baseEvent) return store
  const index = recurrenceInstanceIndex(instance.id)
  if (!baseEvent.recurrenceRule || scope === 'all' || (scope === 'following' && index === 0)) {
    return removeEventWithTombstone(store, baseId)
  }
  if (scope === 'this') {
    const excludedStartsAt = Array.from(
      new Set([...(baseEvent.recurrenceRule.excludedStartsAt ?? []), instance.startsAt]),
    ).sort()
    return {
      ...store,
      events: store.events.map(event =>
        event.id === baseId
          ? {
              ...event,
              recurrenceRule: { ...baseEvent.recurrenceRule!, excludedStartsAt },
              syncState: 'pending' as const,
            }
          : event,
      ),
    }
  }
  // scope === 'following' && index > 0
  const splitStartMs = parseEventBoundMs(instance.startsAt, baseEvent.timeZone)
  const priorExclusions = (baseEvent.recurrenceRule.excludedStartsAt ?? []).filter(
    iso => parseEventBoundMs(iso, baseEvent.timeZone) < splitStartMs,
  )
  const truncatedRule: RecurrenceRule = {
    ...baseEvent.recurrenceRule,
    count:
      typeof baseEvent.recurrenceRule.count === 'number'
        ? Math.max(1, index)
        : undefined,
    until:
      typeof baseEvent.recurrenceRule.count === 'number'
        ? undefined
        : new Date(splitStartMs - 1).toISOString(),
    excludedStartsAt: priorExclusions.length ? priorExclusions : undefined,
  }
  return {
    ...store,
    events: store.events.map(event =>
      event.id === baseId
        ? { ...event, recurrenceRule: truncatedRule, syncState: 'pending' as const }
        : event,
    ),
  }
}

export function eventsInRange(
  events: CalendarEvent[],
  start: string,
  end: string,
): CalendarEvent[] {
  return events
    .filter(event => event.status !== 'cancelled')
    .flatMap(event => expandRecurringEvent(event, start, end))
    .sort(
      (a, b) =>
        parseEventBoundMs(a.startsAt, a.timeZone) -
          parseEventBoundMs(b.startsAt, b.timeZone) ||
        a.startsAt.localeCompare(b.startsAt),
    )
}

export function moveEvent(
  event: CalendarEvent,
  startsAt: string,
): CalendarEvent {
  const duration = Date.parse(event.endsAt) - Date.parse(event.startsAt)
  return {
    ...event,
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + duration).toISOString(),
    syncState: 'pending',
  }
}

export function undoCalendarEventChange(
  store: CalendarStore,
  undo: CalendarEventUndo,
): CalendarStore {
  if (undo.action === 'create') {
    return {
      ...store,
      events: store.events.filter(event => event.id !== undo.eventId),
    }
  }
  const current = store.events.find(event => event.id === undo.eventId)
  if (!current) {
    return { ...store, events: [...store.events, undo.before] }
  }
  return {
    ...store,
    events: store.events.map(event =>
      event.id === undo.eventId ? undo.before : event,
    ),
  }
}

// Timestamp-only ids collide when two events are minted in the same
// millisecond (scripted creates, double-fired handlers); id-keyed updates
// then silently edit both records as one. The counter disambiguates.
let localEventIdCounter = 0
function nextLocalEventId(prefix: string, now = Date.now()): string {
  localEventIdCounter += 1
  return `${prefix}_${now}_${localEventIdCounter}`
}

export function duplicateEvent(
  event: CalendarEvent,
  startsAt = event.startsAt,
): CalendarEvent {
  const duplicated = moveEvent(event, startsAt)
  return {
    ...duplicated,
    id: nextLocalEventId('event_copy'),
    title: `${event.title} copy`,
    status: 'tentative',
    syncState: 'pending',
  }
}

export function cancelEvent(event: CalendarEvent): CalendarEvent {
  return { ...event, status: 'cancelled', syncState: 'pending' }
}

/** A `g:<calendarId>:<eventId>` id names an event that exists at Google; `t:<id>`, one on the team calendar. */
export function isProviderBackedEventId(eventId: string): boolean {
  // A team calendar's event already on the organisation's server is `t:`.
  return eventId.startsWith('g:') || eventId.startsWith('t:')
}

/**
 * Delete an event from the store. A provider-backed event (one with a `g:` id)
 * also gets a tombstone in `removedEventIds`: without it the event would
 * resurrect on the next snapshot merge, and the sync loop needs the id to push
 * the deletion to the provider (which prunes the tombstone once confirmed).
 */
export function removeEventWithTombstone(
  store: CalendarStore,
  eventId: string,
): CalendarStore {
  const events = store.events.filter(event => event.id !== eventId)
  if (events.length === store.events.length) return store
  const needsTombstone = isProviderBackedEventId(eventId)
  const removedEventIds = needsTombstone
    ? Array.from(new Set([...(store.removedEventIds ?? []), eventId]))
    : store.removedEventIds
  return {
    ...store,
    events,
    ...(removedEventIds ? { removedEventIds } : {}),
  }
}

/** Only an attendee matching a connected identity can respond. */
export function resolveRsvpAttendee(
  event: CalendarEvent,
  accountEmails: string[],
): EventAttendee | undefined {
  const normalized = new Set(
    accountEmails
      .map(email => email.trim().toLowerCase())
      .filter(email => email.length > 0),
  )
  return (
    event.attendees.find(attendee =>
      normalized.has(attendee.email.trim().toLowerCase()),
    )
  )
}

export function rsvpEvent(
  event: CalendarEvent,
  response: EventAttendee['response'],
  attendeeEmail?: string,
): CalendarEvent {
  const normalizedEmail = attendeeEmail?.trim().toLowerCase()
  if (event.status === 'cancelled' || !normalizedEmail ||
      !event.attendees.some(attendee => attendee.email.trim().toLowerCase() === normalizedEmail)) return event
  const attendees = event.attendees.map(attendee =>
    attendee.email.trim().toLowerCase() === normalizedEmail
      ? { ...attendee, response }
      : attendee,
  )
  return {
    ...event,
    attendees,
    status:
      response === 'accepted'
        ? 'confirmed'
        : response === 'tentative'
        ? 'tentative'
        : event.status,
    busyStatus:
      response === 'accepted'
        ? 'busy'
        : response === 'tentative'
        ? 'tentative'
        : response === 'declined'
        ? 'free'
        : event.busyStatus,
    syncState: 'pending',
  }
}

/** Explicit set (the drawer checkbox row). */
export function setCalendarVisibility(
  store: CalendarStore,
  calendarId: string,
  visible: boolean,
): CalendarStore {
  return {
    ...store,
    calendars: store.calendars.map(calendar =>
      calendar.id === calendarId ? { ...calendar, visible } : calendar,
    ),
  }
}

/** Rename / recolour a calendar. Local labelling only — never pushed. */
export function updateCalendar(
  store: CalendarStore,
  calendarId: string,
  patch: { name?: string; color?: string },
): CalendarStore {
  return {
    ...store,
    calendars: store.calendars.map(calendar =>
      calendar.id === calendarId
        ? {
            ...calendar,
            ...(patch.name?.trim() ? { name: patch.name.trim() } : {}),
            ...(patch.color?.trim() ? { color: patch.color.trim() } : {}),
          }
        : calendar,
    ),
  }
}

const LOCAL_SOURCE_ID = 'src_local'

export function addLocalCalendar(
  store: CalendarStore,
  input: { name: string; color: string },
): { store: CalendarStore; calendar: Calendar } {
  const name = input.name.trim() || 'New calendar'
  const calendar: Calendar = {
    id: `cal_${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32)}_${Date.now().toString(36)}`,
    sourceId: LOCAL_SOURCE_ID,
    name,
    color: input.color,
    visible: true,
  }
  const accounts = store.accounts.some(account => account.id === LOCAL_ACCOUNT_ID)
    ? store.accounts
    : [
        ...store.accounts,
        {
          id: LOCAL_ACCOUNT_ID,
          provider: 'local' as const,
          name: 'On this computer',
          email: '',
        },
      ]
  const sources = store.sources.some(source => source.id === LOCAL_SOURCE_ID)
    ? store.sources
    : [
        ...store.sources,
        {
          id: LOCAL_SOURCE_ID,
          accountId: LOCAL_ACCOUNT_ID,
          name: 'Local calendars',
          syncState: 'online' as const,
        },
      ]
  return {
    store: {
      ...store,
      accounts,
      sources,
      calendars: [...store.calendars, calendar],
    },
    calendar,
  }
}

/**
 * Drop a calendar and everything on it. A provider calendar would come
 * straight back on the next sync, so the id is also remembered in
 * `settings.removedCalendarIds` and skipped by the snapshot merge and by
 * the Google fetch.
 */
export function removeCalendar(
  store: CalendarStore,
  calendarId: string,
): CalendarStore {
  const removedIds = new Set(store.settings.removedCalendarIds ?? [])
  removedIds.add(calendarId)
  return {
    ...store,
    calendars: store.calendars.filter(calendar => calendar.id !== calendarId),
    events: store.events.filter(event => event.calendarId !== calendarId),
    settings: {
      ...store.settings,
      removedCalendarIds: [...removedIds],
      ...(store.settings.googleExtraCalendarIds
        ? {
            googleExtraCalendarIds:
              store.settings.googleExtraCalendarIds.filter(
                id => id !== calendarId,
              ),
          }
        : {}),
      // A feed-backed calendar carries its subscription's id, so the
      // subscription has to go too — otherwise the next feed refresh
      // simply puts the calendar back.
      ...(store.settings.icsFeeds
        ? {
            icsFeeds: store.settings.icsFeeds.filter(
              feed => feed.id !== calendarId,
            ),
          }
        : {}),
    },
  }
}

export function editableCalendars(
  store: CalendarStore,
): CalendarStore['calendars'] {
  return store.calendars.filter(calendar => !calendar.readOnly)
}

export function firstEditableCalendarId(store: CalendarStore): string {
  // A connected calendar first: the one on this computer is the fallback when there is nothing else to write to.
  // Never a team calendar: what lands there is the whole team's at once, so it is only ever chosen.
  const editable = editableCalendars(store).filter(calendar => !calendar.id.startsWith('team:'))
  const connected = editable.filter(calendar => calendar.id !== LOCAL_CALENDAR_ID)
  return (
    connected.find(calendar => calendar.visible)?.id ??
    connected[0]?.id ??
    editable.find(calendar => calendar.visible)?.id ??
    editable[0]?.id ??
    ''
  )
}

const LOCAL_ACCOUNT_ID = 'acct_on_this_computer'
const LOCAL_DEVICE_SOURCE_ID = 'src_on_this_computer'
export const LOCAL_CALENDAR_ID = 'cal_on_this_computer'

/**
 * A calendar on this computer, so there is always somewhere to put an event: made when the store has no calendar
 * that can be written to (no account connected, or only read-only ones). Like Mail invites its provider is 'local',
 * so it survives connecting an account; a connected calendar then becomes the default.
 */
export function ensureLocalCalendar(store: CalendarStore): { store: CalendarStore; calendarId: string } {
  if (store.calendars.some(item => item.id === LOCAL_CALENDAR_ID)) return { store, calendarId: LOCAL_CALENDAR_ID }
  return {
    store: {
      ...store,
      accounts: [...store.accounts, { id: LOCAL_ACCOUNT_ID, provider: 'local', name: 'On this computer', email: '' }],
      sources: [...store.sources, { id: LOCAL_DEVICE_SOURCE_ID, accountId: LOCAL_ACCOUNT_ID, name: 'On this computer', syncState: 'online' }],
      calendars: [...store.calendars, { id: LOCAL_CALENDAR_ID, sourceId: LOCAL_DEVICE_SOURCE_ID, name: 'My calendar', color: '#4f8f6b', visible: true }],
    },
    calendarId: LOCAL_CALENDAR_ID,
  }
}

/** Whether a calendar lives only on this computer (its account is local): its events are not on any network. */
export function isLocalCalendar(store: Pick<CalendarStore, 'calendars' | 'sources' | 'accounts'>, calendarId: string): boolean {
  const calendar = store.calendars.find(item => item.id === calendarId)
  const source = calendar ? store.sources.find(item => item.id === calendar.sourceId) : undefined
  const account = source ? store.accounts.find(item => item.id === source.accountId) : undefined
  return account?.provider === 'local'
}

const MAIL_INVITE_ACCOUNT_ID = 'acct_mail_invites'
const MAIL_INVITE_SOURCE_ID = 'src_mail_invites'
export const MAIL_INVITE_CALENDAR_ID = 'cal_mail_invites'

/**
 * The device-local calendar auto-mirrored mail invites land on. Its account
 * provider is 'local', NOT 'demo': clearDemoData wipes demo accounts the
 * moment a Google account connects, and mirrored invites must survive that.
 */
export function ensureMailInviteCalendar(store: CalendarStore): {
  store: CalendarStore
  calendarId: string
} {
  if (store.calendars.some(item => item.id === MAIL_INVITE_CALENDAR_ID)) {
    return { store, calendarId: MAIL_INVITE_CALENDAR_ID }
  }
  return {
    store: {
      ...store,
      accounts: [
        ...store.accounts,
        {
          id: MAIL_INVITE_ACCOUNT_ID,
          provider: 'local',
          name: 'Mail invites',
          email: '',
        },
      ],
      sources: [
        ...store.sources,
        {
          id: MAIL_INVITE_SOURCE_ID,
          accountId: MAIL_INVITE_ACCOUNT_ID,
          name: 'Mail invites',
          syncState: 'online',
        },
      ],
      calendars: [
        ...store.calendars,
        {
          id: MAIL_INVITE_CALENDAR_ID,
          sourceId: MAIL_INVITE_SOURCE_ID,
          name: 'Mail invites',
          color: '#7c6ff0',
          visible: true,
        },
      ],
    },
    calendarId: MAIL_INVITE_CALENDAR_ID,
  }
}

/**
 * Upsert an AUTO-MIRRORED invite (mail wrote its intent without any user
 * action). Two rules keep this safe next to a configured Google account:
 *
 * - An event with this UID that already exists — added by hand, or synced
 *   from Google — updates in place ON ITS OWN CALENDAR; the mirror never
 *   relocates it.
 * - A newly mirrored event lands on the local Mail-invites calendar with
 *   source 'feed' and syncState 'synced', so the Google push loop (which
 *   selects source 'provider' + pending) can never send someone's Proton
 *   meetings to Google's servers behind their back.
 */
export function upsertMirroredInviteEvent(
  store: CalendarStore,
  intent: CalendarInviteIntent,
): { store: CalendarStore; event: CalendarEvent } {
  const existing = store.events.find(
    event => event.externalUid === intent.uid,
  )
  const ensured = existing ? { store, calendarId: existing.calendarId } : ensureMailInviteCalendar(store)
  const result = upsertInviteEvent(ensured.store, intent, ensured.calendarId)
  // Receiving an email never authorizes publishing changes to a provider.
  const event: CalendarEvent = {
    ...result.event,
    source: existing?.source ?? 'feed',
    syncState: existing?.syncState ?? 'synced',
  }
  return { event, store: { ...result.store, events: result.store.events.map(item =>
    item.id === event.id ? event : item) } }

}

export function canEditCalendarEvent(
  store: CalendarStore,
  event: CalendarEvent,
): boolean {
  const calendar = store.calendars.find(item => item.id === event.calendarId)
  // A team meeting someone else booked: theirs (or an administrator's) to change; invitees answer it.
  if (event.team && !event.team.mayEdit) return false
  return !calendar?.readOnly
}

export function visibleCalendarEvents(
  store: CalendarStore,
  start: string,
  end: string,
): CalendarEvent[] {
  const visibleCalendarIds = new Set(
    store.calendars
      .filter(calendar => calendar.visible)
      .map(calendar => calendar.id),
  )
  return eventsInRange(store.events, start, end).filter(event =>
    visibleCalendarIds.has(event.calendarId),
  )
}

export function allDayEventsInRange(
  events: CalendarEvent[],
  start: string,
  end: string,
): CalendarEvent[] {
  return eventsInRange(events, start, end)
    .filter(event => event.allDay)
    .sort(
      (left, right) =>
        parseEventBoundMs(left.startsAt, left.timeZone) -
          parseEventBoundMs(right.startsAt, right.timeZone) ||
        left.startsAt.localeCompare(right.startsAt),
    )
}

/**
 * What an agent actually passed us, resolved into a real instant.
 *
 * The tool schema says "ISO 8601", and a bare date is valid ISO 8601 — so
 * `2026-08-27` was being stored verbatim and later read by `new Date(...)` as
 * UTC midnight, which is the previous day anywhere west of Greenwich. That is
 * the "it got the day wrong" bug, and it needed no unusual input to happen.
 *
 * A zoneless wall time was worse in a quieter way: it was read in whatever
 * zone the machine happened to be in, so the event's own `timeZone` was
 * decorative. Here it decides.
 *
 * Returns null when the value is not a time at all, so the caller can refuse
 * rather than store something that will surface on the wrong day.
 */
export function resolveAgentEventTime(
  value: string,
  timeZone: string,
): { instant: string; dateOnly: boolean } | null {
  const raw = value.trim()
  if (!raw) return null

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.exec(raw)
  if (dateOnly) {
    return { instant: instantFromZonedWallTime(raw, 0, 0, timeZone), dateOnly: true }
  }

  // A wall time with no offset belongs to the event's zone, not the runtime's.
  const zoneless = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?$/.exec(raw)
  if (zoneless) {
    const [, dateKey, hour, minute] = zoneless
    return {
      instant: instantFromZonedWallTime(dateKey, Number(hour), Number(minute), timeZone),
      dateOnly: false,
    }
  }

  // Anything carrying Z or an explicit offset already names an instant.
  const parsed = Date.parse(raw)
  if (Number.isNaN(parsed)) return null
  return { instant: new Date(parsed).toISOString(), dateOnly: false }
}

export function createDraftEvent(
  calendarId: string,
  startsAt: string,
  title = 'New event',
  timeZone = systemTimeZone(),
): CalendarEvent {
  return {
    id: nextLocalEventId('event'),
    calendarId,
    title,
    description: '',
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 30 * 60 * 1000).toISOString(),
    timeZone,
    allDay: false,
    status: 'tentative',
    lifecycle: 'draft',
    visibility: 'default',
    busyStatus: 'busy',
    attendees: [],
    reminders: [{ id: 'reminder_default', minutesBefore: 10 }],
    attachments: [],
    linkedItems: [],
    // 'provider', never 'demo': the Google push loop only selects
    // source==='provider' events, so a 'demo'-sourced draft would silently
    // never sync — and 'demo' now exclusively tags the first-run sample seed.
    source: 'provider',
    syncState: 'pending',
  }
}

export function isDraftEvent(event: CalendarEvent): boolean {
  return event.lifecycle === 'draft' && !event.sourceMessageId
}

/**
 * Build a draft event from a quick-add phrase ("tomorrow 2:30pm Planning
 * review") on the first editable calendar. Null when the input is empty or no
 * calendar can take the event — the caller reports rather than guesses.
 */
export function quickAddCalendarEvent(
  store: CalendarStore,
  input: string,
  options: { now?: Date; timeZone?: string } = {},
): CalendarEvent | null {
  const parsed = parseQuickCalendarEvent(input, options)
  if (!parsed) return null
  const calendarId = firstEditableCalendarId(store)
  if (!calendarId) return null
  const timeZone =
    options.timeZone && isValidTimeZone(options.timeZone)
      ? options.timeZone
      : systemTimeZone()
  return {
    ...createDraftEvent(calendarId, parsed.startsAt, parsed.title, timeZone),
    endsAt: parsed.endsAt,
  }
}

/**
 * Switch a draft to active. This is the moment listed attendees become real:
 * the next provider sync carries them, which is what triggers invitations.
 */
export function activateEvent(event: CalendarEvent): CalendarEvent {
  return { ...event, lifecycle: 'active', syncState: 'pending' }
}

export function createEventFromCalendarDraftIntent(
  intent: CalendarDraftIntent,
  calendarId: string,
  startsAt: string,
  endsAt: string,
  now = Date.now(),
  timeZone = systemTimeZone(),
): CalendarEvent {
  return {
    ...createDraftEvent(calendarId, startsAt, intent.title, timeZone),
    id: nextLocalEventId(`event_mail_${intent.source.threadId}`, now),
    description: intent.description,
    endsAt,
    attendees: intent.attendees.map(attendee => ({
      ...attendee,
      response: 'needsAction' as const,
    })),
    linkedItems: intent.linkedItems,
    source: 'provider',
  }
}

export function createEventFromCalendarInviteIntent(
  intent: CalendarInviteIntent,
  calendarId: string,
  response: CalendarInviteResponse = intent.response ?? 'needsAction',
  now = Date.now(),
): CalendarEvent {
  const busyStatus: BusyStatus =
    intent.status === 'cancelled' || response === 'declined'
      ? 'free'
      : intent.status === 'tentative' || response === 'tentative'
      ? 'tentative'
      : 'busy'
  return {
    ...createDraftEvent(calendarId, intent.startsAt, intent.title),
    id: nextLocalEventId(
      `event_invite_${intent.uid.replace(/[^a-z0-9_-]/gi, '_')}`,
      now,
    ),
    lifecycle: 'active',
    externalUid: intent.uid,
    externalSequence: intent.sequence,
    externalMethod: intent.method,
    sourceAccountId: intent.source.accountId,
    sourceThreadId: intent.source.threadId,
    sourceMessageId: intent.source.messageId,
    description: intent.description,
    location: intent.location,
    endsAt: intent.endsAt,
    timeZone: intent.timeZone,
    status: intent.status,
    busyStatus,
    organizer: intent.organizer
      ? { ...intent.organizer, response: 'accepted' }
      : undefined,
    attendees: intent.attendees.map(attendee => ({ ...attendee })),
    linkedItems: [
      { type: 'email', id: intent.source.threadId, label: intent.source.label },
    ],
    recurrenceRule: parseRfc5545Recurrence(intent.recurrenceRule),
    // An incoming invitation is a received copy, never a new organizer event.
    source: 'feed',
    syncState: 'synced',
  }
}

export function upsertInviteEvent(
  store: CalendarStore,
  intent: CalendarInviteIntent,
  calendarId: string,
  response: CalendarInviteResponse = intent.response ?? 'needsAction',
): { store: CalendarStore; event: CalendarEvent } {
  const existing = store.events.find(event => event.externalUid === intent.uid)
  const incoming = createEventFromCalendarInviteIntent(
    intent,
    calendarId,
    response,
  )
  if (!existing)
    return {
      store: { ...store, events: [...store.events, incoming] },
      event: incoming,
    }
  if ((existing.externalSequence ?? 0) > intent.sequence ||
      (existing.status === 'cancelled' && intent.method !== 'CANCEL' &&
       (existing.externalSequence ?? 0) === intent.sequence))
    return { store, event: existing }

  if (intent.method === 'REPLY') {
    const event = {
      ...existing,
      attendees: existing.attendees.map(attendee =>
        incoming.attendees.find(
          item => item.email.toLowerCase() === attendee.email.toLowerCase(),
        ) ?? attendee,
      ),
      syncState: 'pending' as const,
    }
    return { store: { ...store, events: store.events.map(item => item.id === event.id ? event : item) }, event }
  }

  // Invites are legitimately re-delivered with the SAME sequence number
  // (organizers often update without bumping SEQUENCE, and mail clients
  // re-process messages). Taking `incoming.attendees` wholesale would reset
  // any RSVP the user already recorded back to needsAction. Preserve each
  // locally-recorded response unless the incoming invite carries a real one.
  const mergedAttendees = incoming.attendees.map(attendee => {
    if (attendee.response !== 'needsAction') return attendee
    const local = existing.attendees.find(
      item => item.email.toLowerCase() === attendee.email.toLowerCase(),
    )
    return local && local.response !== 'needsAction'
      ? { ...attendee, response: local.response }
      : attendee
  })
  const mergedLinkedItems = [
    ...existing.linkedItems,
    ...incoming.linkedItems.filter(
      item =>
        !existing.linkedItems.some(
          kept => kept.type === item.type && kept.id === item.id,
        ),
    ),
  ]

  const updated: CalendarEvent = {
    ...existing,
    calendarId,
    lifecycle: 'active',
    externalSequence: intent.sequence,
    externalMethod: intent.method,
    sourceAccountId: intent.source.accountId,
    sourceThreadId: intent.source.threadId,
    sourceMessageId: intent.source.messageId,
    title: intent.title,
    description: intent.description,
    location: intent.location,
    startsAt: intent.startsAt,
    endsAt: intent.endsAt,
    timeZone: intent.timeZone,
    status: intent.status,
    busyStatus: intent.status === 'cancelled' ? 'free' :
      response === 'needsAction' ? existing.busyStatus : incoming.busyStatus,
    organizer: incoming.organizer,
    attendees: mergedAttendees,
    linkedItems: mergedLinkedItems,
    ...(incoming.recurrenceRule ? { recurrenceRule: incoming.recurrenceRule } : {}),
    syncState: existing.syncState,
  }
  return {
    store: {
      ...store,
      events: store.events.map(event =>
        event.id === existing.id ? updated : event,
      ),
    },
    event: updated,
  }
}

export function visibleScheduledTasks(
  tasks: CalendarTask[],
  rangeStart: string,
  rangeEnd: string,
  calendars: Calendar[] = [],
): CalendarTask[] {
  const startMs = Date.parse(rangeStart)
  const endMs = Date.parse(rangeEnd)
  return tasks.filter(task => {
    const startsAt = task.scheduledStart ?? task.dueAt
    if (!startsAt) return false
    const taskMs = parseEventBoundMs(startsAt)
    if (Number.isFinite(taskMs) && Number.isFinite(startMs) && Number.isFinite(endMs)) {
      if (taskMs < startMs || taskMs >= endMs) return false
    } else if (startsAt < rangeStart || startsAt >= rangeEnd) {
      return false
    }
    // Respect calendar visibility. Tasks predate per-task calendars, so an
    // unassigned task is treated as living on the Focus calendar; hiding that
    // calendar hides the tasks too (#241).
    const owner =
      calendars.find(
        calendar => calendar.id === (task.calendarId ?? 'cal_focus'),
      ) ?? calendars.find(calendar => calendar.name.toLowerCase() === 'focus')
    if (owner && !owner.visible) return false
    return true
  })
}

export function updateCalendarTask(
  task: CalendarTask,
  patch: Partial<
    Pick<
      CalendarTask,
      | 'title'
      | 'dueAt'
      | 'scheduledStart'
      | 'scheduledEnd'
      | 'sourceLabel'
      | 'status'
    >
  >,
): CalendarTask {
  return {
    ...task,
    ...patch,
    dueAt: 'dueAt' in patch ? (patch.dueAt === '' ? undefined : patch.dueAt) : task.dueAt,
    scheduledStart:
      'scheduledStart' in patch
        ? patch.scheduledStart === ''
          ? undefined
          : patch.scheduledStart
        : task.scheduledStart,
    scheduledEnd:
      'scheduledEnd' in patch
        ? patch.scheduledEnd === ''
          ? undefined
          : patch.scheduledEnd
        : task.scheduledEnd,
    syncState: 'pending',
  }
}

export function calendarSyncSummary(store: CalendarStore): CalendarSyncSummary {
  const summary: CalendarSyncSummary = {
    synced: 0,
    pending: 0,
    failed: 0,
    conflict: 0,
  }
  for (const item of [...store.events, ...store.tasks]) {
    summary[item.syncState] += 1
  }
  return summary
}

function recoveredSyncState(
  syncState: CalendarEvent['syncState'] | CalendarTask['syncState'],
  action: CalendarSyncRecoveryAction,
): CalendarEvent['syncState'] | CalendarTask['syncState'] {
  if (action === 'retry') {
    return syncState === 'failed' || syncState === 'conflict'
      ? 'pending'
      : syncState
  }
  return syncState === 'failed' || syncState === 'conflict'
    ? 'synced'
    : syncState
}

export function recoverCalendarEventSync(
  store: CalendarStore,
  eventId: string,
  action: CalendarSyncRecoveryAction,
): CalendarStore {
  return {
    ...store,
    events: store.events.map(event =>
      event.id === eventId
        ? { ...event, syncState: recoveredSyncState(event.syncState, action) }
        : event,
    ),
  }
}

export function recoverCalendarTaskSync(
  store: CalendarStore,
  taskId: string,
  action: CalendarSyncRecoveryAction,
): CalendarStore {
  return {
    ...store,
    tasks: store.tasks.map(task =>
      task.id === taskId
        ? { ...task, syncState: recoveredSyncState(task.syncState, action) }
        : task,
    ),
  }
}

export function retryCalendarSyncFailures(store: CalendarStore): CalendarStore {
  return {
    ...store,
    events: store.events.map(event => ({
      ...event,
      syncState: recoveredSyncState(event.syncState, 'retry'),
    })),
    tasks: store.tasks.map(task => ({
      ...task,
      syncState: recoveredSyncState(task.syncState, 'retry'),
    })),
  }
}

/**
 * Remove the first-run demo seed once a real (Google) account is connected —
 * sample meetings interleaved with real ones make the app un-trustworthy.
 *
 * Only `source: 'demo'` events are removed: that tag exclusively marks the
 * seeded samples (user/agent-created events carry 'provider'), so "Remove
 * samples" can never delete something the user made. A demo calendar that
 * still holds user-created events after the samples are gone is kept (its
 * account/source too) — deleting it would orphan those events, and the
 * persistence layer drops events whose calendar no longer exists.
 */
export function clearDemoData(store: CalendarStore): CalendarStore {
  const demoAccountIds = new Set(
    store.accounts.filter(account => account.provider === 'demo').map(a => a.id),
  )
  const demoSourceIds = new Set(
    store.sources.filter(source => demoAccountIds.has(source.accountId)).map(
      source => source.id,
    ),
  )
  const demoCalendarIds = new Set(
    store.calendars
      .filter(calendar => demoSourceIds.has(calendar.sourceId))
      .map(calendar => calendar.id),
  )
  const events = store.events.filter(event => event.source !== 'demo')
  const calendarIdsStillUsed = new Set(events.map(event => event.calendarId))
  const calendars = store.calendars.filter(
    calendar =>
      !demoCalendarIds.has(calendar.id) ||
      calendarIdsStillUsed.has(calendar.id),
  )
  const sourceIdsStillUsed = new Set(
    calendars.map(calendar => calendar.sourceId),
  )
  const sources = store.sources.filter(
    source =>
      !demoSourceIds.has(source.id) || sourceIdsStillUsed.has(source.id),
  )
  const accountIdsStillUsed = new Set(sources.map(source => source.accountId))
  return {
    ...store,
    accounts: store.accounts.filter(
      account =>
        account.provider !== 'demo' || accountIdsStillUsed.has(account.id),
    ),
    sources,
    calendars,
    events,
    settings: { ...store.settings, demoCleared: true },
  }
}

/** Records the user's choice to keep the demo data without removing it. */
export function keepDemoData(store: CalendarStore): CalendarStore {
  return { ...store, settings: { ...store.settings, demoCleared: true } }
}

export interface ScheduledReminder {
  /** Stable per (event, reminder) so a reschedule replaces rather than dupes. */
  id: string
  title: string
  body: string
  /** Epoch ms when the notification should fire. */
  fireAt: number
}

/**
 * Compute the OS-notification schedule for an event set: one entry per event
 * reminder whose fire time is in the future and within `horizonMs`. Cancelled
 * events and already-passed reminders are skipped. Pure so the wiring effect
 * stays a thin bridge call.
 */
export function computeEventReminders(
  events: CalendarEvent[],
  now: number,
  horizonMs: number,
): ScheduledReminder[] {
  const horizon = now + horizonMs
  const reminders: ScheduledReminder[] = []
  for (const event of events) {
    if (event.status === 'cancelled' || event.lifecycle === 'draft') continue
    if (!event.reminders.length) continue
    const maxLeadMs = Math.max(
      0,
      ...event.reminders.map(r => Math.max(0, r.minutesBefore) * 60_000),
    )
    const occurrences = event.recurrenceRule
      ? expandRecurringEvent(
          event,
          new Date(now).toISOString(),
          new Date(horizon + maxLeadMs + DAY_MS).toISOString(),
        )
      : [event]
    for (const occurrence of occurrences) {
      const startMs = parseEventBoundMs(occurrence.startsAt, occurrence.timeZone)
      if (Number.isNaN(startMs)) continue
      for (const reminder of occurrence.reminders) {
        const fireAt = startMs - reminder.minutesBefore * 60_000
        if (fireAt <= now || fireAt > horizon) continue
        const minutes = reminder.minutesBefore
        const lead =
          minutes <= 0
            ? 'now'
            : minutes < 60
              ? `in ${minutes} minute${minutes === 1 ? '' : 's'}`
              : `in ${Math.round(minutes / 60)} hour${
                  Math.round(minutes / 60) === 1 ? '' : 's'
                }`
        reminders.push({
          id: `reminder:${occurrence.id}:${reminder.id}`,
          title: occurrence.title || 'Upcoming event',
          body: `Starts ${lead}`,
          fireAt,
        })
      }
    }
  }
  return reminders
}

export function searchCalendarStore(
  store: CalendarStore,
  query: string,
  limit = 12,
): CalendarSearchResult[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return []
  const results: CalendarSearchResult[] = []
  const pushUnique = (result: CalendarSearchResult): void => {
    if (
      results.some(item => item.id === result.id && item.type === result.type)
    )
      return
    results.push(result)
  }

  for (const event of store.events) {
    const calendar = store.calendars.find(item => item.id === event.calendarId)
    const safeZone = isValidTimeZone(event.timeZone)
      ? event.timeZone
      : systemTimeZone()
    const dayText = formatDayInTimeZone(event.startsAt, safeZone)
    const timeText = event.allDay
      ? 'All day'
      : formatTimeInTimeZone(event.startsAt, safeZone)
    const calLabel = calendar?.name ?? 'Calendar'
    const statusFlags = [
      calendar && !calendar.visible ? 'hidden' : '',
      event.status === 'cancelled' ? 'cancelled' : '',
    ]
      .filter(Boolean)
      .join(', ')
    const whenText = `${calLabel} · ${dayText} · ${timeText}${statusFlags ? ` (${statusFlags})` : ''}`
    const attendeeText = event.attendees
      .map(attendee => `${attendee.name} ${attendee.email}`)
      .join(' ')
    const searchable = [
      event.title,
      event.description,
      event.location,
      event.conferenceLink,
      calendar?.name,
      attendeeText,
      event.linkedItems.map(item => item.label).join(' '),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    if (searchable.includes(normalized)) {
      pushUnique({
        id: event.id,
        type: 'event',
        title: event.title,
        subtitle: whenText,
        startsAt: event.startsAt,
        eventId: event.id,
        timeZone: safeZone,
        recurrenceRule: event.recurrenceRule ?? null,
      })
    }
    if (event.location && event.location.toLowerCase().includes(normalized)) {
      pushUnique({
        id: `${event.id}:location`,
        type: 'location',
        title: event.location,
        subtitle: `${event.title} · ${whenText}`,
        startsAt: event.startsAt,
        eventId: event.id,
        timeZone: safeZone,
        recurrenceRule: event.recurrenceRule ?? null,
      })
    }
    for (const attendee of event.attendees) {
      const attendeeSearch = `${attendee.name} ${attendee.email}`.toLowerCase()
      if (!attendeeSearch.includes(normalized)) continue
      pushUnique({
        id: `${event.id}:attendee:${attendee.email}`,
        type: 'person',
        title: attendee.name,
        subtitle: `${attendee.email} · ${event.title} · ${dayText}`,
        startsAt: event.startsAt,
        eventId: event.id,
        timeZone: safeZone,
        recurrenceRule: event.recurrenceRule ?? null,
      })
    }
  }

  for (const task of store.tasks) {
    const searchable = [task.title, task.sourceLabel, task.status]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    if (!searchable.includes(normalized)) continue
    const taskWhen = task.scheduledStart ?? task.dueAt
    const taskDateLabel = taskWhen
      ? ` · ${formatDayInTimeZone(taskWhen, systemTimeZone())}`
      : ''
    pushUnique({
      id: task.id,
      type: 'task',
      title: task.title,
      subtitle: `${task.sourceLabel} · ${task.status}${taskDateLabel}`,
      startsAt: taskWhen,
      taskId: task.id,
    })
  }

  return results
    .sort((left, right) => {
      const leftMs = left.startsAt ? parseEventBoundMs(left.startsAt, left.timeZone) : Number.POSITIVE_INFINITY
      const rightMs = right.startsAt ? parseEventBoundMs(right.startsAt, right.timeZone) : Number.POSITIVE_INFINITY
      return leftMs - rightMs
    })
    .slice(0, limit)
}

export function demoCalendarStore(): CalendarStore {
  return { accounts: [], sources: [], calendars: [], events: [], tasks: [],
    settings: { viewMode: 'week', workStart: 9, workEnd: 17,
      availableDays: [1, 2, 3, 4, 5], availableStartHour: 9, availableEndHour: 17,
      demoCleared: true },
  }
}

export function weekRange(
  anchor: Date,
  timeZone?: string,
): { start: string; end: string } {
  if (timeZone && isValidTimeZone(timeZone)) {
    const anchorKey = dateKeyInTimeZone(anchor, timeZone)
    const offset = (weekdayForDateKey(anchorKey) + 6) % 7
    const mondayKey = addDaysToDateKey(anchorKey, -offset)
    const nextMondayKey = addDaysToDateKey(mondayKey, 7)
    return {
      start: instantFromZonedWallTime(mondayKey, 0, 0, timeZone),
      end: instantFromZonedWallTime(nextMondayKey, 0, 0, timeZone),
    }
  }
  const start = new Date(anchor)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  }
}
