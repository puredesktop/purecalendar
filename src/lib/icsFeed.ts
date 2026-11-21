import ICAL from 'ical.js'
import { isValidTimeZone, systemTimeZone } from './calendarModel'
import type {
  Calendar,
  CalendarEvent,
  CalendarSource,
  CalendarStore,
} from '../types'

/**
 * Read-only iCalendar feed subscriptions (holidays, team calendars, …).
 */

export const ICS_FEED_SOURCE_ID = 'ics-feeds'
const MAX_OCCURRENCES_PER_EVENT = 400
const MAX_ITERATIONS_PER_EVENT = 25_000

function safeFeedTimeZone(tzid: string | null | undefined): string {
  if (tzid && tzid !== 'floating' && isValidTimeZone(tzid)) return tzid
  return systemTimeZone()
}

function isoFromTime(
  value: ICAL.Time | null | undefined,
  fallbackMs?: number,
): string {
  if (value) return value.toJSDate().toISOString()
  return new Date(fallbackMs ?? Date.now()).toISOString()
}

function occurrenceId(
  calendarId: string,
  uid: string,
  startIso: string,
): string {
  return `feed:${calendarId}:${uid}:${startIso}`
}

function baseEvent(
  calendarId: string,
  uid: string,
  component: ICAL.Component,
  event: ICAL.Event,
): Omit<CalendarEvent, 'id' | 'startsAt' | 'endsAt'> {
  const allDay = event.startDate?.isDate === true
  const rawTz =
    (component.getFirstProperty('dtstart')?.getParameter('tzid') as string | undefined) ??
    event.startDate?.zone?.tzid
  return {
    calendarId,
    ...(uid ? { externalUid: uid } : {}),
    title: event.summary || '(No title)',
    description: event.description || '',
    ...(event.location ? { location: event.location } : {}),
    timeZone: safeFeedTimeZone(rawTz),
    allDay,
    status:
      String(component.getFirstPropertyValue('status') ?? '').toUpperCase() ===
      'CANCELLED'
        ? 'cancelled'
        : 'confirmed',
    visibility: 'default',
    // Subscribed feeds are informational — they should not mark you busy.
    busyStatus: 'free',
    attendees: [],
    reminders: [],
    attachments: [],
    linkedItems: [],
    source: 'feed',
    syncState: 'synced',
  }
}

/**
 * Parse a fetched `.ics` feed into events within `[windowStart, windowEnd]`
 * (epoch ms). Recurring events are expanded (with RECURRENCE-ID exceptions
 * related); non-recurring events are emitted when they overlap the window.
 * Returns `null` if the body is not iCalendar.
 */
export function parseIcsFeed(
  rawSource: string,
  calendarId: string,
  windowStart: number,
  windowEnd: number,
): CalendarEvent[] | null {
  let calendar: ICAL.Component
  try {
    calendar = new ICAL.Component(ICAL.parse(rawSource))
  } catch (error) {
    console.warn(
      '[purecalendar] failed to parse ICS feed:',
      error instanceof Error ? error.message : error,
    )
    return null
  }

  const components = calendar.getAllSubcomponents('vevent')
  const mastersByUid = new Map<string, ICAL.Event>()
  const exceptions: ICAL.Event[] = []
  const parsed: Array<{ component: ICAL.Component; event: ICAL.Event }> = []

  for (const component of components) {
    let event: ICAL.Event
    try {
      event = new ICAL.Event(component)
    } catch {
      continue
    }
    if (event.isRecurrenceException()) {
      exceptions.push(event)
      parsed.push({ component, event })
    } else {
      if (event.uid && event.isRecurring()) mastersByUid.set(event.uid, event)
      parsed.push({ component, event })
    }
  }
  for (const exception of exceptions) {
    const master = exception.uid ? mastersByUid.get(exception.uid) : undefined
    if (master) {
      try {
        master.relateException(exception)
      } catch {
        /* ignore malformed exception */
      }
    }
  }

  const events: CalendarEvent[] = []
  for (const { component, event } of parsed) {
    if (!event.startDate) continue
    // Recurrence exceptions attached to a master are emitted via its expansion
    // (or directly below if standalone/orphaned).
    if (event.isRecurrenceException() && event.uid && mastersByUid.has(event.uid)) {
      continue
    }
    const uid = event.uid || `feed_${events.length}`
    const allDay = event.startDate.isDate === true
    const defaultDurationMs = allDay ? 86_400_000 : 0
    const durationMs =
      event.endDate && event.startDate
        ? Math.max(
            0,
            event.endDate.toJSDate().getTime() -
              event.startDate.toJSDate().getTime(),
          )
        : defaultDurationMs
    const shape = baseEvent(calendarId, uid, component, event)

    if (event.isRecurring()) {
      try {
        const iterator = event.iterator()
        let next: ICAL.Time | null
        let emitted = 0
        let iterations = 0
        while (
          (next = iterator.next()) &&
          emitted < MAX_OCCURRENCES_PER_EVENT &&
          iterations < MAX_ITERATIONS_PER_EVENT
        ) {
          iterations += 1
          if (next.toJSDate().getTime() > windowEnd) break
          const details = event.getOccurrenceDetails(next)
          const occStart = details.startDate ?? next
          const occEnd = details.endDate
          const startMs = occStart.toJSDate().getTime()
          const endMs = occEnd ? occEnd.toJSDate().getTime() : startMs + durationMs
          if (startMs > windowEnd) continue
          if (endMs < windowStart) continue
          emitted += 1
          const startIso = occStart.toJSDate().toISOString()
          const endIso = new Date(endMs).toISOString()
          const occItem = details.item
          const occShape =
            occItem && occItem !== event
              ? baseEvent(calendarId, uid, occItem.component, occItem)
              : shape
          events.push({
            ...occShape,
            id: occurrenceId(calendarId, uid, startIso),
            startsAt: startIso,
            endsAt: endIso,
          })
        }
      } catch {
        // A malformed RRULE shouldn't drop the whole feed — skip this series.
        continue
      }
    } else {
      const startMs = event.startDate.toJSDate().getTime()
      const endMs = event.endDate
        ? event.endDate.toJSDate().getTime()
        : startMs + defaultDurationMs
      if (endMs < windowStart || startMs > windowEnd) continue
      const startIso = isoFromTime(event.startDate)
      events.push({
        ...shape,
        id: occurrenceId(calendarId, uid, startIso),
        startsAt: startIso,
        endsAt: isoFromTime(event.endDate, startMs + defaultDurationMs),
      })
    }
  }
  return events
}

/** Drop feed calendars and their events whose feed id is no longer subscribed. */
export function pruneIcsFeeds(
  store: CalendarStore,
  keepFeedIds: Set<string>,
): CalendarStore {
  const feedCalendarIds = new Set(
    store.calendars
      .filter(
        calendar =>
          calendar.sourceId === ICS_FEED_SOURCE_ID &&
          !keepFeedIds.has(calendar.id),
      )
      .map(calendar => calendar.id),
  )
  if (feedCalendarIds.size === 0) return store
  return {
    ...store,
    calendars: store.calendars.filter(
      calendar => !feedCalendarIds.has(calendar.id),
    ),
    events: store.events.filter(
      event => !feedCalendarIds.has(event.calendarId),
    ),
  }
}

export function icsFeedSource(): CalendarSource {
  return {
    id: ICS_FEED_SOURCE_ID,
    accountId: ICS_FEED_SOURCE_ID,
    name: 'Subscribed calendars',
    syncState: 'online',
  }
}

export function icsFeedCalendar(feed: {
  id: string
  label: string
  visible: boolean
}): Calendar {
  return {
    id: feed.id,
    sourceId: ICS_FEED_SOURCE_ID,
    name: feed.label,
    color: '#8a8f98',
    visible: feed.visible,
    readOnly: true,
  }
}

/**
 * Replace a feed's events wholesale (feeds are a read-only mirror), ensuring
 * the read-only calendar + shared feed source exist. Pending local edits can't
 * exist on a read-only calendar, so a full replace is safe.
 */
export function mergeIcsFeedEvents(
  store: CalendarStore,
  feed: { id: string; label: string; visible: boolean },
  feedEvents: CalendarEvent[],
): CalendarStore {
  const hasSource = store.sources.some(
    source => source.id === ICS_FEED_SOURCE_ID,
  )
  const existingCalendar = store.calendars.find(
    calendar => calendar.id === feed.id,
  )
  const syncedAt = new Date().toISOString()
  return {
    ...store,
    sources: hasSource ? store.sources : [...store.sources, icsFeedSource()],
    calendars: existingCalendar
      ? store.calendars.map(calendar =>
          calendar.id === feed.id
            ? {
                ...calendar,
                name: feed.label,
                visible: feed.visible,
                lastSyncedAt: syncedAt,
                lastSyncError: undefined,
              }
            : calendar,
        )
      : [...store.calendars, { ...icsFeedCalendar(feed), lastSyncedAt: syncedAt }],
    events: [
      ...store.events.filter(event => event.calendarId !== feed.id),
      ...feedEvents,
    ],
  }
}
