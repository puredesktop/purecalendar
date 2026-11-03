import { allDayEventPatch, createDraftEvent, ensureLocalCalendar, firstEditableCalendarId, instantFromZonedWallTime, systemTimeZone } from './calendarModel'
import type { CalendarEvent, CalendarStore } from '../types'

/**
 * A date the person agreed in the Executive app, left at
 * `.appdata/executive/calendar/dates/<key>.json`: made into an all-day event
 * with its warnings, once. The state file says which event it became.
 */
export const datesDir = (root: string): string => `${root}/.appdata/executive/calendar/dates`
export const dateStateFile = (root: string, key: string): string => `${datesDir(root)}/state/${key}.json`

export interface TeamDateRequest {
  key: string
  title: string
  date: string
  warningDays: number[]
  description: string
  by: string
}

const MINUTES_IN_A_DAY = 1440

export function readTeamDate(raw: string | null, key: string): TeamDateRequest | null {
  try {
    const value = JSON.parse(raw ?? '') as Record<string, unknown>
    if (value.v !== 1 || value.key !== key || typeof value.title !== 'string' || !value.title.trim() || typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) return null
    return {
      key,
      title: value.title.trim(),
      date: value.date,
      warningDays: Array.isArray(value.warningDays) ? value.warningDays.filter((n): n is number => Number.isInteger(n) && (n as number) > 0) : [],
      description: typeof value.description === 'string' ? value.description : '',
      by: typeof value.by === 'string' ? value.by : 'The team',
    }
  } catch {
    return null
  }
}

/** The store with the event in it, and its id. Asked twice for one key, it finds the event it made. */
export function addTeamDate(store: CalendarStore, request: TeamDateRequest): { store: CalendarStore; eventId: string } {
  const marker = `team-date:${request.key}`
  const made = store.events.find(event => event.linkedItems.some(item => item.id === marker))
  if (made) return { store, eventId: made.id }
  const ensured = firstEditableCalendarId(store) ? { store, calendarId: firstEditableCalendarId(store) } : ensureLocalCalendar(store)
  const zone = systemTimeZone()
  const draft = createDraftEvent(ensured.calendarId, instantFromZonedWallTime(request.date, 12, 0, zone), request.title, zone)
  const event: CalendarEvent = {
    ...draft,
    ...allDayEventPatch(draft, true, zone),
    description: [request.description, `Added by ${request.by} when you agreed.`].filter(Boolean).join('\n\n'),
    status: 'confirmed',
    lifecycle: 'active',
    busyStatus: 'free',
    reminders: request.warningDays.map(days => ({ id: `reminder_${days * MINUTES_IN_A_DAY}`, minutesBefore: days * MINUTES_IN_A_DAY })),
    linkedItems: [{ type: 'task', id: marker, label: 'Agreed in the Executive app' }],
  }
  return { store: { ...ensured.store, events: [...ensured.store.events, event] }, eventId: event.id }
}
