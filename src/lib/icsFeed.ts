import ICAL from 'ical.js'
import type {
  Calendar,
  CalendarEvent,
  CalendarSource,
  CalendarStore,
} from '../types'

/**
 * Read-only iCalendar feed subscriptions (holidays, team calendars, …).
 * `settings.icsFeeds` was UI-visible but never fetched; this parses a fetched
 * feed into events and merges them as a read-only calendar. Recurring events
 * are expanded within a bounded window so seasonal/holiday feeds render
 * without pulling their entire infinite series.
 */

export const ICS_FEED_SOURCE_ID = 'ics-feeds'
const MAX_OCCURRENCES_PER_EVENT = 400

function isoFromTime(value: ICAL.Time | null | undefined): string {
  return value?.toJSDate().toISOString() ?? new Date().toISOString()
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
  return {
    calendarId,
    ...(uid ? { externalUid: uid } : {}),
    title: event.summary || '(No title)',
    description: event.description || '',
    ...(event.location ? { location: event.location } : {}),
    timeZone:
      event.startDate?.zone?.tzid ??
      Intl.DateTimeFormat().resolvedOptions().timeZone,
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
 * (epoch ms). Recurring events are expanded; non-recurring events are emitted
 * when they fall in the window. Returns `null` if the body is not iCalendar.
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

  const events: CalendarEvent[] = []
  for (const component of calendar.getAllSubcomponents('vevent')) {
    let event: ICAL.Event
    try {
      event = new ICAL.Event(component)
    } catch {
      continue
    }
    const uid = event.uid || `feed_${events.length}`
    const durationMs =
      event.endDate && event.startDate
        ? event.endDate.toJSDate().getTime() -
          event.startDate.toJSDate().getTime()
        : 0
    const shape = baseEvent(calendarId, uid, component, event)

    if (event.isRecurring()) {
      try {
        const iterator = event.iterator()
        let next: ICAL.Time | null
        let count = 0
        while ((next = iterator.next()) && count < MAX_OCCURRENCES_PER_EVENT) {
          const startMs = next.toJSDate().getTime()
          if (startMs > windowEnd) break
          count += 1
          if (startMs < windowStart) continue
          const startIso = next.toJSDate().toISOString()
          events.push({
            ...shape,
            id: occurrenceId(calendarId, uid, startIso),
            startsAt: startIso,
            endsAt: new Date(startMs + durationMs).toISOString(),
          })
        }
      } catch {
        // A malformed RRULE shouldn't drop the whole feed — skip this series.
        continue
      }
    } else {
      const startMs = event.startDate?.toJSDate().getTime() ?? 0
      if (startMs < windowStart || startMs > windowEnd) continue
      const startIso = isoFromTime(event.startDate)
      events.push({
        ...shape,
        id: occurrenceId(calendarId, uid, startIso),
        startsAt: startIso,
        endsAt: isoFromTime(event.endDate),
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
  return {
    ...store,
    sources: hasSource ? store.sources : [...store.sources, icsFeedSource()],
    calendars: existingCalendar
      ? store.calendars.map(calendar =>
          calendar.id === feed.id
            ? { ...calendar, name: feed.label, visible: feed.visible }
            : calendar,
        )
      : [...store.calendars, icsFeedCalendar(feed)],
    events: [
      ...store.events.filter(event => event.calendarId !== feed.id),
      ...feedEvents,
    ],
  }
}
