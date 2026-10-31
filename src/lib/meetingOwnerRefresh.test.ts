import { describe, expect, it, vi } from 'vitest'
import type { TeamCalendarEvent, TeamCalendarListing } from '../bridge/platformBridge'
import type { CalendarEvent, CalendarStore } from '../types'
import { refreshOwnerCalendar, type OwnerCalendarSources } from './meetingOwnerRefresh'
import { createMeetingDraftFlow, findMeetingTimes } from './meetingTimes'

const NOW = new Date('2026-11-01T00:00:00.000Z')
const DAY = 86_400_000

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'g:primary:1',
    calendarId: 'primary',
    title: 'Busy',
    description: '',
    startsAt: '2026-11-02T09:00:00.000Z',
    endsAt: '2026-11-02T10:00:00.000Z',
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

function store(extra: Partial<CalendarStore> = {}): CalendarStore {
  return {
    accounts: [
      { id: 'google-account', provider: 'google', name: 'Google', email: 'me@example.com' },
      { id: 'team-account', provider: 'team', name: 'Org', email: 'p-me@team.invalid' },
    ],
    sources: [
      { id: 'google-source', accountId: 'google-account', name: 'Google', syncState: 'online' },
      { id: 'team-source', accountId: 'team-account', name: 'Org', syncState: 'online' },
      { id: 'ics-feeds', accountId: 'feeds', name: 'Subscriptions', syncState: 'online' },
    ],
    calendars: [
      { id: 'primary', sourceId: 'google-source', name: 'Work', color: '#111', visible: true },
      { id: 'team:org', sourceId: 'team-source', name: 'Org', color: '#222', visible: true },
      { id: 'feed-1', sourceId: 'ics-feeds', name: 'Holidays', color: '#333', visible: true },
    ],
    events: [],
    tasks: [],
    settings: {
      timeZoneMode: 'fixed',
      timeZone: 'UTC',
      availableDays: [1, 2, 3, 4, 5],
      availableStartHour: 9,
      availableEndHour: 17,
      icsFeeds: [{ id: 'feed-1', label: 'Holidays', url: 'https://example.com/h.ics', visible: true }],
    },
    ...extra,
  }
}

const EMPTY_ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//t//t//EN\r\nEND:VCALENDAR\r\n'

function teamMeeting(start: string, end: string): TeamCalendarEvent {
  return {
    id: 'm1',
    kind: 'meeting',
    title: 'Team planning',
    start,
    end,
    allDay: false,
    location: null,
    notes: null,
    team: null,
    attendees: [{ id: 'p-me', name: 'Me', response: 'yes' }],
    createdBy: { id: 'p-boss', name: 'Boss' },
    revision: 1,
    updatedAt: 0,
    mayEdit: false,
  }
}

function listing(events: TeamCalendarEvent[]): TeamCalendarListing {
  return { available: true, organisation: 'Org', me: { id: 'p-me', name: 'Me' }, events, people: [], teams: [] }
}

function sources(over: Partial<OwnerCalendarSources> = {}, remoteEvents: CalendarEvent[] = []): OwnerCalendarSources {
  return {
    google: {
      fetchStore: async () => ({ ...store(), events: remoteEvents }),
      merge: (local, remote) => ({ ...local, events: [...local.events.filter(item => item.calendarId !== 'primary'), ...remote.events] }),
      futureMs: 90 * DAY,
    },
    team: { list: async () => listing([]) },
    fetchFeed: async () => ({ ok: true, status: 200, body: EMPTY_ICS }),
    now: () => NOW,
    ...over,
  }
}

const week = { title: 'Sync', durationMinutes: 60, from: '2026-11-02', to: '2026-11-06' }

describe('re-reading the owner\'s calendar for Find a time', () => {
  it('reads every source and reports how far ahead they were all read', async () => {
    const read = await refreshOwnerCalendar(store(), sources())
    expect(read.store.failedCalendarIds).toBeUndefined()
    expect(read.timeZone).toBe('UTC')
    // The shortest window wins: Google's 90 days.
    expect(read.coveredUntil).toBe(new Date(NOW.getTime() + 90 * DAY).toISOString())
    expect(findMeetingTimes(week, { ...read, now: NOW }).ok).toBe(true)
  })

  it('catches a team meeting added after the search, so the draft is refused', async () => {
    let teamEvents: TeamCalendarEvent[] = []
    const wiring = sources({ team: { list: async () => listing(teamEvents) } })
    const search = findMeetingTimes(week, { ...(await refreshOwnerCalendar(store(), wiring)), now: NOW })
    if (!search.ok) throw new Error(search.errors.join(' '))
    const chosen = search.options[0]!
    teamEvents = [teamMeeting(chosen.startsAt, chosen.endsAt)]
    const saveDraft = vi.fn()
    const outcome = await createMeetingDraftFlow().run(week, chosen.startsAt, search.availability, {
      readOwner: () => refreshOwnerCalendar(store(), wiring),
      saveDraft,
      now: () => NOW,
    })
    expect(outcome.kind).toBe('conflict')
    expect(saveDraft).not.toHaveBeenCalled()
  })

  it.each([
    ['Google is not connected', { google: null }, 'Work could not be read'],
    ['Google fails', { google: { fetchStore: async () => { throw new Error('401') }, merge: (local: CalendarStore) => local, futureMs: 90 * DAY } }, 'Work could not be read'],
    ['the team calendar is not offered', { team: null }, 'Org could not be read'],
    ['the team calendar fails', { team: { list: async () => { throw new Error('offline') } } }, 'Org could not be read'],
    ['a feed fails', { fetchFeed: async () => ({ ok: false, status: 500, body: '' }) }, 'Holidays could not be read'],
    ['a feed is not a calendar', { fetchFeed: async () => ({ ok: true, status: 200, body: '<html>' }) }, 'Holidays could not be read'],
  ])('refuses to suggest or draft when %s', async (_, over, text) => {
    const read = await refreshOwnerCalendar(store(), sources(over as Partial<OwnerCalendarSources>))
    const result = findMeetingTimes(week, { ...read, now: NOW })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]).toContain(text)
    const saveDraft = vi.fn()
    const outcome = await createMeetingDraftFlow().run(week, '2026-11-02T11:00:00.000Z', [], {
      readOwner: () => refreshOwnerCalendar(store(), sources(over as Partial<OwnerCalendarSources>)),
      saveDraft,
      now: () => NOW,
    })
    expect(outcome.kind).toBe('recheck-failed')
    expect(saveDraft).not.toHaveBeenCalled()
  })

  it('does not take dates past Google\'s read window as free', async () => {
    // Four months out: a remote event there is not in a fetch that reads 90 days ahead.
    const far = { ...week, from: '2027-03-01', to: '2027-03-05' }
    const blocking = event({ startsAt: '2027-03-01T09:00:00.000Z', endsAt: '2027-03-06T00:00:00.000Z' })
    const fetchStore = vi.fn(async () => ({ ...store(), events: Date.parse(blocking.startsAt) - NOW.getTime() <= 90 * DAY ? [blocking] : [] }))
    const wiring = sources({ google: { fetchStore, merge: (local, remote) => ({ ...local, events: remote.events }), futureMs: 90 * DAY } })
    const result = findMeetingTimes(far, { ...(await refreshOwnerCalendar(store(), wiring)), now: NOW })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]).toContain('only read up to Fri 29 Jan 2027')
    const saveDraft = vi.fn()
    const outcome = await createMeetingDraftFlow().run(far, '2027-03-01T09:00:00.000Z', [], {
      readOwner: () => refreshOwnerCalendar(store(), wiring),
      saveDraft,
      now: () => NOW,
    })
    expect(outcome.kind).toBe('recheck-failed')
    expect(saveDraft).not.toHaveBeenCalled()
  })

  it('leaves a calendar kept only on this computer unbounded', async () => {
    const local: CalendarStore = {
      ...store(),
      accounts: [{ id: 'local', provider: 'local', name: 'This computer', email: '' }],
      sources: [{ id: 'src-local', accountId: 'local', name: 'This computer', syncState: 'online' }],
      calendars: [{ id: 'mine', sourceId: 'src-local', name: 'My calendar', color: '#444', visible: true }],
      settings: { ...store().settings, icsFeeds: [] },
    }
    const read = await refreshOwnerCalendar(local, sources({ google: null, team: null }))
    expect(read.coveredUntil).toBeNull()
    expect(findMeetingTimes({ ...week, from: '2027-06-01', to: '2027-06-04' }, { ...read, now: NOW }).ok).toBe(true)
  })
})
