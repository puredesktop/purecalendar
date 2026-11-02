import { describe, expect, it } from 'vitest'
import { organisationRoots, sameAvailability, teamAvailability } from './teamAvailability'
import type { CalendarStore } from '../types'

const event = (id: string, over: Record<string, unknown> = {}) => ({ id, calendarId: 'c', title: 'Private title', description: 'Secret', location: 'Somewhere', attendees: [{ email: 'x@example.com' }], startsAt: '2026-11-03T10:00:00.000Z', endsAt: '2026-11-03T11:00:00.000Z', timeZone: 'UTC', allDay: false, status: 'confirmed', busyStatus: 'busy', source: 'provider', ...over })
const store = (events: unknown[], settings = {}) => ({ calendars: [{ id: 'c', visible: true }, { id: 'hidden', visible: false }], events, tasks: [], accounts: [], sources: [], settings: { workStart: 9, workEnd: 17, availableDays: [1, 2, 3, 4, 5], timeZoneMode: 'fixed', timeZone: 'Europe/London', ...settings } }) as unknown as CalendarStore
const now = new Date('2026-11-02T12:00:00.000Z')

describe('what the team may read of the calendar', () => {
  it('gives times and working hours, and nothing about what an event is', () => {
    const shared = teamAvailability(store([event('a')]), now)
    expect(shared).toMatchObject({ v: 1, timeZone: 'Europe/London', workStart: 9, workEnd: 17, availableDays: [1, 2, 3, 4, 5], events: 1 })
    expect(shared.busy).toEqual([{ startsAt: '2026-11-03T10:00:00.000Z', endsAt: '2026-11-03T11:00:00.000Z' }])
    expect(JSON.stringify(shared)).not.toMatch(/Private title|Secret|Somewhere|example\.com/)
  })
  it('leaves out demo, free, cancelled, hidden and far-off events', () => {
    const shared = teamAvailability(store([event('demo', { source: 'demo' }), event('free', { busyStatus: 'free' }), event('off', { status: 'cancelled' }), event('hidden', { calendarId: 'hidden' }), event('far', { startsAt: '2027-03-01T10:00:00.000Z', endsAt: '2027-03-01T11:00:00.000Z' })]), now)
    expect(shared.busy).toEqual([])
    // demo events do not count as connected, so an empty result can say so
    expect(shared.events).toBe(4)
    expect(teamAvailability(store([event('demo', { source: 'demo' })]), now).events).toBe(0)
  })
})

it('looks in the workspace and each organisation, once each', () => {
  expect(organisationRoots({ orgs: [{ folder: '/a' }, { folder: '/a' }, { folder: 7 }, { folder: 'relative' }] }, '/w')).toEqual(['/w', '/a'])
  expect(organisationRoots(null)).toEqual([])
})

it('does not count a new time stamp as a change', () => {
  expect(sameAvailability('{"at":"1","busy":[]}', '{"at":"2","busy":[]}')).toBe(true)
  expect(sameAvailability('{"at":"1","busy":[]}', '{"at":"2","busy":[1]}')).toBe(false)
  expect(sameAvailability(null, '{"at":"2"}')).toBe(false)
})
