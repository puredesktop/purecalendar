import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { getPlatformPreferences } from '@purescience/platform-ui/bridge/preferences'
import { readPlatformStorageJson } from '@purescience/platform-ui/bridge/storage.mjs'
import { PLATFORM_BRIDGE_METHODS } from '@purescience/platform-ui/bridge/methods'
import { bridge } from '../bridge/platformBridge'
import { organisationRoots } from '../lib/teamAvailability'
import { addTeamDate, dateStateFile, datesDir, readTeamDate } from '../lib/teamDates'
import type { CalendarStore } from '../types'

const LOOK_EVERY_MS = 15_000

/** Takes the dates the person agreed in the Executive app. A side channel: failing never disturbs the calendar, and it looks again. */
export function useTeamDates(store: CalendarStore, setStore: Dispatch<SetStateAction<CalendarStore>>, enabled = true): void {
  const latest = useRef(store)
  latest.current = store
  useEffect(() => {
    if (!enabled) return
    let running = false
    let disposed = false
    const look = async () => {
      if (running || disposed) return
      running = true
      try {
        const root = (await getPlatformPreferences()).workspaceRoot?.trim()
        const settings = await readPlatformStorageJson({ appSlug: 'executive', fileName: 'executive.json' }).catch(() => ({ value: null }))
        for (const folder of organisationRoots(settings.value, root)) {
          if (disposed) return
          const dir = datesDir(folder)
          const listed = await bridge.call<{ entries?: Array<{ name: string; isDirectory?: boolean }> }>(PLATFORM_BRIDGE_METHODS.FS_LIST, [dir]).catch(() => null)
          for (const entry of listed?.entries ?? []) {
            if (disposed) return
            if (entry.isDirectory || !entry.name.endsWith('.json')) continue
            const key = entry.name.slice(0, -5)
            const path = `${dir}/${entry.name}`
            const answer = await bridge.call<string | { content?: string }>(PLATFORM_BRIDGE_METHODS.FS_READ, [path]).catch(() => null)
            const request = readTeamDate(typeof answer === 'string' ? answer : answer?.content ?? null, key)
            if (!request) {
              await bridge.call(PLATFORM_BRIDGE_METHODS.FS_WRITE, [dateStateFile(folder, key), `${JSON.stringify({ v: 1, why: 'The date could not be read.' })}\n`])
              await bridge.call(PLATFORM_BRIDGE_METHODS.FS_DELETE, [path]).catch(() => undefined)
              continue
            }
            const precomputed = addTeamDate(latest.current, request)
            const marker = `team-date:${request.key}`
            const plannedEvent = precomputed.store.events.find(e => e.id === precomputed.eventId)
            const eventId = precomputed.eventId
            setStore(current => {
              if (current.events.some(e => e.linkedItems.some(item => item.id === marker))) {
                return current
              }
              if (plannedEvent && current.calendars.some(c => c.id === plannedEvent.calendarId)) {
                return { ...current, events: [...current.events, plannedEvent] }
              }
              return addTeamDate(current, request).store
            })
            await bridge.call(PLATFORM_BRIDGE_METHODS.FS_WRITE, [dateStateFile(folder, key), `${JSON.stringify({ v: 1, eventId, at: new Date().toISOString() })}\n`])
            await bridge.call(PLATFORM_BRIDGE_METHODS.FS_DELETE, [path]).catch(() => undefined)
          }
        }
      } finally {
        running = false
      }
    }
    const run = () => { void look().catch(error => console.warn('[purecalendar] team dates:', error)) }
    const first = window.setTimeout(run, 2_000)
    const timer = window.setInterval(run, LOOK_EVERY_MS)
    return () => {
      disposed = true
      window.clearTimeout(first)
      window.clearInterval(timer)
    }
  }, [enabled, setStore])
}
