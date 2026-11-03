// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchCalendarSettings, readCalendarStoreFileVersioned, saveCalendarSettings, writeCalendarStoreFile } from '../bridge/platformBridge'
import { agreeWithLoaded } from '../lib/calendarStoreFile'
import { calendarFixture } from '../test/calendarFixtures'
import type { CalendarStore } from '../types'
import { useCalendarStorePersistence } from './useCalendarStorePersistence'

vi.mock('../bridge/platformBridge', () => ({
  fetchCalendarSettings: vi.fn(),
  readCalendarStoreFileVersioned: vi.fn(),
  saveCalendarSettings: vi.fn(),
  writeCalendarStoreFile: vi.fn(),
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let host: HTMLDivElement
let persistence: ReturnType<typeof useCalendarStorePersistence>
function Probe({ store }: { store: CalendarStore }) {
  persistence = useCalendarStorePersistence(store)
  return <span>{persistence.saveState}</span>
}
async function render(store: CalendarStore) { await act(async () => root.render(<Probe store={store} />)) }
const initial = calendarFixture()
function edited(title: string) { return { ...initial, events: [{ ...initial.events[0]!, title }] } }
const titleOf = (value: unknown) => (value as CalendarStore).events?.[0]?.title
/** The store file as the shell would hold it. */
let onDisk: unknown
const remember = (file: string, value: unknown) => { if (file === 'calendar-store.json') onDisk = JSON.parse(JSON.stringify(value)) }

beforeEach(() => {
  vi.resetAllMocks()
  onDisk = JSON.parse(JSON.stringify(initial))
  agreeWithLoaded(initial)
  vi.mocked(fetchCalendarSettings).mockResolvedValue({})
  vi.mocked(readCalendarStoreFileVersioned).mockImplementation(async () => ({ value: onDisk }))
  vi.mocked(writeCalendarStoreFile).mockImplementation(async (file, value) => { remember(file, value); return undefined })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers() })

describe('ordered calendar saves', () => {
  it('does not rewrite the loaded workspace on mount', async () => {
    await render(initial)
    expect(writeCalendarStoreFile).not.toHaveBeenCalled()
    expect(persistence.persistDirtyRef.current).toBe(false)
  })

  it('serializes autosave/manual requests and keeps newer edits dirty until they are persisted', async () => {
    await render(initial)
    const first = edited('First edit')
    const second = edited('Second edit')
    let finishFirst!: () => void
    vi.mocked(writeCalendarStoreFile).mockImplementation(async (file, value) => {
      if (file === 'calendar-store.json' && titleOf(value) === 'First edit') await new Promise<void>(resolve => { finishFirst = resolve })
      remember(file, value)
      return undefined
    })
    await render(first)
    let firstSave!: Promise<boolean>
    await act(async () => { firstSave = persistence.saveNow(); await new Promise(resolve => setTimeout(resolve, 0)) })
    await render(second)
    let secondSave!: Promise<boolean>
    await act(async () => { secondSave = persistence.saveNow(); await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(writeCalendarStoreFile).toHaveBeenCalledTimes(2)
    let firstCovered: boolean | undefined
    await act(async () => {
      finishFirst()
      firstCovered = await firstSave
      expect(persistence.persistDirtyRef.current).toBe(true)
      expect(await secondSave).toBe(true)
    })
    expect(firstCovered).toBe(false)
    expect(vi.mocked(writeCalendarStoreFile).mock.calls.map(([file, value]) => [file, (value as CalendarStore).events[0]?.title])).toEqual([
      ['calendar-store.bak.json', initial.events[0]!.title], ['calendar-store.json', 'First edit'],
      ['calendar-store.bak.json', 'First edit'], ['calendar-store.json', 'Second edit'],
    ])
    expect(host.textContent).toBe('saved')
    expect(persistence.persistDirtyRef.current).toBe(false)
  })

  it('persists a revert made while an older save is in flight', async () => {
    vi.useFakeTimers()
    await render(initial)
    const change = edited('Transient edit')
    let finish!: () => void
    vi.mocked(writeCalendarStoreFile).mockImplementation(async (file, value) => {
      if (file === 'calendar-store.json' && titleOf(value) === 'Transient edit') await new Promise<void>(resolve => { finish = resolve })
      remember(file, value)
      return undefined
    })
    await render(change)
    let saving!: Promise<boolean>
    await act(async () => { saving = persistence.saveNow(); await vi.advanceTimersByTimeAsync(0) })
    await render(initial)
    expect(persistence.persistDirtyRef.current).toBe(true)
    await act(async () => { finish(); expect(await saving).toBe(false) })
    await act(async () => { await vi.advanceTimersByTimeAsync(800) })
    const writes = vi.mocked(writeCalendarStoreFile).mock.calls.filter(([file]) => file === 'calendar-store.json')
    expect(writes.map(([, value]) => (value as CalendarStore).events[0]?.title)).toEqual(['Transient edit', initial.events[0]!.title])
    expect(persistence.persistDirtyRef.current).toBe(false)
  })

  it('keeps a failed settings save dirty even after the store write, then retries settings', async () => {
    await render(initial)
    const changed = { ...initial, settings: { ...initial.settings, googleExtraCalendarIds: ['shared'] } }
    await render(changed)
    vi.mocked(saveCalendarSettings).mockRejectedValue(new Error('Settings unavailable'))
    await act(async () => { expect(await persistence.saveNow()).toBe(false) })
    expect(persistence.persistDirtyRef.current).toBe(true)
    vi.mocked(saveCalendarSettings).mockResolvedValue(undefined)
    await act(async () => { expect(await persistence.saveNow()).toBe(true) })
    expect(writeCalendarStoreFile).toHaveBeenCalledTimes(2)
    expect(saveCalendarSettings).toHaveBeenCalledTimes(2)
    expect(persistence.persistDirtyRef.current).toBe(false)
  })

  it('reports failed writes and returns false to keep the editor open, then supports retry', async () => {
    await render(initial)
    await render(edited('Keep this edit'))
    vi.mocked(writeCalendarStoreFile).mockRejectedValue(new Error('Disk full'))
    await act(async () => { expect(await persistence.saveNow()).toBe(false) })
    expect(persistence.persistDirtyRef.current).toBe(true)
    expect(persistence.persistFailure).toBe('Disk full')
    expect(host.textContent).toBe('dirty')
    vi.mocked(writeCalendarStoreFile).mockImplementation(async (file, value) => { remember(file, value); return undefined })
    await act(async () => { expect(await persistence.saveNow()).toBe(true) })
    expect(persistence.persistFailure).toBeNull()
  })
})
