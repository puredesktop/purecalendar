import { useCallback, useEffect, useState } from 'react'
import {
  fetchCalendarSettings,
  fetchGoogleAccessToken,
  fetchGoogleCredentialStatus,
  networkFetch,
  readCalendarStoreFileVersioned,
  writeCalendarStoreFile,
} from '../bridge/platformBridge'
import { agreeOnSettings, agreeWithLoaded } from '../lib/calendarStoreFile'
import { demoCalendarStore, parseEventBoundMs } from '../lib/calendarModel'
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
 * unsynced edits, including failed/conflicted pushes) survives.
 */
export function mergeGoogleSnapshot(
  local: CalendarStore,
  remote: CalendarStore,
): CalendarStore {
  // The team calendar's events are its own account's (lib/teamCalendar.ts): Google's snapshot leaves them be.
  const team = (event: CalendarStore['events'][number]) => event.calendarId.startsWith('team:')
  const unsyncedLocal = local.events.filter(
    event => event.source === 'provider' && event.syncState !== 'synced' && !team(event),
  )
  const pendingIds = new Set(unsyncedLocal.map(event => event.id))
  const nonProviderLocal = local.events.filter(
    event => event.source !== 'provider' || team(event),
  )
  // A calendar the provider could not read this time keeps whatever was
  // already synced for it — an unreadable calendar is not an empty one.
  const failedCalendarIds = new Set(remote.failedCalendarIds ?? [])
  const keptFromFailedCalendars = failedCalendarIds.size
    ? local.events.filter(
        event =>
          event.source === 'provider' &&
          event.syncState === 'synced' &&
          failedCalendarIds.has(event.calendarId),
      )
    : []
  // A tombstoned id names an event deleted locally whose provider delete has
  // not been confirmed yet; letting the snapshot re-add it is the "deleted
  // events resurrect on refresh" bug.
  const removedEventIds = new Set(local.removedEventIds ?? [])
  const localById = new Map(local.events.map(event => [event.id, event]))
  const remoteEvents = remote.events
    .filter(event => !pendingIds.has(event.id) && !removedEventIds.has(event.id))
    .map(event => {
      const prev = localById.get(event.id)
      if (!prev) return event
      // Preserve local-only enrichments Google's snapshot does not round-trip.
      const keepReminders =
        event.reminders.length === 0 && prev.reminders.length > 0
          ? prev.reminders
          : event.reminders
      const keepLinked =
        event.linkedItems.length === 0 && prev.linkedItems.length > 0
          ? prev.linkedItems
          : event.linkedItems
      return keepReminders === event.reminders && keepLinked === event.linkedItems
        ? event
        : { ...event, reminders: keepReminders, linkedItems: keepLinked }
    })
  const remoteEventIds = new Set(remoteEvents.map(event => event.id))
  // Keep synced provider events that fall strictly outside a bounded fetch
  // window (e.g. events >90 days in the future) so periodic refresh never
  // erases far-future or past synced events.
  const windowStartMs = remote.fetchedWindow
    ? Date.parse(remote.fetchedWindow.start)
    : Number.NaN
  const windowEndMs = remote.fetchedWindow
    ? Date.parse(remote.fetchedWindow.end)
    : Number.NaN
  const keptOutsideWindow =
    Number.isFinite(windowStartMs) && Number.isFinite(windowEndMs)
      ? local.events.filter(event => {
          if (
            event.source !== 'provider' ||
            event.syncState !== 'synced' ||
            event.recurrenceRule != null ||
            team(event) ||
            pendingIds.has(event.id) ||
            removedEventIds.has(event.id) ||
            failedCalendarIds.has(event.calendarId) ||
            remoteEventIds.has(event.id)
          ) {
            return false
          }
          const startMs = parseEventBoundMs(event.startsAt, event.timeZone)
          const endMs = parseEventBoundMs(event.endsAt, event.timeZone)
          if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false
          return endMs <= windowStartMs || startMs >= windowEndMs
        })
      : []

  // A calendar the user removed must not come back on the next sync,
  // and neither may its events.
  const removedCalendarIds = new Set(local.settings.removedCalendarIds ?? [])
  const remoteCalendarById = new Map(remote.calendars.map(c => [c.id, c]))
  const localCalendarIds = new Set(local.calendars.map(c => c.id))
  const localAccountIds = new Set(local.accounts.map(a => a.id))
  const localSourceIds = new Set(local.sources.map(s => s.id))
  const mergedLocalCalendars = local.calendars.map(calendar => {
    const fresh = remoteCalendarById.get(calendar.id)
    if (!fresh) return calendar
    return {
      ...calendar,
      ...(fresh.readOnly !== undefined ? { readOnly: fresh.readOnly } : { readOnly: undefined }),
      ...(fresh.lastSyncedAt ? { lastSyncedAt: fresh.lastSyncedAt } : {}),
      ...(fresh.lastSyncError
        ? { lastSyncError: fresh.lastSyncError }
        : fresh.lastSyncedAt
          ? { lastSyncError: undefined }
          : {}),
    }
  })
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
      ...mergedLocalCalendars,
      ...remote.calendars.filter(
        calendar =>
          !localCalendarIds.has(calendar.id) &&
          !removedCalendarIds.has(calendar.id),
      ),
    ],
    events: [
      ...nonProviderLocal,
      ...unsyncedLocal,
      ...keptFromFailedCalendars.filter(
        event => !removedCalendarIds.has(event.calendarId),
      ),
      ...keptOutsideWindow.filter(
        event => !removedCalendarIds.has(event.calendarId),
      ),
      ...remoteEvents.filter(
        event => !removedCalendarIds.has(event.calendarId),
      ),
    ],
  }
}

export async function loadPersistedStore(): Promise<CalendarStore> {
  // Missing files are a first run. Failed reads or invalid files are not.
  const main = await readCalendarStoreFileVersioned(CALENDAR_STORE_FILE).then(
    answer => ({ value: answer.value, version: answer.version, failed: false }),
    () => ({ value: null, version: undefined, failed: true }),
  )
  const parsed = parsePersistedCalendarStore(main.value)
  if (parsed) {
    agreeWithLoaded(parsed, { version: main.version })
    return parsed
  }
  const backup = await readCalendarStoreFileVersioned(CALENDAR_STORE_BACKUP_FILE).then(
    answer => ({ value: answer.value, failed: false }),
    () => ({ value: null, failed: true }),
  )
  const recovered = parsePersistedCalendarStore(backup.value)
  if (recovered) {
    if (main.value !== null) {
      await writeCalendarStoreFile(CALENDAR_STORE_CORRUPT_FILE, main.value)
    }
    agreeWithLoaded(recovered, { fileUnreadable: main.failed })
    return recovered
  }
  if (main.failed || backup.failed || main.value !== null || backup.value !== null) {
    throw new Error('Saved calendar data could not be read. Your files have been kept. Try again, or restore a valid calendar backup.')
  }
  const firstRun = demoCalendarStore()
  agreeWithLoaded(firstRun, { version: main.version })
  return firstRun
}

export function usePureCalendarBoot(ready: boolean): PureCalendarBootState & { retryBoot: () => void } {
  const [attempt, setAttempt] = useState(0)
  const retryBoot = useCallback(() => setAttempt(value => value + 1), [])
  const [state, setState] = useState<PureCalendarBootState>({
    store: null,
    calendarProvider: null,
    bootError: null,
  })

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    setState({ store: null, calendarProvider: null, bootError: null })
    async function load(): Promise<void> {
      try {
        // App settings (viewMode, working hours, timezone) are persisted
        // separately; hydrate them over whatever the store carries so saved
        // preferences survive reload.
        const [persistedStore, settings] = await Promise.all([
          loadPersistedStore(),
          fetchCalendarSettings().catch(
            (error: unknown) => {
              console.warn(
                '[purecalendar] failed to read app settings; using store defaults:',
                error,
              )
              return {}
            },
          ),
        ])
        const nextStore = {
          ...persistedStore,
          settings: { ...persistedStore.settings, ...settings },
        }
        agreeOnSettings(nextStore.settings)

        // Open the saved workspace before checking credentials or contacting
        // Google. The mounted calendar owns background refresh and merges into
        // its current store, so edits made while a slow sync runs are retained.
        if (cancelled) return
        // Seed the fetch-time preferences from what was persisted, so
        // the very first sync already honours added/removed calendars;
        // the shell keeps them current from there.
        setGoogleCalendarPreferences({
          extraCalendarIds: nextStore.settings.googleExtraCalendarIds,
          removedCalendarIds: nextStore.settings.removedCalendarIds,
        })
        setState({ store: nextStore, calendarProvider: null, bootError: null })

        const credentialStatus = await fetchGoogleCredentialStatus().catch(
          (error: unknown) => {
            console.warn(
              '[purecalendar] failed to read google credential status; showing saved events:',
              error,
            )
            return null
          },
        )
        if (cancelled) return
        let calendarProvider: CalendarProvider | null = null
        let notice: string | undefined
        if (credentialStatus?.connected) {
          calendarProvider = new GoogleCalendarProvider({
            ...(credentialStatus.email
              ? { email: credentialStatus.email }
              : {}),
            fetch: networkFetch,
            accessToken: async () =>
              (await fetchGoogleAccessToken()).accessToken,
            extraCalendarIds: googleExtraCalendarIds,
            removedCalendarIds: googleRemovedCalendarIds,
          })
        } else if (credentialStatus?.needsReconnect) {
          notice =
            'Google access expired or was revoked. Reconnect in Calendar settings → Calendar connections.'
        }

        if (cancelled) return
        setState(current => ({
          ...current,
          calendarProvider,
          ...(notice ? { notice } : {}),
          bootError: null,
        }))
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
  }, [ready, attempt])

  return { ...state, retryBoot }
}
