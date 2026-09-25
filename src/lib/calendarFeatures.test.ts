import { describe, expect, it } from 'vitest'
import type { CalendarEvent, CalendarStore } from '../types'
import {
  clearDemoData,
  computeEventReminders,
  keepDemoData,
} from './calendarModel'

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

function demoStore(): CalendarStore {
  return {
    accounts: [
      { id: 'demo-account', provider: 'demo', name: 'Demo', email: '' },
      { id: 'google-account', provider: 'google', name: 'Me', email: 'a@b' },
    ],
    sources: [
      { id: 'demo-source', accountId: 'demo-account', name: 'Demo', syncState: 'offline' },
      { id: 'google-source', accountId: 'google-account', name: 'Google', syncState: 'online' },
    ],
    calendars: [
      { id: 'demo-cal', sourceId: 'demo-source', name: 'Demo', color: '#111', visible: true },
      { id: 'g-cal', sourceId: 'google-source', name: 'Personal', color: '#222', visible: true },
    ],
    events: [
      event({ id: 'demo-1', calendarId: 'demo-cal', source: 'demo' }),
      event({ id: 'g-1', calendarId: 'g-cal', source: 'provider' }),
    ],
    tasks: [],
    settings: {},
  }
}

describe('clearDemoData', () => {
  it('removes demo account/source/calendar/events and keeps real data', () => {
    const cleared = clearDemoData(demoStore())
    expect(cleared.accounts.map(a => a.id)).toEqual(['google-account'])
    expect(cleared.sources.map(s => s.id)).toEqual(['google-source'])
    expect(cleared.calendars.map(c => c.id)).toEqual(['g-cal'])
    expect(cleared.events.map(e => e.id)).toEqual(['g-1'])
    expect(cleared.settings.demoCleared).toBe(true)
  })

  it('never deletes a user-created event, even one on a demo calendar', () => {
    // User/agent-created events carry source 'provider' (createDraftEvent);
    // one living on a demo calendar must survive "Remove samples", and its
    // calendar must survive with it or the event would be orphaned and
    // dropped by the persistence layer's calendar check.
    const store = demoStore()
    store.events.push(
      event({ id: 'mine', calendarId: 'demo-cal', source: 'provider' }),
    )
    const cleared = clearDemoData(store)
    expect(cleared.events.some(e => e.id === 'mine')).toBe(true)
    expect(cleared.events.some(e => e.id === 'demo-1')).toBe(false)
    expect(cleared.calendars.some(c => c.id === 'demo-cal')).toBe(true)
    // The calendar's source/account chain survives too, so the store stays
    // internally consistent.
    expect(cleared.sources.some(s => s.id === 'demo-source')).toBe(true)
    expect(cleared.accounts.some(a => a.id === 'demo-account')).toBe(true)
  })
})

describe('keepDemoData', () => {
  it('only marks the flag, leaving data intact', () => {
    const kept = keepDemoData(demoStore())
    expect(kept.settings.demoCleared).toBe(true)
    expect(kept.events).toHaveLength(2)
    expect(kept.accounts).toHaveLength(2)
  })
})

describe('computeEventReminders', () => {
  const now = Date.parse('2026-07-10T08:00:00.000Z')

  it('schedules a future reminder with a stable id and lead-time body', () => {
    const events = [
      event({
        id: 'evt-1',
        title: 'Standup',
        startsAt: '2026-07-10T09:00:00.000Z',
        reminders: [{ id: 'r1', minutesBefore: 10 }],
      }),
    ]
    const reminders = computeEventReminders(events, now, 24 * 60 * 60 * 1000)
    expect(reminders).toHaveLength(1)
    expect(reminders[0]?.id).toBe('reminder:evt-1:r1')
    expect(reminders[0]?.title).toBe('Standup')
    expect(reminders[0]?.body).toBe('Starts in 10 minutes')
    // 09:00 minus 10 min = 08:50.
    expect(reminders[0]?.fireAt).toBe(Date.parse('2026-07-10T08:50:00.000Z'))
  })

  it('skips reminders already in the past, beyond the horizon, or on cancelled events', () => {
    const events = [
      event({
        id: 'past',
        startsAt: '2026-07-10T08:02:00.000Z',
        reminders: [{ id: 'r', minutesBefore: 10 }], // fires 07:52, before now
      }),
      event({
        id: 'far',
        startsAt: '2026-08-10T09:00:00.000Z',
        reminders: [{ id: 'r', minutesBefore: 5 }], // beyond a 1-day horizon
      }),
      event({
        id: 'cancelled',
        status: 'cancelled',
        startsAt: '2026-07-10T09:00:00.000Z',
        reminders: [{ id: 'r', minutesBefore: 5 }],
      }),
    ]
    expect(computeEventReminders(events, now, 24 * 60 * 60 * 1000)).toEqual([])
  })

  it('uses an hour-granularity body for long lead times', () => {
    const reminders = computeEventReminders(
      [
        event({
          id: 'evt',
          startsAt: '2026-07-10T11:00:00.000Z',
          reminders: [{ id: 'r', minutesBefore: 120 }],
        }),
      ],
      now,
      24 * 60 * 60 * 1000,
    )
    expect(reminders[0]?.body).toBe('Starts in 2 hours')
  })
})
