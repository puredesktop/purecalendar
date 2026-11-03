import {
  normalizeAccount,
  normalizeCalendar,
  normalizeEvent,
  normalizeSettings,
  normalizeSource,
  normalizeTask,
} from './calendarStorePersistence'
import type { CalendarSettings, CalendarStore } from '../types'

/**
 * Merging `calendar-store.json` when several copies of Calendar run over one file (a tab, and a copy held in a page).
 *
 * Every copy keeps its own memory and saves on its own clock, so a save can never be "write what I hold": a copy with an
 * older view would erase whatever the others saved since. Saving merges record by record instead. The rules:
 *
 * 1. Absence never means deleted. A record on disk and not in memory arrived from another copy; a record in memory and not
 *    on disk is written back.
 * 2. A delete is a tombstone, written by the copy that deleted: it held the record when it last agreed with the file (the
 *    baseline) and now does not.
 * 3. A delete wins: a copy that held a record and finds a tombstone drops it, even with an edit of its own. Only a record new
 *    to the copy (an id made again, a provider listing it again) clears a tombstone.
 * 4. A record only one side changed since the baseline takes that side. Both changed: an edit not yet pushed to its provider
 *    beats a pushed one, which is how a refresh from Google cannot erase it; then the later edit time.
 * 5. Records go with what holds them: an event whose calendar is gone, or that waits on the provider-delete queue, goes.
 *
 * Settings merge the same way key by key, and the lists in them item by item.
 */

export const RECORD_KINDS = ['accounts', 'sources', 'calendars', 'events', 'tasks'] as const
export type RecordKind = (typeof RECORD_KINDS)[number]
type Stored = { id: string; syncState?: string }

/** What a copy needs to know about the file besides its records. Older builds ignore it. */
export interface FileMergeMeta {
  /** When each record was deleted, by kind and id. */
  tombstones: Partial<Record<RecordKind, Record<string, string>>>
  /** When each record was last really edited, by kind and id: a save lands later than its edit. */
  editedAt: Partial<Record<RecordKind, Record<string, string>>>
}

/** Long enough for any copy left open; a stale copy past this only re-adds a record. */
export const META_MAX_AGE_MS = 90 * 24 * 3600_000

export interface Baseline {
  records: Record<RecordKind, Map<string, string>>
  removedEventIds: Set<string>
  settings: CalendarSettings
}

export const editKey = (kind: RecordKind, id: string): string => `${kind}:${id}`

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)))
      : item,
  ) ?? ''
}

const NORMALIZE: Record<RecordKind, (input: unknown) => unknown> = {
  accounts: normalizeAccount,
  sources: normalizeSource,
  calendars: normalizeCalendar,
  events: normalizeEvent,
  tasks: normalizeTask,
}

/** What a record is once saved: the same text however a copy built it, in whatever key order. */
export const recordFingerprint = (kind: RecordKind, record: unknown): string => canonical(NORMALIZE[kind](record) ?? record)

export function emptyMeta(): FileMergeMeta {
  return { tombstones: {}, editedAt: {} }
}

export function parseFileMeta(value: unknown): FileMergeMeta {
  const meta = (value as { merge?: Partial<FileMergeMeta> } | null)?.merge
  const table = (input: unknown): FileMergeMeta['tombstones'] => {
    if (!input || typeof input !== 'object') return {}
    const out: FileMergeMeta['tombstones'] = {}
    for (const kind of RECORD_KINDS) {
      const entries = (input as Record<string, unknown>)[kind]
      if (!entries || typeof entries !== 'object') continue
      out[kind] = Object.fromEntries(
        Object.entries(entries as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      )
    }
    return out
  }
  return { tombstones: table(meta?.tombstones), editedAt: table(meta?.editedAt) }
}

export function baselineOf(store: Pick<CalendarStore, RecordKind | 'removedEventIds' | 'settings'>): Baseline {
  const records = {} as Baseline['records']
  for (const kind of RECORD_KINDS) {
    records[kind] = new Map((store[kind] as Stored[]).map(record => [record.id, recordFingerprint(kind, record)]))
  }
  return { records, removedEventIds: new Set(store.removedEventIds ?? []), settings: store.settings }
}

const time = (value: string | undefined): number => {
  const parsed = Date.parse(value ?? '')
  return Number.isFinite(parsed) ? parsed : 0
}

const unsynced = (record: Stored): boolean => record.syncState !== undefined && record.syncState !== 'synced'

/** Both changed: which one stays. Ties keep memory, the copy doing the saving. */
function keepsMemory(memory: Stored, disk: Stored, editedHere: string, editedThere: string | undefined): boolean {
  if (unsynced(memory) !== unsynced(disk)) return unsynced(memory)
  return time(editedHere) >= time(editedThere)
}

function mergeRecords<T extends Stored>(input: {
  kind: RecordKind
  baseline: ReadonlyMap<string, string>
  memory: readonly T[]
  disk: readonly T[]
  meta: FileMergeMeta
  editTimes: ReadonlyMap<string, string>
  now: string
}): { merged: T[]; tombstones: Record<string, string>; editedAt: Record<string, string> } {
  const { kind, baseline, memory, disk, meta, editTimes, now } = input
  const diskById = new Map(disk.map(record => [record.id, record]))
  const memoryIds = new Set(memory.map(record => record.id))
  const tombstones = { ...(meta.tombstones[kind] ?? {}) }
  const editedAt = { ...(meta.editedAt[kind] ?? {}) }
  const merged: T[] = []
  const editedHere = (id: string): string => editTimes.get(editKey(kind, id)) ?? now

  for (const record of memory) {
    const held = baseline.get(record.id)
    if (tombstones[record.id] !== undefined) {
      if (held !== undefined) continue
      // New to this copy: a provider listed it again, or the id was made again.
      delete tombstones[record.id]
    }
    const onDisk = diskById.get(record.id)
    const mine = recordFingerprint(kind, record)
    const changedHere = held === undefined || mine !== held
    if (!onDisk) {
      merged.push(record)
      if (changedHere) editedAt[record.id] = editedHere(record.id)
      continue
    }
    const theirs = recordFingerprint(kind, onDisk)
    if (mine === theirs) {
      merged.push(record)
    } else if (theirs === held) {
      merged.push(record)
      editedAt[record.id] = editedHere(record.id)
    } else if (mine === held) {
      merged.push(onDisk)
    } else if (keepsMemory(record, onDisk, editedHere(record.id), editedAt[record.id])) {
      merged.push(record)
      editedAt[record.id] = editedHere(record.id)
    } else {
      merged.push(onDisk)
    }
  }

  for (const id of baseline.keys()) {
    if (memoryIds.has(id)) continue
    // This copy held it and no longer does: this copy deleted it.
    tombstones[id] ??= editedHere(id)
    delete editedAt[id]
  }

  for (const record of disk) {
    if (memoryIds.has(record.id) || baseline.has(record.id) || tombstones[record.id] !== undefined) continue
    merged.push(record)
  }

  const oldest = time(now) - META_MAX_AGE_MS
  const recent = (table: Record<string, string>): Record<string, string> =>
    Object.fromEntries(Object.entries(table).filter(([, at]) => time(at) >= oldest))
  const keptIds = new Set(merged.map(record => record.id))
  return {
    merged,
    tombstones: recent(tombstones),
    editedAt: recent(Object.fromEntries(Object.entries(editedAt).filter(([id]) => keptIds.has(id)))),
  }
}

/** Items only leave a shared list when one side took them out. */
function mergeIdSets(baseline: ReadonlySet<string>, memory: readonly string[], disk: readonly string[]): string[] {
  const mine = new Set(memory)
  const theirs = new Set(disk)
  const taken = (item: string): boolean => baseline.has(item) && (!mine.has(item) || !theirs.has(item))
  return [...new Set([...memory, ...disk])].filter(item => !taken(item))
}

function mergeFeeds(baseline: CalendarSettings['icsFeeds'] = [], memory: CalendarSettings['icsFeeds'] = [], disk: CalendarSettings['icsFeeds'] = []): CalendarSettings['icsFeeds'] {
  const ids = mergeIdSets(new Set(baseline.map(feed => feed.id)), memory.map(feed => feed.id), disk.map(feed => feed.id))
  const held = new Map(baseline.map(feed => [feed.id, canonical(feed)]))
  const mine = new Map(memory.map(feed => [feed.id, feed]))
  const theirs = new Map(disk.map(feed => [feed.id, feed]))
  return ids.map(id => {
    const here = mine.get(id)
    const there = theirs.get(id)
    if (!here) return there!
    if (!there) return here
    return canonical(here) === held.get(id) ? there : here
  })
}

export function mergeSettings(baseline: CalendarSettings, memory: CalendarSettings, disk: CalendarSettings): CalendarSettings {
  const keys = [...new Set([...Object.keys(memory), ...Object.keys(disk)])] as Array<keyof CalendarSettings>
  const merged: Record<string, unknown> = {}
  for (const key of keys) {
    const held = canonical(baseline[key])
    const mine = canonical(memory[key])
    const theirs = canonical(disk[key])
    let value: unknown
    if (mine === theirs || theirs === held) value = memory[key]
    else if (mine === held) value = disk[key]
    else if (key === 'icsFeeds') value = mergeFeeds(baseline.icsFeeds, memory.icsFeeds, disk.icsFeeds)
    else if (key === 'removedCalendarIds' || key === 'googleExtraCalendarIds') {
      value = mergeIdSets(new Set(baseline[key] ?? []), memory[key] ?? [], disk[key] ?? [])
    } else value = memory[key]
    if (value !== undefined) merged[key] = value
  }
  return merged as CalendarSettings
}

export interface CalendarStoreMerge {
  store: CalendarStore
  meta: FileMergeMeta
}

export function mergeCalendarStores(input: {
  baseline: Baseline
  memory: CalendarStore
  disk: CalendarStore | null
  diskMeta: FileMergeMeta
  /** Disk's settings as this copy should see them: the file's, overlaid with the app's. */
  diskSettings: CalendarSettings
  /** When this copy changed each record, by editKey. */
  editTimes: ReadonlyMap<string, string>
  now: string
}): CalendarStoreMerge {
  const { baseline, memory, disk, diskMeta, diskSettings, editTimes, now } = input
  const meta = emptyMeta()
  const parts = {} as Pick<CalendarStore, RecordKind>
  for (const kind of RECORD_KINDS) {
    const result = mergeRecords<Stored>({
      kind,
      baseline: baseline.records[kind],
      memory: memory[kind] as Stored[],
      disk: (disk?.[kind] ?? []) as Stored[],
      meta: diskMeta,
      editTimes,
      now,
    })
    ;(parts as unknown as Record<RecordKind, Stored[]>)[kind] = result.merged
    if (Object.keys(result.tombstones).length) meta.tombstones[kind] = result.tombstones
    if (Object.keys(result.editedAt).length) meta.editedAt[kind] = result.editedAt
  }
  const removedEventIds = mergeIdSets(baseline.removedEventIds, memory.removedEventIds ?? [], disk?.removedEventIds ?? [])
  const queued = new Set(removedEventIds)
  const calendarIds = new Set(parts.calendars.map(calendar => calendar.id))
  // The file must stay loadable: an event whose calendar is gone cannot be saved beside it.
  parts.events = parts.events.filter(event => calendarIds.has(event.calendarId) && !queued.has(event.id))
  const { failedCalendarIds: _transient, ...rest } = memory
  void _transient
  const { removedEventIds: _memoryQueue, ...withoutQueue } = rest
  void _memoryQueue
  return {
    store: {
      ...withoutQueue,
      ...parts,
      ...(removedEventIds.length ? { removedEventIds } : {}),
      settings: mergeSettings(baseline.settings, memory.settings, diskSettings),
    },
    meta,
  }
}

/** Does writing this store change the file? Order in a list is not a change. */
export function sameAsFile(merge: CalendarStoreMerge, disk: CalendarStore | null, diskMeta: FileMergeMeta): boolean {
  if (!disk) return false
  for (const kind of RECORD_KINDS) {
    const left = merge.store[kind] as Stored[]
    const right = new Map((disk[kind] as Stored[]).map(record => [record.id, recordFingerprint(kind, record)]))
    if (left.length !== right.size) return false
    if (left.some(record => right.get(record.id) !== recordFingerprint(kind, record))) return false
  }
  const queue = new Set(disk.removedEventIds ?? [])
  const mergedQueue = merge.store.removedEventIds ?? []
  if (queue.size !== mergedQueue.length || mergedQueue.some(id => !queue.has(id))) return false
  return canonical(normalizeSettings(merge.store.settings)) === canonical(normalizeSettings(disk.settings)) && canonical(merge.meta) === canonical(diskMeta)
}

/** What a merge means for this copy's memory. Null when nothing differs. */
export interface StoreChanges {
  /** Merged records, replacing what memory held at the time of the merge. */
  arrived: Partial<Record<RecordKind, Stored[]>>
  /** What memory held of each arrived or removed record, to see whether it has been edited since. */
  held: Partial<Record<RecordKind, Map<string, Stored>>>
  removed: Partial<Record<RecordKind, Set<string>>>
  queue: { added: string[]; dropped: string[] }
  settings: { before: CalendarSettings; after: CalendarSettings } | null
}

export function changesFor(memory: CalendarStore, merged: CalendarStore): StoreChanges | null {
  const changes: StoreChanges = { arrived: {}, held: {}, removed: {}, queue: { added: [], dropped: [] }, settings: null }
  let any = false
  for (const kind of RECORD_KINDS) {
    const before = memory[kind] as Stored[]
    const held = new Map(before.map(record => [record.id, record]))
    const after = merged[kind] as Stored[]
    const keptIds = new Set(after.map(record => record.id))
    const arrived = after.filter(record => held.get(record.id) !== record)
    const removed = new Set(before.filter(record => !keptIds.has(record.id)).map(record => record.id))
    if (arrived.length) changes.arrived[kind] = arrived
    if (removed.size) changes.removed[kind] = removed
    if (arrived.length || removed.size) {
      changes.held[kind] = held
      any = true
    }
  }
  const queueBefore = new Set(memory.removedEventIds ?? [])
  const queueAfter = new Set(merged.removedEventIds ?? [])
  changes.queue.added = [...queueAfter].filter(id => !queueBefore.has(id))
  changes.queue.dropped = [...queueBefore].filter(id => !queueAfter.has(id))
  if (changes.queue.added.length || changes.queue.dropped.length) any = true
  if (canonical(memory.settings) !== canonical(merged.settings)) {
    changes.settings = { before: memory.settings, after: merged.settings }
    any = true
  }
  return any ? changes : null
}

/** Take another copy's saves into this store. An edit made here since the merge stays, and the next save decides. */
export function applyStoreChanges(current: CalendarStore, changes: StoreChanges): CalendarStore {
  const next: CalendarStore = { ...current }
  for (const kind of RECORD_KINDS) {
    const arrived = changes.arrived[kind] ?? []
    const removed = changes.removed[kind]
    if (!arrived.length && !removed?.size) continue
    const held = changes.held[kind]
    const incoming = new Map(arrived.map(record => [record.id, record]))
    const kept: Stored[] = []
    for (const record of current[kind] as Stored[]) {
      if (removed?.has(record.id)) continue
      const newer = incoming.get(record.id)
      if (newer) incoming.delete(record.id)
      kept.push(newer && held?.get(record.id) === record ? newer : record)
    }
    ;(next as unknown as Record<RecordKind, Stored[]>)[kind] = [...kept, ...incoming.values()]
  }
  if (changes.queue.added.length || changes.queue.dropped.length) {
    const dropped = new Set(changes.queue.dropped)
    const queue = [...new Set([...(current.removedEventIds ?? []), ...changes.queue.added])].filter(id => !dropped.has(id))
    if (queue.length) next.removedEventIds = queue
    else delete next.removedEventIds
  }
  if (changes.settings) {
    const { before, after } = changes.settings
    const settings: Record<string, unknown> = { ...current.settings }
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)]) as Set<keyof CalendarSettings>) {
      // Changed here since the merge: this edit stays.
      if (canonical(current.settings[key]) !== canonical(before[key])) continue
      if (after[key] === undefined) delete settings[key]
      else settings[key] = after[key]
    }
    next.settings = settings as CalendarSettings
  }
  return next
}
