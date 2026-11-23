// @vitest-environment happy-dom
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import type { MutableRefObject } from 'react'
import { resolveCalendarTimeZone } from '../lib/calendarModel'
import type { CalendarEvent, CalendarStore, CalendarTask } from '../types'
import { PURECALENDAR_ATOMIC_TOOL_SCHEMAS } from './atomicToolSchemas'
import {
  APP_AGENT_TOOL_NAMES,
  EXPOSED_TOOL_NAMES,
  PURECALENDAR_ALL_ATOMIC_TOOL_NAMES,
  PURECALENDAR_CORE_TOOL_NAMES,
  PURECALENDAR_EXTENDED_TOOL_NAMES,
  PURECALENDAR_FUNCTION_NAMES,
  PURECALENDAR_META_TOOL_NAMES,
} from './catalog'
import {
  AgentCalendarToolError,
  setAgentStore,
  setAgentStoreDispatch,
  setMeetingSources,
  type CalendarAgentToolContext,
} from './handlers'
import {
  PURECALENDAR_OPERATIONS_REGISTRY,
  buildPureCalendarHandlers,
} from './operationsRegistry'

const FIXED_NOW = new Date('2030-01-06T08:00:00.000Z') // Sunday 2030-01-06 UTC

const RELEASE_VERBS = new Set([
  'send',
  'sends',
  'sending',
  'merge',
  'merges',
  'merging',
  'publish',
  'publishes',
  'publishing',
  'deposit',
  'deposits',
  'depositing',
  'deploy',
  'deploys',
  'deploying',
  'post',
  'posts',
  'posting',
])

const invoke = (shortName: string, args: Record<string, unknown> = {}) => ({
  toolCallId: `tc_${shortName}`,
  shortName,
  arguments: args,
})

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt-1',
    calendarId: 'cal_work',
    title: 'Planning Sync',
    description: 'Weekly review',
    startsAt: '2030-01-07T10:00:00.000Z',
    endsAt: '2030-01-07T11:00:00.000Z',
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

function makeTask(overrides: Partial<CalendarTask> = {}): CalendarTask {
  return {
    id: 'task-1',
    calendarId: 'cal_work',
    title: 'Prepare board slides',
    scheduledStart: '2030-01-07T15:00:00.000Z',
    scheduledEnd: '2030-01-07T16:00:00.000Z',
    sourceLabel: 'Tasks',
    status: 'open',
    syncState: 'synced',
    ...overrides,
  }
}

function makeStore(
  events: CalendarEvent[] = [],
  extra: Partial<CalendarStore> = {},
): CalendarStore {
  return {
    accounts: [
      { id: 'acct_1', provider: 'google', name: 'Work', email: 'me@example.com' },
    ],
    sources: [
      { id: 'src_1', accountId: 'acct_1', name: 'Work', syncState: 'online' },
    ],
    calendars: [
      {
        id: 'cal_work',
        sourceId: 'src_1',
        name: 'Work',
        color: '#2563eb',
        visible: true,
      },
      {
        id: 'cal_holidays',
        sourceId: 'src_1',
        name: 'Holidays',
        color: '#64748b',
        visible: true,
        readOnly: true,
      },
    ],
    events,
    tasks: [],
    settings: {
      timeZoneMode: 'fixed',
      timeZone: 'UTC',
      availableDays: [1, 2, 3, 4, 5],
      availableStartHour: 9,
      availableEndHour: 17,
      savedContacts: [
        {
          id: 'sc-ana',
          name: 'Ana Silva',
          email: 'ana@example.com',
          timeZone: 'Europe/Berlin',
        },
      ],
    },
    ...extra,
  }
}

function createHarness(
  initial: CalendarStore,
  options: {
    now?: Date
    readOwnerNow?: CalendarAgentToolContext['readOwnerNow']
    busyReader?: CalendarAgentToolContext['getBusyReader']
  } = {},
) {
  let live = initial
  const ref: MutableRefObject<CalendarStore | null> = { current: live }
  const ops: Array<{ kind: string; summary: string }> = []
  const searchQualification = new Map()

  const applyStore = (updater: CalendarStore | ((prev: CalendarStore) => CalendarStore)) => {
    live = typeof updater === 'function' ? updater(live) : updater
    ref.current = live
  }

  // Wire module-level singletons too so atomic runners & extended tools share live state
  setAgentStore(ref)
  setAgentStoreDispatch(applyStore)
  setMeetingSources({
    readOwner: options.readOwnerNow ?? null,
    busyReader: options.busyReader ? options.busyReader() : null,
  })

  const ctx: CalendarAgentToolContext = {
    getStore: () => live,
    commitEvents: (store, change) => {
      live = { ...store, events: change(store.events) }
      ref.current = live
    },
    commitStore: (store, change) => {
      live = change(store)
      ref.current = live
    },
    recordOperation: (kind, summary) => {
      ops.push({ kind, summary })
    },
    readOwnerNow:
      options.readOwnerNow ??
      (async () => ({
        store: live,
        timeZone: resolveCalendarTimeZone(live.settings).timeZone,
      })),
    getBusyReader: options.busyReader ?? (() => null),
    searchQualification,
    now: () => options.now ?? FIXED_NOW,
  }

  const handlers = buildPureCalendarHandlers(() => ctx)
  return {
    handlers,
    ctx,
    getStore: () => live,
    setStore: (next: CalendarStore) => {
      live = next
      ref.current = live
    },
    ops,
  }
}

afterEach(() => {
  setAgentStore(null)
  setAgentStoreDispatch(null)
  setMeetingSources({ readOwner: null, busyReader: undefined })
})

describe('PureCalendar operations registry invariants & plugin.json sync', () => {
  it('preserves all 10 atomic tools across core + extended tiers with 4 functions and 3 meta-tools', () => {
    const audit = PURECALENDAR_OPERATIONS_REGISTRY.auditSummary()
    expect(audit).toEqual({
      appSlug: 'calendar',
      functions: 4,
      coreTools: 6,
      extendedTools: 4,
      metaTools: 3,
      totalExposed: 13,
      totalAtomicTools: 10,
      totalRegistered: 14,
      schemaReductionPercent: -30,
    })

    expect(PURECALENDAR_ATOMIC_TOOL_SCHEMAS).toHaveLength(10)
    expect(PURECALENDAR_OPERATIONS_REGISTRY.exposedToolNames).toEqual([
      ...EXPOSED_TOOL_NAMES,
    ])
    expect(APP_AGENT_TOOL_NAMES).toEqual(EXPOSED_TOOL_NAMES)
    expect(PURECALENDAR_OPERATIONS_REGISTRY.extendedToolNames).toEqual([
      ...PURECALENDAR_EXTENDED_TOOL_NAMES,
    ])
    expect(PURECALENDAR_OPERATIONS_REGISTRY.allAtomicToolNames).toEqual([
      ...PURECALENDAR_ALL_ATOMIC_TOOL_NAMES,
    ])
    expect(PURECALENDAR_FUNCTION_NAMES).toHaveLength(4)
    expect(PURECALENDAR_CORE_TOOL_NAMES).toHaveLength(6)
    expect(PURECALENDAR_META_TOOL_NAMES).toHaveLength(3)
  })

  it('keeps all release and release-escalating riskWhen tools directly exposed (never extended)', () => {
    const extendedSet = new Set(PURECALENDAR_OPERATIONS_REGISTRY.extendedToolNames)
    for (const tool of PURECALENDAR_ATOMIC_TOOL_SCHEMAS) {
      const hasElevatedRiskWhen =
        tool.riskWhen &&
        Object.values(tool.riskWhen).some(
          r => r === 'release' || r === 'external' || r === 'destructive',
        )
      if (
        tool.risk === 'release' ||
        tool.risk === 'external' ||
        tool.deletesPermanently ||
        hasElevatedRiskWhen
      ) {
        expect(tool.exposure).toBe('always')
        expect(extendedSet.has(tool.name)).toBe(false)
      }
    }
  })

  it('keeps plugin.json app.agents.tools 1:1 in sync with manifestTools and satisfies manifest checks', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(process.cwd(), 'plugin.json'), 'utf8'),
    ) as {
      app: {
        agents: {
          tools: Array<{
            name: string
            risk?: string
            requiresApproval?: boolean
            description?: string
            inputSchema?: Record<string, unknown>
          }>
        }
      }
    }

    expect(manifest.app.agents.tools).toEqual(
      PURECALENDAR_OPERATIONS_REGISTRY.manifestTools,
    )

    for (const tool of manifest.app.agents.tools) {
      expect(['read', 'write', 'destructive', 'external', 'release']).toContain(
        tool.risk,
      )
      expect(typeof tool.requiresApproval).toBe('boolean')
      const desc = (tool.description ?? '').trim().replace(/\s+/g, ' ')
      expect(desc.length, `${tool.name} description too short`).toBeGreaterThanOrEqual(80)

      if (tool.risk !== 'release') {
        const nameFirst =
          tool.name
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .split(/[^A-Za-z]+/)
            .find(Boolean)
            ?.toLowerCase() ?? ''
        const descFirst =
          desc
            .split(/[^A-Za-z]+/)
            .find(Boolean)
            ?.toLowerCase() ?? ''
        expect(RELEASE_VERBS.has(nameFirst), `${tool.name} starts with release verb`).toBe(false)
        expect(RELEASE_VERBS.has(descFirst), `${tool.name} description starts with release verb`).toBe(false)
      }
    }
  })
})

describe('Escape-hatch meta-tools: discoverAppTools, callExtendedReadTool, callExtendedTool', () => {
  it('discovers extended tools by category, keyword query, exact names, and includeFunctions', async () => {
    const { handlers } = createHarness(makeStore())

    const allExtended = JSON.parse(
      (await handlers.discoverAppTools!(invoke('discoverAppTools'))).content,
    ) as {
      categories: string[]
      operations: Array<{ name: string; invokeVia: string }>
    }
    expect(allExtended.categories).toEqual(['discovery', 'scheduling', 'settings'])
    expect(allExtended.operations.map(o => o.name).sort()).toEqual([
      'createMeetingDraft',
      'findMeetingTimes',
      'getCalendarSettings',
      'searchCalendar',
    ])
    expect(
      allExtended.operations.find(o => o.name === 'getCalendarSettings')?.invokeVia,
    ).toBe('callExtendedReadTool')
    expect(
      allExtended.operations.find(o => o.name === 'createMeetingDraft')?.invokeVia,
    ).toBe('callExtendedTool')

    const byCat = JSON.parse(
      (
        await handlers.discoverAppTools!(
          invoke('discoverAppTools', { category: 'scheduling' }),
        )
      ).content,
    ) as { operations: Array<{ name: string }> }
    expect(byCat.operations.map(o => o.name).sort()).toEqual([
      'createMeetingDraft',
      'findMeetingTimes',
    ])

    const byName = JSON.parse(
      (
        await handlers.discoverAppTools!(
          invoke('discoverAppTools', {
            names: ['searchCalendar', 'fn_scheduleBriefing', 'nonexistentTool'],
          }),
        )
      ).content,
    ) as {
      mode: string
      operations: Array<{ name: string; found: boolean; invokeVia?: string; inputSchema?: unknown }>
    }
    expect(byName.mode).toBe('describe')
    expect(byName.operations[0]).toMatchObject({
      name: 'searchCalendar',
      found: true,
      invokeVia: 'callExtendedReadTool',
    })
    expect(byName.operations[0]?.inputSchema).toBeTruthy()
    expect(byName.operations[1]).toMatchObject({
      name: 'fn_scheduleBriefing',
      found: true,
      invokeVia: 'direct',
    })
    expect(byName.operations[2]).toMatchObject({
      name: 'nonexistentTool',
      found: false,
    })

    const withFns = JSON.parse(
      (
        await handlers.discoverAppTools!(
          invoke('discoverAppTools', { includeFunctions: true }),
        )
      ).content,
    ) as { totalMatched: number }
    expect(withFns.totalMatched).toBe(14)
  })

  it('routes read-only extended tools through callExtendedReadTool and refuses writes/direct/unknown', async () => {
    const { handlers } = createHarness(
      makeStore([makeEvent({ id: 'evt-alpha', title: 'Quarterly Budget Sync' })]),
    )

    const settingsRes = await handlers.callExtendedReadTool!(
      invoke('callExtendedReadTool', { tool: 'getCalendarSettings', arguments: {} }),
    )
    const settingsPayload = JSON.parse(settingsRes.content) as {
      timeZone: string
      defaultCalendarId: string
    }
    expect(settingsPayload.timeZone).toBe('UTC')
    expect(settingsPayload.defaultCalendarId).toBe('cal_work')

    const searchRes = await handlers.callExtendedReadTool!(
      invoke('callExtendedReadTool', {
        tool: 'searchCalendar',
        arguments: { query: 'Budget' },
      }),
    )
    const searchPayload = JSON.parse(searchRes.content) as {
      results: Array<{ title: string }>
    }
    expect(searchPayload.results.some(r => r.title === 'Quarterly Budget Sync')).toBe(true)

    const findRes = await handlers.callExtendedReadTool!(
      invoke('callExtendedReadTool', {
        tool: 'findMeetingTimes',
        arguments: {
          title: 'Quick Sync',
          durationMinutes: 30,
          from: '2030-01-07',
          to: '2030-01-08',
        },
      }),
    )
    const findPayload = JSON.parse(findRes.content) as { options: unknown[] }
    expect(findPayload.options.length).toBeGreaterThan(0)

    await expect(
      handlers.callExtendedReadTool!(
        invoke('callExtendedReadTool', { tool: 'createMeetingDraft', arguments: {} }),
      ),
    ).rejects.toThrow(/cannot run through callExtendedReadTool/)

    await expect(
      handlers.callExtendedReadTool!(
        invoke('callExtendedReadTool', { tool: 'listCalendarEvents', arguments: {} }),
      ),
    ).rejects.toThrow(/already directly exposed/)

    await expect(
      handlers.callExtendedReadTool!(
        invoke('callExtendedReadTool', { tool: 'doesNotExist', arguments: {} }),
      ),
    ).rejects.toThrow(/Unknown extended tool/)
  })

  it('routes mutating extended tool createMeetingDraft via callExtendedTool and refuses read/direct/release tools', async () => {
    const { handlers, getStore, ops } = createHarness(makeStore())

    const found = JSON.parse(
      (
        await handlers.callExtendedReadTool!(
          invoke('callExtendedReadTool', {
            tool: 'findMeetingTimes',
            arguments: {
              title: 'Partner Call',
              durationMinutes: 30,
              from: '2030-01-07',
              to: '2030-01-08',
            },
          }),
        )
      ).content,
    ) as { options: Array<{ startsAt: string }> }
    const chosenStart = found.options[0]!.startsAt

    const created = JSON.parse(
      (
        await handlers.callExtendedTool!(
          invoke('callExtendedTool', {
            tool: 'createMeetingDraft',
            arguments: {
              title: 'Partner Call',
              durationMinutes: 30,
              from: '2030-01-07',
              to: '2030-01-08',
              startsAt: chosenStart,
            },
          }),
        )
      ).content,
    ) as { id: string; created: boolean; lifecycle: string }

    expect(created.created).toBe(true)
    expect(created.lifecycle).toBe('draft')
    expect(getStore().events.some(e => e.id === created.id)).toBe(true)
    expect(ops.some(o => o.kind === 'calendar.extended.createMeetingDraft')).toBe(true)

    await expect(
      handlers.callExtendedTool!(
        invoke('callExtendedTool', { tool: 'searchCalendar', arguments: { query: 'x' } }),
      ),
    ).rejects.toThrow(/read-only/)

    await expect(
      handlers.callExtendedTool!(
        invoke('callExtendedTool', { tool: 'activateCalendarEvent', arguments: { eventId: 'evt-1' } }),
      ),
    ).rejects.toThrow(/already directly exposed/)

    await expect(
      handlers.callExtendedTool!(
        invoke('callExtendedTool', { tool: 'deleteCalendarEvent', arguments: { eventId: 'evt-1' } }),
      ),
    ).rejects.toThrow(/already directly exposed/)

    await expect(
      handlers.callExtendedTool!(
        invoke('callExtendedTool', { tool: 'ghostTool', arguments: {} }),
      ),
    ).rejects.toThrow(AgentCalendarToolError)
  })
})

describe('fn_scheduleBriefing', () => {
  it('compiles settings, daily agenda, conflicts, working-hour free blocks, drafts, holds, tasks, and search in one call', async () => {
    const guest = { name: 'Ana', email: 'ana@example.com', response: 'accepted' as const }
    const store = makeStore(
      [
        makeEvent({
          id: 'evt-morning',
          title: 'Design Review',
          startsAt: '2030-01-07T09:00:00.000Z',
          endsAt: '2030-01-07T10:30:00.000Z',
          attendees: [guest],
        }),
        makeEvent({
          id: 'evt-overlap',
          title: 'Architecture Sync',
          startsAt: '2030-01-07T10:00:00.000Z',
          endsAt: '2030-01-07T11:00:00.000Z',
        }),
        makeEvent({
          id: 'evt-hold',
          title: 'HOLD: Coffee w/ Ana (option 1)',
          startsAt: '2030-01-07T14:00:00.000Z',
          endsAt: '2030-01-07T14:30:00.000Z',
          lifecycle: 'draft',
          holdGroupId: 'grp-1',
        }),
      ],
      { tasks: [makeTask()] },
    )
    const { handlers, ops } = createHarness(store)

    const res = await handlers.fn_scheduleBriefing!(
      invoke('fn_scheduleBriefing', {
        from: '2030-01-07',
        to: '2030-01-07',
        query: 'Architecture',
      }),
    )
    const envelope = JSON.parse(res.content) as {
      ok: true
      opClass: 'function'
      function: string
      summary: string
      data: {
        settings: { timeZone: string; defaultCalendarId: string }
        totals: { events: number; conflicts: number; drafts: number; holds: number; tasks: number }
        days: Array<{
          date: string
          availableDay: boolean
          busyMinutesInWorkHours: number
          freeBlocks: Array<{ localStart: string; localEnd: string; durationMinutes: number }>
        }>
        conflicts: Array<{ overlapMinutes: number; hasActiveGuests: boolean }>
        drafts: Array<{ id: string }>
        holds: Array<{ id: string }>
        tasks: Array<{ id: string }>
        search: { query: string; results: Array<{ title: string }> }
      }
    }

    expect(envelope.ok).toBe(true)
    expect(envelope.opClass).toBe('function')
    expect(envelope.function).toBe('fn_scheduleBriefing')
    expect(envelope.data.settings.timeZone).toBe('UTC')
    expect(envelope.data.totals).toMatchObject({
      events: 3,
      conflicts: 1,
      drafts: 1,
      holds: 1,
      tasks: 1,
    })
    expect(envelope.data.conflicts[0]).toMatchObject({
      overlapMinutes: 30,
      hasActiveGuests: true,
    })
    // Working hours 09:00-17:00 UTC: busy 09:00-11:00 and 14:00-14:30 => free 11:00-14:00 (180m) & 14:30-17:00 (150m)
    expect(envelope.data.days[0]?.busyMinutesInWorkHours).toBe(150)
    expect(envelope.data.days[0]?.freeBlocks.map(b => `${b.localStart}-${b.localEnd}`)).toEqual([
      '11:00-14:00',
      '14:30-17:00',
    ])
    expect(envelope.data.search.results.some(r => r.title === 'Architecture Sync')).toBe(true)
    expect(ops).toHaveLength(0) // read-only
  })

  it('handles bare-date all-day events accurately in negative-UTC time zones', async () => {
    const store = makeStore(
      [
        makeEvent({
          id: 'evt-offsite',
          title: 'Team Offsite',
          startsAt: '2030-01-07',
          endsAt: '2030-01-08',
          allDay: true,
          timeZone: 'UTC',
          busyStatus: 'busy',
        }),
      ],
      {
        settings: {
          timeZoneMode: 'fixed',
          timeZone: 'America/Los_Angeles',
          availableDays: [1, 2, 3, 4, 5],
          availableStartHour: 9,
          availableEndHour: 17,
        },
      },
    )
    const { handlers } = createHarness(store)
    const res = await handlers.fn_scheduleBriefing!(
      invoke('fn_scheduleBriefing', { from: '2030-01-07', to: '2030-01-08' }),
    )
    const envelope = JSON.parse(res.content) as {
      data: {
        days: Array<{
          date: string
          events: Array<{ id: string; localDate: string; localStart: string }>
          freeBlocks: unknown[]
          busyMinutesInWorkHours: number
        }>
      }
    }
    expect(envelope.data.days[0]?.date).toBe('2030-01-07')
    expect(envelope.data.days[0]?.events).toEqual([
      expect.objectContaining({
        id: 'evt-offsite',
        localDate: '2030-01-07',
        localStart: 'all-day',
      }),
    ])
    expect(envelope.data.days[0]?.freeBlocks).toEqual([])
    expect(envelope.data.days[0]?.busyMinutesInWorkHours).toBe(480)
    expect(envelope.data.days[1]?.events).toEqual([])
  })

  it('rejects unknown calendarId or inverted date ranges', async () => {
    const { handlers } = createHarness(makeStore())

    await expect(
      handlers.fn_scheduleBriefing!(
        invoke('fn_scheduleBriefing', { from: '2030-01-10', to: '2030-01-08' }),
      ),
    ).rejects.toThrow(/cannot be earlier/)

    await expect(
      handlers.fn_scheduleBriefing!(
        invoke('fn_scheduleBriefing', { calendarId: 'cal_missing' }),
      ),
    ).rejects.toThrow(/not found/)
  })
})

describe('fn_planMeetingSlots', () => {
  it('resolves saved-contact time zones, returns ranked slots with owner settings, and refuses unknown time zones without guessing', async () => {
    const { handlers } = createHarness(
      makeStore([
        makeEvent({
          startsAt: '2030-01-07T09:00:00.000Z',
          endsAt: '2030-01-07T11:00:00.000Z',
        }),
      ]),
    )

    const res = await handlers.fn_planMeetingSlots!(
      invoke('fn_planMeetingSlots', {
        title: 'Roadmap Sync',
        durationMinutes: 60,
        from: '2030-01-07',
        to: '2030-01-09',
        participants: [{ name: 'Ana Silva', email: 'ana@example.com' }],
      }),
    )
    const envelope = JSON.parse(res.content) as {
      ok: true
      data: {
        ownerSettings: { timeZone: string }
        resolvedParticipants: Array<{ timeZone: string; timeZoneSource: string }>
        options: Array<{ startsAt: string; participants: Array<{ localTime: string; availability: string }> }>
        proposalText: string
      }
    }

    expect(envelope.ok).toBe(true)
    expect(envelope.data.ownerSettings.timeZone).toBe('UTC')
    expect(envelope.data.resolvedParticipants).toEqual([
      { label: 'Ana Silva', timeZone: 'Europe/Berlin', timeZoneSource: 'savedContact' },
    ])
    expect(envelope.data.options.length).toBeGreaterThan(0)
    expect(envelope.data.options[0]?.participants[0]?.availability).toBe('unknown')
    expect(envelope.data.proposalText).toContain('Roadmap Sync')

    await expect(
      handlers.fn_planMeetingSlots!(
        invoke('fn_planMeetingSlots', {
          durationMinutes: 30,
          from: '2030-01-07',
          to: '2030-01-08',
          participants: [{ name: 'Mystery Guest', email: 'unknown@example.com' }],
        }),
      ),
    ).rejects.toThrow(/has no timeZone and was not found in saved contacts/)
  })

  it('refuses cleanly if the owner calendar cannot be read', async () => {
    const { handlers } = createHarness(makeStore(), {
      readOwnerNow: async () => {
        throw new Error('Google OAuth token expired')
      },
    })

    await expect(
      handlers.fn_planMeetingSlots!(
        invoke('fn_planMeetingSlots', {
          durationMinutes: 30,
          from: '2030-01-07',
          to: '2030-01-08',
        }),
      ),
    ).rejects.toThrow(/could not be read/)
  })
})

describe('fn_auditScheduleHealth', () => {
  it('flags conflicts, 3+ back-to-back chains, outside-hours events, stale drafts, hold groups, and sync errors', async () => {
    const store = makeStore(
      [
        // Back-to-back marathon of 3 meetings on Mon 2030-01-07 + overlap on meeting 2/3
        makeEvent({
          id: 'evt-1',
          title: 'Standup',
          startsAt: '2030-01-07T09:00:00.000Z',
          endsAt: '2030-01-07T09:30:00.000Z',
        }),
        makeEvent({
          id: 'evt-2',
          title: 'Sprint Review',
          startsAt: '2030-01-07T09:30:00.000Z',
          endsAt: '2030-01-07T10:30:00.000Z',
        }),
        makeEvent({
          id: 'evt-3',
          title: 'Client Call',
          startsAt: '2030-01-07T10:15:00.000Z',
          endsAt: '2030-01-07T11:00:00.000Z',
        }),
        // Outside working hours (18:00-19:00 UTC)
        makeEvent({
          id: 'evt-late',
          title: 'Late Sync',
          startsAt: '2030-01-07T18:00:00.000Z',
          endsAt: '2030-01-07T19:00:00.000Z',
        }),
        // Stale past draft + hold group
        makeEvent({
          id: 'evt-stale-hold',
          title: 'HOLD: Old Intro (option 1)',
          startsAt: '2030-01-02T10:00:00.000Z',
          endsAt: '2030-01-02T10:30:00.000Z',
          lifecycle: 'draft',
          holdGroupId: 'grp-old',
        }),
      ],
      {
        failedCalendarIds: ['cal_holidays'],
      },
    )
    const { handlers } = createHarness(store)

    const res = await handlers.fn_auditScheduleHealth!(
      invoke('fn_auditScheduleHealth', {
        from: '2030-01-07',
        to: '2030-01-13',
      }),
    )
    const envelope = JSON.parse(res.content) as {
      ok: true
      data: {
        conflicts: Array<{ overlapMinutes: number }>
        backToBackChains: Array<{ count: number; eventIds: string[] }>
        outsideWorkingHours: Array<{ id: string }>
        pendingDrafts: Array<{ id: string; stale: boolean }>
        holdGroups: Array<{ holdGroupId: string | null; staleCount: number }>
        syncIssues: { failedCalendarIds: string[] }
        recommendations: string[]
      }
    }

    expect(envelope.data.conflicts).toHaveLength(1)
    expect(envelope.data.conflicts[0]?.overlapMinutes).toBe(15)
    expect(envelope.data.backToBackChains).toHaveLength(1)
    expect(envelope.data.backToBackChains[0]?.eventIds).toEqual([
      'evt-1',
      'evt-2',
      'evt-3',
    ])
    expect(envelope.data.outsideWorkingHours.map(e => e.id)).toEqual(['evt-late'])
    expect(envelope.data.pendingDrafts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'evt-stale-hold', stale: true }),
      ]),
    )
    expect(envelope.data.holdGroups[0]).toMatchObject({
      holdGroupId: 'grp-old',
      staleCount: 1,
    })
    expect(envelope.data.syncIssues.failedCalendarIds).toEqual(['cal_holidays'])
    expect(envelope.data.recommendations.length).toBeGreaterThanOrEqual(4)
  })

  it('flags events ending exactly at local midnight as outside working hours', async () => {
    const store = makeStore([
      makeEvent({
        id: 'evt-midnight',
        title: 'Late Night Release Window',
        startsAt: '2030-01-07T23:00:00.000Z',
        endsAt: '2030-01-08T00:00:00.000Z',
      }),
    ])
    const { handlers } = createHarness(store)
    const res = await handlers.fn_auditScheduleHealth!(
      invoke('fn_auditScheduleHealth', { from: '2030-01-07', to: '2030-01-08' }),
    )
    const envelope = JSON.parse(res.content) as {
      data: { outsideWorkingHours: Array<{ id: string }> }
    }
    expect(envelope.data.outsideWorkingHours.map(e => e.id)).toEqual([
      'evt-midnight',
    ])
  })
})

describe('fn_stageMeetingDrafts', () => {
  it('stages conflict-checked grouped draft holds and skips overlapping slots by default', async () => {
    const busy = makeEvent({
      id: 'evt-busy',
      title: 'Existing Standup',
      startsAt: '2030-01-07T10:00:00.000Z',
      endsAt: '2030-01-07T11:00:00.000Z',
    })
    const { handlers, getStore, ops } = createHarness(makeStore([busy]))

    const res = await handlers.fn_stageMeetingDrafts!(
      invoke('fn_stageMeetingDrafts', {
        title: 'Partnership Call',
        attendees: [{ email: 'ana@example.com', name: 'Ana' }],
        holds: [
          // Conflicts with evt-busy -> skipped
          { startsAt: '2030-01-07T10:30:00.000Z', durationMinutes: 30 },
          // Clear -> created
          { startsAt: '2030-01-07T14:00:00.000Z', durationMinutes: 60 },
          // Clear -> created
          { startsAt: '2030-01-08T10:00:00.000Z', durationMinutes: 60 },
        ],
      }),
    )
    const envelope = JSON.parse(res.content) as {
      ok: true
      data: {
        holdGroupId: string
        createdHolds: Array<{ id: string; title: string; lifecycle: string; attendeesListed: string[] }>
        skippedConflicts: Array<{ index: number; conflictingEventIds: string[] }>
      }
    }

    expect(envelope.data.holdGroupId).toBeTruthy()
    expect(envelope.data.skippedConflicts).toHaveLength(1)
    expect(envelope.data.skippedConflicts[0]).toMatchObject({
      index: 0,
      conflictingEventIds: ['evt-busy'],
    })
    expect(envelope.data.createdHolds).toHaveLength(2)
    expect(envelope.data.createdHolds[0]?.lifecycle).toBe('draft')
    expect(envelope.data.createdHolds[0]?.attendeesListed).toEqual(['ana@example.com'])
    expect(getStore().events).toHaveLength(3)
    expect(ops.some(o => o.kind === 'calendar.function.fn_stageMeetingDrafts')).toBe(true)
  })

  it('confirms a planned meeting option and releases sibling draft holds in one call, while strictly refusing active events', async () => {
    const activeWithGuest = makeEvent({
      id: 'evt-active-guest',
      title: 'Board Meeting',
      startsAt: '2030-01-08T15:00:00.000Z',
      endsAt: '2030-01-08T16:00:00.000Z',
      attendees: [{ name: 'CEO', email: 'ceo@example.com', response: 'accepted' }],
    })
    const hold1 = makeEvent({
      id: 'evt-hold-1',
      title: 'HOLD: Sync (option 1)',
      startsAt: '2030-01-07T14:00:00.000Z',
      endsAt: '2030-01-07T14:30:00.000Z',
      lifecycle: 'draft',
      holdGroupId: 'grp-sync',
    })
    const hold2 = makeEvent({
      id: 'evt-hold-2',
      title: 'HOLD: Sync (option 2)',
      startsAt: '2030-01-08T10:00:00.000Z',
      endsAt: '2030-01-08T10:30:00.000Z',
      lifecycle: 'draft',
      holdGroupId: 'grp-sync',
    })
    const { handlers, getStore } = createHarness(
      makeStore([activeWithGuest, hold1, hold2]),
    )

    // Plan first so searchQualification is populated
    const planned = JSON.parse(
      (
        await handlers.fn_planMeetingSlots!(
          invoke('fn_planMeetingSlots', {
            title: 'Confirmed Sync',
            durationMinutes: 30,
            from: '2030-01-09',
            to: '2030-01-09',
          }),
        )
      ).content,
    ) as { data: { options: Array<{ startsAt: string }> } }
    const chosenStart = planned.data.options[0]!.startsAt

    const staged = JSON.parse(
      (
        await handlers.fn_stageMeetingDrafts!(
          invoke('fn_stageMeetingDrafts', {
            confirmMeetingDraft: {
              title: 'Confirmed Sync',
              durationMinutes: 30,
              from: '2030-01-09',
              to: '2030-01-09',
              startsAt: chosenStart,
            },
            releaseHoldGroupId: 'grp-sync',
            releaseHoldIds: ['evt-active-guest'],
          }),
        )
      ).content,
    ) as {
      data: {
        confirmedDraft: { id: string; created: boolean; lifecycle: string }
        releasedHolds: Array<{ id: string }>
        refusedReleases: Array<{ id: string; reason: string }>
      }
    }

    expect(staged.data.confirmedDraft.created).toBe(true)
    expect(staged.data.confirmedDraft.lifecycle).toBe('draft')
    expect(staged.data.releasedHolds.map(h => h.id).sort()).toEqual([
      'evt-hold-1',
      'evt-hold-2',
    ])
    // Active event MUST NOT be deleted
    expect(staged.data.refusedReleases).toEqual([
      expect.objectContaining({
        id: 'evt-active-guest',
        reason: expect.stringMatching(/active, not a private draft/i),
      }),
    ])
    const remainingIds = getStore().events.map(e => e.id)
    expect(remainingIds).toContain('evt-active-guest')
    expect(remainingIds).toContain(staged.data.confirmedDraft.id)
    expect(remainingIds).not.toContain('evt-hold-1')
    expect(remainingIds).not.toContain('evt-hold-2')
  })

  it('confirms a previously held slot while releasing its hold group and resolving saved-contact time zones', async () => {
    const hold1 = makeEvent({
      id: 'evt-opt-1',
      title: 'HOLD: Design Review (option 1)',
      startsAt: '2030-01-07T14:00:00.000Z',
      endsAt: '2030-01-07T14:30:00.000Z',
      lifecycle: 'draft',
      holdGroupId: 'grp-design',
    })
    const hold2 = makeEvent({
      id: 'evt-opt-2',
      title: 'HOLD: Design Review (option 2)',
      startsAt: '2030-01-08T10:00:00.000Z',
      endsAt: '2030-01-08T10:30:00.000Z',
      lifecycle: 'draft',
      holdGroupId: 'grp-design',
    })
    const { handlers, getStore } = createHarness(makeStore([hold1, hold2]))

    const staged = JSON.parse(
      (
        await handlers.fn_stageMeetingDrafts!(
          invoke('fn_stageMeetingDrafts', {
            confirmMeetingDraft: {
              title: 'Design Review',
              durationMinutes: 30,
              from: '2030-01-07',
              to: '2030-01-09',
              startsAt: '2030-01-08T10:00:00.000Z',
              // Omitted timeZone resolved from savedContacts (Ana Silva -> Europe/Berlin)
              participants: [{ name: 'Ana Silva', email: 'ana@example.com' }],
            },
            releaseHoldGroupId: 'grp-design',
          }),
        )
      ).content,
    ) as {
      data: {
        confirmedDraft: { id: string; created: boolean; startsAt: string; attendeesListed: string[] }
        releasedHolds: Array<{ id: string }>
        refusedReleases: Array<{ id: string }>
      }
    }

    expect(staged.data.confirmedDraft.created).toBe(true)
    expect(staged.data.confirmedDraft.startsAt).toBe('2030-01-08T10:00:00.000Z')
    expect(staged.data.confirmedDraft.attendeesListed).toEqual(['ana@example.com'])
    expect(staged.data.releasedHolds.map(h => h.id).sort()).toEqual([
      'evt-opt-1',
      'evt-opt-2',
    ])
    expect(staged.data.refusedReleases).toEqual([])
    expect(getStore().events.map(e => e.id)).toEqual([staged.data.confirmedDraft.id])
  })

  it('rejects empty call with no holds, confirmMeetingDraft, or release target', async () => {
    const { handlers } = createHarness(makeStore())
    await expect(
      handlers.fn_stageMeetingDrafts!(invoke('fn_stageMeetingDrafts', {})),
    ).rejects.toThrow(/Provide at least one/)
  })
})
