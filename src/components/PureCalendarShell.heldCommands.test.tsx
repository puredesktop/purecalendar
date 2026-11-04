// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { calendarFixture } from '../test/calendarFixtures'
import type { CalendarProvider, CalendarStore } from '../types'
import { PureCalendarShell } from './PureCalendarShell'

let neighbour: { tabId: string; name: string; heldInRoom?: boolean } | null = null
// The page holding this app sends commands over the window; here the handler the shell gives is called straight.
const held = vi.hoisted(() => ({ handler: null as null | ((command: string, text: string) => unknown) }))
vi.mock('@purescience/platform-ui/bridge/react/heldCommand', () => ({
  useHeldCommand: (handler: (command: string, text: string) => unknown) => { held.handler = handler },
}))
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
const query = (selector: string) => host.querySelector<HTMLElement>(selector)

function store(): CalendarStore {
  const fixture = calendarFixture()
  return { ...fixture, settings: { ...fixture.settings, viewMode: 'month' }, events: [] } as CalendarStore
}
async function render(provider: CalendarProvider | null = null) {
  await act(async () => root.render(<PureCalendarShell initialStore={store()} calendarProvider={provider} />))
}
const tell = (command: string, text = '') => act(async () => (await held.handler!(command, text)) as { ok: boolean; say?: string })
const pressed = () => query('[role="group"][aria-label="Calendar view"] button[aria-pressed="true"]')?.textContent

beforeEach(() => {
  vi.clearAllMocks()
  held.handler = null
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  neighbour = null
})

describe('Calendar answering the page that holds it', () => {
  it('shows today in the full app, the way the Day button does', async () => {
    await render()
    expect(pressed()).toBe('Month')
    const answer = await tell('view', 'today')
    expect(answer).toEqual({ ok: true, say: 'Showing today.' })
    expect(pressed()).toBe('Day')
  })

  it('shows the week in the full app', async () => {
    await render()
    const answer = await tell('view', 'week')
    expect(answer).toEqual({ ok: true, say: 'Showing this week.' })
    expect(pressed()).toBe('Week')
  })

  it('held, brings the agenda back to today and leaves the saved view alone', async () => {
    neighbour = { tabId: 'tab-2', name: 'Executive', heldInRoom: true }
    await render()
    expect(query('[data-compact-agenda]')).not.toBeNull()
    expect(await tell('view', 'week')).toEqual({ ok: true, say: 'Showing the next seven days.' })
    expect(await tell('view', 'today')).toEqual({ ok: true, say: 'Today is at the top of your calendar.' })
    neighbour = null
    await render()
    expect(pressed()).toBe('Month')
  })

  it('closes an open event so the view shows', async () => {
    neighbour = { tabId: 'tab-2', name: 'Executive', heldInRoom: true }
    await render()
    await act(async () => query('button[aria-label^="New event on"]')!.click())
    expect(query('[role="dialog"][aria-label="Calendar details"]')).not.toBeNull()
    await tell('view', 'today')
    expect(query('[role="dialog"][aria-label="Calendar details"]')).toBeNull()
  })

  it('says what it can do when asked for any other view', async () => {
    await render()
    expect(await tell('view', 'fortnight')).toEqual({ ok: false, say: 'Say today or week.' })
    expect(pressed()).toBe('Month')
  })

  it('opens a parsed event as a draft for a press, and invites nobody', async () => {
    neighbour = { tabId: 'tab-2', name: 'Executive', heldInRoom: true }
    const provider = { fetchStore: vi.fn(async () => store()), sync: vi.fn(), createEvent: vi.fn(), updateEvent: vi.fn(), deleteEvent: vi.fn(), rsvp: vi.fn() } satisfies CalendarProvider
    await render(provider)
    const answer = await tell('event', 'tomorrow 2:30pm Planning review') as { ok: boolean; say: string }
    expect(answer.ok).toBe(true)
    expect(answer.say).toMatch(/^Planning review, .* at 2:30.?PM, is open for you to look over\. It stays a draft until you choose Edit and set it to Active\.$/i)
    const details = query('[role="dialog"][aria-label="Calendar details"]')!
    expect(details).not.toBeNull()
    expect(details.textContent).toContain('Planning review')
    expect(details.textContent).toMatch(/2:30.PM/)
    expect(details.textContent).toContain('draft')
    const edit = Array.from(details.querySelectorAll('button')).find(each => each.textContent === 'Edit')!
    await act(async () => edit.click())
    expect(details.querySelector('button[data-release="activateCalendarEvent"]')?.textContent).toBe('Make active')
    // Nothing goes out: the draft stays on this computer until it is set to Active.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1000)) })
    for (const method of [provider.sync, provider.createEvent, provider.updateEvent, provider.deleteEvent, provider.rsvp]) expect(method).not.toHaveBeenCalled()
  })

  it('asks for words when there are none', async () => {
    await render()
    const answer = await tell('event', '   ')
    expect(answer.ok).toBe(false)
    expect(answer.say).toBe('Say when and what, like: tomorrow 2:30pm Planning review.')
    expect(query('[role="dialog"][aria-label="Calendar details"]')).toBeNull()
  })

  it('refuses a command it does not know', async () => {
    await render()
    expect((await tell('delete', 'everything')).ok).toBe(false)
  })
})
