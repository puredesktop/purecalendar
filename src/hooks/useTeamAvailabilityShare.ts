import { useEffect, useRef } from 'react'
import { getPlatformPreferences } from '@purescience/platform-ui/bridge/preferences'
import { readPlatformStorageJson } from '@purescience/platform-ui/bridge/storage.mjs'
import { bridge } from '../bridge/platformBridge'
import { PLATFORM_BRIDGE_METHODS } from '@purescience/platform-ui/bridge/methods'
import { availabilityFile, mailShareFile, organisationRoots, sameAvailability, teamAvailability } from '../lib/teamAvailability'
import type { CalendarStore } from '../types'

const readIfPresent = async (path: string): Promise<string | null> => {
  try {
    const answer = await bridge.call<string | { content?: string }>(PLATFORM_BRIDGE_METHODS.FS_READ, [path])
    return typeof answer === 'string' ? answer : answer?.content ?? null
  } catch {
    return null
  }
}

/**
 * Keeps the team's copy of when the person is busy current, for organisations that already share mail with their team
 * (lib/teamAvailability holds what is in it). A side channel: failing never disturbs the calendar, and it retries on the
 * next change or when the app next opens.
 */
export function useTeamAvailabilityShare(store: CalendarStore): void {
  const latest = useRef(store)
  latest.current = store
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const root = (await getPlatformPreferences()).workspaceRoot?.trim()
          const settings = await readPlatformStorageJson({ appSlug: 'executive', fileName: 'executive.json' }).catch(() => ({ value: null }))
          const roots = organisationRoots(settings.value, root)
          const text = JSON.stringify(teamAvailability(latest.current, new Date()))
          for (const folder of roots) {
            if ((await readIfPresent(mailShareFile(folder))) === null) continue
            if (!sameAvailability(await readIfPresent(availabilityFile(folder)), text)) await bridge.call(PLATFORM_BRIDGE_METHODS.FS_WRITE, [availabilityFile(folder), text])
          }
        } catch (error) {
          console.warn('[purecalendar] team availability share:', error)
        }
      })()
    }, 4_000)
    return () => window.clearTimeout(timer)
  }, [store])
}
