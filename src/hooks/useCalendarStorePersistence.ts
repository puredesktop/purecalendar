import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { saveCalendarSettings, writeCalendarStoreFile } from '../bridge/platformBridge'
import { CALENDAR_STORE_BACKUP_FILE, CALENDAR_STORE_FILE } from '../lib/calendarStorePersistence'
import type { CalendarStore } from '../types'

/** One ordered writer for autosave and explicit Save. Acknowledgements only
 * mark Saved when they cover the current revision, including edits in flight. */
export function useCalendarStorePersistence(store: CalendarStore) {
  const serialized = useMemo(() => JSON.stringify(store), [store])
  const current = useRef({ serialized, value: store })
  current.current = { serialized, value: store }
  const persisted = useRef(current.current)
  const savedSettings = useRef(JSON.stringify(store.settings))
  const tail = useRef<Promise<unknown>>(Promise.resolve())
  const pendingWrites = useRef(0)
  const mounted = useRef(true)
  const persistDirtyRef = useRef(false)
  persistDirtyRef.current = serialized !== persisted.current.serialized || JSON.stringify(store.settings) !== savedSettings.current || pendingWrites.current > 0
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved'>('idle')
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [persistFailure, setPersistFailure] = useState<string | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const saveNow = useCallback((): Promise<boolean> => {
    const snapshot = current.current
    pendingWrites.current++
    persistDirtyRef.current = true
    const write = async (): Promise<boolean> => {
      try {
        if (mounted.current) setSaveState('saving')
        if (snapshot.serialized !== persisted.current.serialized) {
          // Never overwrite the current good file if its recovery copy fails.
          await writeCalendarStoreFile(CALENDAR_STORE_BACKUP_FILE, persisted.current.value)
          await writeCalendarStoreFile(CALENDAR_STORE_FILE, snapshot.value)
          persisted.current = snapshot
        }
        const settings = JSON.stringify(snapshot.value.settings)
        if (settings !== savedSettings.current) {
          await saveCalendarSettings(snapshot.value.settings)
          savedSettings.current = settings
        }
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
  }, [])

  useEffect(() => {
    if (serialized === persisted.current.serialized && JSON.stringify(store.settings) === savedSettings.current && pendingWrites.current === 0) return
    setSaveState('dirty')
    const timeout = window.setTimeout(() => { void saveNow() }, 800)
    return () => window.clearTimeout(timeout)
  }, [serialized, saveNow])

  return { saveNow, saveState, lastSavedAt, persistFailure, persistDirtyRef }
}
