import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  applyStoreChanges,
  noteStoreChange,
  pullCalendarStoreFile,
  pushCalendarSettings,
  saveCalendarStoreFile,
  type StoreChanges,
} from '../lib/calendarStoreFile'
import type { CalendarStore } from '../types'

/** How often a copy takes what other copies saved. It also looks on focus, and every save merges with the file. */
const LOOK_EVERY_MS = 15_000

/** One ordered writer for autosave and explicit Save. Acknowledgements only
 * mark Saved when they cover the current revision, including edits in flight.
 *
 * Several copies of Calendar can run over one file (a tab and a copy held in a page), so a write merges with the file
 * record by record (lib/calendarStoreMerge.ts), and what the others saved comes back into this copy's store. */
export function useCalendarStorePersistence(store: CalendarStore, setStore?: Dispatch<SetStateAction<CalendarStore>>) {
  const serialized = useMemo(() => JSON.stringify(store), [store])
  const current = useRef({ serialized, value: store })
  current.current = { serialized, value: store }
  const persisted = useRef(current.current)
  const savedSettings = useRef(JSON.stringify(store.settings))
  // Another copy's saves taken in while nothing here was unsaved: already on disk, so not a change to write.
  const fromDisk = useRef<CalendarStore | null>(null)
  if (store === fromDisk.current) {
    persisted.current = current.current
    savedSettings.current = JSON.stringify(store.settings)
  }
  const tail = useRef<Promise<unknown>>(Promise.resolve())
  const pendingWrites = useRef(0)
  const mounted = useRef(true)
  const persistDirtyRef = useRef(false)
  persistDirtyRef.current = serialized !== persisted.current.serialized || JSON.stringify(store.settings) !== savedSettings.current || pendingWrites.current > 0
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved'>('idle')
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [persistFailure, setPersistFailure] = useState<string | null>(null)
  const setStoreRef = useRef(setStore)
  setStoreRef.current = setStore

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => { noteStoreChange(store) }, [store])

  const takeIn = useCallback((changes: StoreChanges | null): void => {
    if (!changes || !mounted.current) return
    setStoreRef.current?.(held => {
      const next = applyStoreChanges(held, changes)
      if (held === persisted.current.value) fromDisk.current = next
      return next
    })
  }, [])

  const saveNow = useCallback((): Promise<boolean> => {
    const snapshot = current.current
    pendingWrites.current++
    persistDirtyRef.current = true
    const write = async (): Promise<boolean> => {
      try {
        if (mounted.current) setSaveState('saving')
        let changes: StoreChanges | null = null
        if (snapshot.serialized !== persisted.current.serialized) {
          changes = await saveCalendarStoreFile(snapshot.value)
          persisted.current = snapshot
        }
        const settings = JSON.stringify(snapshot.value.settings)
        if (settings !== savedSettings.current) {
          await pushCalendarSettings()
          savedSettings.current = settings
        }
        takeIn(changes)
        const covered = current.current.serialized === snapshot.serialized && pendingWrites.current === 1
        persistDirtyRef.current = !covered
        if (mounted.current) {
          setPersistFailure(null)
          setLastSavedAt(new Date())
          setSaveState(covered ? 'saved' : 'dirty')
        }
        return covered
      } catch (error) {
        persistDirtyRef.current = true
        if (mounted.current) {
          setSaveState('dirty')
          setPersistFailure(error instanceof Error ? error.message : 'The calendar store could not be saved.')
        }
        return false
      } finally {
        pendingWrites.current--
      }
    }
    const pending = tail.current.then(write)
    tail.current = pending
    return pending
  }, [takeIn])

  useEffect(() => {
    if (serialized === persisted.current.serialized && JSON.stringify(store.settings) === savedSettings.current && pendingWrites.current === 0) return
    setSaveState('dirty')
    const timeout = window.setTimeout(() => { void saveNow() }, 800)
    return () => window.clearTimeout(timeout)
  }, [serialized, saveNow])

  // Take what other copies saved. A missed look changes nothing on disk; the next save reports a real failure.
  const look = useCallback((): void => {
    if (!setStoreRef.current) return
    tail.current = tail.current.then(async () => {
      try {
        takeIn(await pullCalendarStoreFile(current.current.value))
      } catch (error) {
        console.warn('[purecalendar] could not look at the saved calendar:', error)
      }
    })
  }, [takeIn])

  useEffect(() => {
    const poll = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') look()
    }, LOOK_EVERY_MS)
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') look()
    }
    window.addEventListener('focus', look)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(poll)
      window.removeEventListener('focus', look)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [look])

  return { saveNow, saveState, lastSavedAt, persistFailure, persistDirtyRef }
}
