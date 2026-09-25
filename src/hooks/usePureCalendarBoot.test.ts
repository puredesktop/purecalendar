import { describe, expect, it } from 'vitest'
import type { CalendarEvent, CalendarStore } from '../types'
import { mergeGoogleSnapshot } from './usePureCalendarBoot'

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'evt',
    calendarId: 'cal',
    title: 'Event',
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
    syncState: 'synced',
    ...overrides,
  }
}

function store(overrides: Partial<CalendarStore>): CalendarStore {
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

describe('mergeGoogleSnapshot', () => {
  it('replaces stale provider events with the remote snapshot', () => {
    const local = store({
      events: [
        event({ id: 'g:cal:1', title: 'Stale title' }),
        event({ id: 'g:cal:gone' }),
      ],
    })
    const remote = store({
      events: [
        event({ id: 'g:cal:1', title: 'Fresh title' }),
        event({ id: 'g:cal:new' }),
      ],
    })

    const merged = mergeGoogleSnapshot(local, remote)
    expect(merged.events.map(e => e.id).sort()).toEqual([
      'g:cal:1',
      'g:cal:new',
    ])
    expect(merged.events.find(e => e.id === 'g:cal:1')?.title).toBe(
      'Fresh title',
    )
  })

  it('keeps local demo/task events and unpushed pending edits', () => {
    const pendingEdit = event({
      id: 'g:cal:1',
      title: 'Local edit',
      syncState: 'pending',
    })
    const demoEvent = event({ id: 'demo-1', source: 'demo' })
    const local = store({ events: [pendingEdit, demoEvent] })
    const remote = store({
      events: [event({ id: 'g:cal:1', title: 'Remote title' })],
    })

    const merged = mergeGoogleSnapshot(local, remote)
    // The pending local edit wins over the remote copy of the same event.
    expect(merged.events.filter(e => e.id === 'g:cal:1')).toHaveLength(1)
    expect(merged.events.find(e => e.id === 'g:cal:1')?.title).toBe(
      'Local edit',
    )
    expect(merged.events.some(e => e.id === 'demo-1')).toBe(true)
  })

  it('never re-adds a tombstoned event from the remote snapshot', () => {
    // The user deleted g:cal:dead locally; until the provider confirms the
    // delete, a refresh must not bring it back.
    const local = {
      ...store({ events: [event({ id: 'g:cal:keep' })] }),
      removedEventIds: ['g:cal:dead'],
    }
    const remote = store({
      events: [event({ id: 'g:cal:keep' }), event({ id: 'g:cal:dead' })],
    })

    const merged = mergeGoogleSnapshot(local, remote)
    expect(merged.events.map(e => e.id)).toEqual(['g:cal:keep'])
    // The tombstone itself survives the merge for the sync loop to push.
    expect(merged.removedEventIds).toEqual(['g:cal:dead'])
  })

  it('unions remote accounts, sources, and calendars without duplicates', () => {
    const local = store({
      accounts: [
        { id: 'google-account', provider: 'google', name: 'Old', email: 'a@b' },
      ],
      calendars: [
        {
          id: 'cal',
          sourceId: 'google-source',
          name: 'Cal',
          color: '#fff',
          visible: false,
        },
      ],
    })
    const remote = store({
      accounts: [
        { id: 'google-account', provider: 'google', name: 'New', email: 'a@b' },
      ],
      sources: [
        {
          id: 'google-source',
          accountId: 'google-account',
          name: 'Google Calendar',
          syncState: 'online',
        },
      ],
      calendars: [
        {
          id: 'cal',
          sourceId: 'google-source',
          name: 'Cal',
          color: '#abc',
          visible: true,
        },
        {
          id: 'cal-2',
          sourceId: 'google-source',
          name: 'Second',
          color: '#def',
          visible: true,
        },
      ],
    })

    const merged = mergeGoogleSnapshot(local, remote)
    expect(merged.accounts).toHaveLength(1)
    // Local wins for existing entries (visibility toggles survive syncs).
    expect(merged.calendars.find(c => c.id === 'cal')?.visible).toBe(false)
    expect(merged.calendars.some(c => c.id === 'cal-2')).toBe(true)
    expect(merged.sources).toHaveLength(1)
  })
})

describe('a Google sync never overwrites local or mail-fed events', () => {
  /** The shape of the real store: demo/local, a Proton mail invite, Google. */
  function realisticLocal(): CalendarStore {
    return store({
      calendars: [
        {
          id: 'cal_local',
          sourceId: 'src_local',
          name: 'Local',
          color: '#6b7280',
          visible: true,
        },
        {
          id: 'cal_mail_invites',
          sourceId: 'src_mail_invites',
          name: 'Mail invites',
          color: '#7c6ff0',
          visible: true,
        },
        {
          id: 'alex@business.example',
          sourceId: 'src_google',
          name: 'alex@business.example',
          color: '#9fe1e7',
          visible: true,
        },
      ],
      events: [
        event({ id: 'local-1', calendarId: 'cal_local', source: 'demo' }),
        event({
          id: 'invite-1',
          calendarId: 'cal_mail_invites',
          title: 'Book Sprints pure.desktop meeting',
          source: 'feed',
          syncState: 'pending',
          externalUid: 'uid-from-proton',
        }),
        event({ id: 'g:alex@business.example:1', calendarId: 'alex@business.example' }),
      ],
      tasks: [],
    })
  }

  it('keeps local and mail-invite events when Google returns its own', () => {
    const merged = mergeGoogleSnapshot(
      realisticLocal(),
      store({
        calendars: [
          {
            id: 'shared@group.calendar.google.com',
            sourceId: 'src_google',
            name: 'Shared roadmap',
            color: '#16a765',
            visible: true,
            readOnly: true,
          },
        ],
        events: [
          event({
            id: 'g:shared:1',
            calendarId: 'shared@group.calendar.google.com',
          }),
          event({
            id: 'g:alex@business.example:1',
            calendarId: 'alex@business.example',
            title: 'Refreshed from Google',
          }),
        ],
      }),
    )
    // the Proton-fed invite and the local event are untouched
    expect(merged.events.find(e => e.id === 'invite-1')).toMatchObject({
      title: 'Book Sprints pure.desktop meeting',
      source: 'feed',
    })
    expect(merged.events.some(e => e.id === 'local-1')).toBe(true)
    // the newly shared calendar is ADDED, nothing is replaced
    expect(merged.calendars.map(c => c.id)).toEqual([
      'cal_local',
      'cal_mail_invites',
      'alex@business.example',
      'shared@group.calendar.google.com',
    ])
    expect(merged.events.some(e => e.id === 'g:shared:1')).toBe(true)
  })

  it('keeps already-synced events of a calendar this fetch could not read', () => {
    const merged = mergeGoogleSnapshot(
      realisticLocal(),
      store({
        events: [],
        failedCalendarIds: ['alex@business.example'],
      }),
    )
    // a transient read failure must not look like "the calendar emptied"
    expect(merged.events.some(e => e.id === 'g:alex@business.example:1')).toBe(
      true,
    )
    expect(merged.events.some(e => e.id === 'invite-1')).toBe(true)
  })

  it('still drops provider events that Google really no longer has', () => {
    const merged = mergeGoogleSnapshot(
      realisticLocal(),
      store({ events: [] }),
    )
    expect(merged.events.some(e => e.id === 'g:alex@business.example:1')).toBe(
      false,
    )
    expect(merged.events.map(e => e.id).sort()).toEqual([
      'invite-1',
      'local-1',
    ])
  })
})
