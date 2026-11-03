import type { CalendarCommandId } from './calendarCommands'
import { dateKeyInTimeZone, instantFromZonedWallTime } from './calendarModel'
import type { CalendarEvent, CalendarTask } from '../types'

/** The compact view beside the Executive app: a short agenda of the coming days. */
export const COMPACT_AGENDA_DAYS = 7

export interface CompactAgendaDay {
  /** YYYY-MM-DD in the display time zone. */
  key: string
  start: string
  /** The next day's start, so a day with a clock change is still whole. */
  end: string
  /** Noon of the day, safe to format or create on in the display zone. */
  date: Date
}

export type CompactAgendaItem =
  | { type: 'event'; id: string; event: CalendarEvent }
  | { type: 'task'; id: string; task: CalendarTask }

function addDaysToKey(key: string, count: number): string {
  const [year = 1970, month = 1, day = 1] = key.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + count)).toISOString().slice(0, 10)
}

export function compactAgendaDays(
  anchor: Date,
  timeZone: string,
  count = COMPACT_AGENDA_DAYS,
): CompactAgendaDay[] {
  const firstKey = dateKeyInTimeZone(anchor, timeZone)
  return Array.from({ length: count }, (_, index) => {
    const key = addDaysToKey(firstKey, index)
    return {
      key,
      start: instantFromZonedWallTime(key, 0, 0, timeZone),
      end: instantFromZonedWallTime(addDaysToKey(key, 1), 0, 0, timeZone),
      date: new Date(instantFromZonedWallTime(key, 12, 0, timeZone)),
    }
  })
}

export function compactAgendaRange(days: CompactAgendaDay[]): { start: string; end: string } {
  return { start: days[0]?.start ?? '', end: days[days.length - 1]?.end ?? '' }
}

function eventTouchesDay(event: CalendarEvent, day: CompactAgendaDay): boolean {
  const startsAt = Date.parse(event.startsAt)
  const endsAt = Date.parse(event.endsAt)
  const dayStart = Date.parse(day.start)
  const dayEnd = Date.parse(day.end)
  if (startsAt >= dayEnd) return false
  // An event with no length still sits on the day it starts.
  return endsAt > dayStart || startsAt >= dayStart
}

/** What belongs under one day's heading: all-day first, then by start time. */
export function compactAgendaItems(
  day: CompactAgendaDay,
  events: CalendarEvent[],
  tasks: CalendarTask[],
  timeZone: string,
): CompactAgendaItem[] {
  const startOf = (item: CompactAgendaItem): number =>
    item.type === 'event'
      ? Date.parse(item.event.startsAt)
      : Date.parse(item.task.scheduledStart ?? item.task.dueAt ?? '')
  const allDay = (item: CompactAgendaItem): number =>
    item.type === 'event' && item.event.allDay ? 0 : 1
  return [
    ...events
      .filter(event => eventTouchesDay(event, day))
      .map((event): CompactAgendaItem => ({ type: 'event', id: event.id, event })),
    ...tasks
      .filter(task => {
        const startsAt = task.scheduledStart ?? task.dueAt
        return startsAt ? dateKeyInTimeZone(startsAt, timeZone) === day.key : false
      })
      .map((task): CompactAgendaItem => ({ type: 'task', id: task.id, task })),
  ].sort((left, right) => allDay(left) - allDay(right) || startOf(left) - startOf(right))
}

export function compactAgendaTitle(
  days: CompactAgendaDay[],
  timeZone: string,
): { title: string; year: string } {
  const first = days[0]?.date ?? new Date()
  const last = days[days.length - 1]?.date ?? first
  const sameMonth = days[0]?.key.slice(0, 7) === days[days.length - 1]?.key.slice(0, 7)
  const firstLabel = new Intl.DateTimeFormat(undefined, { timeZone, month: 'short', day: 'numeric' }).format(first)
  const lastLabel = new Intl.DateTimeFormat(undefined, {
    timeZone,
    day: 'numeric',
    ...(sameMonth ? {} : { month: 'short' as const }),
  }).format(last)
  return {
    title: `${firstLabel} - ${lastLabel}`,
    year: new Intl.DateTimeFormat(undefined, { timeZone, year: 'numeric' }).format(last),
  }
}

export function compactDayHeading(
  day: CompactAgendaDay,
  now: Date,
  timeZone: string,
): { title: string; date: string; today: boolean } {
  const todayKey = dateKeyInTimeZone(now, timeZone)
  const today = day.key === todayKey
  const title = today
    ? 'Today'
    : day.key === addDaysToKey(todayKey, 1)
      ? 'Tomorrow'
      : new Intl.DateTimeFormat(undefined, { timeZone, weekday: 'long' }).format(day.date)
  return {
    title,
    date: new Intl.DateTimeFormat(undefined, { timeZone, month: 'short', day: 'numeric' }).format(day.date),
    today,
  }
}

/**
 * Keys the compact view leaves alone: the search box and view switch are not
 * on screen, a view key must not overwrite the saved view, and Delete must not
 * act on a selected event nobody can see.
 */
export function compactIgnoresCommand(command: CalendarCommandId, detailsOpen: boolean): boolean {
  if (command === 'search' || command.startsWith('view-')) return true
  return command === 'delete-selected-event' && !detailsOpen
}
