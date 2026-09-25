// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import type { MutableRefObject } from 'react'
import type { CalendarEvent, CalendarStore } from '../../types'
import {
  appAgentHandlers,
  setAgentStore,
  setAgentStoreDispatch,
} from './index'

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'evt-1',
    calendarId: 'cal_work',
    title: 'Event',
    description: '',
    startsAt: '2026-08-27T10:00:00.000Z',
    endsAt: '2026-08-27T11:00:00.000Z',
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

function makeStore(events: CalendarEvent[]): CalendarStore {
  return {
    accounts: [],
    sources: [
      { id: 'src_local', accountId: 'acct', name: 'Local', syncState: 'online' },
    ],
    calendars: [
      {
        id: 'cal_work',
        sourceId: 'src_local',
        name: 'Work',
        color: '#111',
        visible: true,
      },
    ],
    events,
    tasks: [],
    settings: {},
  }
}

/** Wires the handler singleton to a live store and returns a live getter. */
function bindStore(initial: CalendarStore): () => CalendarStore {
  let live = initial
  const ref: MutableRefObject<CalendarStore | null> = { current: live }
  setAgentStore(ref)
  setAgentStoreDispatch(updater => {
    live =
      typeof updater === 'function'
        ? (updater as (prev: CalendarStore) => CalendarStore)(live)
        : updater
    ref.current = live
  })
  return () => live
}

function invoke(
  args: Record<string, unknown>,
): { toolCallId: string; shortName: string; arguments: Record<string, unknown> } {
  return { toolCallId: 'call-1', shortName: 'tool', arguments: args }
}

afterEach(() => {
  setAgentStore(null)
  setAgentStoreDispatch(null)
})

describe('updateCalendarEvent time and status handling', () => {
  it('resolves zoneless wall times in the event timezone instead of storing raw strings', async () => {
    const getStore = bindStore(
      makeStore([event({ timeZone: 'Pacific/Auckland' })]),
    )
    const result = await appAgentHandlers.updateCalendarEvent(
      invoke({
        eventId: 'evt-1',
        // Zoneless wall time: belongs to the event's zone (NZST, UTC+12).
        startsAt: '2026-08-27T09:00',
        endsAt: '2026-08-27T10:00',
      }),
    )
    const payload = JSON.parse(result.content) as {
      startsAt: string
      endsAt: string
    }
    expect(payload.startsAt).toBe('2026-08-26T21:00:00.000Z')
    expect(payload.endsAt).toBe('2026-08-26T22:00:00.000Z')
    const stored = getStore().events[0]!
    expect(stored.startsAt).toBe('2026-08-26T21:00:00.000Z')
    expect(stored.syncState).toBe('pending')
  })

  it('rejects an unparseable time instead of storing it', async () => {
    bindStore(makeStore([event({})]))
    const result = await appAgentHandlers.updateCalendarEvent(
      invoke({ eventId: 'evt-1', startsAt: 'next Tuesday-ish' }),
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('not a time')
  })

  it('rejects a status outside the EventStatus union', async () => {
    const getStore = bindStore(makeStore([event({})]))
    const result = await appAgentHandlers.updateCalendarEvent(
      invoke({ eventId: 'evt-1', status: 'maybe' }),
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('confirmed, tentative, cancelled')
    expect(getStore().events[0]!.status).toBe('confirmed')
  })

  it('applies allDayEventPatch when allDay is set, snapping to day boundaries', async () => {
    const getStore = bindStore(makeStore([event({})]))
    const result = await appAgentHandlers.updateCalendarEvent(
      invoke({ eventId: 'evt-1', allDay: true }),
    )
    const payload = JSON.parse(result.content) as { allDay: boolean }
    expect(payload.allDay).toBe(true)
    const stored = getStore().events[0]!
    expect(stored.allDay).toBe(true)
    // 10:00-11:00 UTC snaps to the full UTC day.
    expect(stored.startsAt).toBe('2026-08-27T00:00:00.000Z')
    expect(stored.endsAt).toBe('2026-08-28T00:00:00.000Z')
  })
})

describe('rescheduleCalendarEvent time handling', () => {
  it('resolves a bare date in the event timezone (all-day-style midnight)', async () => {
    const getStore = bindStore(
      makeStore([event({ timeZone: 'Pacific/Auckland' })]),
    )
    const result = await appAgentHandlers.rescheduleCalendarEvent(
      invoke({ eventId: 'evt-1', startsAt: '2026-08-28' }),
    )
    const payload = JSON.parse(result.content) as { startsAt: string }
    // Midnight Auckland, not UTC midnight (which would be the previous day).
    expect(payload.startsAt).toBe('2026-08-27T12:00:00.000Z')
    expect(getStore().events[0]!.startsAt).toBe('2026-08-27T12:00:00.000Z')
  })

  it('rejects an unparseable startsAt', async () => {
    bindStore(makeStore([event({})]))
    const result = await appAgentHandlers.rescheduleCalendarEvent(
      invoke({ eventId: 'evt-1', startsAt: 'soon' }),
    )
    expect(result.isError).toBe(true)
  })
})

describe('deleteCalendarEvent', () => {
  it('removes the event, tombstones provider-backed ids, and reports truthfully', async () => {
    const store = makeStore([
      event({ id: 'g:cal_work:evt-9' }),
      event({ id: 'evt-local' }),
    ])
    const getStore = bindStore(store)

    const result = await appAgentHandlers.deleteCalendarEvent(
      invoke({ eventId: 'g:cal_work:evt-9' }),
    )
    const payload = JSON.parse(result.content) as {
      id: string
      removed: boolean
      providerDeleteQueued: boolean
    }
    // The old handler reported status 'cancelled' while only filtering the
    // local list; the report now matches what actually happened.
    expect(payload).toEqual({
      id: 'g:cal_work:evt-9',
      removed: true,
      providerDeleteQueued: true,
    })
    expect(
      getStore().events.some(item => item.id === 'g:cal_work:evt-9'),
    ).toBe(false)
    expect(getStore().removedEventIds).toEqual(['g:cal_work:evt-9'])

    const localResult = await appAgentHandlers.deleteCalendarEvent(
      invoke({ eventId: 'evt-local' }),
    )
    const localPayload = JSON.parse(localResult.content) as {
      providerDeleteQueued: boolean
    }
    expect(localPayload.providerDeleteQueued).toBe(false)
    expect(getStore().events).toHaveLength(0)
    // Still only the provider-backed tombstone.
    expect(getStore().removedEventIds).toEqual(['g:cal_work:evt-9'])
  })
})
