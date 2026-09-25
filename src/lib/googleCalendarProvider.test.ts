import { describe, expect, it, vi } from 'vitest'
import type { CalendarEvent } from '../types'
import {
  calendarEventFromGoogle,
  GoogleCalendarProvider,
  googleEventBodyFromCalendarEvent,
  googleEventLocalId,
  parseGoogleEventLocalId,
  type GoogleCalendarFetchRequest,
  type GoogleCalendarFetchResponse,
} from './googleCalendarProvider'

type FetchHandler = (
  request: GoogleCalendarFetchRequest,
) => GoogleCalendarFetchResponse | Promise<GoogleCalendarFetchResponse>

function jsonResponse(payload: unknown): GoogleCalendarFetchResponse {
  return { status: 200, ok: true, body: JSON.stringify(payload) }
}

function providerWith(
  handler: FetchHandler,
  overrides: {
    accessToken?: () => Promise<string>
  } = {},
): {
  provider: GoogleCalendarProvider
  fetch: ReturnType<typeof vi.fn>
} {
  const fetch = vi.fn(
    async (request: GoogleCalendarFetchRequest) => handler(request),
  )
  const provider = new GoogleCalendarProvider({
    email: 'alex@business.example',
    fetch,
    accessToken: overrides.accessToken ?? (async () => 'test-access-token'),
    timeMin: () => '2026-07-01T00:00:00.000Z',
    timeMax: () => '2026-08-01T00:00:00.000Z',
    // Tests never sleep through real backoff delays.
    retryOptions: { sleep: async () => {} },
  })
  return { provider, fetch }
}

const CALENDAR_LIST = {
  items: [
    {
      id: 'primary-cal',
      summary: 'Personal',
      backgroundColor: '#abc',
      primary: true,
      accessRole: 'owner',
    },
    {
      id: 'team-cal',
      summary: 'Team',
      accessRole: 'reader',
    },
  ],
}

const TIMED_EVENT = {
  id: 'evt-1',
  iCalUID: 'uid-1@google.com',
  sequence: 2,
  status: 'confirmed',
  summary: 'Standup',
  description: 'Daily sync',
  location: 'Meet',
  hangoutLink: 'https://meet.google.com/xyz',
  start: { dateTime: '2026-07-06T09:00:00+12:00', timeZone: 'Pacific/Auckland' },
  end: { dateTime: '2026-07-06T09:15:00+12:00', timeZone: 'Pacific/Auckland' },
  organizer: { email: 'boss@business.example', displayName: 'Boss' },
  attendees: [
    { email: 'alex@business.example', self: true, responseStatus: 'needsAction' },
    { email: 'boss@business.example', responseStatus: 'accepted' },
  ],
}

const ALL_DAY_EVENT = {
  id: 'evt-2',
  status: 'confirmed',
  summary: 'Conference',
  start: { date: '2026-07-10' },
  end: { date: '2026-07-11' },
  transparency: 'transparent',
}

describe('google calendar provider', () => {
  it('round-trips local event ids', () => {
    const id = googleEventLocalId('team:cal', 'evt-9')
    expect(parseGoogleEventLocalId(id)).toEqual({
      calendarId: 'team:cal',
      eventId: 'evt-9',
    })
    expect(parseGoogleEventLocalId('local-draft')).toBeNull()
  })

  it('maps google events including all-day and free/busy', () => {
    const timed = calendarEventFromGoogle('primary-cal', TIMED_EVENT, 'UTC')
    expect(timed.id).toBe('g:primary-cal:evt-1')
    expect(timed.externalUid).toBe('uid-1@google.com')
    expect(timed.externalSequence).toBe(2)
    expect(timed.allDay).toBe(false)
    expect(timed.timeZone).toBe('Pacific/Auckland')
    expect(timed.conferenceLink).toBe('https://meet.google.com/xyz')
    expect(timed.attendees[0]?.response).toBe('needsAction')
    expect(timed.busyStatus).toBe('busy')

    const allDay = calendarEventFromGoogle('primary-cal', ALL_DAY_EVENT, 'UTC')
    expect(allDay.allDay).toBe(true)
    expect(allDay.startsAt).toBe('2026-07-10')
    expect(allDay.busyStatus).toBe('free')
  })

  it('fetchStore lists calendars, pages events, and marks read-only calendars', async () => {
    const { provider, fetch } = providerWith(request => {
      if (request.url.includes('/users/me/calendarList')) {
        return jsonResponse(CALENDAR_LIST)
      }
      if (request.url.includes('/calendars/primary-cal/events')) {
        // Two pages for the primary calendar.
        if (!request.url.includes('pageToken')) {
          return jsonResponse({ items: [TIMED_EVENT], nextPageToken: 'page2' })
        }
        return jsonResponse({ items: [ALL_DAY_EVENT] })
      }
      if (request.url.includes('/calendars/team-cal/events')) {
        return jsonResponse({
          items: [{ ...TIMED_EVENT, id: 'evt-3', status: 'cancelled' }],
        })
      }
      throw new Error(`Unexpected request: ${request.url}`)
    })

    const store = await provider.fetchStore()
    expect(store.accounts[0]?.provider).toBe('google')
    expect(store.accounts[0]?.email).toBe('alex@business.example')
    expect(store.calendars).toHaveLength(2)
    expect(store.calendars.find(c => c.id === 'team-cal')?.readOnly).toBe(true)
    // Cancelled events are dropped; both pages of primary-cal arrive.
    expect(store.events.map(event => event.id)).toEqual([
      'g:primary-cal:evt-1',
      'g:primary-cal:evt-2',
    ])
    // Every call carried the bearer token.
    for (const call of fetch.mock.calls) {
      expect(
        (call[0] as GoogleCalendarFetchRequest).headers?.Authorization,
      ).toBe('Bearer test-access-token')
    }
  })

  it('serializes local events for google including recurrence', () => {
    const event: CalendarEvent = {
      id: 'local-1',
      calendarId: 'primary-cal',
      title: 'Weekly review',
      description: 'Notes',
      startsAt: '2026-07-07T10:00:00.000Z',
      endsAt: '2026-07-07T11:00:00.000Z',
      timeZone: 'Pacific/Auckland',
      allDay: false,
      status: 'confirmed',
      visibility: 'default',
      busyStatus: 'busy',
      attendees: [
        { name: 'Boss', email: 'boss@business.example', response: 'needsAction' },
      ],
      reminders: [],
      attachments: [],
      linkedItems: [],
      recurrenceRule: { frequency: 'weekly', interval: 1, count: 10 },
      source: 'provider',
      syncState: 'pending',
    }
    const body = googleEventBodyFromCalendarEvent(event)
    expect(body.summary).toBe('Weekly review')
    expect(body.recurrence).toEqual(['RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=10'])
    expect(body.attendees).toEqual([
      {
        email: 'boss@business.example',
        displayName: 'Boss',
        responseStatus: 'needsAction',
      },
    ])
  })

  it('serializes EXDATE for a timed recurring series with exclusions', () => {
    const event: CalendarEvent = {
      id: 'g:primary-cal:series-1',
      calendarId: 'primary-cal',
      title: 'Weekly review',
      description: 'Notes',
      startsAt: '2026-07-07T10:00:00.000Z',
      endsAt: '2026-07-07T11:00:00.000Z',
      timeZone: 'UTC',
      allDay: false,
      status: 'confirmed',
      visibility: 'default',
      busyStatus: 'busy',
      attendees: [],
      reminders: [],
      attachments: [],
      linkedItems: [],
      recurrenceRule: {
        frequency: 'weekly',
        interval: 1,
        count: 10,
        // Two dropped occurrences; second carries a non-UTC offset to prove
        // it is normalized to UTC basic form like UNTIL is.
        excludedStartsAt: [
          '2026-07-14T10:00:00.000Z',
          '2026-07-21T22:00:00+12:00',
        ],
      },
      source: 'provider',
      syncState: 'pending',
    }
    const body = googleEventBodyFromCalendarEvent(event)
    expect(body.recurrence).toEqual([
      'RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=10',
      // One EXDATE line, comma-joined, UTC basic form.
      'EXDATE:20260714T100000Z,20260721T100000Z',
    ])
  })

  it('serializes DATE-valued EXDATE for an all-day recurring series', () => {
    const event: CalendarEvent = {
      id: 'g:primary-cal:series-2',
      calendarId: 'primary-cal',
      title: 'Sprint day',
      description: '',
      startsAt: '2026-07-10',
      endsAt: '2026-07-11',
      timeZone: 'UTC',
      allDay: true,
      status: 'confirmed',
      visibility: 'default',
      busyStatus: 'busy',
      attendees: [],
      reminders: [],
      attachments: [],
      linkedItems: [],
      recurrenceRule: {
        frequency: 'weekly',
        interval: 1,
        excludedStartsAt: ['2026-07-17', '2026-07-24'],
      },
      source: 'provider',
      syncState: 'pending',
    }
    const body = googleEventBodyFromCalendarEvent(event)
    expect(body.recurrence).toEqual([
      'RRULE:FREQ=WEEKLY;INTERVAL=1',
      // All-day exclusions must be DATE-valued so Google matches them.
      'EXDATE;VALUE=DATE:20260717,20260724',
    ])
  })

  it('omits EXDATE when a recurring series has no exclusions', () => {
    const event: CalendarEvent = {
      id: 'g:primary-cal:series-3',
      calendarId: 'primary-cal',
      title: 'Standup',
      description: '',
      startsAt: '2026-07-07T09:00:00.000Z',
      endsAt: '2026-07-07T09:15:00.000Z',
      timeZone: 'UTC',
      allDay: false,
      status: 'confirmed',
      visibility: 'default',
      busyStatus: 'busy',
      attendees: [],
      reminders: [],
      attachments: [],
      linkedItems: [],
      recurrenceRule: { frequency: 'daily', interval: 1 },
      source: 'provider',
      syncState: 'pending',
    }
    const body = googleEventBodyFromCalendarEvent(event)
    expect(body.recurrence).toEqual(['RRULE:FREQ=DAILY;INTERVAL=1'])
  })

  it('omits attendees from the payload while the event is a draft', () => {
    const event: CalendarEvent = {
      id: 'evt-draft-1',
      calendarId: 'primary-cal',
      title: 'Planning session',
      description: '',
      startsAt: '2026-07-07T10:00:00.000Z',
      endsAt: '2026-07-07T11:00:00.000Z',
      timeZone: 'UTC',
      allDay: false,
      status: 'tentative',
      lifecycle: 'draft',
      visibility: 'default',
      busyStatus: 'busy',
      attendees: [
        { name: 'Boss', email: 'boss@business.example', response: 'needsAction' },
      ],
      reminders: [],
      attachments: [],
      linkedItems: [],
      source: 'provider',
      syncState: 'pending',
    }
    const body = googleEventBodyFromCalendarEvent(event)
    expect(body.attendees).toBeUndefined()
    const active = googleEventBodyFromCalendarEvent({
      ...event,
      lifecycle: 'active',
    })
    expect(active.attendees).toEqual([
      {
        email: 'boss@business.example',
        displayName: 'Boss',
        responseStatus: 'needsAction',
      },
    ])
  })

  it('marks a scoped single-instance edit conflict instead of pushing a bogus PATCH', async () => {
    const { provider, fetch } = providerWith(() => {
      throw new Error('scoped exception must not reach Google')
    })

    // Shape produced by applyRecurringEventEdit(scope: 'this') over a
    // Google-backed base `g:primary-cal:evt-1`: synthetic `_only_<index>` id,
    // no recurrenceRule.
    const scopedException: CalendarEvent = {
      id: 'g:primary-cal:evt-1_only_3',
      calendarId: 'primary-cal',
      title: 'Moved this one',
      description: '',
      startsAt: '2026-07-28T10:30:00.000Z',
      endsAt: '2026-07-28T11:30:00.000Z',
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
      syncState: 'pending',
    }

    const synced = await provider.sync({
      accounts: [],
      sources: [],
      calendars: [],
      events: [scopedException],
      tasks: [],
      settings: {},
    })

    // Never 'synced' — the edited occurrence genuinely did not round-trip.
    expect(synced.events[0]?.syncState).toBe('conflict')
    // And we did not hit the network with an unresolvable instance id.
    expect(fetch).not.toHaveBeenCalled()
  })

  it('creates local events and updates google-backed events on sync', async () => {
    const { provider, fetch } = providerWith(request => {
      if (request.method === 'POST') {
        return jsonResponse({ ...TIMED_EVENT, id: 'created-1' })
      }
      if (request.method === 'PATCH') {
        return jsonResponse(TIMED_EVENT)
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    const localDraft: CalendarEvent = {
      id: 'local-draft',
      calendarId: 'primary-cal',
      title: 'New event',
      description: '',
      startsAt: '2026-07-08T10:00:00.000Z',
      endsAt: '2026-07-08T11:00:00.000Z',
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
      syncState: 'pending',
    }
    const googleBacked: CalendarEvent = {
      ...localDraft,
      id: 'g:primary-cal:evt-1',
      title: 'Renamed',
    }
    // A seeded sample stays source 'demo' (user-created events are
    // 'provider' since createDraftEvent changed) — and even a PENDING demo
    // event must never be pushed to Google.
    const demoEvent: CalendarEvent = {
      ...localDraft,
      id: 'demo-1',
      source: 'demo',
      syncState: 'pending',
    }
    // A pending provider event on a calendar Google does not own (a local
    // calendar) has no Google home; it must not be POSTed anywhere.
    const localCalendarEvent: CalendarEvent = {
      ...localDraft,
      id: 'local-only-1',
      calendarId: 'cal_local',
    }

    const synced = await provider.sync({
      accounts: [],
      sources: [],
      calendars: [
        {
          id: 'primary-cal',
          sourceId: 'google-source',
          name: 'Personal',
          color: '#abc',
          visible: true,
        },
        {
          id: 'cal_local',
          sourceId: 'src_local',
          name: 'On this device',
          color: '#def',
          visible: true,
        },
      ],
      events: [localDraft, googleBacked, demoEvent, localCalendarEvent],
      tasks: [],
      settings: {},
    })

    expect(synced.events[0]?.id).toBe('g:primary-cal:created-1')
    expect(synced.events[0]?.syncState).toBe('synced')
    expect(synced.events[1]?.syncState).toBe('synced')
    expect(synced.events[2]).toBe(demoEvent)
    expect(synced.events[3]).toBe(localCalendarEvent)
    expect(fetch).toHaveBeenCalledTimes(2)
    // No attendees on either event → Google must not send invite emails.
    for (const call of fetch.mock.calls) {
      expect((call[0] as GoogleCalendarFetchRequest).url).not.toContain(
        'sendUpdates',
      )
    }
  })

  it('requests native invite emails only when the event has attendees', async () => {
    const requests: GoogleCalendarFetchRequest[] = []
    const { provider } = providerWith(request => {
      requests.push(request)
      if (request.method === 'DELETE') {
        return { status: 204, ok: true, body: '' }
      }
      return jsonResponse(
        request.method === 'POST'
          ? { ...TIMED_EVENT, id: 'created-1' }
          : TIMED_EVENT,
      )
    })

    const withAttendees: CalendarEvent = {
      id: 'local-invite',
      calendarId: 'primary-cal',
      title: 'Planning',
      description: '',
      startsAt: '2026-07-08T10:00:00.000Z',
      endsAt: '2026-07-08T11:00:00.000Z',
      timeZone: 'UTC',
      allDay: false,
      status: 'confirmed',
      visibility: 'default',
      busyStatus: 'busy',
      attendees: [
        { name: 'Boss', email: 'boss@business.example', response: 'needsAction' },
      ],
      reminders: [],
      attachments: [],
      linkedItems: [],
      source: 'provider',
      syncState: 'pending',
    }

    await provider.createEvent(withAttendees)
    expect(requests.at(-1)?.method).toBe('POST')
    expect(requests.at(-1)?.url).toContain('sendUpdates=all')

    await provider.updateEvent({ ...withAttendees, id: 'g:primary-cal:evt-1' })
    expect(requests.at(-1)?.method).toBe('PATCH')
    expect(requests.at(-1)?.url).toContain('sendUpdates=all')

    await provider.updateEvent({
      ...withAttendees,
      id: 'g:primary-cal:evt-1',
      attendees: [],
    })
    expect(requests.at(-1)?.method).toBe('PATCH')
    expect(requests.at(-1)?.url).not.toContain('sendUpdates')

    // Delete cannot know attendees, so it always asks Google to notify.
    await provider.deleteEvent('g:primary-cal:evt-1')
    expect(requests.at(-1)?.method).toBe('DELETE')
    expect(requests.at(-1)?.url).toContain('sendUpdates=all')
  })

  it('serializes visibility and round-trips conference link and tentative via extended properties', () => {
    const event: CalendarEvent = {
      id: 'g:primary-cal:evt-vis',
      calendarId: 'primary-cal',
      title: 'Private sync',
      description: '',
      startsAt: '2026-07-08T10:00:00.000Z',
      endsAt: '2026-07-08T11:00:00.000Z',
      timeZone: 'UTC',
      allDay: false,
      status: 'confirmed',
      visibility: 'private',
      busyStatus: 'tentative',
      conferenceLink: 'https://example.com/room/42',
      attendees: [],
      reminders: [],
      attachments: [],
      linkedItems: [],
      source: 'provider',
      syncState: 'pending',
    }
    const body = googleEventBodyFromCalendarEvent(event) as {
      visibility?: string
      extendedProperties?: { private?: Record<string, string> }
    }
    // The Visibility select used to silently revert: the body never carried it.
    expect(body.visibility).toBe('private')
    // hangoutLink is read-only and transparency cannot say "tentative", so
    // both round-trip through app-private extended properties.
    expect(body.extendedProperties?.private).toEqual({
      purecalendarConferenceLink: 'https://example.com/room/42',
      purecalendarBusyStatus: 'tentative',
    })

    // And the parse side reads them back.
    const parsed = calendarEventFromGoogle(
      'primary-cal',
      {
        id: 'evt-vis',
        status: 'confirmed',
        summary: 'Private sync',
        visibility: 'private',
        transparency: 'opaque',
        start: { dateTime: '2026-07-08T10:00:00Z' },
        end: { dateTime: '2026-07-08T11:00:00Z' },
        extendedProperties: {
          private: {
            purecalendarConferenceLink: 'https://example.com/room/42',
            purecalendarBusyStatus: 'tentative',
          },
        },
      },
      'UTC',
    )
    expect(parsed.visibility).toBe('private')
    expect(parsed.conferenceLink).toBe('https://example.com/room/42')
    expect(parsed.busyStatus).toBe('tentative')
  })

  it('prefers the user-set conference link over the Google-managed one', () => {
    const parsed = calendarEventFromGoogle(
      'primary-cal',
      {
        ...TIMED_EVENT,
        extendedProperties: {
          private: { purecalendarConferenceLink: 'https://example.com/mine' },
        },
      },
      'UTC',
    )
    expect(parsed.conferenceLink).toBe('https://example.com/mine')
    // An empty stored value falls back to Google's own link.
    const fallback = calendarEventFromGoogle(
      'primary-cal',
      {
        ...TIMED_EVENT,
        extendedProperties: { private: { purecalendarConferenceLink: '' } },
      },
      'UTC',
    )
    expect(fallback.conferenceLink).toBe('https://meet.google.com/xyz')
  })

  it('parses Google attachments into the event model', () => {
    const parsed = calendarEventFromGoogle(
      'primary-cal',
      {
        ...TIMED_EVENT,
        attachments: [
          {
            fileId: 'file-1',
            fileUrl: 'https://drive.google.com/file/d/file-1',
            title: 'agenda.pdf',
            mimeType: 'application/pdf',
          },
          // No id or url: nothing to reference, dropped.
          { title: 'ghost' },
        ],
      },
      'UTC',
    )
    expect(parsed.attachments).toEqual([
      {
        id: 'file-1',
        name: 'agenda.pdf',
        mimeType: 'application/pdf',
        sizeLabel: '',
      },
    ])
  })

  it('pushes tombstoned deletes on sync and prunes confirmed ones', async () => {
    const deleted: string[] = []
    const { provider } = providerWith(request => {
      if (request.method === 'DELETE') {
        deleted.push(request.url)
        if (request.url.includes('gone-evt')) {
          // Already deleted at Google: confirmed enough to prune.
          return { status: 404, ok: false, body: 'not found' }
        }
        if (request.url.includes('flaky-evt')) {
          return { status: 500, ok: false, body: 'backend error' }
        }
        return { status: 204, ok: true, body: '' }
      }
      return jsonResponse(TIMED_EVENT)
    })

    const synced = await provider.sync({
      accounts: [],
      sources: [],
      calendars: [],
      events: [],
      tasks: [],
      settings: {},
      removedEventIds: [
        'g:primary-cal:ok-evt',
        'g:primary-cal:gone-evt',
        'g:primary-cal:flaky-evt',
        'local-only', // no Google copy; pruned without a network call
      ],
    })

    expect(deleted.some(url => url.includes('ok-evt'))).toBe(true)
    expect(deleted.some(url => url.includes('gone-evt'))).toBe(true)
    // Only the failed delete stays queued for the next sync.
    expect(synced.removedEventIds).toEqual(['g:primary-cal:flaky-evt'])
  })

  it('rsvp patches only the self attendee', async () => {
    const patched: GoogleCalendarFetchRequest[] = []
    const { provider } = providerWith(request => {
      if (request.method === 'PATCH') {
        patched.push(request)
        return jsonResponse({
          ...TIMED_EVENT,
          attendees: [
            { email: 'alex@business.example', self: true, responseStatus: 'accepted' },
            { email: 'boss@business.example', responseStatus: 'accepted' },
          ],
        })
      }
      return jsonResponse(TIMED_EVENT)
    })

    const updated = await provider.rsvp('g:primary-cal:evt-1', 'accepted')
    expect(updated.attendees[0]?.response).toBe('accepted')
    // RSVP updates the attendee's own copy — it must never trigger Google
    // invite emails to the other guests.
    expect(patched[0]?.url).not.toContain('sendUpdates')
    const body = JSON.parse(patched[0]?.body ?? '{}') as {
      attendees: Array<{ email: string; responseStatus: string }>
    }
    expect(body.attendees.find(a => a.email === 'alex@business.example')?.responseStatus).toBe('accepted')
    expect(body.attendees.find(a => a.email === 'boss@business.example')?.responseStatus).toBe('accepted')
  })

  it('rsvp falls back to the connected account email when no attendee is marked self', async () => {
    const patched: GoogleCalendarFetchRequest[] = []
    const { provider } = providerWith(request => {
      const noSelf = {
        ...TIMED_EVENT,
        attendees: [
          // Secondary-calendar reads can lack the self flag entirely.
          { email: 'alex@business.example', responseStatus: 'needsAction' },
          { email: 'boss@business.example', responseStatus: 'accepted' },
        ],
      }
      if (request.method === 'PATCH') {
        patched.push(request)
        return jsonResponse(noSelf)
      }
      return jsonResponse(noSelf)
    })

    await provider.rsvp('g:primary-cal:evt-1', 'declined')
    const body = JSON.parse(patched[0]?.body ?? '{}') as {
      attendees: Array<{ email: string; responseStatus: string }>
    }
    expect(
      body.attendees.find(a => a.email === 'alex@business.example')
        ?.responseStatus,
    ).toBe('declined')
    expect(
      body.attendees.find(a => a.email === 'boss@business.example')
        ?.responseStatus,
    ).toBe('accepted')
  })

  it('marks events failed when the push errors and surfaces API errors', async () => {
    const { provider } = providerWith(() => ({
      status: 403,
      ok: false,
      body: 'rate limited',
    }))

    await expect(provider.fetchStore()).rejects.toThrow(/403/)

    const pending: CalendarEvent = {
      id: 'g:primary-cal:evt-1',
      calendarId: 'primary-cal',
      title: 'Will fail',
      description: '',
      startsAt: '2026-07-08T10:00:00.000Z',
      endsAt: '2026-07-08T11:00:00.000Z',
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
      syncState: 'pending',
    }
    const synced = await provider.sync({
      accounts: [],
      sources: [],
      calendars: [],
      events: [pending],
      tasks: [],
      settings: {},
    })
    expect(synced.events[0]?.syncState).toBe('failed')
  })

  describe('retry policy', () => {
    const localDraft: CalendarEvent = {
      id: 'local-draft',
      calendarId: 'primary-cal',
      title: 'New event',
      description: '',
      startsAt: '2026-07-08T10:00:00.000Z',
      endsAt: '2026-07-08T11:00:00.000Z',
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
      syncState: 'pending',
    }

    it('retries a 429 on the list path and succeeds', async () => {
      let calls = 0
      const { provider, fetch } = providerWith(request => {
        calls += 1
        if (calls === 1) {
          return { status: 429, ok: false, body: 'rate limited' }
        }
        if (request.url.includes('/users/me/calendarList')) {
          return jsonResponse(CALENDAR_LIST)
        }
        if (request.url.includes('/events')) {
          return jsonResponse({ items: [] })
        }
        throw new Error(`Unexpected request: ${request.url}`)
      })

      const store = await provider.fetchStore()
      expect(store.calendars).toHaveLength(2)
      // First calendarList attempt got a 429; the retry succeeded, then the
      // two per-calendar event lists ran normally.
      expect(fetch.mock.calls.length).toBe(4)
    })

    it('does not retry createEvent when the fetch itself throws', async () => {
      const { provider, fetch } = providerWith(() => {
        throw new Error('socket hang up')
      })

      // A thrown POST is ambiguous (may have reached Google) — retrying
      // could double-create, so it must fail after exactly one attempt.
      await expect(provider.createEvent(localDraft)).rejects.toThrow(
        'socket hang up',
      )
      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('retries a PATCH 500 and succeeds (idempotent update)', async () => {
      let calls = 0
      const { provider, fetch } = providerWith(() => {
        calls += 1
        if (calls === 1) {
          return { status: 500, ok: false, body: 'backend error' }
        }
        return jsonResponse(TIMED_EVENT)
      })

      const updated = await provider.updateEvent({
        ...localDraft,
        id: 'g:primary-cal:evt-1',
      })
      expect(updated.syncState).toBe('synced')
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('retries a 401 once with a freshly fetched access token', async () => {
      let tokenCalls = 0
      const { provider, fetch } = providerWith(
        request => {
          if (request.headers?.Authorization === 'Bearer stale-token') {
            return { status: 401, ok: false, body: 'invalid credentials' }
          }
          return jsonResponse(CALENDAR_LIST)
        },
        {
          accessToken: async () => {
            tokenCalls += 1
            return tokenCalls === 1 ? 'stale-token' : 'fresh-token'
          },
        },
      )

      const payload = await provider['request']<{ items?: unknown[] }>(
        '/users/me/calendarList',
      )
      expect(payload.items).toHaveLength(2)
      // Each attempt re-requested a token, so the 401 retry carried the
      // refreshed one.
      expect(tokenCalls).toBe(2)
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(
        (fetch.mock.calls[1]?.[0] as GoogleCalendarFetchRequest).headers
          ?.Authorization,
      ).toBe('Bearer fresh-token')
    })
  })
})

describe('multiple calendars', () => {
  /** calendarList + per-calendar event routes, with optional failures. */
  function multiCalendarHandler(options: {
    describable?: Record<string, { summary: string; backgroundColor?: string }>
    failingEventCalendars?: string[]
  }): { handler: FetchHandler; hits: string[] } {
    const hits: string[] = []
    const handler: FetchHandler = request => {
      const url = request.url
      hits.push(url)
      if (url.includes('/users/me/calendarList')) {
        return jsonResponse(CALENDAR_LIST)
      }
      const eventsMatch = /\/calendars\/([^/]+)\/events/.exec(url)
      if (eventsMatch) {
        const id = decodeURIComponent(eventsMatch[1]!)
        if (options.failingEventCalendars?.includes(id)) {
          return { status: 403, ok: false, body: '{"error":"forbidden"}' }
        }
        return jsonResponse({
          items: [
            {
              id: `evt-${id}`,
              summary: `Event on ${id}`,
              status: 'confirmed',
              start: { dateTime: '2026-07-10T09:00:00Z' },
              end: { dateTime: '2026-07-10T10:00:00Z' },
            },
          ],
        })
      }
      const describeMatch = /\/calendars\/([^/?]+)$/.exec(url)
      if (describeMatch) {
        const id = decodeURIComponent(describeMatch[1]!)
        const entry = options.describable?.[id]
        if (!entry) return { status: 404, ok: false, body: '{"error":"nope"}' }
        return jsonResponse({ id, ...entry })
      }
      return jsonResponse({})
    }
    return { handler, hits }
  }

  it('fetches every calendar in the list, one colour each', async () => {
    const { handler } = multiCalendarHandler({})
    const { provider } = providerWith(handler)
    const store = await provider.fetchStore()
    expect(store.calendars.map(calendar => calendar.id)).toEqual([
      'primary-cal',
      'team-cal',
    ])
    expect(store.calendars[0]!.color).toBe('#abc')
    expect(store.calendars[1]!.readOnly).toBe(true)
    expect(store.events.map(event => event.calendarId)).toEqual([
      'primary-cal',
      'team-cal',
    ])
  })

  it('adds a shared calendar the user named, which is not in their list', async () => {
    const { handler } = multiCalendarHandler({
      describable: {
        'shared@group.calendar.google.com': {
          summary: 'Shared roadmap',
          backgroundColor: '#16a765',
        },
      },
    })
    const { provider } = providerWith(handler)
    ;(
      provider as unknown as {
        options: { extraCalendarIds: () => string[] }
      }
    ).options.extraCalendarIds = () => ['shared@group.calendar.google.com']
    const store = await provider.fetchStore()
    const shared = store.calendars.find(
      calendar => calendar.id === 'shared@group.calendar.google.com',
    )
    expect(shared).toMatchObject({
      name: 'Shared roadmap',
      color: '#16a765',
      readOnly: true,
    })
    expect(
      store.events.some(
        event => event.calendarId === 'shared@group.calendar.google.com',
      ),
    ).toBe(true)
  })

  it('never re-fetches a calendar the user removed', async () => {
    const { handler, hits } = multiCalendarHandler({})
    const { provider } = providerWith(handler)
    ;(
      provider as unknown as {
        options: { removedCalendarIds: () => string[] }
      }
    ).options.removedCalendarIds = () => ['team-cal']
    const store = await provider.fetchStore()
    expect(store.calendars.map(calendar => calendar.id)).toEqual([
      'primary-cal',
    ])
    expect(hits.some(url => url.includes('team-cal'))).toBe(false)
  })

  it('one unreadable calendar does not cost the others their events', async () => {
    const { handler } = multiCalendarHandler({
      failingEventCalendars: ['team-cal'],
    })
    const { provider } = providerWith(handler)
    const store = await provider.fetchStore()
    // the calendar is still listed; only its events are missing
    expect(store.calendars).toHaveLength(2)
    expect(store.events.map(event => event.calendarId)).toEqual([
      'primary-cal',
    ])
  })
})
