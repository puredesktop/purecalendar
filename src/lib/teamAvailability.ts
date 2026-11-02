import { systemTimeZone, visibleCalendarEvents } from './calendarModel'
import type { CalendarStore } from '../types'

/**
 * When the person is busy, for the executive team's Chief of Staff to offer real times in a draft. A plain file beside the
 * organisation's mail share (`.appdata/executive/calendar/availability.json`): times only, never what an event is, who it
 * is with or where. Demo events are not the person's and free or cancelled ones don't take up time.
 */
export const AVAILABILITY_DAYS = 21
export const availabilityFile = (root: string): string => `${root}/.appdata/executive/calendar/availability.json`
export const mailShareFile = (root: string): string => `${root}/.appdata/executive/mail/share.json`

export function teamAvailability(store: CalendarStore, now: Date): { at: string; v: 1; timeZone: string; workStart: number | null; workEnd: number | null; availableDays: number[]; events: number; busy: Array<{ startsAt: string; endsAt: string; allDay?: true }> } {
  const end = new Date(now.getTime() + AVAILABILITY_DAYS * 86_400_000)
  const mine = store.events.filter(e => e.source !== 'demo')
  const busy = visibleCalendarEvents({ ...store, events: mine }, now.toISOString(), end.toISOString())
    .filter(e => e.status !== 'cancelled' && e.busyStatus !== 'free')
    .map(e => ({ startsAt: e.startsAt, endsAt: e.endsAt, ...(e.allDay ? { allDay: true as const } : {}) }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  const s = store.settings
  return { v: 1, at: now.toISOString(), timeZone: s.timeZoneMode === 'fixed' && s.timeZone ? s.timeZone : systemTimeZone(), workStart: s.workStart ?? null, workEnd: s.workEnd ?? null, availableDays: s.availableDays ?? [], events: mine.length, busy }
}

/** The organisations this desktop's team works in, from the Executive app's settings; only those sharing mail get this too. */
export function organisationRoots(settings: unknown, workspaceRoot?: string): string[] {
  const value = settings as { orgs?: Array<{ folder?: unknown }> } | null
  const folders = Array.isArray(value?.orgs) ? value.orgs.map(org => org?.folder) : []
  return [...new Set([workspaceRoot, ...folders].filter((root): root is string => typeof root === 'string' && root.startsWith('/')))]
}

/** What changed, ignoring when it was written, so an unchanged calendar writes nothing. */
export const sameAvailability = (a: string | null, b: string): boolean => {
  const body = (text: string) => text.replace(/"at":"[^"]*",?/, '')
  return a !== null && body(a) === body(b)
}
