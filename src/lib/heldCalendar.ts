import { formatDayInTimeZone, formatTimeInTimeZone } from './calendarModel'
import type { CalendarEvent } from '../types'

/** What `/today` and `/week` ask for: Calendar's two views, by the words the person would use. */
export type HeldView = 'today' | 'week'

export function readHeldView(text: string): HeldView | null {
  const said = text.trim().toLowerCase()
  return said === 'today' || said === 'week' ? said : null
}

/** The line that answers `/event`: what was understood, and that it still waits for a press. */
export function describeQuickEvent(event: CalendarEvent, timeZone: string): string {
  const when = event.allDay
    ? formatDayInTimeZone(event.startsAt, timeZone)
    : `${formatDayInTimeZone(event.startsAt, timeZone)} at ${formatTimeInTimeZone(event.startsAt, timeZone)}`
  return `${event.title}, ${when}, is open for you to look over. It stays a draft until you choose Edit and set it to Active.`
}
