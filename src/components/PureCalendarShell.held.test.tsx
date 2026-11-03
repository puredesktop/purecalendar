// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { teamCalendar } from '../bridge/platformBridge'
import { calendarFixture } from '../test/calendarFixtures'
import type { CalendarProvider, CalendarStore } from '../types'
import { PureCalendarShell } from './PureCalendarShell'

const shell = vi.hoisted(() => ({
  background: true,
  calls: [] as Array<{ method: string; args: unknown[] }>,
}))
vi.mock('../hooks/useBackgroundWork', () => ({ useBackgroundWork: () => shell.background }))
vi.mock('@purescience/platform-ui/bridge/react/useAdjacentApp', () => ({ useAdjacentApp: () => null }))
vi.mock('@purescience/platform-bridge/components/settings/AppSettings', () => ({
  AppSettingsPages: () => null,
  useAppSettings: () => ({ isOpen: false, open: () => undefined, close: () => undefined }),
}))
vi.mock('@purescience/platform-ui/bridge/preferences', async importOriginal => ({
  ...(await importOriginal<object>()),
  // The first thing the team's availability share does.
  getPlatformPreferences: async () => {
    shell.calls.push({ method: 'availability.share', args: [] })
    return { workspaceRoot: '/org' }
  },
}))
vi.mock('@purescience/platform-ui/bridge/storage.mjs', () => ({
  readPlatformStorageJson: async () => ({ value: { organisations: [{ id: 'org', folder: '/org' }] } }),
}))
vi.mock('@purescience/platform-ui/bridge/client', async importOriginal => ({
  ...(await importOriginal<object>()),
  bridge: {
    on: vi.fn(() => () => undefined),
    subscribe: vi.fn(() => () => undefined),
    onEvent: vi.fn(() => () => undefined),
    getMethods: () => ['teamCalendar.list'],
    call: vi.fn(async (method: string, args: unknown[] = []) => {
      shell.calls.push({ method, args })
      if (method.includes('team') || method.includes('Team')) return { available: false, organisation: null, me: null, events: [], people: [], teams: [] }
      if (method === 'storage.readJson') return { value: null, version: null }
      if (method === 'network.fetch') return { ok: true, status: 200, headers: {}, body: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n' }
      return null
    }),
  },
}))
vi.mock('../bridge/platformBridge', async importOriginal => ({
  ...(await importOriginal<object>()),
  isStandaloneDevMode: () => false,
  fetchGoogleCredentialStatus: vi.fn(async () => null),
  fetchCalendarSettings: vi.fn(async () => ({})),
  saveCalendarSettings: vi.fn(async () => undefined),
  readCalendarStoreFileVersioned: vi.fn(async () => ({ value: null, version: null })),
  writeCalendarStoreFile: vi.fn(async () => undefined),
  teamCalendarOffered: () => true,
  networkFetch: vi.fn(async () => {
    shell.calls.push({ method: 'network.fetch', args: [] })
    return { ok: true, status: 200, headers: {}, body: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n' }
  }),
  teamCalendar: {
    list: vi.fn(async () => {
      shell.calls.push({ method: 'teamCalendar.list', args: [] })
      return { available: false, organisation: null, me: null, events: [], people: [], teams: [] }
    }),
    create: vi.fn(async () => { throw new Error('not in this test') }),
    update: vi.fn(async () => { throw new Error('not in this test') }),
    remove: vi.fn(async () => { throw new Error('not in this test') }),
    busy: vi.fn(async () => ({ busy: [] })),
    respond: vi.fn(async () => { throw new Error('not in this test') }),
  },
}))
vi.mock('@purescience/platform-ui/bridge/notifications', () => ({
  scheduleNotification: vi.fn(async () => { shell.calls.push({ method: 'notification.schedule', args: [] }) }),
  cancelNotification: vi.fn(async () => undefined),
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

function provider() {
  return {
    fetchStore: vi.fn(async () => calendarFixture()),
    sync: vi.fn(async (store: CalendarStore) => store),
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
    rsvp: vi.fn(),
  } satisfies CalendarProvider
}

/** A store with everything background work would act on: an unpushed Google edit, a queued delete, a feed, a reminder. */
function busyStore(): CalendarStore {
  const fixture = calendarFixture()
  const soon = new Date(Date.now() + 3_600_000).toISOString()
  const later = new Date(Date.now() + 7_200_000).toISOString()
  return {
    ...fixture,
    removedEventIds: ['g:cal_work:deleted'],
    settings: { icsFeeds: [{ id: 'feed', label: 'Feed', url: 'https://example.org/feed.ics', visible: true }] },
    events: [{
      ...fixture.events[0]!, id: 'g:cal_work:pending', calendarId: 'cal_work', title: 'Unpushed', source: 'provider', syncState: 'pending',
      startsAt: soon, endsAt: later, recurrenceRule: undefined, reminders: [{ id: 'r1', minutesBefore: 10 }],
    }],
  }
}

let root: Root
const mount = async (calendarProvider: CalendarProvider) => {
  await act(async () => root.render(<PureCalendarShell initialStore={busyStore()} calendarProvider={calendarProvider} />))
}
/** Past every debounce the app has for this work: reminders 1 s, Google push 1.2 s, the availability share 4 s. */
const settle = (ms: number) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)) })
const called = (fragment: string) => shell.calls.filter(call => call.method.includes(fragment))
const inviteReads = () => shell.calls.filter(call => call.method === 'storage.readJson' && JSON.stringify(call.args).includes('invite'))

beforeEach(() => {
  shell.calls.length = 0
  vi.clearAllMocks()
  root = createRoot(document.createElement('div'))
})
afterEach(async () => {
  await act(async () => root.unmount())
})

describe('background work in PureCalendarShell', () => {
  it('runs in the normal tab: this is what the held copy must not do', async () => {
    shell.background = true
    const google = provider()
    await mount(google)
    await settle(4_200)
    expect(google.fetchStore).toHaveBeenCalled()
    expect(google.sync).toHaveBeenCalled()
    expect(inviteReads().length).toBeGreaterThan(0)
    expect(called('network.fetch').length).toBeGreaterThan(0)
    expect(called('teamCalendar.list').length).toBeGreaterThan(0)
    expect(called('notification').length).toBeGreaterThan(0)
    expect(called('availability.share').length).toBeGreaterThan(0)
  })

  it('does not start in a held copy: no sync, feeds, team calendar loop, invites or reminders', async () => {
    shell.background = false
    const google = provider()
    await mount(google)
    await settle(4_200)
    expect(google.fetchStore).not.toHaveBeenCalled()
    expect(google.sync).not.toHaveBeenCalled()
    expect(inviteReads()).toEqual([])
    expect(called('network.fetch')).toEqual([])
    expect(called('notification')).toEqual([])
    expect(called('availability.share')).toEqual([])
    // One read to know who the organisation is, never the store-merging look.
    expect(called('teamCalendar.list').length).toBeLessThanOrEqual(1)
  })

  describe.each([
    ['the normal tab books it', true, 1],
    ['a held copy leaves it to the normal tab, so it is not booked twice', false, 0],
  ] as const)('a team meeting waiting to be sent: %s', (_name, background, sends) => {
    it('sends only from the normal tab', async () => {
      shell.background = background
      const me = { id: 'me', name: 'Me' }
      vi.mocked(teamCalendar.list).mockResolvedValue({ available: true, organisation: 'Org', me, events: [], people: [me], teams: [] })
      const fixture = calendarFixture()
      const calendar = { ...fixture.calendars[0]!, id: 'team:org', name: 'Org' }
      const initial: CalendarStore = {
        ...fixture,
        calendars: [...fixture.calendars, calendar],
        events: [{ ...fixture.events[0]!, id: 'local-meeting', calendarId: calendar.id, title: 'Meeting', source: 'provider', syncState: 'pending', recurrenceRule: undefined }],
      }
      await act(async () => root.render(<PureCalendarShell initialStore={initial} />))
      await settle(1_600)
      expect(vi.mocked(teamCalendar.create)).toHaveBeenCalledTimes(sends)
    })
  })
})
