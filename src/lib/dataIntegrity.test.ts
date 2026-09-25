/**
 * Regression tests for the PureCalendar data-integrity fixes (issue #175
 * sweep):
 *
 *  - parsePersistedCalendarStore: untrusted persisted blobs never crash boot;
 *    corrupt top-level shapes reject (caller falls back to backup/seed);
 *    invalid individual records are dropped while the rest load.
 *  - upsertInviteEvent: a re-delivered invite with the SAME sequence number
 *    must not reset the user's locally-recorded RSVP.
 *  - expandRecurringEvent: a malformed startsAt/endsAt must not throw
 *    (previously Invalid Date -> toISOString() blanked the whole calendar).
 *  - allDayEventPatch: toggling all-day snaps times to day boundaries in the
 *    display timezone instead of leaving a wall-clock time on the event.
 *  - local event ids: two events minted in the same millisecond get distinct
 *    ids (id-keyed updates previously edited both records as one).
 */
import { describe, expect, it } from 'vitest'
import {
  allDayEventPatch,
  createDraftEvent,
  createEventFromCalendarInviteIntent,
  demoCalendarStore,
  eventsInRange,
  expandRecurringEvent,
  upsertInviteEvent,
} from './calendarModel'
import { parsePersistedCalendarStore } from './calendarStorePersistence'
import type { CalendarEvent } from '../types'

const inviteIntent = {
  id: 'calendar_invite_msg_1_invite-test',
  resourceId: 'calendar-invite:mail:acct_demo:msg_1:invite-test',
  sourceAppSlug: 'mail' as const,
  source: {
    type: 'email' as const,
    accountId: 'acct_demo',
    threadId: 'thread_invite',
    messageId: 'msg_1',
    label: 'Invitation: Review meeting',
    snippet: 'Kim invited you.',
  },
  uid: 'invite-rsvp@example.com',
  method: 'REQUEST' as const,
  sequence: 2,
  status: 'confirmed' as const,
  title: 'Review meeting',
  description: 'Talk through the plan.',
  location: 'Zoom',
  startsAt: '2026-06-25T17:00:00.000Z',
  endsAt: '2026-06-25T17:30:00.000Z',
  timeZone: 'UTC',
  organizer: { name: 'Kim', email: 'kim@example.com' },
  attendees: [
    {
      name: 'Alex Example',
      email: 'alex@example.com',
      response: 'needsAction' as const,
    },
  ],
  createdAt: '2026-06-20T10:00:00.000Z',
}

// ---------------------------------------------------------------------------
// Persisted-store validation
// ---------------------------------------------------------------------------

describe('parsePersistedCalendarStore', () => {
  it('round-trips a real store', () => {
    const store = demoCalendarStore()
    const parsed = parsePersistedCalendarStore(
      JSON.parse(JSON.stringify(store)),
    )
    expect(parsed).not.toBeNull()
    expect(parsed?.events.map(event => event.id)).toEqual(
      store.events.map(event => event.id),
    )
    expect(parsed?.calendars.length).toBe(store.calendars.length)
    expect(parsed?.tasks.length).toBe(store.tasks.length)
  })

  it('round-trips delete tombstones so a reload cannot resurrect the event', () => {
    const store = {
      ...demoCalendarStore(),
      removedEventIds: ['g:cal-1:evt-9'],
    }
    const parsed = parsePersistedCalendarStore(
      JSON.parse(JSON.stringify(store)),
    )
    expect(parsed?.removedEventIds).toEqual(['g:cal-1:evt-9'])
    // Junk entries are dropped; an all-junk list parses as absent.
    const junk = parsePersistedCalendarStore(
      JSON.parse(
        JSON.stringify({ ...demoCalendarStore(), removedEventIds: [1, ''] }),
      ),
    )
    expect(junk?.removedEventIds).toBeUndefined()
  })

  it('rejects blobs that are not a plausible store', () => {
    expect(parsePersistedCalendarStore(null)).toBeNull()
    expect(parsePersistedCalendarStore('garbage')).toBeNull()
    expect(parsePersistedCalendarStore({})).toBeNull()
    expect(
      parsePersistedCalendarStore({ events: [], calendars: [], accounts: [] }),
    ).toBeNull() // no calendars -> cannot hold events, treat as corrupt
  })

  it('drops individual invalid events but keeps the rest', () => {
    const store = demoCalendarStore()
    const good = store.events[0]
    const blob = JSON.parse(JSON.stringify(store)) as Record<string, unknown>
    blob.events = [
      JSON.parse(JSON.stringify(good)),
      { id: 'event_bad_dates', calendarId: good.calendarId, startsAt: 'not-a-date', endsAt: '' },
      { title: 'no id at all' },
      42,
    ]
    const parsed = parsePersistedCalendarStore(blob)
    expect(parsed).not.toBeNull()
    expect(parsed?.events.map(event => event.id)).toEqual([good.id])
  })

  it('drops events pointing at a calendar that no longer exists', () => {
    const store = demoCalendarStore()
    const good = store.events[0]
    const blob = JSON.parse(JSON.stringify(store)) as Record<string, unknown>
    blob.events = [
      JSON.parse(JSON.stringify(good)),
      { ...JSON.parse(JSON.stringify(good)), id: 'event_orphan', calendarId: 'cal_deleted' },
    ]
    const parsed = parsePersistedCalendarStore(blob)
    expect(parsed?.events.map(event => event.id)).toEqual([good.id])
  })

  it('normalizes unknown enum values instead of propagating them', () => {
    const store = demoCalendarStore()
    const blob = JSON.parse(JSON.stringify(store)) as {
      events: Array<Record<string, unknown>>
    }
    blob.events[0].status = 'exploded'
    blob.events[0].syncState = 'weird'
    blob.events[0].busyStatus = 7
    const parsed = parsePersistedCalendarStore(blob)
    expect(parsed?.events[0].status).toBe('confirmed')
    expect(parsed?.events[0].syncState).toBe('pending')
    expect(parsed?.events[0].busyStatus).toBe('busy')
  })
})

// ---------------------------------------------------------------------------
// Invite re-delivery must not reset the local RSVP
// ---------------------------------------------------------------------------

describe('upsertInviteEvent RSVP preservation', () => {
  it('keeps a locally-recorded acceptance when the same sequence is re-processed', () => {
    const base = demoCalendarStore()
    const first = upsertInviteEvent(base, inviteIntent, 'cal_work', 'accepted')
    expect(first.event.attendees[0]?.response).toBe('accepted')

    // Same invite arrives again (same uid, SAME sequence), no response info.
    const second = upsertInviteEvent(first.store, inviteIntent, 'cal_work')
    expect(second.event.attendees[0]?.response).toBe('accepted')
  })

  it('lets a genuine incoming response update the attendee', () => {
    const base = demoCalendarStore()
    const first = upsertInviteEvent(base, inviteIntent, 'cal_work', 'accepted')
    const declinedIntent = {
      ...inviteIntent,
      sequence: 3,
      attendees: [
        {
          name: 'Alex Example',
          email: 'alex@example.com',
          response: 'declined' as const,
        },
      ],
    }
    const second = upsertInviteEvent(
      first.store,
      declinedIntent,
      'cal_work',
      'declined',
    )
    expect(second.event.attendees[0]?.response).toBe('declined')
  })

  it('still ignores an invite older than the stored sequence', () => {
    const base = demoCalendarStore()
    const first = upsertInviteEvent(base, inviteIntent, 'cal_work', 'accepted')
    const stale = { ...inviteIntent, sequence: 1, title: 'Old title' }
    const second = upsertInviteEvent(first.store, stale, 'cal_work')
    expect(second.event.title).toBe('Review meeting')
  })
})

// ---------------------------------------------------------------------------
// Malformed dates must not blank the calendar
// ---------------------------------------------------------------------------

describe('expandRecurringEvent with malformed dates', () => {
  const rangeStart = '2026-06-22T00:00:00.000Z'
  const rangeEnd = '2026-06-29T00:00:00.000Z'

  it('does not throw when a recurring event has an unparseable endsAt', () => {
    const broken: CalendarEvent = {
      ...createDraftEvent('cal_work', '2026-06-24T10:00:00.000Z'),
      id: 'event_broken',
      endsAt: 'not-a-date',
      recurrenceRule: { frequency: 'daily', interval: 1 },
    }
    expect(() =>
      expandRecurringEvent(broken, rangeStart, rangeEnd),
    ).not.toThrow()
  })

  it('one bad record does not take out the rest of the range query', () => {
    const good: CalendarEvent = {
      ...createDraftEvent('cal_work', '2026-06-24T10:00:00.000Z'),
      id: 'event_good',
      recurrenceRule: { frequency: 'daily', interval: 1, count: 3 },
    }
    const broken: CalendarEvent = {
      ...createDraftEvent('cal_work', '2026-06-24T10:00:00.000Z'),
      id: 'event_broken',
      endsAt: '',
      recurrenceRule: { frequency: 'daily', interval: 1 },
    }
    const events = eventsInRange([broken, good], rangeStart, rangeEnd)
    expect(
      events.some(event => event.id.startsWith('event_good')),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// All-day toggle snaps to day boundaries
// ---------------------------------------------------------------------------

describe('allDayEventPatch', () => {
  it('snaps a timed event to local day boundaries when turning all-day on', () => {
    // 00:30 UTC on March 10 is March 9 in Los Angeles — the classic
    // wrong-day case when only the flag is flipped.
    const patch = allDayEventPatch(
      { startsAt: '2026-03-10T00:30:00.000Z', endsAt: '2026-03-10T01:30:00.000Z' },
      true,
      'America/Los_Angeles',
    )
    expect(patch.allDay).toBe(true)
    // Midnight March 9 in LA (PDT, UTC-7 — DST began March 8) is 07:00 UTC.
    expect(patch.startsAt).toBe('2026-03-09T07:00:00.000Z')
    expect(patch.endsAt).toBe('2026-03-10T07:00:00.000Z')
  })

  it('covers every touched day for a multi-day event', () => {
    const patch = allDayEventPatch(
      { startsAt: '2026-06-24T15:00:00.000Z', endsAt: '2026-06-26T09:00:00.000Z' },
      true,
      'UTC',
    )
    expect(patch.startsAt).toBe('2026-06-24T00:00:00.000Z')
    expect(patch.endsAt).toBe('2026-06-27T00:00:00.000Z')
  })

  it('treats an exact-midnight end as exclusive', () => {
    const patch = allDayEventPatch(
      { startsAt: '2026-06-24T15:00:00.000Z', endsAt: '2026-06-25T00:00:00.000Z' },
      true,
      'UTC',
    )
    expect(patch.endsAt).toBe('2026-06-25T00:00:00.000Z')
  })

  it('turning all-day off keeps the times untouched', () => {
    const patch = allDayEventPatch(
      { startsAt: '2026-06-24T15:00:00.000Z', endsAt: '2026-06-24T16:00:00.000Z' },
      false,
      'UTC',
    )
    expect(patch).toEqual({ allDay: false })
  })
})

// ---------------------------------------------------------------------------
// Local id uniqueness
// ---------------------------------------------------------------------------

describe('local event id uniqueness', () => {
  it('two drafts created in the same millisecond get distinct ids', () => {
    const first = createDraftEvent('cal_work', '2026-06-24T10:00:00.000Z')
    const second = createDraftEvent('cal_work', '2026-06-24T10:00:00.000Z')
    expect(first.id).not.toBe(second.id)
  })

  it('two invite events minted with the same explicit timestamp differ', () => {
    const first = createEventFromCalendarInviteIntent(
      inviteIntent,
      'cal_work',
      'accepted',
      42,
    )
    const second = createEventFromCalendarInviteIntent(
      inviteIntent,
      'cal_work',
      'accepted',
      42,
    )
    expect(first.id).not.toBe(second.id)
  })
})
