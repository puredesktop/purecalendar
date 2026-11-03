import {
  fetchCalendarSettings,
  readCalendarStoreFileVersioned,
  saveCalendarSettings,
  writeCalendarStoreFile,
} from '../bridge/platformBridge'
import {
  CALENDAR_STORE_BACKUP_FILE,
  CALENDAR_STORE_FILE,
  parsePersistedCalendarStore,
} from './calendarStorePersistence'
import {
  applyStoreChanges,
  baselineOf,
  changesFor,
  editKey,
  mergeCalendarStores,
  parseFileMeta,
  RECORD_KINDS,
  sameAsFile,
  type Baseline,
  type FileMergeMeta,
  type StoreChanges,
} from './calendarStoreMerge'
import type { CalendarSettings, CalendarStore } from '../types'

export { applyStoreChanges, type StoreChanges }

const MAX_MERGE_TRIES = 5

/**
 * This copy's place in the shared file. It lives here, one per copy: each copy of the app is its own frame with its own
 * modules. The merge's rules are in calendarStoreMerge.ts; this is the reading and writing around them.
 */
const thisCopy: {
  baseline: Baseline | null
  /** The file's version when this copy last agreed with it, and the app settings it saw then. */
  version: string | null | undefined
  appSettings: string | null
  /** When this copy changed each record, by editKey: kept until saved, because a save lands later than its edit. */
  editTimes: Map<string, string>
  lastSeen: CalendarStore | null
  /** The file could not be read when this copy opened, so it opened from the backup: the file is replaced on saving. */
  fileUnreadable: boolean
} = { baseline: null, version: undefined, appSettings: null, editTimes: new Map(), lastSeen: null, fileUnreadable: false }

/** What this copy opened from: from here on, whatever differs from it is this copy's own change. */
export function agreeWithLoaded(store: CalendarStore, input: { version?: string | null; fileUnreadable?: boolean } = {}): void {
  thisCopy.baseline = baselineOf(store)
  thisCopy.version = input.version
  thisCopy.appSettings = null
  thisCopy.fileUnreadable = input.fileUnreadable === true
  thisCopy.editTimes.clear()
  thisCopy.lastSeen = store
}

/** Boot overlays the app's settings on the file's: this copy did not change them. */
export function agreeOnSettings(settings: CalendarSettings): void {
  if (thisCopy.baseline) thisCopy.baseline.settings = settings
}

/** Note what changed, when it changed. Called for every new store this copy holds. */
export function noteStoreChange(store: CalendarStore, now = new Date().toISOString()): void {
  if (!thisCopy.baseline) thisCopy.baseline = baselineOf(store)
  const previous = thisCopy.lastSeen
  thisCopy.lastSeen = store
  if (!previous || previous === store) return
  for (const kind of RECORD_KINDS) {
    const before = previous[kind] as Array<{ id: string }>
    const after = store[kind] as Array<{ id: string }>
    if (before === after) continue
    const held = new Map(before.map(record => [record.id, record]))
    const kept = new Set<string>()
    for (const record of after) {
      kept.add(record.id)
      if (held.get(record.id) !== record) thisCopy.editTimes.set(editKey(kind, record.id), now)
    }
    for (const id of held.keys()) if (!kept.has(id)) thisCopy.editTimes.set(editKey(kind, id), now)
  }
}

async function readFile(): Promise<{ raw: unknown; disk: CalendarStore | null; meta: FileMergeMeta; version?: string | null }> {
  let answer: { value: unknown; version?: string | null }
  try {
    answer = await readCalendarStoreFileVersioned(CALENDAR_STORE_FILE)
  } catch (error) {
    if (!thisCopy.fileUnreadable) throw error
    answer = { value: null }
  }
  return {
    raw: answer.value,
    disk: parsePersistedCalendarStore(answer.value),
    meta: parseFileMeta(answer.value),
    ...(answer.version !== undefined ? { version: answer.version } : {}),
  }
}

async function readAppSettings(): Promise<CalendarSettings> {
  return fetchCalendarSettings().catch((error: unknown) => {
    console.warn('[purecalendar] failed to read app settings; merging with the file alone:', error)
    return {}
  })
}

function clearSavedEditTimes(before: number): void {
  for (const [key, at] of thisCopy.editTimes) if (Date.parse(at) <= before) thisCopy.editTimes.delete(key)
}

/**
 * Read the file, merge this store into it record by record, and write only if that changes it. The write applies only if the
 * file is still as read: when another copy saved in between, nothing is written and the merge runs again. Resolves with what
 * this copy's memory should take in, or null.
 */
export async function saveCalendarStoreFile(memory: CalendarStore): Promise<StoreChanges | null> {
  thisCopy.baseline ??= baselineOf(memory)
  for (let attempt = 0; attempt < MAX_MERGE_TRIES; attempt++) {
    const now = new Date().toISOString()
    const { raw, disk, meta, version } = await readFile()
    const appSettings = await readAppSettings()
    const merge = mergeCalendarStores({
      baseline: thisCopy.baseline,
      memory,
      disk,
      diskMeta: meta,
      diskSettings: { ...disk?.settings, ...appSettings },
      editTimes: thisCopy.editTimes,
      now,
    })
    let written = version
    if (!sameAsFile(merge, disk, meta)) {
      // Never overwrite the current good file if its recovery copy fails.
      if (disk) await writeCalendarStoreFile(CALENDAR_STORE_BACKUP_FILE, raw)
      const value = { ...merge.store, merge: merge.meta }
      const answer = await writeCalendarStoreFile(CALENDAR_STORE_FILE, value, version)
      if (answer?.conflict) continue
      written = answer?.version
    }
    thisCopy.baseline = baselineOf(merge.store)
    thisCopy.version = written
    thisCopy.appSettings = null
    thisCopy.fileUnreadable = false
    clearSavedEditTimes(Date.parse(now))
    return changesFor(memory, merge.store)
  }
  throw new Error('Other copies of Calendar kept saving at the same moment. Your changes are safe here and will be saved on the next try.')
}

/**
 * The app's own settings follow the file's merged settings, key by key. A whole-object write from a stale copy would put back
 * every setting another copy changed.
 */
export async function pushCalendarSettings(): Promise<void> {
  const wanted = thisCopy.baseline?.settings as Record<string, unknown> | undefined
  if (!wanted) return
  const current = (await fetchCalendarSettings().catch(() => ({}))) as Record<string, unknown>
  const patch = Object.fromEntries(
    Object.entries(wanted).filter(([key, value]) => JSON.stringify(current[key]) !== JSON.stringify(value)),
  )
  if (Object.keys(patch).length) await saveCalendarSettings(patch as CalendarSettings)
}

/**
 * Take what other copies saved without writing anything. The baseline moves to the file, so anything this copy has not saved
 * yet still reads as its own change. Resolves with what memory should take in, or null.
 */
export async function pullCalendarStoreFile(memory: CalendarStore): Promise<StoreChanges | null> {
  if (!thisCopy.baseline) thisCopy.baseline = baselineOf(memory)
  const { disk, meta, version } = await readFile()
  const appSettings = await readAppSettings()
  const seenSettings = JSON.stringify(appSettings)
  if (!disk) return null
  if (version !== undefined && version === thisCopy.version && seenSettings === thisCopy.appSettings) return null
  const diskSettings = { ...disk.settings, ...appSettings }
  const merge = mergeCalendarStores({
    baseline: thisCopy.baseline,
    memory,
    disk,
    diskMeta: meta,
    diskSettings,
    editTimes: thisCopy.editTimes,
    now: new Date().toISOString(),
  })
  thisCopy.baseline = baselineOf({ ...disk, settings: diskSettings })
  thisCopy.version = version
  thisCopy.appSettings = seenSettings
  return changesFor(memory, merge.store)
}
