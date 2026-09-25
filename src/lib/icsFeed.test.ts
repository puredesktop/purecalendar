import { describe, expect, it } from 'vitest'
import type { CalendarEvent, CalendarStore } from '../types'
import {
  ICS_FEED_SOURCE_ID,
  mergeIcsFeedEvents,
  parseIcsFeed,
  pruneIcsFeeds,
} from './icsFeed'

const WINDOW_START = Date.parse('2026-07-01T00:00:00Z')
const WINDOW_END = Date.parse('2026-12-31T00:00:00Z')

function feedIcs(body: string): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//EN',
    body,
    'END:VCALENDAR',
  ].join('\r\n')
}

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'e',
    calendarId: 'c',
    title: 'E',
    description: '',
    startsAt: '2026-07-10T09:00:00.000Z',
    endsAt: '2026-07-10T10:00:00.000Z',
    timeZone: 'UTC',
    allDay: false,
    status: 'confirmed',
    visibility: 'default',
    busyStatus: 'busy',
    attendees: [],
    reminders: [],
    attachments: [],
    linkedItems: [],
    source: 'provider',
    syncState: 'synced',
    ...overrides,
  }
}

function store(overrides: Partial<CalendarStore> = {}): CalendarStore {
  return {
    accounts: [],
    sources: [],
    calendars: [],
    events: [],
    tasks: [],
    settings: {},
    ...overrides,
  }
}

describe('parseIcsFeed', () => {
  it('parses a timed VEVENT within the window as a free, read-only feed event', () => {
    const events = parseIcsFeed(
      feedIcs(
        [
          'BEGIN:VEVENT',
          'UID:h1@feed',
          'SUMMARY:Team offsite',
          'DTSTART:20260715T140000Z',
          'DTEND:20260715T150000Z',
          'END:VEVENT',
        ].join('\r\n'),
      ),
      'feed-a',
      WINDOW_START,
      WINDOW_END,
    )
    expect(events).toHaveLength(1)
    const [only] = events!
    expect(only?.calendarId).toBe('feed-a')
    expect(only?.title).toBe('Team offsite')
    expect(only?.source).toBe('feed')
    expect(only?.busyStatus).toBe('free')
    expect(only?.externalUid).toBe('h1@feed')
    expect(only?.id).toContain('feed:feed-a:h1@feed:')
  })

  it('emits all-day events and drops events outside the window', () => {
    const events = parseIcsFeed(
      feedIcs(
        [
          'BEGIN:VEVENT',
          'UID:holiday@feed',
          'SUMMARY:Holiday',
          'DTSTART;VALUE=DATE:20260704',
          'DTEND;VALUE=DATE:20260705',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'UID:old@feed',
          'SUMMARY:Last year',
          'DTSTART:20250101T090000Z',
          'DTEND:20250101T100000Z',
          'END:VEVENT',
        ].join('\r\n'),
      ),
      'feed-a',
      WINDOW_START,
      WINDOW_END,
    )
    expect(events?.map(e => e.title)).toEqual(['Holiday'])
    expect(events?.[0]?.allDay).toBe(true)
  })

  it('expands a recurring event across the window', () => {
    const events = parseIcsFeed(
      feedIcs(
        [
          'BEGIN:VEVENT',
          'UID:weekly@feed',
          'SUMMARY:Weekly standup',
          'DTSTART:20260706T090000Z',
          'DTEND:20260706T091500Z',
          'RRULE:FREQ=WEEKLY;COUNT=4',
          'END:VEVENT',
        ].join('\r\n'),
      ),
      'feed-a',
      WINDOW_START,
      WINDOW_END,
    )
    expect(events).toHaveLength(4)
    // Distinct occurrence ids, 7 days apart.
    const starts = events!.map(e => e.startsAt)
    expect(new Set(starts).size).toBe(4)
  })

  it('returns null for a non-iCalendar body', () => {
    expect(parseIcsFeed('<html>not ics</html>', 'f', WINDOW_START, WINDOW_END)).toBeNull()
  })
})

describe('mergeIcsFeedEvents', () => {
  const feed = { id: 'feed-a', label: 'Holidays', visible: true }

  it('adds the read-only calendar and shared source on first merge', () => {
    const merged = mergeIcsFeedEvents(
      store({ events: [event({ id: 'g:cal:1', source: 'provider' })] }),
      feed,
      [event({ id: 'feed:feed-a:x:1', calendarId: 'feed-a', source: 'feed' })],
    )
    expect(merged.sources.find(s => s.id === ICS_FEED_SOURCE_ID)).toBeTruthy()
    const cal = merged.calendars.find(c => c.id === 'feed-a')
    expect(cal?.readOnly).toBe(true)
    expect(cal?.name).toBe('Holidays')
    // Google event preserved; feed event added.
    expect(merged.events.map(e => e.id).sort()).toEqual([
      'feed:feed-a:x:1',
      'g:cal:1',
    ])
  })

  it('replaces a feed’s prior events wholesale on re-fetch', () => {
    const first = mergeIcsFeedEvents(store(), feed, [
      event({ id: 'feed:feed-a:old', calendarId: 'feed-a', source: 'feed' }),
    ])
    const second = mergeIcsFeedEvents(first, feed, [
      event({ id: 'feed:feed-a:new', calendarId: 'feed-a', source: 'feed' }),
    ])
    expect(second.events.map(e => e.id)).toEqual(['feed:feed-a:new'])
    expect(second.calendars.filter(c => c.id === 'feed-a')).toHaveLength(1)
  })
})

describe('pruneIcsFeeds', () => {
  it('drops feed calendars and events no longer subscribed', () => {
    const withFeed = mergeIcsFeedEvents(
      store({ events: [event({ id: 'g:cal:1', source: 'provider' })] }),
      { id: 'feed-a', label: 'Holidays', visible: true },
      [event({ id: 'feed:feed-a:x', calendarId: 'feed-a', source: 'feed' })],
    )
    const pruned = pruneIcsFeeds(withFeed, new Set())
    expect(pruned.calendars.some(c => c.id === 'feed-a')).toBe(false)
    expect(pruned.events.map(e => e.id)).toEqual(['g:cal:1'])
  })

  it('is a no-op when all feeds are kept', () => {
    const withFeed = mergeIcsFeedEvents(
      store(),
      { id: 'feed-a', label: 'Holidays', visible: true },
      [event({ id: 'feed:feed-a:x', calendarId: 'feed-a', source: 'feed' })],
    )
    expect(pruneIcsFeeds(withFeed, new Set(['feed-a']))).toBe(withFeed)
  })
})
