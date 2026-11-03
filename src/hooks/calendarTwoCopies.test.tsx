// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { calendarFixture } from '../test/calendarFixtures'
import type { CalendarEvent, CalendarSettings, CalendarStore, CalendarTask } from '../types'

/**
 * Two live copies of PureCalendar over one shared store, through the real boot and persistence hooks. A copy is what an
 * iframe is: its own module state and its own memory, so each is imported separately. Only the shell is a stand-in, and it
 * behaves as the shell's JSON store does: reads give a version, a write with ifMatch applies only at that version, and
 * values cross as clones.
 */
const disk = vi.hoisted(() => ({
  files: new Map<string, { raw: string; version: number }>(),
  counter: 0,
  settings: {} as Record<string, unknown>,
  writes: [] as string[],
  beforeWrite: null as null | ((fileName: string) => void),
  failReads: false,
}))
const put = (fileName: string, value: unknown) => {
  disk.files.set(fileName, { raw: JSON.stringify(value), version: ++disk.counter })
}

vi.mock('@purescience/platform-ui/bridge/client', () => ({
  bridge: {
    onEvent: () => () => undefined,
    waitForReady: async () => ({ appSlug: 'calendar' }),
    getMethods: () => [],
    call: async (method: string, args: unknown[] = []) => {
      const input = (args[0] ?? {}) as { fileName: string; value: unknown; ifMatch?: string | null; patch?: Record<string, unknown> }
      if (method === 'storage.readJson') {
        if (disk.failReads) throw new Error('read failed')
        const file = disk.files.get(input.fileName)
        return file ? { path: input.fileName, value: JSON.parse(file.raw), version: String(file.version) } : { path: input.fileName, value: null, version: null }
      }
      if (method === 'storage.writeJson') {
        const hook = disk.beforeWrite
        disk.beforeWrite = null
        hook?.(input.fileName)
        const file = disk.files.get(input.fileName)
        const version = file ? String(file.version) : null
        if (input.ifMatch !== undefined && input.ifMatch !== version) {
          return { path: input.fileName, ok: false, version, conflict: true, value: file ? JSON.parse(file.raw) : null }
        }
        disk.writes.push(input.fileName)
        disk.files.set(input.fileName, { raw: JSON.stringify(input.value), version: ++disk.counter })
        return { path: input.fileName, ok: true, version: String(disk.counter) }
      }
      if (method === 'settings.app.get') return structuredClone(disk.settings)
      if (method === 'settings.app.update') {
        disk.settings = { ...disk.settings, ...structuredClone(input.patch) }
        return disk.settings
      }
      if (method === 'credentials.status') return { id: 'google.oauth', kind: 'oauth', provider: 'google', configured: false, connected: false, scopes: [], needsReconnect: false }
      throw new Error(`unexpected bridge method ${method}`)
    },
  },
}))
vi.mock('@purescience/platform-ui/bridge/operations', () => ({
  listPlatformOperations: vi.fn(), onPlatformOperationRecorded: vi.fn(), recordPlatformOperation: vi.fn(),
}))

interface Copy {
  store(): CalendarStore
  change(update: (store: CalendarStore) => CalendarStore): Promise<void>
  save(): Promise<boolean>
  failure(): string | null
  dirty(): boolean
  focus(): Promise<void>
  close(): Promise<void>
}
const open_: Copy[] = []

/** One copy: boots from the file the way the app does, and holds its store in React state the way the shell does. */
async function open(): Promise<Copy> {
  vi.resetModules()
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { usePureCalendarBoot } = await import('./usePureCalendarBoot')
  const { useCalendarStorePersistence } = await import('./useCalendarStorePersistence')
  const persist = useCalendarStorePersistence as (
    store: CalendarStore,
    setStore?: React.Dispatch<React.SetStateAction<CalendarStore>>,
  ) => ReturnType<typeof useCalendarStorePersistence>
  let store!: CalendarStore
  let setStore!: React.Dispatch<React.SetStateAction<CalendarStore>>
  let persistence!: ReturnType<typeof useCalendarStorePersistence>
  function Workspace({ initial }: { initial: CalendarStore }) {
    const [value, set] = React.useState(initial)
    store = value
    setStore = set
    persistence = persist(value, set)
    return null
  }
  function Boot() {
    const boot = usePureCalendarBoot(true)
    return boot.store ? React.createElement(Workspace, { initial: boot.store }) : null
  }
  const act = React.act
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 8; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  }
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(React.createElement(Boot)))
  await settle()
  expect(store).toBeTruthy()
  const copy: Copy = {
    store: () => store,
    change: async update => { await act(async () => setStore(update)) },
    save: async () => {
      let covered = false
      await act(async () => { covered = await persistence.saveNow() })
      await settle()
      return covered
    },
    failure: () => persistence.persistFailure,
    dirty: () => persistence.persistDirtyRef.current,
    focus: async () => {
      await act(async () => { window.dispatchEvent(new Event('focus')) })
      await settle()
    },
    close: async () => { await act(async () => root.unmount()) },
  }
  open_.push(copy)
  return copy
}

const fixture = calendarFixture()
const base = fixture.events[0]!
const event = (id: string, title = id): CalendarEvent => ({ ...base, id, title, recurrenceRule: undefined, source: 'demo', syncState: 'synced' })
const task = (id: string): CalendarTask => ({ id, title: id, sourceLabel: 'test', status: 'open', syncState: 'synced' })
const seedStore = (events: CalendarEvent[], extra: Partial<CalendarStore> = {}): CalendarStore => ({
  ...fixture, events, tasks: [], settings: {}, ...extra,
})
const addEvent = (item: CalendarEvent) => (store: CalendarStore): CalendarStore => ({ ...store, events: [...store.events, item] })
const editEvent = (id: string, patch: Partial<CalendarEvent>) => (store: CalendarStore): CalendarStore => ({
  ...store, events: store.events.map(item => (item.id === id ? { ...item, ...patch } : item)),
})
const removeEvent = (id: string) => (store: CalendarStore): CalendarStore => ({ ...store, events: store.events.filter(item => item.id !== id) })
const fileStore = (): CalendarStore => JSON.parse(disk.files.get('calendar-store.json')!.raw) as CalendarStore
const ids = (store: CalendarStore): string[] => store.events.map(item => item.id).sort()
const titleOn = (store: CalendarStore, id: string) => store.events.find(item => item.id === id)?.title

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // Not standalone dev: the app goes through the shell's bridge.
  Object.defineProperty(window, 'parent', { value: {}, configurable: true })
  disk.files.clear()
  disk.settings = {}
  disk.writes.length = 0
  disk.beforeWrite = null
  disk.failReads = false
})
afterEach(async () => {
  for (const copy of open_.splice(0)) await copy.close()
  Object.defineProperty(window, 'parent', { value: window, configurable: true })
  vi.useRealTimers()
})

describe('two copies over calendar-store.json', () => {
  it('keeps what each adds, edits and deletes on different records, and a new copy reads them all', async () => {
    put('calendar-store.json', seedStore(
      [event('edit-a'), event('edit-b'), event('gone-a'), event('gone-b')],
      { tasks: [task('task-kept'), task('task-gone')] },
    ))
    const a = await open()
    const b = await open()
    await a.change(store => editEvent('edit-a', { title: 'From A' })(addEvent(event('new-a'))(removeEvent('gone-a')(store))))
    await a.save()
    await b.change(store => editEvent('edit-b', { title: 'From B' })(addEvent(event('new-b'))(removeEvent('gone-b')(store))))
    await b.change(store => ({ ...store, tasks: [...store.tasks.filter(item => item.id !== 'task-gone'), task('task-new')] }))
    await b.save()

    expect(ids(fileStore())).toEqual(['edit-a', 'edit-b', 'new-a', 'new-b'])
    expect(titleOn(fileStore(), 'edit-a')).toBe('From A')
    expect(titleOn(fileStore(), 'edit-b')).toBe('From B')
    expect(fileStore().tasks.map(item => item.id).sort()).toEqual(['task-kept', 'task-new'])

    const c = await open()
    expect(ids(c.store())).toEqual(['edit-a', 'edit-b', 'new-a', 'new-b'])
  })

  it('does not bring back a record the other copy deleted', async () => {
    put('calendar-store.json', seedStore([event('deleted'), event('kept')]))
    const stale = await open()
    const other = await open()
    await other.change(removeEvent('deleted'))
    await other.save()
    await stale.change(addEvent(event('mine')))
    await stale.save()
    expect(ids(fileStore())).toEqual(['kept', 'mine'])
    await stale.change(editEvent('mine', { title: 'And again' }))
    await stale.save()
    expect(ids(fileStore())).toEqual(['kept', 'mine'])
    expect(ids(stale.store())).toEqual(['kept', 'mine'])
  })

  it('keeps the newer edit of one record, even when the older edit saves last', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-01T10:00:00.000Z'))
    put('calendar-store.json', seedStore([event('same')]))
    const a = await open()
    const b = await open()
    vi.setSystemTime(new Date('2026-11-01T10:00:01.000Z'))
    await a.change(editEvent('same', { title: 'Older, from A' }))
    vi.setSystemTime(new Date('2026-11-01T10:00:02.000Z'))
    await b.change(editEvent('same', { title: 'Newer, from B' }))
    await b.save()
    vi.setSystemTime(new Date('2026-11-01T10:00:03.000Z'))
    await a.save()
    expect(titleOn(fileStore(), 'same')).toBe('Newer, from B')
    expect(titleOn(a.store(), 'same')).toBe('Newer, from B')
  })

  it('takes the later edit when the later edit saves last', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-01T10:00:00.000Z'))
    put('calendar-store.json', seedStore([event('same')]))
    const a = await open()
    const b = await open()
    vi.setSystemTime(new Date('2026-11-01T10:00:01.000Z'))
    await a.change(editEvent('same', { title: 'Older, from A' }))
    await a.save()
    vi.setSystemTime(new Date('2026-11-01T10:00:02.000Z'))
    await b.change(editEvent('same', { title: 'Newer, from B' }))
    await b.save()
    expect(titleOn(fileStore(), 'same')).toBe('Newer, from B')
  })

  it('a copy opened on an older snapshot, saving at once, loses nothing the other did', async () => {
    put('calendar-store.json', seedStore([event('edited'), event('deleted'), event('kept')]))
    const older = await open()
    const other = await open()
    await other.change(store => addEvent(event('added'))(editEvent('edited', { title: 'Edited since' })(removeEvent('deleted')(store))))
    await other.save()
    // The first thing the older copy does is save something of its own, without having looked.
    await older.change(addEvent(event('mine')))
    await older.save()
    expect(ids(fileStore())).toEqual(['added', 'edited', 'kept', 'mine'])
    expect(titleOn(fileStore(), 'edited')).toBe('Edited since')
    expect(ids(older.store())).toEqual(['added', 'edited', 'kept', 'mine'])
    expect(titleOn(older.store(), 'edited')).toBe('Edited since')
  })

  it('a copy that saves with nothing changed does not touch the file', async () => {
    put('calendar-store.json', seedStore([event('kept')]))
    const a = await open()
    const b = await open()
    await b.change(addEvent(event('from-b')))
    await b.save()
    disk.writes.length = 0
    await a.save()
    expect(disk.writes).toEqual([])
    expect(ids(fileStore())).toEqual(['from-b', 'kept'])
  })

  it('merges again when the other copy saves between its read and its write', async () => {
    put('calendar-store.json', seedStore([event('kept')]))
    const a = await open()
    const b = await open()
    await a.change(addEvent(event('from-a')))
    await a.save()
    await b.change(addEvent(event('from-b')))
    // The backup is written first: the race is held for the store file itself.
    const race = (fileName: string): void => {
      if (fileName === 'calendar-store.json') put(fileName, { ...fileStore(), events: [...fileStore().events, event('in-between')] })
      else disk.beforeWrite = race
    }
    disk.beforeWrite = race
    await b.save()
    expect(ids(fileStore())).toEqual(['from-a', 'from-b', 'in-between', 'kept'])
  })

  it('does not overwrite the file blind when it cannot read it', async () => {
    put('calendar-store.json', seedStore([event('kept')]))
    const a = await open()
    await a.change(addEvent(event('mine')))
    disk.failReads = true
    expect(await a.save()).toBe(false)
    expect(a.failure()).toBeTruthy()
    expect(a.dirty()).toBe(true)
    expect(ids(fileStore())).toEqual(['kept'])
    disk.failReads = false
    expect(await a.save()).toBe(true)
    expect(ids(fileStore())).toEqual(['kept', 'mine'])
  })

  it('backs up what was on disk, not what this copy last wrote', async () => {
    put('calendar-store.json', seedStore([event('kept')]))
    const a = await open()
    const b = await open()
    await b.change(addEvent(event('from-b')))
    await b.save()
    await a.change(addEvent(event('from-a')))
    await a.save()
    const backup = JSON.parse(disk.files.get('calendar-store.bak.json')!.raw) as CalendarStore
    expect(ids(backup)).toEqual(['from-b', 'kept'])
  })

  it('a first run writes no sample data back over what another copy deleted', async () => {
    const a = await open()
    const b = await open()
    const sample = a.store().events[0]?.id
    if (sample) {
      await b.change(removeEvent(sample))
      await b.save()
      await a.change(addEvent(event('mine')))
      await a.save()
      expect(ids(fileStore())).not.toContain(sample)
    }
    await a.change(addEvent(event('mine-too')))
    await a.save()
    expect(ids(fileStore())).toContain('mine-too')
  })
})

describe('other records in the store', () => {
  it('a removed calendar stays removed, with its events, and the file stays readable', async () => {
    const calendars = fixture.calendars.slice(0, 1)
    put('calendar-store.json', seedStore([event('on-it')], { calendars }))
    const stale = await open()
    const other = await open()
    await other.change(store => ({ ...store, calendars: [], events: [] }))
    await other.save()
    await stale.change(addEvent(event('added-to-it')))
    await stale.save()
    const c = await open()
    expect(c.store().calendars).toEqual([])
    expect(c.failure()).toBeNull()
    expect(fileStore().events).toEqual([])
  })

  it('keeps each copy\'s provider-delete queue and does not restore a confirmed delete', async () => {
    put('calendar-store.json', seedStore([event('kept')], { removedEventIds: ['g:cal:confirmed', 'g:cal:queued'] }))
    const whole = await open()
    const held = await open()
    // The whole app confirms one delete with Google; the held copy queues another.
    await whole.change(store => ({ ...store, removedEventIds: ['g:cal:queued'] }))
    await whole.save()
    await held.change(store => ({ ...store, removedEventIds: [...(store.removedEventIds ?? []), 'g:cal:new'] }))
    await held.save()
    expect([...(fileStore().removedEventIds ?? [])].sort()).toEqual(['g:cal:new', 'g:cal:queued'])
    await whole.focus()
    expect([...(whole.store().removedEventIds ?? [])].sort()).toEqual(['g:cal:new', 'g:cal:queued'])
  })

  it('an event deleted through the provider queue does not come back with a stale copy\'s edit of it', async () => {
    put('calendar-store.json', seedStore([event('g:cal:one')]))
    const whole = await open()
    const held = await open()
    await held.change(store => ({ ...removeEvent('g:cal:one')(store), removedEventIds: ['g:cal:one'] }))
    await held.save()
    await whole.change(editEvent('g:cal:one', { title: 'Refreshed from Google' }))
    await whole.save()
    expect(ids(fileStore())).toEqual([])
    expect(fileStore().removedEventIds).toEqual(['g:cal:one'])
  })
})

describe('settings', () => {
  const settingsOf = (patch: CalendarSettings) => (store: CalendarStore): CalendarStore => ({ ...store, settings: { ...store.settings, ...patch } })

  it('keeps a setting each copy changed, in the file and in the app\'s settings', async () => {
    put('calendar-store.json', seedStore([event('kept')], { settings: { viewMode: 'week', workStart: 8 } }))
    disk.settings = { viewMode: 'week', workStart: 8 }
    const whole = await open()
    const held = await open()
    await whole.change(settingsOf({ viewMode: 'month' }))
    await whole.save()
    await held.change(settingsOf({ workStart: 10 }))
    await held.save()
    expect(disk.settings).toMatchObject({ viewMode: 'month', workStart: 10 })
    expect(fileStore().settings).toMatchObject({ viewMode: 'month', workStart: 10 })
  })

  it('merges lists in settings: removed calendars and subscribed feeds from each copy', async () => {
    const feed = (id: string) => ({ id, label: id, url: `https://example.org/${id}.ics`, visible: true })
    put('calendar-store.json', seedStore([event('kept')], { settings: { removedCalendarIds: ['one'], icsFeeds: [feed('shared'), feed('dropped')] } }))
    disk.settings = { removedCalendarIds: ['one'], icsFeeds: [feed('shared'), feed('dropped')] }
    const a = await open()
    const b = await open()
    await a.change(settingsOf({ removedCalendarIds: ['one', 'two'], icsFeeds: [feed('shared'), feed('dropped'), feed('from-a')] }))
    await a.save()
    await b.change(settingsOf({ removedCalendarIds: ['one', 'three'], icsFeeds: [feed('shared'), feed('from-b')] }))
    await b.save()
    const merged = fileStore().settings
    expect([...(merged.removedCalendarIds ?? [])].sort()).toEqual(['one', 'three', 'two'])
    expect((merged.icsFeeds ?? []).map(item => item.id).sort()).toEqual(['from-a', 'from-b', 'shared'])
    expect((disk.settings.icsFeeds as Array<{ id: string }>).map(item => item.id).sort()).toEqual(['from-a', 'from-b', 'shared'])
  })
})

describe('a copy picks up what the other changed', () => {
  it('on focus: additions, edits and deletions, keeping its own unsaved edit', async () => {
    put('calendar-store.json', seedStore([event('edited'), event('deleted'), event('mine')]))
    const a = await open()
    const b = await open()
    await b.change(store => addEvent(event('added'))(editEvent('edited', { title: 'Edited over there' })(removeEvent('deleted')(store))))
    await b.save()
    await a.change(editEvent('mine', { title: 'Typing here' }))
    await a.focus()
    expect(ids(a.store())).toEqual(['added', 'edited', 'mine'])
    expect(titleOn(a.store(), 'edited')).toBe('Edited over there')
    expect(titleOn(a.store(), 'mine')).toBe('Typing here')
    await a.save()
    expect(titleOn(fileStore(), 'mine')).toBe('Typing here')
    expect(ids(fileStore())).toEqual(['added', 'edited', 'mine'])
  })

  it('on a timer, and picks up settings the other copy changed', async () => {
    put('calendar-store.json', seedStore([event('kept')], { settings: { workStart: 8 } }))
    disk.settings = { workStart: 8 }
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const a = await open()
    const b = await open()
    await b.change(store => addEvent(event('added'))({ ...store, settings: { ...store.settings, workStart: 10 } }))
    await b.save()
    await a.change(store => store)
    vi.advanceTimersByTime(60_000)
    for (let i = 0; i < 12; i++) await new Promise(resolve => setTimeout(resolve, 0))
    await a.focus()
    expect(ids(a.store())).toEqual(['added', 'kept'])
    expect(a.store().settings.workStart).toBe(10)
  })

  it('two copies settle: looking and saving stop writing once they agree', async () => {
    put('calendar-store.json', seedStore([event('kept')]))
    const a = await open()
    const b = await open()
    await a.change(addEvent(event('from-a')))
    await a.save()
    await b.focus()
    await b.save()
    await a.focus()
    await a.save()
    disk.writes.length = 0
    await a.focus()
    await b.focus()
    await a.save()
    await b.save()
    expect(disk.writes).toEqual([])
    expect(ids(a.store())).toEqual(['from-a', 'kept'])
    expect(ids(b.store())).toEqual(['from-a', 'kept'])
  })
})
