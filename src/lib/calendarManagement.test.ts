import { describe, expect, it } from 'vitest'
import {
  addLocalCalendar,
  removeCalendar,
  setCalendarVisibility,
  updateCalendar,
  visibleCalendarEvents,
} from './calendarModel'
import type { CalendarEvent, CalendarStore } from '../types'

function storeWith(): CalendarStore {
  return {
    accounts: [
      { id: 'acct', provider: 'google', name: 'G', email: 'a@b.example' },
    ],
    sources: [
      { id: 'src', accountId: 'acct', name: 'Google', syncState: 'online' },
    ],
    calendars: [
      {
        id: 'work@example.com',
        sourceId: 'src',
        name: 'Work',
        color: '#4285f4',
        visible: true,
      },
      {
        id: 'team@group.calendar.google.com',
        sourceId: 'src',
        name: 'Team',
        color: '#16a765',
        visible: true,
        readOnly: true,
      },
    ],
    events: [
      event('e1', 'work@example.com', 'Standup', '09:00', '09:30'),
      event(
        'e2',
        'team@group.calendar.google.com',
        'Team sync',
        '10:00',
        '11:00',
      ),
    ],
    tasks: [],
    settings: {},
  }
}

function event(
  id: string,
  calendarId: string,
  title: string,
  from: string,
  to: string,
): CalendarEvent {
  return {
    id,
    calendarId,
    title,
    description: '',
    startsAt: `2026-08-25T${from}:00.000Z`,
    endsAt: `2026-08-25T${to}:00.000Z`,
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
  }
}

const RANGE = {
  start: '2026-08-24T00:00:00.000Z',
  end: '2026-08-31T00:00:00.000Z',
}

describe('calendar management', () => {
  it('hiding a calendar removes only its events from the view', () => {
    const store = setCalendarVisibility(
      storeWith(),
      'team@group.calendar.google.com',
      false,
    )
    const shown = visibleCalendarEvents(store, RANGE.start, RANGE.end)
    expect(shown.map(event => event.id)).toEqual(['e1'])
    // the calendar itself is still listed, just not visible
    expect(store.calendars).toHaveLength(2)
    expect(
      store.calendars.find(c => c.id === 'team@group.calendar.google.com')
        ?.visible,
    ).toBe(false)
  })

  it('renames and recolours without touching anything else', () => {
    const store = updateCalendar(storeWith(), 'work@example.com', {
      name: 'Day job',
      color: '#fa573c',
    })
    const calendar = store.calendars[0]!
    expect(calendar.name).toBe('Day job')
    expect(calendar.color).toBe('#fa573c')
    expect(store.events).toHaveLength(2)
    // an empty patch is a no-op, not a wipe
    const untouched = updateCalendar(store, 'work@example.com', {})
    expect(untouched.calendars[0]!.name).toBe('Day job')
  })

  it('removing drops the calendar, its events, and remembers the id', () => {
    const store = removeCalendar(
      storeWith(),
      'team@group.calendar.google.com',
    )
    expect(store.calendars.map(c => c.id)).toEqual(['work@example.com'])
    expect(store.events.map(e => e.id)).toEqual(['e1'])
    // remembered so the next provider sync does not resurrect it
    expect(store.settings.removedCalendarIds).toContain(
      'team@group.calendar.google.com',
    )
  })

  it('removing a user-added shared calendar also drops it from the fetch list', () => {
    const base = {
      ...storeWith(),
      settings: {
        googleExtraCalendarIds: ['team@group.calendar.google.com', 'other@x'],
      },
    }
    const store = removeCalendar(base, 'team@group.calendar.google.com')
    expect(store.settings.googleExtraCalendarIds).toEqual(['other@x'])
  })

  it('adds a local calendar, visible, with the colour it was given', () => {
    const { store, calendar } = addLocalCalendar(storeWith(), {
      name: 'Side project',
      color: '#7c6ff0',
    })
    expect(calendar.name).toBe('Side project')
    expect(calendar.color).toBe('#7c6ff0')
    expect(calendar.visible).toBe(true)
    expect(store.calendars).toHaveLength(3)
    expect(new Set(store.calendars.map(c => c.id)).size).toBe(3)
  })
})

describe('removing a feed-backed calendar', () => {
  it('also cancels the subscription, so a refresh cannot re-add it', () => {
    const base: CalendarStore = {
      ...storeWith(),
      calendars: [
        ...storeWith().calendars,
        {
          id: 'ics_abc',
          sourceId: 'src_ics',
          name: 'UK holidays',
          color: '#8a8f98',
          visible: true,
          readOnly: true,
        },
      ],
      settings: {
        icsFeeds: [
          { id: 'ics_abc', label: 'UK holidays', url: 'https://x/basic.ics', visible: true },
          { id: 'ics_keep', label: 'Other', url: 'https://y/basic.ics', visible: true },
        ],
      },
    }
    const store = removeCalendar(base, 'ics_abc')
    expect(store.calendars.some(c => c.id === 'ics_abc')).toBe(false)
    expect(store.settings.icsFeeds?.map(f => f.id)).toEqual(['ics_keep'])
  })
})
