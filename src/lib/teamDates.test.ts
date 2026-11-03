import { describe, expect, it } from 'vitest'
import { addTeamDate, readTeamDate } from './teamDates'
import { ensureLocalCalendar } from './calendarModel'
import type { CalendarStore } from '../types'

const empty = { calendars: [], sources: [], events: [], accounts: [], tasks: [] } as unknown as CalendarStore
const request = { key: 'dec-1', title: 'Tax registration', date: '2027-01-12', warningDays: [30, 7], description: 'Gusto says this is due.', by: 'CFO' }

describe('a date agreed in the Executive app', () => {
  it('reads what the app left, and nothing else', () => {
    expect(readTeamDate(JSON.stringify({ v: 1, ...request }), 'dec-1')).toEqual(request)
    expect(readTeamDate(JSON.stringify({ v: 1, ...request }), 'other')).toBeNull()
    expect(readTeamDate(JSON.stringify({ v: 1, ...request, date: 'soon' }), 'dec-1')).toBeNull()
    expect(readTeamDate('not json', 'dec-1')).toBeNull()
  })

  it('becomes a whole-day event with its warnings, marked free, saying who added it', () => {
    const { store, eventId } = addTeamDate(ensureLocalCalendar(empty).store, request)
    const event = store.events.find(e => e.id === eventId)!
    expect(event).toMatchObject({ title: 'Tax registration', allDay: true, lifecycle: 'active', status: 'confirmed', busyStatus: 'free' })
    expect(event.reminders.map(r => r.minutesBefore)).toEqual([43200, 10080])
    expect(event.description).toContain('Gusto says this is due.')
    expect(event.description).toContain('Added by CFO when you agreed.')
    expect(event.startsAt.slice(0, 7)).toBe('2027-01')
  })

  it('is added once, however many times it is asked for', () => {
    const first = addTeamDate(ensureLocalCalendar(empty).store, request)
    const again = addTeamDate(first.store, request)
    expect(again.eventId).toBe(first.eventId)
    expect(again.store.events).toHaveLength(1)
  })

  it('makes a calendar on this computer if there is none', () => {
    const { store } = addTeamDate(empty, request)
    expect(store.events).toHaveLength(1)
    expect(store.calendars.length).toBeGreaterThan(0)
  })
})
