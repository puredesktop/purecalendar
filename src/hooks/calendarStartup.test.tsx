// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchCalendarSettings,
  fetchGoogleCredentialStatus,
  readCalendarStoreFile,
  writeCalendarStoreFile,
  type OAuthCredentialStatus,
} from '../bridge/platformBridge'
import { demoCalendarStore } from '../lib/calendarModel'
import { GoogleCalendarProvider } from '../lib/googleCalendarProvider'
import { googleExtraCalendarIds, googleRemovedCalendarIds, setGoogleCalendarPreferences } from '../lib/googleCalendarPreferences'
import { usePureCalendarBoot, type PureCalendarBootState } from './usePureCalendarBoot'

vi.mock('../bridge/platformBridge', () => ({
  fetchCalendarSettings: vi.fn(),
  fetchGoogleCredentialStatus: vi.fn(),
  fetchGoogleAccessToken: vi.fn(),
  networkFetch: vi.fn(),
  readCalendarStoreFile: vi.fn(),
  writeCalendarStoreFile: vi.fn(),
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const saved = {
  ...demoCalendarStore(),
  calendars: [{ id: 'personal', sourceId: 'google-source', name: 'Personal', color: '#4285f4', visible: true }],
  events: [{
    id: 'saved-event', calendarId: 'personal', title: 'Saved meeting',
    description: '', startsAt: '2026-10-02T16:00:00Z', endsAt: '2026-10-02T17:00:00Z',
    timeZone: 'UTC', allDay: false, status: 'confirmed', visibility: 'default',
    busyStatus: 'busy', attendees: [], reminders: [], attachments: [], linkedItems: [],
    source: 'provider', syncState: 'synced',
  }],
}
const connected: OAuthCredentialStatus = {
  id: 'google.oauth', kind: 'oauth', provider: 'google', configured: true,
  connected: true, scopes: [], needsReconnect: false,
}

let root: Root | null
let host: HTMLDivElement
let state: PureCalendarBootState & { retryBoot: () => void }

function Probe() {
  state = usePureCalendarBoot(true)
  return <span>{state.store?.events[0]?.title ?? 'Loading'}</span>
}

async function mount() {
  await act(async () => root!.render(<Probe />))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(readCalendarStoreFile).mockResolvedValue(saved)
  vi.mocked(fetchCalendarSettings).mockResolvedValue({ viewMode: 'agenda' })
  vi.mocked(fetchGoogleCredentialStatus).mockImplementation(() => new Promise(() => {}))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host.remove()
  vi.restoreAllMocks()
})

describe('calendar startup', () => {
  it('does not mount an empty writable workspace when saved files cannot be read, and can retry', async () => {
    vi.mocked(readCalendarStoreFile).mockRejectedValue(new Error('Disk unavailable'))
    await mount()
    expect(state.store).toBeNull()
    expect(state.bootError?.message).toContain('Your files have been kept')
    expect(writeCalendarStoreFile).not.toHaveBeenCalled()
    vi.mocked(readCalendarStoreFile).mockResolvedValue(saved)
    await act(async () => state.retryBoot())
    expect(state.store?.events[0]?.title).toBe('Saved meeting')
    expect(state.bootError).toBeNull()
  })

  it('keeps malformed files untouched when neither copy can be recovered', async () => {
    vi.mocked(readCalendarStoreFile).mockResolvedValue({ invalid: true })
    await mount()
    expect(state.store).toBeNull()
    expect(state.bootError).not.toBeNull()
    expect(writeCalendarStoreFile).not.toHaveBeenCalled()
  })

  it('recovers the backup and preserves a malformed main before exposing writable data', async () => {
    vi.mocked(readCalendarStoreFile).mockImplementation(async name => name === 'calendar-store.json' ? { invalid: true } : saved)
    vi.mocked(writeCalendarStoreFile).mockResolvedValue(undefined)
    await mount()
    expect(writeCalendarStoreFile).toHaveBeenCalledWith('calendar-store.corrupt.json', { invalid: true })
    expect(state.store?.events[0]?.title).toBe('Saved meeting')
  })

  it('opens an empty workspace only when both saved files are missing', async () => {
    vi.mocked(readCalendarStoreFile).mockResolvedValue(null)
    await mount()
    expect(state.store?.events).toEqual([])
    expect(state.bootError).toBeNull()
  })

  it('shows saved events and settings while credential lookup is stalled', async () => {
    await mount()
    expect(host.textContent).toBe('Saved meeting')
    expect(state.store?.settings.viewMode).toBe('agenda')
    expect(state.calendarProvider).toBeNull()
    expect(state.bootError).toBeNull()
  })

  it('attaches the connected provider without waiting for a remote snapshot or replacing the open store', async () => {
    let resolveStatus!: (value: OAuthCredentialStatus) => void
    vi.mocked(fetchGoogleCredentialStatus).mockImplementation(() => new Promise(resolve => { resolveStatus = resolve }))
    vi.mocked(fetchCalendarSettings).mockResolvedValue({ googleExtraCalendarIds: ['shared'], removedCalendarIds: ['removed'] })
    const fetchStore = vi.spyOn(GoogleCalendarProvider.prototype, 'fetchStore').mockImplementation(() => new Promise(() => {}))
    await mount()
    const displayedStore = state.store
    await act(async () => resolveStatus(connected))
    expect(state.store).toBe(displayedStore)
    expect(state.calendarProvider).toBeInstanceOf(GoogleCalendarProvider)
    expect(fetchStore).not.toHaveBeenCalled()
    expect(googleExtraCalendarIds()).toEqual(['shared'])
    expect(googleRemovedCalendarIds()).toEqual(['removed'])
  })

  it('keeps the saved workspace usable when credential lookup fails', async () => {
    vi.mocked(fetchGoogleCredentialStatus).mockRejectedValue(new Error('Credential service unavailable'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await mount()
    expect(host.textContent).toBe('Saved meeting')
    expect(state.bootError).toBeNull()
  })

  it('does not reset calendar preferences changed while credentials are loading', async () => {
    let resolveStatus!: (value: OAuthCredentialStatus) => void
    vi.mocked(fetchGoogleCredentialStatus).mockImplementation(() => new Promise(resolve => { resolveStatus = resolve }))
    await mount()
    setGoogleCalendarPreferences({ extraCalendarIds: ['new-share'], removedCalendarIds: ['hidden-calendar'] })
    await act(async () => resolveStatus(connected))
    expect(googleExtraCalendarIds()).toEqual(['new-share'])
    expect(googleRemovedCalendarIds()).toEqual(['hidden-calendar'])
  })

  it('reads settings alongside the saved store rather than serializing the local reads', async () => {
    let resolveStore!: (value: unknown) => void
    vi.mocked(readCalendarStoreFile).mockImplementation(() => new Promise(resolve => { resolveStore = resolve }))
    await mount()
    expect(fetchCalendarSettings).toHaveBeenCalledOnce()
    expect(host.textContent).toBe('Loading')
    await act(async () => resolveStore(saved))
    expect(host.textContent).toBe('Saved meeting')
  })

  it('ignores credentials that arrive after the calendar closes', async () => {
    let resolveStatus!: (value: OAuthCredentialStatus) => void
    vi.mocked(fetchGoogleCredentialStatus).mockImplementation(() => new Promise(resolve => { resolveStatus = resolve }))
    await mount()
    const displayedState = state
    await act(async () => root!.unmount())
    root = null
    await act(async () => resolveStatus(connected))
    expect(state.store).toBe(displayedState.store)
    expect(state.calendarProvider).toBeNull()
  })
})
