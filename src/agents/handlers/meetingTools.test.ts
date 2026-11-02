// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MutableRefObject } from 'react'
import type { CalendarEvent, CalendarStore } from '../../types'

const bridge = vi.hoisted(() => ({
  recordOperation: vi.fn(async () => undefined),
  teamCalendarOffered: vi.fn(() => false),
  teamCalendar: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    respond: vi.fn(),
    remove: vi.fn(),
    busy: vi.fn(),
  },
}))
vi.mock('../../bridge/platformBridge', () => bridge)

const { appAgentHandlers, setAgentStore, setAgentStoreDispatch, setMeetingSources } = await import('./index')
const { meetingDraftFlow } = await import('../../lib/meetingTimes')

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'evt',
    calendarId: 'cal_work',
    title: 'Board review',
    description: 'Confidential',
    startsAt: '2030-01-07T10:00:00.000Z',
    endsAt: '2030-01-07T11:00:00.000Z',
    timeZone: 'UTC',
    allDay: false,
    status: 'confirmed',
    visibility: 'default',
    busyStatus: 'busy',
    attendees: [{ name: 'Guest', email: 'guest@example.com', response: 'accepted' }],
    reminders: [],
    attachments: [],
    linkedItems: [],
    source: 'provider',
    syncState: 'synced',
    ...overrides,
  }
}

function makeStore(events: CalendarEvent[] = [], extra: Partial<CalendarStore> = {}): CalendarStore {
  return {
    accounts: [{ id: 'acct', provider: 'google', name: 'Work', email: 'me@example.com' }],
    sources: [{ id: 'src', accountId: 'acct', name: 'Work', syncState: 'online' }],
    calendars: [{ id: 'cal_work', sourceId: 'src', name: 'Work', color: '#111', visible: true }],
    events,
    tasks: [],
    settings: { timeZoneMode: 'fixed', timeZone: 'UTC', availableDays: [1, 2, 3, 4, 5], availableStartHour: 9, availableEndHour: 17 },
    ...extra,
  }
}

let dispatches = 0
function bindStore(initial: CalendarStore): { get: () => CalendarStore; set: (next: CalendarStore) => void } {
  let live = initial
  const ref: MutableRefObject<CalendarStore | null> = { current: live }
  setAgentStore(ref)
  setAgentStoreDispatch(updater => {
    dispatches += 1
    live = typeof updater === 'function' ? (updater as (prev: CalendarStore) => CalendarStore)(live) : updater
    ref.current = live
  })
  return {
    get: () => live,
    set: next => {
      live = next
      ref.current = next
    },
  }
}

const call = (args: Record<string, unknown>) => ({ toolCallId: 'call-1', shortName: 'tool', arguments: args })
// Monday 7 – Friday 11 January 2030 (UTC), well in the future.
const request = { title: 'Roadmap', durationMinutes: 60, from: '2030-01-07', to: '2030-01-11', bufferAfterMinutes: 15 }

beforeEach(() => {
  dispatches = 0
  meetingDraftFlow.forget()
  setMeetingSources({ readOwner: null, busyReader: undefined })
  vi.clearAllMocks()
  bridge.teamCalendarOffered.mockReturnValue(false)
})
afterEach(() => {
  setAgentStore(null)
  setAgentStoreDispatch(null)
})

describe('findMeetingTimes tool', () => {
  it('refuses an invalid request with the reasons and writes nothing', async () => {
    const store = bindStore(makeStore())
    const result = await appAgentHandlers.findMeetingTimes(call({ ...request, durationMinutes: 0, bufferBeforeMinutes: -5, participants: [{ name: 'Ana', timeZone: 'Nowhere/City' }] }))
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Duration must be more than 0 minutes')
    expect(result.content).toContain('cannot be negative')
    expect(result.content).toContain('not a recognised time zone')
    expect(dispatches).toBe(0)
    expect(store.get().events).toHaveLength(0)
  })

  it('explains when no time is suitable', async () => {
    bindStore(makeStore([event({ id: 'all', allDay: true, startsAt: '2030-01-07', endsAt: '2030-01-12' })]))
    const result = await appAgentHandlers.findMeetingTimes(call(request))
    const payload = JSON.parse(result.content) as { options: unknown[]; shortfall: string; proposalText: string }
    expect(payload.options).toEqual([])
    expect(payload.shortfall).toContain('No time qualifies')
    expect(payload.proposalText).toContain('Could you suggest a few times')
  })

  it('labels other people\'s availability unknown and keeps other events out of the wording', async () => {
    bindStore(makeStore([event({})]))
    const result = await appAgentHandlers.findMeetingTimes(
      call({ ...request, participants: [{ name: 'Ana', email: 'ana@example.com', timeZone: 'America/New_York' }] }),
    )
    const payload = JSON.parse(result.content) as {
      options: Array<{ participants: Array<{ availability: string; localTime: string }>; benefits: string[]; tradeOffs: string[] }>
      availability: string[]
      proposalText: string
    }
    expect(payload.options).toHaveLength(3)
    for (const option of payload.options) {
      expect(option.participants[0]!.availability).toBe('unknown')
      expect(option.participants[0]!.localTime).toContain('America/New_York (GMT-05:00)')
    }
    expect(payload.availability[0]).toContain('availability unknown')
    expect(payload.proposalText).toContain("I can't see Ana's calendar")
    expect(result.content).not.toContain('Board review')
    expect(result.content).not.toContain('Confidential')
    expect(bridge.teamCalendar.busy).not.toHaveBeenCalled()
  })

  it('uses teammates\' team-calendar free/busy when it is offered', async () => {
    bindStore(makeStore())
    bridge.teamCalendarOffered.mockReturnValue(true)
    bridge.teamCalendar.busy.mockResolvedValue({ busy: [{ id: 'p-ben', name: 'Ben', times: [{ start: '2030-01-07T00:00:00Z', end: '2030-01-10T00:00:00Z' }] }] })
    const result = await appAgentHandlers.findMeetingTimes(call({ ...request, participants: [{ name: 'Ben', email: 'p-ben@team.invalid', timeZone: 'UTC' }] }))
    const payload = JSON.parse(result.content) as { options: Array<{ startsAt: string; participants: Array<{ availability: string }> }> }
    expect(bridge.teamCalendar.busy).toHaveBeenCalledWith(['p-ben'], expect.any(String), expect.any(String))
    for (const option of payload.options) {
      expect(Date.parse(option.startsAt)).toBeGreaterThanOrEqual(Date.parse('2030-01-10T00:00:00Z'))
      expect(option.participants[0]!.availability).toBe('free')
    }
  })

  it('refuses when the owner\'s calendar failed to load instead of suggesting free times', async () => {
    bindStore(makeStore([], { failedCalendarIds: ['cal_work'] }))
    const result = await appAgentHandlers.findMeetingTimes(call(request))
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Work could not be read')
  })
})

describe('createMeetingDraft tool', () => {
  it('creates one private draft at the chosen time, and never twice', async () => {
    const existing = event({ id: 'keep' })
    const store = bindStore(makeStore([existing]))
    const found = JSON.parse((await appAgentHandlers.findMeetingTimes(call({ ...request, participants: [{ name: 'Ana', email: 'ana@example.com', timeZone: 'Europe/Berlin' }] }))).content) as {
      options: Array<{ startsAt: string; endsAt: string }>
    }
    const chosen = found.options[1]!
    const args = { ...request, participants: [{ name: 'Ana', email: 'ana@example.com', timeZone: 'Europe/Berlin' }], startsAt: chosen.startsAt }
    const [first, second] = await Promise.all([appAgentHandlers.createMeetingDraft(call(args)), appAgentHandlers.createMeetingDraft(call(args))])
    const third = await appAgentHandlers.createMeetingDraft(call(args))
    const a = JSON.parse(first.content) as { id: string; created: boolean; lifecycle: string; startsAt: string; endsAt: string; attendeesListed: string[]; summary: string }
    const b = JSON.parse(second.content) as { id: string; created: boolean }
    const c = JSON.parse(third.content) as { id: string; created: boolean }
    expect(a.created).toBe(true)
    expect([b.created, c.created]).toEqual([false, false])
    expect(new Set([a.id, b.id, c.id]).size).toBe(1)
    expect(a.lifecycle).toBe('draft')
    expect(a.startsAt).toBe(chosen.startsAt)
    expect(a.endsAt).toBe(chosen.endsAt)
    expect(Date.parse(a.endsAt) - Date.parse(a.startsAt)).toBe(60 * 60_000)
    expect(a.attendeesListed).toEqual(['ana@example.com'])
    expect(a.summary).toContain('listed, not invited')

    const events = store.get().events
    expect(events).toHaveLength(2)
    expect(events.find(item => item.id === 'keep')).toEqual(existing)
    const draft = events.find(item => item.id === a.id)!
    expect(draft.lifecycle).toBe('draft')
    expect(draft.attendees.every(attendee => attendee.response === 'needsAction')).toBe(true)
    // Nothing sent: no activation, no team-calendar write, only the one draft creation in the ledger.
    expect(bridge.recordOperation).toHaveBeenCalledTimes(1)
    expect(bridge.recordOperation).toHaveBeenCalledWith(expect.objectContaining({ kind: 'calendar.event.create' }))
    for (const write of [bridge.teamCalendar.create, bridge.teamCalendar.update, bridge.teamCalendar.respond, bridge.teamCalendar.remove]) {
      expect(write).not.toHaveBeenCalled()
    }
  })

  it('refuses a selection that now conflicts, and creates nothing', async () => {
    const store = bindStore(makeStore())
    const found = JSON.parse((await appAgentHandlers.findMeetingTimes(call(request))).content) as { options: Array<{ startsAt: string; endsAt: string }> }
    const chosen = found.options[0]!
    store.set(makeStore([event({ id: 'late-arrival', startsAt: chosen.startsAt, endsAt: chosen.endsAt })]))
    const result = await appAgentHandlers.createMeetingDraft(call({ ...request, startsAt: chosen.startsAt }))
    expect(result.isError).toBe(true)
    expect(result.content).toContain('No draft was made — search again')
    expect(store.get().events.map(item => item.id)).toEqual(['late-arrival'])
    expect(bridge.recordOperation).not.toHaveBeenCalled()
  })

  it('refuses when a teammate\'s free/busy cannot be re-read', async () => {
    const store = bindStore(makeStore())
    const busyReader = vi.fn(async () => [{ id: 'p-ben', name: 'Ben', times: [] }])
    setMeetingSources({ readOwner: null, busyReader })
    const participants = [{ name: 'Ben', email: 'p-ben@team.invalid', timeZone: 'UTC' }]
    const found = JSON.parse((await appAgentHandlers.findMeetingTimes(call({ ...request, participants }))).content) as { options: Array<{ startsAt: string }> }
    busyReader.mockRejectedValueOnce(new Error('team server unreachable'))
    const result = await appAgentHandlers.createMeetingDraft(call({ ...request, participants, startsAt: found.options[0]!.startsAt }))
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Could not re-check Ben (team server unreachable)')
    expect(store.get().events).toHaveLength(0)
  })

  it('still re-checks a teammate whose free/busy qualified the time after the connection has gone', async () => {
    const store = bindStore(makeStore())
    setMeetingSources({ readOwner: null, busyReader: vi.fn(async () => [{ id: 'p-ben', name: 'Ben', times: [] }]) })
    const participants = [{ name: 'Ben', email: 'p-ben@team.invalid', timeZone: 'UTC' }]
    const found = JSON.parse((await appAgentHandlers.findMeetingTimes(call({ ...request, participants }))).content) as {
      options: Array<{ startsAt: string; participants: Array<{ availability: string }> }>
    }
    expect(found.options[0]!.participants[0]!.availability).toBe('free')
    setMeetingSources({ readOwner: null, busyReader: null })
    const result = await appAgentHandlers.createMeetingDraft(call({ ...request, participants, startsAt: found.options[0]!.startsAt }))
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Could not re-check Ben (the team calendar is not connected here)')
    expect(store.get().events).toHaveLength(0)
  })

  it('refuses when the owner\'s calendar cannot be re-read', async () => {
    const store = bindStore(makeStore())
    const found = JSON.parse((await appAgentHandlers.findMeetingTimes(call(request))).content) as { options: Array<{ startsAt: string }> }
    setMeetingSources({
      readOwner: async () => {
        throw new Error('Google did not answer')
      },
      busyReader: null,
    })
    const result = await appAgentHandlers.createMeetingDraft(call({ ...request, startsAt: found.options[0]!.startsAt }))
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Google did not answer')
    expect(store.get().events).toHaveLength(0)
  })

  it('brings a calendar the re-read just found into the app with the draft', async () => {
    const store = bindStore(makeStore())
    // The re-read finds a Google calendar the app's state does not have yet, and the draft goes to it.
    const refreshed: CalendarStore = {
      ...makeStore(),
      accounts: [...makeStore().accounts, { id: 'google-account', provider: 'google', name: 'Google', email: 'me@gmail.com' }],
      sources: [...makeStore().sources, { id: 'google-source', accountId: 'google-account', name: 'Google', syncState: 'online' }],
      calendars: [{ id: 'new-primary', sourceId: 'google-source', name: 'Primary', color: '#4285f4', visible: true }, ...makeStore().calendars],
    }
    setMeetingSources({ readOwner: async () => ({ store: refreshed, timeZone: 'UTC' }), busyReader: null })
    const found = JSON.parse((await appAgentHandlers.findMeetingTimes(call(request))).content) as { options: Array<{ startsAt: string }> }
    // Something else changed the app meanwhile; it must survive the save.
    store.set({ ...store.get(), events: [event({ id: 'meanwhile', startsAt: '2030-02-01T10:00:00.000Z', endsAt: '2030-02-01T11:00:00.000Z' })] })
    const result = await appAgentHandlers.createMeetingDraft(call({ ...request, startsAt: found.options[0]!.startsAt }))
    const created = JSON.parse(result.content) as { id: string; calendarId: string }
    expect(created.calendarId).toBe('new-primary')
    const saved = store.get()
    expect(saved.calendars.map(calendar => calendar.id)).toEqual(['cal_work', 'new-primary'])
    expect(saved.sources.some(source => source.id === 'google-source')).toBe(true)
    expect(saved.accounts.some(account => account.id === 'google-account')).toBe(true)
    expect(saved.events.map(item => item.id)).toEqual(['meanwhile', created.id])
  })

  it('validates before anything else', async () => {
    const store = bindStore(makeStore())
    const missing = await appAgentHandlers.createMeetingDraft(call(request))
    expect(missing.isError).toBe(true)
    expect(missing.content).toContain('startsAt is required')
    const reversed = await appAgentHandlers.createMeetingDraft(call({ ...request, from: '2030-01-11', to: '2030-01-07', startsAt: '2030-01-08T09:00:00Z' }))
    expect(reversed.isError).toBe(true)
    expect(reversed.content).toContain('before the first day')
    expect(store.get().events).toHaveLength(0)
  })
})
