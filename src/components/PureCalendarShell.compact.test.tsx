// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { calendarFixture } from '../test/calendarFixtures'
import { saveCalendarSettings, writeCalendarStoreFile } from '../bridge/platformBridge'
import type { CalendarStore } from '../types'
import { PureCalendarShell } from './PureCalendarShell'

let neighbour: { tabId: string; name: string } | null = null
vi.mock('@purescience/platform-ui/bridge/react/useAdjacentApp', () => ({ useAdjacentApp: () => neighbour }))
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

function store(): CalendarStore {
  const fixture = calendarFixture()
  const today = new Date()
  today.setHours(11, 0, 0, 0)
  const startsAt = today.toISOString()
  const endsAt = new Date(today.getTime() + 3_600_000).toISOString()
  return {
    ...fixture,
    settings: { ...fixture.settings, viewMode: 'week' },
    events: [{ ...fixture.events[0]!, id: 'today-event', title: 'Board call', startsAt, endsAt, recurrenceRule: undefined }],
  } as CalendarStore
}

async function render(name: string | null, initial = store()) {
  neighbour = name === null ? null : { tabId: 'tab-2', name }
  await act(async () => root.render(<PureCalendarShell initialStore={initial} />))
}
const query = (selector: string) => host.querySelector<HTMLElement>(selector)
const toolbar = () => query('input[aria-label="Search calendar"]')!.closest<HTMLElement>('div[class]')!.parentElement!.parentElement!
const pressed = () => query('[role="group"][aria-label="Calendar view"] button[aria-pressed="true"]')?.textContent
async function key(value: string) {
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true })) })
}
// Saves ride on a debounce; wait it out so a stray write would have happened.
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 1000)) })
const savedViewModes = () =>
  [...vi.mocked(saveCalendarSettings).mock.calls, ...vi.mocked(writeCalendarStoreFile).mock.calls]
    .flatMap(call => Array.from(JSON.stringify(call).matchAll(/"viewMode":"(\w+)"/g), match => match[1]))

beforeEach(() => {
  vi.clearAllMocks()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  neighbour = null
})

describe('PureCalendarShell compact in the room', () => {
  it('is the full app beside anything else', async () => {
    await render('Mail')
    expect(query('[data-compact-in-room]')).toBeNull()
    expect(query('[data-compact-agenda]')).toBeNull()
    expect(query('input[aria-label="Quick add event"]')!.style.display).toBe('')
    expect(toolbar().style.display).toBe('')
    expect(query('[role="group"][aria-label="Calendar view"]')).not.toBeNull()
    expect(host.textContent).toContain('Find a time')
    expect(host.textContent).toContain('Calendars')
  })

  it('shows the agenda and hides the chrome beside Executive, without unmounting it', async () => {
    await render('Executive')
    expect(query('[data-compact-agenda]')).not.toBeNull()
    expect(host.textContent).toContain('Today')
    expect(host.textContent).toContain('Board call')
    expect(toolbar().style.display).toBe('none')
    expect(query('input[aria-label="Quick add event"]')!.style.display).toBe('none')
    expect(host.textContent).not.toContain('Find a time')
    expect(host.textContent).toContain('New event')
  })

  it('opens an event from the agenda', async () => {
    await render('Executive')
    const row = Array.from(host.querySelectorAll('[data-compact-agenda] button')).find(button => button.textContent?.includes('Board call'))!
    await act(async () => (row as HTMLElement).click())
    expect(query('[role="dialog"][aria-label="Calendar details"]')).not.toBeNull()
  })

  it('creates an event on the chosen day without moving the agenda', async () => {
    await render('Executive')
    const before = host.querySelectorAll('[data-compact-agenda] section')[0]!.textContent
    const add = host.querySelectorAll<HTMLElement>('[data-compact-agenda] button[aria-label^="New event on"]')[3]!
    await act(async () => add.click())
    expect(query('[role="dialog"][aria-label="Calendar details"]')).not.toBeNull()
    expect(host.querySelectorAll('[data-compact-agenda] section')[0]!.textContent).toBe(before)
    expect(host.querySelectorAll('[data-compact-agenda] section')[3]!.textContent).toContain('New event')
  })

  it('never writes the saved view: keys are ignored and the setting is kept', async () => {
    await render('Executive')
    await key('3')
    await key('4')
    expect(pressed()).toBe('Week')
    await render(null)
    expect(pressed()).toBe('Week')
    await settle()
    expect(savedViewModes().filter(mode => mode !== 'week')).toEqual([])
  })

  it('still switches the view with the keys when not compact', async () => {
    await render('Mail')
    await key('3')
    expect(pressed()).toBe('Month')
    await settle()
    expect(savedViewModes()).toContain('month')
  })

  it('gives the full app back on Expand, on the week it was showing', async () => {
    await render(null)
    await key('ArrowRight')
    const fullTitle = query('h1')!.textContent
    await render('Executive')
    expect(query('[data-compact-agenda]')).not.toBeNull()
    expect(query('h1')!.textContent).not.toBe(fullTitle)
    await render(null)
    expect(query('[data-compact-agenda]')).toBeNull()
    expect(query('h1')!.textContent).toBe(fullTitle)
    expect(toolbar().style.display).toBe('')
  })

  it('Delete does nothing in compact unless the event is open', async () => {
    await render('Executive')
    await key('Delete')
    expect(host.textContent).toContain('Board call')
  })

  it('Delete still acts on the selected event when not compact', async () => {
    await render('Mail')
    expect(host.textContent).toContain('Board call')
    await key('Delete')
    expect(host.textContent).not.toContain('Board call')
  })
})
