import { describe, expect, it } from 'vitest'
import type { TeamCalendarEvent, TeamCalendarListing } from '../bridge/platformBridge'
import { mergeGoogleSnapshot } from '../hooks/usePureCalendarBoot'
import { demoCalendarStore, ensureLocalCalendar, firstEditableCalendarId, removeEventWithTombstone } from './calendarModel'
import { parsePersistedCalendarStore } from './calendarStorePersistence'
import {
  calendarEventFromTeam,
  firstFreeTime,
  mergeTeamPushResult,
  mergeTeamSnapshot,
  teamEventsToSend,
  teamInputFromEvent,
  teammateAddress,
  teamTombstones,
} from './teamCalendar'

const meeting = (patch: Partial<TeamCalendarEvent> = {}): TeamCalendarEvent => ({
  id: 'e1',
  kind: 'meeting',
  title: 'Planning',
  start: '2026-11-02T22:00:00.000Z',
  end: '2026-11-02T23:00:00.000Z',
  allDay: false,
  location: null,
  notes: null,
  team: null,
  attendees: [
    { id: 'ada', name: 'Ada', response: 'yes' },
    { id: 'bo', name: 'Bo', response: 'invited' },
  ],
  createdBy: { id: 'ada', name: 'Ada' },
  revision: 1,
  updatedAt: 1,
  mayEdit: false,
  ...patch,
})
const listing = (events: TeamCalendarEvent[]): TeamCalendarListing => ({
  available: true,
  organisation: 'Pure',
  me: { id: 'bo', name: 'Bo' },
  events,
  people: [{ id: 'ada', name: 'Ada' }, { id: 'bo', name: 'Bo' }],
  teams: [{ id: 'eng', name: 'Engineering' }],
})

describe('the team calendar', () => {
  it('is one more account: the organisation’s calendar and one per team, never the default', () => {
    const { store } = ensureLocalCalendar(demoCalendarStore())
    const merged = mergeTeamSnapshot(store, listing([meeting(), meeting({ id: 'd1', kind: 'date', title: 'Launch', start: '2026-11-10', end: '2026-11-11', allDay: true, attendees: [], team: { id: 'eng', name: 'Engineering' } })]), 'Pacific/Auckland')
    expect(merged.calendars.filter(c => c.id.startsWith('team:')).map(c => c.name)).toEqual(['Pure', 'Engineering'])
    expect(firstEditableCalendarId(merged)).not.toMatch(/^team:/)
    const planning = merged.events.find(e => e.id === 't:e1')!
    expect(planning.calendarId).toBe('team:org')
    expect(planning.attendees.find(a => a.email === teammateAddress('bo'))?.response).toBe('needsAction')
    expect(planning.team).toEqual({ kind: 'meeting', revision: 1, mayEdit: false })
    expect(merged.events.find(e => e.id === 't:d1')?.calendarId).toBe('team:eng')
    expect(merged.accounts.find(a => a.provider === 'team')?.email).toBe(teammateAddress('bo'))
  })

  it('survives a Google refresh, a reload, and goes when the desktop leaves the organisation', () => {
    const merged = mergeTeamSnapshot(demoCalendarStore(), listing([meeting()]), 'UTC')
    expect(mergeGoogleSnapshot(merged, { ...demoCalendarStore(), events: [] }).events.some(e => e.id === 't:e1')).toBe(true)
    const reloaded = parsePersistedCalendarStore(JSON.parse(JSON.stringify(merged)))!
    expect(reloaded.events.find(e => e.id === 't:e1')?.team?.mayEdit).toBe(false)
    expect(reloaded.accounts.find(a => a.id === 'team-account')?.provider).toBe('team')
    const left = mergeTeamSnapshot(merged, { ...listing([]), available: false, me: null }, 'UTC')
    expect(left.calendars.some(c => c.id.startsWith('team:'))).toBe(false)
    expect(left.events.some(e => e.calendarId.startsWith('team:'))).toBe(false)
  })

  it('sends what changed here, keeps it through a refresh, and takes the server’s id', () => {
    const base = mergeTeamSnapshot(demoCalendarStore(), listing([]), 'UTC')
    const draft = {
      ...calendarEventFromTeam(meeting(), 'bo', 'UTC'),
      id: 'event_1',
      calendarId: 'team:eng',
      title: 'Retro',
      startsAt: '2026-11-03T01:00:00.000Z',
      endsAt: '2026-11-03T02:00:00.000Z',
      allDay: false,
      attendees: [{ name: 'Ada', email: teammateAddress('ada'), response: 'needsAction' as const }],
      syncState: 'pending' as const,
      team: { kind: 'meeting' as const, revision: 0, mayEdit: true },
    }
    const pending = { ...base, events: [...base.events, draft] }
    expect(teamEventsToSend(pending).map(e => e.id)).toEqual(['event_1'])
    expect(teamInputFromEvent(draft)).toMatchObject({ kind: 'meeting', teamId: 'eng', attendees: ['ada'], title: 'Retro' })
    expect(teamInputFromEvent(draft)).not.toHaveProperty('id')
    // A refresh while it is on its way keeps it.
    const refreshed = mergeTeamSnapshot(pending, listing([]), 'UTC')
    expect(refreshed.events.find(e => e.id === 'event_1')).toBe(draft)
    const { store, renamed } = mergeTeamPushResult(refreshed, [{ kind: 'saved', sent: draft, event: meeting({ id: 'n1', title: 'Retro', team: { id: 'eng', name: 'Engineering' }, mayEdit: true }), clashes: [] }], 'bo', 'UTC')
    expect(renamed.get('event_1')).toBe('t:n1')
    expect(store.events.find(e => e.id === 't:n1')?.syncState).toBe('synced')
    expect(teamEventsToSend(store)).toEqual([])
  })

  it('removes an event there once it is removed here', () => {
    const merged = mergeTeamSnapshot(demoCalendarStore(), listing([meeting({ mayEdit: true })]), 'UTC')
    const removed = removeEventWithTombstone(merged, 't:e1')
    expect(teamTombstones(removed)).toEqual(['t:e1'])
    expect(mergeTeamSnapshot(removed, listing([meeting()]), 'UTC').events.some(e => e.id === 't:e1')).toBe(false)
    expect(teamTombstones(mergeTeamPushResult(removed, [{ kind: 'removed', id: 't:e1' }], 'bo', 'UTC').store)).toEqual([])
  })

  it('an all-day date is sent as its day where it was set', () => {
    const merged = mergeTeamSnapshot(demoCalendarStore(), listing([]), 'UTC')
    void merged
    const date = { ...calendarEventFromTeam(meeting(), 'bo', 'UTC'), id: 'x', calendarId: 'team:org', title: 'Offsite', allDay: true, startsAt: '2026-11-09T11:00:00.000Z', endsAt: '2026-11-09T11:00:00.000Z', timeZone: 'Pacific/Auckland', attendees: [], team: { kind: 'date' as const, revision: 0, mayEdit: true } }
    expect(teamInputFromEvent(date)).toMatchObject({ kind: 'date', allDay: true, start: '2026-11-10', end: '2026-11-11', attendees: [] })
  })

  it('finds the first time nobody is taken, in available hours', () => {
    const slot = firstFreeTime(
      [{ start: '2026-11-02T09:00:00.000Z', end: '2026-11-02T10:30:00.000Z' }],
      { from: new Date('2026-11-02T08:50:00.000Z'), minutes: 60, workStart: 9, workEnd: 17, days: [1, 2, 3, 4, 5], timeZone: 'UTC' },
    )
    expect(slot).toEqual({ start: '2026-11-02T10:30:00.000Z', end: '2026-11-02T11:30:00.000Z' })
    // Saturday 16:30: past hours, so Monday 09:00.
    expect(firstFreeTime([], { from: new Date('2026-11-07T16:30:00.000Z'), minutes: 30, workStart: 9, workEnd: 17, days: [1, 2, 3, 4, 5], timeZone: 'UTC' })?.start).toBe('2026-11-09T09:00:00.000Z')
  })
})
