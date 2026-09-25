import {
  withHttpRetry,
  type HttpRetryOptions,
} from '@purescience/platform-ui/net/httpRetry.js'
import type {
  Calendar,
  CalendarAccount,
  CalendarEvent,
  CalendarProvider,
  CalendarSource,
  CalendarStore,
  EventAttendee,
} from '../types'
import { systemTimeZone } from './calendarModel'
import {
  isScopedRecurrenceException,
  recurrenceLinesForGoogle,
} from './googleRecurrence'

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3'
const EVENT_PAGE_SIZE = 250
const DEFAULT_PAST_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_FUTURE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000
const GOOGLE_ACCOUNT_ID = 'google-account'
const GOOGLE_SOURCE_ID = 'google-source'

/** Local ids are `g:<calendarId>:<eventId>` so they stay stable across syncs. */
export function googleEventLocalId(
  calendarId: string,
  eventId: string,
): string {
  return `g:${calendarId}:${eventId}`
}

export function parseGoogleEventLocalId(
  localId: string,
): { calendarId: string; eventId: string } | null {
  if (!localId.startsWith('g:')) return null
  const rest = localId.slice(2)
  const split = rest.lastIndexOf(':')
  if (split <= 0) return null
  return { calendarId: rest.slice(0, split), eventId: rest.slice(split + 1) }
}

export interface GoogleCalendarFetchRequest {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
}

export interface GoogleCalendarFetchResponse {
  status: number
  ok: boolean
  body: string
}

export interface GoogleCalendarProviderOptions {
  email?: string
  fetch: (
    request: GoogleCalendarFetchRequest,
  ) => Promise<GoogleCalendarFetchResponse>
  /** Fresh short-lived access token; the shell refreshes transparently. */
  accessToken: () => Promise<string>
  /** Event listing window; defaults to 30 days back / 90 days ahead. */
  timeMin?: () => string
  timeMax?: () => string
  /** Retry policy tuning; tests inject `sleep: async () => {}`. */
  retryOptions?: HttpRetryOptions
  /**
   * Shared calendars the user added by address. They are readable with
   * the events scope but are absent from the user's own calendarList,
   * so they are fetched explicitly alongside the discovered ones.
   */
  extraCalendarIds?: () => string[]
  /** Calendars the user removed; never re-fetched. */
  removedCalendarIds?: () => string[]
}

interface GoogleCalendarListItem {
  id: string
  summary?: string
  backgroundColor?: string
  primary?: boolean
  accessRole?: string
}

interface GoogleEventTime {
  date?: string
  dateTime?: string
  timeZone?: string
}

interface GoogleEventPerson {
  email?: string
  displayName?: string
  organizer?: boolean
  self?: boolean
  responseStatus?: string
}

interface GoogleEvent {
  id: string
  iCalUID?: string
  sequence?: number
  status?: string
  summary?: string
  description?: string
  location?: string
  hangoutLink?: string
  transparency?: string
  visibility?: string
  start?: GoogleEventTime
  end?: GoogleEventTime
  organizer?: GoogleEventPerson
  attendees?: GoogleEventPerson[]
  recurrence?: string[]
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>
  }
  attachments?: Array<{
    fileId?: string
    fileUrl?: string
    title?: string
    mimeType?: string
  }>
  extendedProperties?: {
    private?: Record<string, string>
  }
}

/**
 * App-private extended-property keys. Google's event model cannot carry a
 * user-set conference link (hangoutLink is read-only) or a 'tentative'
 * transparency, so both round-trip through extendedProperties.private —
 * which fetches back with the event — instead of silently reverting.
 */
const EXT_PROP_CONFERENCE_LINK = 'purecalendarConferenceLink'
const EXT_PROP_BUSY_STATUS = 'purecalendarBusyStatus'

function responseFromGoogle(status?: string): EventAttendee['response'] {
  switch (status) {
    case 'accepted':
      return 'accepted'
    case 'declined':
      return 'declined'
    case 'tentative':
      return 'tentative'
    default:
      return 'needsAction'
  }
}

function responseToGoogle(response: EventAttendee['response']): string {
  return response === 'needsAction' ? 'needsAction' : response
}

function attendeeFromGoogle(person: GoogleEventPerson): EventAttendee {
  return {
    name: person.displayName ?? person.email ?? '',
    email: person.email ?? '',
    response: responseFromGoogle(person.responseStatus),
  }
}

function eventTimeToIso(time: GoogleEventTime | undefined): string {
  return time?.dateTime ?? time?.date ?? ''
}

export function calendarEventFromGoogle(
  calendarId: string,
  event: GoogleEvent,
  fallbackTimeZone: string,
): CalendarEvent {
  const allDay = Boolean(event.start?.date && !event.start?.dateTime)
  // The app's own stored link (extended property) wins: it is the value the
  // user typed. Google-managed links fill in when the user set none.
  const conferenceLink =
    event.extendedProperties?.private?.[EXT_PROP_CONFERENCE_LINK] ||
    event.hangoutLink ||
    event.conferenceData?.entryPoints?.find(entry => entry.uri)?.uri
  const busyStatus =
    event.transparency === 'transparent'
      ? 'free'
      : event.extendedProperties?.private?.[EXT_PROP_BUSY_STATUS] ===
          'tentative'
        ? 'tentative'
        : 'busy'
  return {
    id: googleEventLocalId(calendarId, event.id),
    calendarId,
    ...(event.iCalUID ? { externalUid: event.iCalUID } : {}),
    ...(event.sequence !== undefined
      ? { externalSequence: event.sequence }
      : {}),
    title: event.summary?.trim() || '(No title)',
    description: event.description ?? '',
    ...(event.location ? { location: event.location } : {}),
    ...(conferenceLink ? { conferenceLink } : {}),
    startsAt: eventTimeToIso(event.start),
    endsAt: eventTimeToIso(event.end),
    timeZone: event.start?.timeZone ?? fallbackTimeZone,
    allDay,
    status:
      event.status === 'cancelled'
        ? 'cancelled'
        : event.status === 'tentative'
          ? 'tentative'
          : 'confirmed',
    visibility:
      event.visibility === 'private'
        ? 'private'
        : event.visibility === 'public'
          ? 'public'
          : 'default',
    busyStatus,
    ...(event.organizer
      ? { organizer: attendeeFromGoogle(event.organizer) }
      : {}),
    attendees: (event.attendees ?? []).map(attendeeFromGoogle),
    reminders: [],
    attachments: (event.attachments ?? [])
      .filter(attachment => attachment.fileId || attachment.fileUrl)
      .map(attachment => ({
        id: attachment.fileId ?? attachment.fileUrl ?? '',
        name: attachment.title || attachment.fileUrl || 'Attachment',
        mimeType: attachment.mimeType ?? '',
        // Google's attachments API carries no size; the row shows the name.
        sizeLabel: '',
      })),
    linkedItems: [],
    source: 'provider',
    syncState: 'synced',
  }
}

/**
 * Ask Google to email invites/updates natively when the event has attendees.
 * RSVP patches must NOT use this — updating one's own attendee copy should
 * not notify the other guests (see `rsvp`).
 */
function sendUpdatesQuery(event: CalendarEvent): string {
  return event.attendees.length && event.lifecycle !== 'draft'
    ? '?sendUpdates=all'
    : ''
}

export function googleEventBodyFromCalendarEvent(
  event: CalendarEvent,
): Record<string, unknown> {
  const time = (iso: string): Record<string, unknown> =>
    event.allDay
      ? { date: iso.slice(0, 10) }
      : { dateTime: iso, timeZone: event.timeZone }
  return {
    summary: event.title,
    description: event.description,
    ...(event.location ? { location: event.location } : {}),
    start: time(event.startsAt),
    end: time(event.endsAt),
    status: event.status,
    visibility: event.visibility,
    transparency: event.busyStatus === 'free' ? 'transparent' : 'opaque',
    // Round-trip what Google's model cannot hold: a user-set conference link
    // (hangoutLink is read-only) and the 'tentative' busy state (transparency
    // only knows opaque/transparent). Empty string clears a stale value.
    extendedProperties: {
      private: {
        [EXT_PROP_CONFERENCE_LINK]: event.conferenceLink ?? '',
        [EXT_PROP_BUSY_STATUS]:
          event.busyStatus === 'tentative' ? 'tentative' : '',
      },
    },
    // Draft events never carry attendees to Google: listed people on a
    // draft are not invited until the event is activated.
    ...(event.attendees.length && event.lifecycle !== 'draft'
      ? {
          attendees: event.attendees.map(attendee => ({
            email: attendee.email,
            ...(attendee.name && attendee.name !== attendee.email
              ? { displayName: attendee.name }
              : {}),
            responseStatus: responseToGoogle(attendee.response),
          })),
        }
      : {}),
    ...(event.recurrenceRule
      ? {
          recurrence: recurrenceLinesForGoogle(
            event.recurrenceRule,
            event.allDay,
          ),
        }
      : {}),
  }
}

export class GoogleCalendarProvider implements CalendarProvider {
  constructor(private readonly options: GoogleCalendarProviderOptions) {}

  private async request<T>(
    path: string,
    init: { method?: string; body?: string } = {},
  ): Promise<T> {
    const method = init.method ?? 'GET'
    // POST (createEvent) is the one non-idempotent call here. A THROWN
    // network error is ambiguous — the request may have reached Google
    // before the connection died — so retrying it could double-create the
    // event. Error *responses* (429/5xx) are safe to retry for every verb:
    // Google answered, so nothing was committed. GET/PATCH/DELETE are
    // idempotent and get the full policy.
    const retryThrownErrors = method !== 'POST'
    let unretriedNetworkFailure: unknown = null
    const response = await withHttpRetry(async () => {
      // Fresh token per attempt: the policy's single 401 retry is only
      // meaningful if the retry carries a newly issued token (the shell
      // refreshes transparently behind accessToken()).
      const accessToken = await this.options.accessToken()
      try {
        return await this.options.fetch({
          url: path.startsWith('https://')
            ? path
            : `${CALENDAR_API_BASE}${path}`,
          method,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(init.body ? { body: init.body } : {}),
        })
      } catch (error) {
        if (retryThrownErrors) throw error
        unretriedNetworkFailure = error
        // Sentinel the policy returns untouched (ok + non-retryable
        // status), so the failure is rethrown below without a retry.
        return { status: 0, ok: true, body: '' }
      }
    }, this.options.retryOptions)
    if (unretriedNetworkFailure !== null) throw unretriedNetworkFailure
    if (!response.ok) {
      throw new Error(
        `Google Calendar API error (${response.status}): ${response.body}`,
      )
    }
    return response.body ? (JSON.parse(response.body) as T) : ({} as T)
  }

  private windowStart(): string {
    return (
      this.options.timeMin?.() ??
      new Date(Date.now() - DEFAULT_PAST_WINDOW_MS).toISOString()
    )
  }

  private windowEnd(): string {
    return (
      this.options.timeMax?.() ??
      new Date(Date.now() + DEFAULT_FUTURE_WINDOW_MS).toISOString()
    )
  }

  private async listCalendars(): Promise<GoogleCalendarListItem[]> {
    const payload = await this.request<{ items?: GoogleCalendarListItem[] }>(
      '/users/me/calendarList',
    )
    return payload.items ?? []
  }

  /**
   * Metadata for one calendar the user named directly. Throws when the
   * account cannot see it, which is what makes this usable as the
   * "add a shared calendar" validation step.
   */
  async describeCalendar(calendarId: string): Promise<{
    id: string
    name: string
    color?: string
  }> {
    const entry = await this.request<{
      id?: string
      summary?: string
      backgroundColor?: string
    }>(`/calendars/${encodeURIComponent(calendarId)}`)
    return {
      id: entry.id ?? calendarId,
      name: entry.summary ?? calendarId,
      ...(entry.backgroundColor ? { color: entry.backgroundColor } : {}),
    }
  }

  /** Discovered calendarList plus user-added shared ids, minus removed. */
  private async resolveCalendars(): Promise<GoogleCalendarListItem[]> {
    const removed = new Set(this.options.removedCalendarIds?.() ?? [])
    const discovered = (await this.listCalendars()).filter(
      calendar => !removed.has(calendar.id),
    )
    const known = new Set(discovered.map(calendar => calendar.id))
    const extras: GoogleCalendarListItem[] = []
    for (const id of this.options.extraCalendarIds?.() ?? []) {
      if (known.has(id) || removed.has(id)) continue
      try {
        const described = await this.describeCalendar(id)
        extras.push({
          id: described.id,
          summary: described.name,
          ...(described.color ? { backgroundColor: described.color } : {}),
          accessRole: 'reader',
        })
        known.add(described.id)
      } catch {
        // A share that has been revoked should not fail the sync.
        continue
      }
    }
    return [...discovered, ...extras]
  }

  private async listCalendarEvents(
    calendarId: string,
    timeMin: string,
    timeMax: string,
  ): Promise<GoogleEvent[]> {
    const events: GoogleEvent[] = []
    let pageToken: string | undefined
    do {
      const params = new URLSearchParams({
        singleEvents: 'true',
        orderBy: 'startTime',
        timeMin,
        timeMax,
        maxResults: String(EVENT_PAGE_SIZE),
        ...(pageToken ? { pageToken } : {}),
      })
      const payload = await this.request<{
        items?: GoogleEvent[]
        nextPageToken?: string
      }>(
        `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
      )
      events.push(...(payload.items ?? []))
      pageToken = payload.nextPageToken
    } while (pageToken)
    return events
  }

  async fetchStore(): Promise<CalendarStore> {
    const timeMin = this.windowStart()
    const timeMax = this.windowEnd()
    const calendars = await this.resolveCalendars()
    const fallbackTimeZone = systemTimeZone()

    const events: CalendarEvent[] = []
    const failedCalendarIds: string[] = []
    for (const calendar of calendars) {
      let items: GoogleEvent[]
      try {
        items = await this.listCalendarEvents(calendar.id, timeMin, timeMax)
      } catch {
        // One unreadable calendar (revoked share, rate limit, blip) must
        // not cost the user every other calendar's events — but it must
        // be REPORTED, because the merge replaces provider events
        // wholesale and would otherwise treat "we could not read it" as
        // "it has no events" and drop what was already synced.
        failedCalendarIds.push(calendar.id)
        continue
      }
      for (const item of items) {
        if (item.status === 'cancelled') continue
        events.push(
          calendarEventFromGoogle(calendar.id, item, fallbackTimeZone),
        )
      }
    }

    const account: CalendarAccount = {
      id: GOOGLE_ACCOUNT_ID,
      provider: 'google',
      name: this.options.email ?? 'Google Calendar',
      email: this.options.email ?? '',
    }
    const source: CalendarSource = {
      id: GOOGLE_SOURCE_ID,
      accountId: account.id,
      name: 'Google Calendar',
      syncState: 'online',
    }
    const mappedCalendars: Calendar[] = calendars.map(calendar => ({
      id: calendar.id,
      sourceId: source.id,
      name: calendar.summary ?? calendar.id,
      color: calendar.backgroundColor ?? '#4285f4',
      visible: true,
      ...(calendar.accessRole === 'reader' ||
      calendar.accessRole === 'freeBusyReader'
        ? { readOnly: true }
        : {}),
    }))

    // Every calendar failing is a failed sync, not an empty account.
    if (failedCalendarIds.length > 0 && failedCalendarIds.length === calendars.length) {
      throw new Error(
        `Could not read any calendar (${failedCalendarIds.length} failed).`,
      )
    }

    return {
      accounts: [account],
      sources: [source],
      calendars: mappedCalendars,
      events,
      tasks: [],
      settings: {},
      ...(failedCalendarIds.length > 0 ? { failedCalendarIds } : {}),
    }
  }

  async sync(store: CalendarStore): Promise<CalendarStore> {
    // Deletions first: a tombstoned id is pushed to Google and pruned once
    // the provider confirms (404/410 counts — the event is already gone).
    // A failed delete keeps its tombstone, so the next sync retries and the
    // snapshot merge keeps refusing to resurrect the event meanwhile.
    const tombstones = store.removedEventIds ?? []
    const unconfirmedTombstones: string[] = []
    for (const eventId of tombstones) {
      if (!parseGoogleEventLocalId(eventId)) continue
      try {
        await this.deleteEvent(eventId)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!/\((404|410)\)/.test(message)) {
          console.warn(
            `[purecalendar] google delete failed for event ${eventId}; will retry:`,
            message,
          )
          unconfirmedTombstones.push(eventId)
        }
      }
    }

    // Only calendars that live at Google can take a newly created event; a
    // pending event on a local or demo calendar stays local (and visibly
    // pending) instead of being POSTed at a calendar id Google has never
    // heard of.
    const googleCalendarIds = new Set(
      store.calendars
        .filter(calendar => calendar.sourceId === GOOGLE_SOURCE_ID)
        .map(calendar => calendar.id),
    )
    const events = await Promise.all(
      store.events.map(async event => {
        if (event.syncState !== 'pending' || event.source !== 'provider') {
          return event
        }
        if (
          !parseGoogleEventLocalId(event.id) &&
          !googleCalendarIds.has(event.calendarId)
        ) {
          return event
        }
        // A scoped single-instance edit ("edit just this occurrence") is
        // stored locally as a standalone event with a synthetic
        // `${baseId}_only_${index}` id and no recurrenceRule
        // (applyRecurringEventEdit, scope 'this'). That synthetic id is NOT a
        // Google instance id — Google instance ids look like
        // `{eventId}_20260710T090000Z` and are only obtainable by GETting
        // `events/{recurringEventId}/instances`, which the local exception
        // does not carry. PATCHing the synthetic id would 404 (or, worse,
        // silently create a divergent standalone event), so we cannot honestly
        // round-trip the edited occurrence here.
        //
        // The occurrence's REMOVAL from the series still reaches Google: the
        // base event picks up `excludedStartsAt` on the same edit and now
        // serializes an EXDATE (see googleEventBodyFromCalendarEvent). What is
        // left unsynced is the *replacement* content of that one occurrence.
        // We mark it 'conflict' — never 'synced' — so the divergence is
        // visible in the sync summary UI rather than pretended-away.
        //
        // Full fix (future): after pushing the base RRULE+EXDATE, GET
        // `events/{recurringEventId}/instances?originalStart=<occurrenceStart>`
        // to resolve the real Google instance id, then PATCH that instance
        // (dropping the EXDATE for it) so the edited occurrence becomes a true
        // Google exception. Requires threading the base Google event id and the
        // original occurrence start through the local exception, which the
        // model does not currently persist.
        if (isScopedRecurrenceException(event)) {
          return { ...event, syncState: 'conflict' as const }
        }
        try {
          return parseGoogleEventLocalId(event.id)
            ? await this.updateEvent(event)
            : await this.createEvent(event)
        } catch (error) {
          // The failed state is surfaced in the sync summary UI, but keep
          // the underlying cause in the log so user reports are debuggable.
          console.warn(
            `[purecalendar] google push failed for event ${event.id} ("${event.title}"); marked failed:`,
            error instanceof Error ? error.message : error,
          )
          return { ...event, syncState: 'failed' as const }
        }
      }),
    )
    return {
      ...store,
      events,
      ...(tombstones.length
        ? { removedEventIds: unconfirmedTombstones }
        : {}),
    }
  }

  async createEvent(event: CalendarEvent): Promise<CalendarEvent> {
    const calendarId = event.calendarId || 'primary'
    const created = await this.request<GoogleEvent>(
      `/calendars/${encodeURIComponent(calendarId)}/events${sendUpdatesQuery(event)}`,
      {
        method: 'POST',
        body: JSON.stringify(googleEventBodyFromCalendarEvent(event)),
      },
    )
    return {
      ...calendarEventFromGoogle(calendarId, created, event.timeZone),
      // Keep local-only enrichments Google does not round-trip.
      reminders: event.reminders,
      linkedItems: event.linkedItems,
    }
  }

  async updateEvent(event: CalendarEvent): Promise<CalendarEvent> {
    const ref = parseGoogleEventLocalId(event.id)
    if (!ref) return this.createEvent(event)
    const updated = await this.request<GoogleEvent>(
      `/calendars/${encodeURIComponent(ref.calendarId)}/events/${encodeURIComponent(ref.eventId)}${sendUpdatesQuery(event)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(googleEventBodyFromCalendarEvent(event)),
      },
    )
    return {
      ...calendarEventFromGoogle(ref.calendarId, updated, event.timeZone),
      reminders: event.reminders,
      linkedItems: event.linkedItems,
    }
  }

  async deleteEvent(eventId: string): Promise<void> {
    const ref = parseGoogleEventLocalId(eventId)
    if (!ref) return
    // Attendees are unknown at delete time, so always ask Google to notify;
    // Google no-ops when the event had no attendees.
    await this.request<void>(
      `/calendars/${encodeURIComponent(ref.calendarId)}/events/${encodeURIComponent(ref.eventId)}?sendUpdates=all`,
      { method: 'DELETE' },
    )
  }

  async rsvp(
    eventId: string,
    response: EventAttendee['response'],
  ): Promise<CalendarEvent> {
    const ref = parseGoogleEventLocalId(eventId)
    if (!ref) throw new Error(`Not a Google event: ${eventId}`)
    const current = await this.request<GoogleEvent>(
      `/calendars/${encodeURIComponent(ref.calendarId)}/events/${encodeURIComponent(ref.eventId)}`,
    )
    // `self` names the connected account's own attendee copy. On events read
    // through a secondary calendar it can be absent, so fall back to matching
    // the connected account's email before giving up.
    const selfEmail = this.options.email?.trim().toLowerCase()
    const hasSelfFlag = (current.attendees ?? []).some(
      attendee => attendee.self === true,
    )
    const attendees = (current.attendees ?? []).map(attendee =>
      (
        hasSelfFlag
          ? attendee.self === true
          : Boolean(selfEmail) && attendee.email?.toLowerCase() === selfEmail
      )
        ? { ...attendee, responseStatus: responseToGoogle(response) }
        : attendee,
    )
    const updated = await this.request<GoogleEvent>(
      `/calendars/${encodeURIComponent(ref.calendarId)}/events/${encodeURIComponent(ref.eventId)}`,
      { method: 'PATCH', body: JSON.stringify({ attendees }) },
    )
    return calendarEventFromGoogle(ref.calendarId, updated, systemTimeZone())
  }
}
