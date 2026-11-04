import { eventMeetingUrl } from './eventLinks'
import { formatDayInTimeZone, formatTimeInTimeZone, visibleCalendarEvents } from './calendarModel'
import type { CalendarStore } from '../types'
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

const MINUTE = 60_000
/** `/join` looks this far ahead. */
export const JOIN_AHEAD_MS = 10 * MINUTE
/** How far back an event may have started and still be going: longer than any meeting anyone has. */
const LOOK_BACK_MS = 24 * 60 * MINUTE
const LOOK_FOR_NEXT_MS = 30 * 24 * 60 * MINUTE

export type JoinAnswer =
  | { kind: 'open'; url: string; title: string }
  | { kind: 'no-link'; title: string }
  | { kind: 'choose'; events: ReadonlyArray<{ key: string; title: string; startsAt: string; hasLink: boolean }> }
  | { kind: 'nothing'; next: { title: string; startsAt: string } | null }

const real = (event: CalendarEvent): boolean => !event.allDay && event.status !== 'cancelled' && !(event.lifecycle === 'draft' && !event.externalUid)
/** One event among the repeats of a recurring one. */
export const joinKey = (event: CalendarEvent): string => `${event.id}|${event.startsAt}`

/**
 * What `/join` means now: the event starting within ten minutes, or under way however long ago it started and not yet over. All
 * day events, drafts and cancelled ones don't count. More than one is a choice, soonest first: it never guesses. `picked` is that
 * choice coming back.
 */
export function readJoin(store: CalendarStore, now: number, picked?: string): JoinAnswer {
  const from = new Date(now - LOOK_BACK_MS).toISOString()
  const upTo = new Date(now + JOIN_AHEAD_MS + MINUTE).toISOString()
  const near = visibleCalendarEvents(store, from, upTo)
    .filter(real)
    .filter(event => Date.parse(event.startsAt) <= now + JOIN_AHEAD_MS && Date.parse(event.endsAt) > now)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
  const asked = picked ? near.find(event => joinKey(event) === picked) : undefined
  const chosen = asked ?? (near.length === 1 ? near[0] : undefined)
  if (chosen) {
    const url = eventMeetingUrl(chosen)
    return url ? { kind: 'open', url, title: chosen.title } : { kind: 'no-link', title: chosen.title }
  }
  if (near.length) return { kind: 'choose', events: near.map(event => ({ key: joinKey(event), title: event.title, startsAt: event.startsAt, hasLink: !!eventMeetingUrl(event) })) }
  const next = visibleCalendarEvents(store, new Date(now).toISOString(), new Date(now + LOOK_FOR_NEXT_MS).toISOString())
    .filter(real)
    .filter(event => Date.parse(event.startsAt) > now)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0]
  return { kind: 'nothing', next: next ? { title: next.title, startsAt: next.startsAt } : null }
}
