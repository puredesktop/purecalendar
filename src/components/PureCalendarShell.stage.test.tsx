// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { calendarFixture } from '../test/calendarFixtures'
import type { CalendarStore } from '../types'
import { PureCalendarShell } from './PureCalendarShell'

const gesture = vi.hoisted(() => ({ person: false }))
// jsdom can't make a trusted event, so "a person pressed it" is set here. A script's click takes the real check.
vi.mock('@purescience/platform-ui/release/gesture', async importOriginal => {
  const real = await importOriginal<typeof import('@purescience/platform-ui/release/gesture')>()
  return { ...real, isPersonGesture: (event: Parameters<typeof real.isPersonGesture>[0]) => gesture.person || real.isPersonGesture(event) }
})
vi.mock('@purescience/platform-ui/bridge/react/useAdjacentApp', () => ({ useAdjacentApp: () => ({ tabId: 'tab-2', name: 'Executive', heldInRoom: true }) }))
vi.mock('@purescience/platform-ui/bridge/client', async importOriginal => ({
  ...(await importOriginal<object>()),
  bridge: { call: vi.fn(async () => null), on: vi.fn(() => () => undefined), subscribe: vi.fn(() => () => undefined) },
}))
vi.mock('../bridge/platformBridge', async importOriginal => ({
  ...(await importOriginal<object>()),
  fetchGoogleCredentialStatus: vi.fn(async () => null),
  saveCalendarSettings: vi.fn(async () => undefined),
  writeCalendarStoreFile: vi.fn(async () => undefined),
}))
vi.mock('@purescience/platform-bridge/components/settings/AppSettings', () => ({
  AppSettingsPages: () => null,
  useAppSettings: () => ({ isOpen: false, open: () => undefined, close: () => undefined }),
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root
let host: HTMLDivElement

function store(lifecycle: 'draft' | 'active'): CalendarStore {
  const fixture = calendarFixture()
  const today = new Date()
  today.setHours(11, 0, 0, 0)
  return {
    ...fixture,
    settings: { ...fixture.settings, viewMode: 'week' },
    events: [{
      ...fixture.events[0]!,
      id: 'hold', title: 'Board call', lifecycle, recurrenceRule: undefined,
      startsAt: today.toISOString(), endsAt: new Date(today.getTime() + 3_600_000).toISOString(),
    }],
  } as CalendarStore
}

async function open(lifecycle: 'draft' | 'active') {
  await act(async () => root.render(<PureCalendarShell initialStore={store(lifecycle)} />))
  const row = [...host.querySelectorAll<HTMLElement>('[data-compact-agenda] button')].find(button => button.textContent?.includes('Board call'))!
  await act(async () => row.click())
  const edit = [...host.querySelectorAll<HTMLElement>('[role="dialog"] button')].find(button => button.textContent === 'Edit')!
  await act(async () => edit.click())
}
const release = () => host.querySelector<HTMLButtonElement>('button[data-release="activateCalendarEvent"]')
const back = () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Back to draft')

beforeEach(() => {
  gesture.person = false
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

describe('the Stage of a draft event', () => {
  it('is a button marked as the release, not a select', async () => {
    await open('draft')
    expect(release()?.textContent).toBe('Make active')
    expect(release()?.closest('label')).toBeNull()
    expect(host.querySelector('select option[value="draft"]')).toBeNull()
  })

  it('stays a draft when a script presses it', async () => {
    await open('draft')
    await act(async () => release()!.click())
    expect(release()).not.toBeNull()
    expect(back()).toBeUndefined()
  })

  it('goes active when a person presses it, and back to draft without the release', async () => {
    await open('draft')
    gesture.person = true
    await act(async () => release()!.click())
    expect(release()).toBeNull()
    expect(back()).toBeDefined()
    gesture.person = false
    await act(async () => back()!.click())
    expect(release()).not.toBeNull()
  })

  it('offers no release on an event that is already active', async () => {
    await open('active')
    expect(release()).toBeNull()
    expect(back()).toBeDefined()
  })
})
