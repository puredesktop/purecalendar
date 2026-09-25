import { useEffect, useState } from 'react'
import {
  fetchCalendarSettings,
  fetchGoogleAccessToken,
  fetchGoogleCredentialStatus,
  networkFetch,
  readCalendarStoreFile,
  writeCalendarStoreFile,
} from '../bridge/platformBridge'
import { demoCalendarStore } from '../lib/calendarModel'
import {
  CALENDAR_STORE_BACKUP_FILE,
  CALENDAR_STORE_CORRUPT_FILE,
  CALENDAR_STORE_FILE,
  parsePersistedCalendarStore,
} from '../lib/calendarStorePersistence'
import { GoogleCalendarProvider } from '../lib/googleCalendarProvider'
import {
  googleExtraCalendarIds,
  googleRemovedCalendarIds,
  setGoogleCalendarPreferences,
} from '../lib/googleCalendarPreferences'
import type { CalendarProvider, CalendarStore } from '../types'

export interface PureCalendarBootState {
  store: CalendarStore | null
  calendarProvider: CalendarProvider | null
  notice?: string
  bootError: Error | null
}

/**
 * Merge a fresh Google snapshot into the persisted local store. Remote truth
 * wins for provider-sourced events (stale copies are replaced wholesale);
 * everything local (demo seeds, task blocks, drafts without a `g:` id, and
 * pending edits that have not pushed yet) survives.
 */
export function mergeGoogleSnapshot(
  local: CalendarStore,
  remote: CalendarStore,
): CalendarStore {
  const pendingLocal = local.events.filter(
    event => event.source === 'provider' && event.syncState === 'pending',
  )
  const pendingIds = new Set(pendingLocal.map(event => event.id))
  const nonProviderLocal = local.events.filter(
    event => event.source !== 'provider',
  )
  // A calendar the provider could not read this time keeps whatever was
  // already synced for it — an unreadable calendar is not an empty one.
  const failedCalendarIds = new Set(remote.failedCalendarIds ?? [])
  const keptFromFailedCalendars = failedCalendarIds.size
    ? local.events.filter(
        event =>
          event.source === 'provider' &&
          event.syncState !== 'pending' &&
          failedCalendarIds.has(event.calendarId),
      )
    : []
  // A tombstoned id names an event deleted locally whose provider delete has
  // not been confirmed yet; letting the snapshot re-add it is the "deleted
  // events resurrect on refresh" bug.
  const removedEventIds = new Set(local.removedEventIds ?? [])
  const remoteEvents = remote.events.filter(
    event => !pendingIds.has(event.id) && !removedEventIds.has(event.id),
  )
  // A calendar the user removed must not come back on the next sync,
  // and neither may its events.
  const removedCalendarIds = new Set(local.settings.removedCalendarIds ?? [])
  const localCalendarIds = new Set(local.calendars.map(c => c.id))
  const localAccountIds = new Set(local.accounts.map(a => a.id))
  const localSourceIds = new Set(local.sources.map(s => s.id))
  return {
    ...local,
    accounts: [
      ...local.accounts,
      ...remote.accounts.filter(account => !localAccountIds.has(account.id)),
    ],
    sources: [
      ...local.sources,
      ...remote.sources.filter(source => !localSourceIds.has(source.id)),
    ],
    calendars: [
      ...local.calendars,
      ...remote.calendars.filter(
        calendar =>
          !localCalendarIds.has(calendar.id) &&
          !removedCalendarIds.has(calendar.id),
      ),
    ],
    events: [
      ...nonProviderLocal,
      ...pendingLocal,
      ...keptFromFailedCalendars.filter(
        event => !removedCalendarIds.has(event.calendarId),
      ),
      ...remoteEvents.filter(
        event => !removedCalendarIds.has(event.calendarId),
      ),
    ],
  }
}

async function loadPersistedStore(): Promise<CalendarStore> {
  // The persisted store is the source of truth. The demo seed is only
  // for a true first run — never a fallback that could overwrite real
  // data (the PureSheets boot bug: blank model + live save target).
  // A missing file resolves to null; a rejection here is a real read
  // failure, so log it before falling through to the backup path.
  const rawMain = await readCalendarStoreFile(CALENDAR_STORE_FILE).catch(
    (error: unknown) => {
      console.warn(
        `[purecalendar] failed to read store file "${CALENDAR_STORE_FILE}"; trying backup:`,
        error,
      )
      return null
    },
  )
  let nextStore = parsePersistedCalendarStore(rawMain)
  if (!nextStore) {
    const rawBackup = await readCalendarStoreFile(
      CALENDAR_STORE_BACKUP_FILE,
    ).catch((error: unknown) => {
      console.warn(
        `[purecalendar] failed to read backup store file "${CALENDAR_STORE_BACKUP_FILE}":`,
        error,
      )
      return null
    })
    nextStore = parsePersistedCalendarStore(rawBackup)
    if (rawMain !== null && nextStore) {
      // Main file existed but was unreadable and the backup saved us.
      // Preserve the corrupt blob for post-mortem before autosave
      // rewrites the main file with the recovered contents.
      void writeCalendarStoreFile(CALENDAR_STORE_CORRUPT_FILE, rawMain).catch(
        (error: unknown) => {
          console.warn(
            `[purecalendar] could not preserve corrupt store blob to "${CALENDAR_STORE_CORRUPT_FILE}" (recovered from backup anyway):`,
            error,
          )
        },
      )
    }
  }
  if (!nextStore) {
    if (rawMain !== null) {
      // Both main and backup unreadable: keep the evidence, then start
      // fresh — the alternative is an unusable app.
      console.warn(
        '[purecalendar] main and backup store files were both unreadable; preserving the corrupt blob and starting from the demo seed',
      )
      void writeCalendarStoreFile(CALENDAR_STORE_CORRUPT_FILE, rawMain).catch(
        (error: unknown) => {
          console.warn(
            `[purecalendar] could not preserve corrupt store blob to "${CALENDAR_STORE_CORRUPT_FILE}":`,
            error,
          )
        },
      )
    }
    nextStore = demoCalendarStore()
  }
  return nextStore
}

export function usePureCalendarBoot(ready: boolean): PureCalendarBootState {
  const [state, setState] = useState<PureCalendarBootState>({
    store: null,
    calendarProvider: null,
    bootError: null,
  })

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    async function load(): Promise<void> {
      try {
        let nextStore = await loadPersistedStore()
        // App settings (viewMode, working hours, timezone) are persisted
        // separately; hydrate them over whatever the store carries so saved
        // preferences survive reload.
        const settings = await fetchCalendarSettings().catch(
          (error: unknown) => {
            console.warn(
              '[purecalendar] failed to read app settings; using store defaults:',
              error,
            )
            return {}
          },
        )
        nextStore = {
          ...nextStore,
          settings: { ...nextStore.settings, ...settings },
        }

        const credentialStatus = await fetchGoogleCredentialStatus().catch(
          (error: unknown) => {
            console.warn(
              '[purecalendar] failed to read google credential status; booting with demo provider:',
              error,
            )
            return null
          },
        )
        let calendarProvider: CalendarProvider | null = null
        let notice: string | undefined
        if (credentialStatus?.connected) {
          // Seed the fetch-time preferences from what was persisted, so
          // the very first sync already honours added/removed calendars;
          // the shell keeps them current from there.
          setGoogleCalendarPreferences({
            ...(nextStore.settings.googleExtraCalendarIds
              ? {
                  extraCalendarIds:
                    nextStore.settings.googleExtraCalendarIds,
                }
              : {}),
            ...(nextStore.settings.removedCalendarIds
              ? { removedCalendarIds: nextStore.settings.removedCalendarIds }
              : {}),
          })
          const googleProvider = new GoogleCalendarProvider({
            ...(credentialStatus.email
              ? { email: credentialStatus.email }
              : {}),
            fetch: networkFetch,
            accessToken: async () =>
              (await fetchGoogleAccessToken()).accessToken,
            extraCalendarIds: googleExtraCalendarIds,
            removedCalendarIds: googleRemovedCalendarIds,
          })
          try {
            const remote = await googleProvider.fetchStore()
            nextStore = mergeGoogleSnapshot(nextStore, remote)
            calendarProvider = googleProvider
          } catch (error) {
            // A connected account whose startup sync failed must stay on the
            // Google provider so the next sync retries — mirror PureMail's
            // boot resilience rather than silently dropping to demo data.
            calendarProvider = googleProvider
            const message =
              error instanceof Error ? error.message : String(error)
            console.warn(
              '[purecalendar] google boot sync failed; will retry:',
              message,
            )
            notice = `Google Calendar was unreachable at startup; showing your last synced events. (${message})`
          }
        } else if (credentialStatus?.needsReconnect) {
          notice =
            'Google access expired or was revoked. Reconnect in Calendar settings → Calendar connections.'
        }

        if (cancelled) return
        setState({
          store: nextStore,
          calendarProvider,
          ...(notice ? { notice } : {}),
          bootError: null,
        })
      } catch (error) {
        if (cancelled) return
        setState({
          store: null,
          calendarProvider: null,
          bootError:
            error instanceof Error ? error : new Error(String(error)),
        })
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [ready])

  return state
}
