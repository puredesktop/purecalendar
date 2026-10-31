import type { TeamCalendarListing } from '../bridge/platformBridge'
import type { CalendarStore } from '../types'
import { resolveCalendarTimeZone } from './calendarModel'
import { ICS_FEED_SOURCE_ID, mergeIcsFeedEvents, parseIcsFeed } from './icsFeed'
import { calendarsInScope, type OwnerCalendarRead } from './meetingTimes'
import { isTeamCalendarId, mergeTeamSnapshot } from './teamCalendar'

const DAY = 86_400_000
/** How far ahead each kind of calendar is read — the same windows the app's own refreshes use. */
export const TEAM_READ_WINDOW = { pastMs: 62 * DAY, futureMs: 400 * DAY }
export const FEED_READ_WINDOW = { pastMs: 30 * DAY, futureMs: 180 * DAY }

export interface OwnerCalendarSources {
  /** The connected Google account; null when it is not connected. */
  google: {
    fetchStore: () => Promise<CalendarStore>
    merge: (local: CalendarStore, remote: CalendarStore) => CalendarStore
    /** How far ahead its fetch reads. */
    futureMs: number
  } | null
  /** The organisation's team calendar; null where it is not offered. */
  team: { list: (range: { from: string; to: string }) => Promise<TeamCalendarListing> } | null
  fetchFeed: (url: string) => Promise<{ ok: boolean; status: number; body: string }>
  now?: () => Date
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * The owner's calendar re-read for Find a time: every source behind a visible
 * calendar — the Google account, the team calendar, each subscribed feed —
 * fetched now. A calendar whose source cannot be read (not connected, a
 * failed request, an unreadable feed) is marked failed, so the search refuses
 * instead of reading it as empty. Nothing is written back; the app's own
 * refreshes keep the stored copy.
 */
export async function refreshOwnerCalendar(local: CalendarStore, sources: OwnerCalendarSources): Promise<OwnerCalendarRead> {
  const now = (sources.now ?? (() => new Date()))().getTime()
  const timeZone = resolveCalendarTimeZone(local.settings).timeZone
  let store = local
  const failed = new Set<string>()
  const horizons: number[] = []
  const scope = calendarsInScope(local)
  const providerOf = (calendarId: string) => {
    const calendar = local.calendars.find(item => item.id === calendarId)
    const source = calendar ? local.sources.find(item => item.id === calendar.sourceId) : undefined
    return source ? local.accounts.find(item => item.id === source.accountId)?.provider : undefined
  }

  const google = scope.filter(calendar => !isTeamCalendarId(calendar.id) && providerOf(calendar.id) === 'google')
  if (google.length || sources.google) {
    if (!sources.google) {
      google.forEach(calendar => failed.add(calendar.id))
    } else {
      try {
        const remote = await sources.google.fetchStore()
        store = sources.google.merge(store, remote)
        for (const id of remote.failedCalendarIds ?? []) failed.add(id)
        horizons.push(now + sources.google.futureMs)
      } catch (error) {
        console.warn('[purecalendar] Find a time: Google could not be re-read:', message(error))
        google.forEach(calendar => failed.add(calendar.id))
      }
    }
  }

  const team = scope.filter(calendar => isTeamCalendarId(calendar.id))
  if (team.length) {
    if (!sources.team) {
      team.forEach(calendar => failed.add(calendar.id))
    } else {
      try {
        const listing = await sources.team.list({
          from: new Date(now - TEAM_READ_WINDOW.pastMs).toISOString(),
          to: new Date(now + TEAM_READ_WINDOW.futureMs).toISOString(),
        })
        // An answer that is not this person's team calendar (unavailable, or no identity) would make the merge drop
        // the team calendars and their meetings — so their time would look free. It is a failed read instead.
        if (!listing.available || !listing.me) throw new Error('the team calendar is not available to this person')
        store = mergeTeamSnapshot(store, listing, timeZone)
        horizons.push(now + TEAM_READ_WINDOW.futureMs)
      } catch (error) {
        console.warn('[purecalendar] Find a time: team calendar could not be re-read:', message(error))
        team.forEach(calendar => failed.add(calendar.id))
      }
    }
  }

  const feedCalendars = new Set(scope.filter(calendar => calendar.sourceId === ICS_FEED_SOURCE_ID).map(calendar => calendar.id))
  for (const feed of local.settings.icsFeeds ?? []) {
    if (!feedCalendars.has(feed.id)) continue
    try {
      const response = await sources.fetchFeed(feed.url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const events = parseIcsFeed(response.body, feed.id, now - FEED_READ_WINDOW.pastMs, now + FEED_READ_WINDOW.futureMs)
      if (!events) throw new Error('not a calendar')
      store = mergeIcsFeedEvents(store, feed, events)
      horizons.push(now + FEED_READ_WINDOW.futureMs)
    } catch (error) {
      console.warn(`[purecalendar] Find a time: feed "${feed.label}" could not be re-read:`, message(error))
      failed.add(feed.id)
    }
  }
  // A visible feed calendar with no subscription left cannot be re-read either.
  for (const id of feedCalendars) if (!(local.settings.icsFeeds ?? []).some(feed => feed.id === id)) failed.add(id)

  return {
    store: failed.size ? { ...store, failedCalendarIds: [...failed] } : { ...store, failedCalendarIds: undefined },
    timeZone,
    coveredUntil: horizons.length ? new Date(Math.min(...horizons)).toISOString() : null,
  }
}
