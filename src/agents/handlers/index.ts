import type { MutableRefObject } from 'react'
import {
  agentToolErrorContent,
  formatAgentToolJson,
  readAgentToolStringArg,
} from '@purescience/platform-ui/bridge/agentToolHelpers'
import type { AgentToolHandler } from '@purescience/platform-ui/bridge/react/usePlatformAgentTools'
import { recordOperation } from '../../bridge/platformBridge'
import type { CalendarStore, EventAttendee, EventStatus } from '../../types'
import {
  activateEvent,
  canEditCalendarEvent,
  allDayEventPatch,
  createDraftEvent,
  firstEditableCalendarId,
  resolveAgentEventTime,
  isDraftEvent,
  moveEvent,
  removeEventWithTombstone,
  searchCalendarStore,
  systemTimeZone,
  visibleCalendarEvents,
} from '../../lib/calendarModel'

type StoreDispatch = (
  updater: CalendarStore | ((prev: CalendarStore) => CalendarStore),
) => void

let agentStoreRef: MutableRefObject<CalendarStore | null> | null = null
let agentStoreDispatch: StoreDispatch | null = null

export function setAgentStore(
  ref: MutableRefObject<CalendarStore | null> | null,
): void {
  agentStoreRef = ref
}

export function syncAgentStore(store: CalendarStore): void {
  if (agentStoreRef) {
    agentStoreRef.current = store
  }
}

export function setAgentStoreDispatch(dispatch: StoreDispatch | null): void {
  agentStoreDispatch = dispatch
}

/**
 * Apply an event-list change to whatever the store holds NOW.
 *
 * Every tool used to build a whole new store from its own snapshot and
 * dispatch it as a value. Anything that changed React state in between — an
 * ICS feed refresh runs every five minutes — was overwritten by that
 * snapshot, and since the persist effect saves what React state ends up
 * holding, the losing write was gone after a reload too. That is how an event
 * the agent really did add is not there afterwards.
 *
 * Dispatching an updater composes with the current state instead of
 * replacing it, so the two writes cannot erase each other.
 */
function commitEvents(
  store: CalendarStore,
  change: (events: CalendarStore['events']) => CalendarStore['events'],
): void {
  commitStore(store, current => ({
    ...current,
    events: change(current.events),
  }))
}

/** Same contract as commitEvents for changes that touch more than `events`
 * (e.g. delete, which also writes a tombstone). */
function commitStore(
  store: CalendarStore,
  change: (store: CalendarStore) => CalendarStore,
): void {
  if (agentStoreRef) {
    agentStoreRef.current = change(store)
  }
  if (agentStoreDispatch) {
    agentStoreDispatch(prev => change(prev))
  }
}

/** Ledger entry for an agent-lane calendar interaction (fire and forget). */
function recordAgentOperation(kind: string, summary: string): void {
  void recordOperation({
    lane: 'agent',
    kind,
    appSlug: 'calendar',
    summary,
  }).catch(() => undefined)
}

function requireStore(): CalendarStore {
  const store = agentStoreRef?.current ?? null
  if (!store) {
    throw new Error('Calendar store is not loaded yet.')
  }
  return store
}

/**
 * Attendees arrive as an array of { email, name? } objects (or bare email
 * strings). Returns undefined when the argument is absent so callers can
 * distinguish "not provided" from "provided empty".
 */
function readAttendeesArg(
  args: Record<string, unknown>,
): EventAttendee[] | undefined {
  const raw = args.attendees
  if (!Array.isArray(raw)) return undefined
  const attendees: EventAttendee[] = []
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) {
      attendees.push({
        name: item.trim(),
        email: item.trim(),
        response: 'needsAction',
      })
      continue
    }
    if (
      item &&
      typeof item === 'object' &&
      typeof (item as { email?: unknown }).email === 'string' &&
      ((item as { email: string }).email.trim().length > 0)
    ) {
      const email = (item as { email: string }).email.trim()
      const name =
        typeof (item as { name?: unknown }).name === 'string' &&
        ((item as { name: string }).name.trim().length > 0)
          ? (item as { name: string }).name.trim()
          : email
      attendees.push({ name, email, response: 'needsAction' })
    }
  }
  return attendees
}

const listCalendarEvents: AgentToolHandler = async invoke => {
  const startsAt = readAgentToolStringArg(invoke.arguments, 'startsAt')
  const endsAt = readAgentToolStringArg(invoke.arguments, 'endsAt')

  if (!startsAt || !endsAt) {
    return agentToolErrorContent(
      'startsAt and endsAt are required ISO 8601 date strings.',
    )
  }

  try {
    const store = requireStore()
    let events = visibleCalendarEvents(store, startsAt, endsAt)
    const calendarId = readAgentToolStringArg(invoke.arguments, 'calendarId')
    if (calendarId) {
      events = events.filter(e => e.calendarId === calendarId)
    }
    return {
      content: formatAgentToolJson({
        events: events.map(e => ({
          id: e.id,
          title: e.title,
          startsAt: e.startsAt,
          endsAt: e.endsAt,
          calendarId: e.calendarId,
          status: e.status,
          allDay: e.allDay,
          timeZone: e.timeZone,
          recurrenceRule: e.recurrenceRule,
        })),
      }),
    }
  } catch (error) {
    return agentToolErrorContent(
      error instanceof Error ? error.message : String(error),
    )
  }
}

const searchCalendar: AgentToolHandler = async invoke => {
  const query = readAgentToolStringArg(invoke.arguments, 'query')

  if (!query) {
    return agentToolErrorContent('query is required.')
  }

  try {
    const store = requireStore()
    const results = searchCalendarStore(store, query)
    return {
      content: formatAgentToolJson({ results }),
    }
  } catch (error) {
    return agentToolErrorContent(
      error instanceof Error ? error.message : String(error),
    )
  }
}

const createCalendarDraft: AgentToolHandler = async invoke => {
  const title = readAgentToolStringArg(invoke.arguments, 'title')
  const startsAt = readAgentToolStringArg(invoke.arguments, 'startsAt')
  const endsAt = readAgentToolStringArg(invoke.arguments, 'endsAt')

  if (!title || !startsAt || !endsAt) {
    return agentToolErrorContent(
      'title, startsAt, and endsAt are required.',
    )
  }

  try {
    const store = requireStore()
    const calendarId =
      readAgentToolStringArg(invoke.arguments, 'calendarId') ||
      firstEditableCalendarId(store)
    if (!calendarId) {
      return agentToolErrorContent('No editable calendar is available.')
    }
    const timeZone =
      readAgentToolStringArg(invoke.arguments, 'timeZone') || undefined
    const zone = timeZone || systemTimeZone()

    // Resolve before storing. A bare date or a zoneless wall time used to be
    // written through verbatim and read back as UTC, which put the event on
    // the day before anywhere west of Greenwich.
    const start = resolveAgentEventTime(startsAt, zone)
    if (!start) {
      return agentToolErrorContent(
        `startsAt "${startsAt}" is not a time. Use a full instant (2026-08-27T09:00:00Z), a local time (2026-08-27T09:00), or a plain date (2026-08-27) for an all-day event.`,
      )
    }
    const end = resolveAgentEventTime(endsAt, zone)
    if (!end) {
      return agentToolErrorContent(
        `endsAt "${endsAt}" is not a time. Use the same form as startsAt.`,
      )
    }

    const event = createDraftEvent(calendarId, start.instant, title, timeZone)
    event.endsAt = end.instant
    // A date with no time is an all-day event, which is what "put it on the
    // 27th" means. Stored as midnight-to-midnight in the event's own zone.
    if (start.dateOnly) {
      Object.assign(
        event,
        allDayEventPatch(
          { startsAt: start.instant, endsAt: end.instant },
          true,
          zone,
        ),
      )
    }
    if (Date.parse(event.endsAt) <= Date.parse(event.startsAt)) {
      return agentToolErrorContent(
        `endsAt (${event.endsAt}) must be after startsAt (${event.startsAt}).`,
      )
    }
    const attendees = readAttendeesArg(invoke.arguments)
    if (attendees) {
      event.attendees = attendees
    }
    commitEvents(store, events => [...events, event])
    recordAgentOperation(
      'calendar.event.create',
      `Created draft event "${event.title}" starting ${event.startsAt}`,
    )
    return {
      content: formatAgentToolJson({
        id: event.id,
        // The RESOLVED values, so a wrong day is visible in the tool result
        // instead of only on the calendar days later.
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        allDay: event.allDay,
        timeZone: event.timeZone,
        calendarId: event.calendarId,
        lifecycle: event.lifecycle,
        attendeesListed: event.attendees.map(a => a.email),
      }),
    }
  } catch (error) {
    return agentToolErrorContent(
      error instanceof Error ? error.message : String(error),
    )
  }
}

const updateCalendarEvent: AgentToolHandler = async invoke => {
  const eventId = readAgentToolStringArg(invoke.arguments, 'eventId')

  if (!eventId) {
    return agentToolErrorContent('eventId is required.')
  }

  try {
    const store = requireStore()
    const existing = store.events.find(e => e.id === eventId)
    if (!existing) {
      return agentToolErrorContent(`Event ${eventId} not found.`)
    }

    if (!canEditCalendarEvent(store, existing)) {
      return agentToolErrorContent(`Event ${eventId} is read-only.`)
    }

    const patch: Record<string, unknown> = {}
    const title = readAgentToolStringArg(invoke.arguments, 'title')
    if (title != null) patch.title = title
    const timeZone = readAgentToolStringArg(invoke.arguments, 'timeZone')
    if (timeZone != null) patch.timeZone = timeZone

    // Times resolve through the same path as createCalendarDraft: a bare
    // date or zoneless wall time stored verbatim reads back as UTC and lands
    // on the wrong day west of Greenwich.
    const zone = timeZone || existing.timeZone || systemTimeZone()
    const startsAtArg = readAgentToolStringArg(invoke.arguments, 'startsAt')
    let startsAt: string | undefined
    if (startsAtArg != null) {
      const resolved = resolveAgentEventTime(startsAtArg, zone)
      if (!resolved) {
        return agentToolErrorContent(
          `startsAt "${startsAtArg}" is not a time. Use a full instant (2026-08-27T09:00:00Z), a local time (2026-08-27T09:00), or a plain date (2026-08-27).`,
        )
      }
      startsAt = resolved.instant
      patch.startsAt = resolved.instant
    }
    const endsAtArg = readAgentToolStringArg(invoke.arguments, 'endsAt')
    let endsAt: string | undefined
    if (endsAtArg != null) {
      const resolved = resolveAgentEventTime(endsAtArg, zone)
      if (!resolved) {
        return agentToolErrorContent(
          `endsAt "${endsAtArg}" is not a time. Use the same form as startsAt.`,
        )
      }
      endsAt = resolved.instant
      patch.endsAt = resolved.instant
    }
    const description = readAgentToolStringArg(invoke.arguments, 'description')
    if (description != null) patch.description = description
    const status = readAgentToolStringArg(invoke.arguments, 'status')
    if (status != null) {
      // Free strings would be pushed verbatim to Google, which rejects them.
      const statuses: EventStatus[] = ['confirmed', 'tentative', 'cancelled']
      if (!statuses.includes(status as EventStatus)) {
        return agentToolErrorContent(
          `status "${status}" is not valid. Use one of: ${statuses.join(', ')}.`,
        )
      }
      patch.status = status
    }
    const location = readAgentToolStringArg(invoke.arguments, 'location')
    if (location != null) patch.location = location
    const calendarId = readAgentToolStringArg(invoke.arguments, 'calendarId')
    if (calendarId != null) patch.calendarId = calendarId
    const allDay =
      'allDay' in invoke.arguments &&
      typeof invoke.arguments.allDay === 'boolean'
        ? invoke.arguments.allDay
        : undefined
    const attendees = readAttendeesArg(invoke.arguments)
    if (attendees !== undefined) patch.attendees = attendees

    const moved = startsAt != null && endsAt == null
      ? moveEvent(existing, startsAt)
      : null
    let updated: CalendarStore['events'][number] = moved
      ? { ...moved, ...patch, syncState: 'pending' as const }
      : { ...existing, ...patch, syncState: 'pending' as const }
    if (allDay !== undefined) {
      // allDayEventPatch snaps times to day boundaries in the event's zone —
      // setting only the flag renders the event on the wrong day for
      // negative-UTC-offset timezones.
      updated = { ...updated, ...allDayEventPatch(updated, allDay, zone) }
    }
    commitEvents(store, events => events.map(e => (e.id === eventId ? updated : e)))
    recordAgentOperation(
      'calendar.event.update',
      `Updated event "${updated.title}" (${updated.id})`,
    )
    return {
      content: formatAgentToolJson({
        id: updated.id,
        title: updated.title,
        startsAt: updated.startsAt,
        endsAt: updated.endsAt,
        allDay: updated.allDay,
        status: updated.status,
      }),
    }
  } catch (error) {
    return agentToolErrorContent(
      error instanceof Error ? error.message : String(error),
    )
  }
}

const deleteCalendarEvent: AgentToolHandler = async invoke => {
  const eventId = readAgentToolStringArg(invoke.arguments, 'eventId')

  if (!eventId) {
    return agentToolErrorContent('eventId is required.')
  }

  try {
    const store = requireStore()
    const existing = store.events.find(e => e.id === eventId)
    if (!existing) {
      return agentToolErrorContent(`Event ${eventId} not found.`)
    }

    if (!canEditCalendarEvent(store, existing)) {
      return agentToolErrorContent(`Event ${eventId} is read-only.`)
    }

    // Remove + tombstone: the tombstone keeps a provider-backed event from
    // resurrecting on the next snapshot merge and queues the provider-side
    // delete for the sync loop.
    commitStore(store, current => removeEventWithTombstone(current, eventId))
    const providerDeleteQueued = eventId.startsWith('g:')
    recordAgentOperation(
      'calendar.event.delete',
      `Deleted event "${existing.title}" (${eventId})`,
    )
    return {
      content: formatAgentToolJson({
        id: eventId,
        removed: true,
        // Truthful report: the event is gone locally; a provider-backed
        // event's remote copy is deleted by the next sync.
        providerDeleteQueued,
      }),
    }
  } catch (error) {
    return agentToolErrorContent(
      error instanceof Error ? error.message : String(error),
    )
  }
}

const rescheduleCalendarEvent: AgentToolHandler = async invoke => {
  const eventId = readAgentToolStringArg(invoke.arguments, 'eventId')
  const startsAt = readAgentToolStringArg(invoke.arguments, 'startsAt')

  if (!eventId || !startsAt) {
    return agentToolErrorContent('eventId and startsAt are required.')
  }

  try {
    const store = requireStore()
    const existing = store.events.find(e => e.id === eventId)
    if (!existing) {
      return agentToolErrorContent(`Event ${eventId} not found.`)
    }

    if (!canEditCalendarEvent(store, existing)) {
      return agentToolErrorContent(`Event ${eventId} is read-only.`)
    }

    // Same bare-date/zoneless resolution as createCalendarDraft: a raw
    // string stored verbatim reads back as UTC and shifts the day.
    const zone = existing.timeZone || systemTimeZone()
    const resolved = resolveAgentEventTime(startsAt, zone)
    if (!resolved) {
      return agentToolErrorContent(
        `startsAt "${startsAt}" is not a time. Use a full instant (2026-08-27T09:00:00Z), a local time (2026-08-27T09:00), or a plain date (2026-08-27).`,
      )
    }

    const moved = moveEvent(existing, resolved.instant)
    commitEvents(store, events => events.map(e => (e.id === eventId ? moved : e)))
    recordAgentOperation(
      'calendar.event.reschedule',
      `Rescheduled event "${moved.title}" to ${moved.startsAt}`,
    )
    return {
      content: formatAgentToolJson({ id: moved.id, startsAt: moved.startsAt }),
    }
  } catch (error) {
    return agentToolErrorContent(
      error instanceof Error ? error.message : String(error),
    )
  }
}

const activateCalendarEvent: AgentToolHandler = async invoke => {
  const eventId = readAgentToolStringArg(invoke.arguments, 'eventId')

  if (!eventId) {
    return agentToolErrorContent('eventId is required.')
  }

  try {
    const store = requireStore()
    const existing = store.events.find(e => e.id === eventId)
    if (!existing) {
      return agentToolErrorContent(`Event ${eventId} not found.`)
    }

    if (!canEditCalendarEvent(store, existing)) {
      return agentToolErrorContent(`Event ${eventId} is read-only.`)
    }

    if (!isDraftEvent(existing)) {
      return {
        content: formatAgentToolJson({
          id: existing.id,
          lifecycle: 'active',
          note: 'Event was already active; nothing changed.',
        }),
      }
    }

    const activated = activateEvent(existing)
    commitEvents(store, events => events.map(e => (e.id === eventId ? activated : e)))
    recordAgentOperation(
      'calendar.event.activate',
      `Activated event "${activated.title}" (${eventId})`,
    )
    return {
      content: formatAgentToolJson({
        id: activated.id,
        title: activated.title,
        lifecycle: activated.lifecycle,
        attendeesInvited: activated.attendees.map(a => a.email),
      }),
    }
  } catch (error) {
    return agentToolErrorContent(
      error instanceof Error ? error.message : String(error),
    )
  }
}

const getCalendarSettings: AgentToolHandler = async () => {
  try {
    const store = requireStore()
    const settings = store.settings
    const resolvedTimeZone =
      settings.timeZoneMode === 'fixed' && settings.timeZone
        ? settings.timeZone
        : systemTimeZone()
    let defaultCalendarId: string | null = null
    try {
      defaultCalendarId = firstEditableCalendarId(store)
    } catch {
      defaultCalendarId = null
    }
    return {
      content: formatAgentToolJson({
        timeZone: resolvedTimeZone,
        timeZoneMode: settings.timeZoneMode ?? 'system',
        workStart: settings.workStart ?? null,
        workEnd: settings.workEnd ?? null,
        availableDays: settings.availableDays ?? null,
        availableStartHour: settings.availableStartHour ?? null,
        availableEndHour: settings.availableEndHour ?? null,
        viewMode: settings.viewMode ?? null,
        defaultCalendarId,
        calendars: store.calendars.map(calendar => ({
          id: calendar.id,
          name: calendar.name,
          visible: calendar.visible,
          readOnly: calendar.readOnly === true,
        })),
      }),
    }
  } catch (error) {
    return agentToolErrorContent(
      error instanceof Error ? error.message : String(error),
    )
  }
}

export const appAgentHandlers = {
  listCalendarEvents,
  searchCalendar,
  getCalendarSettings,
  createCalendarDraft,
  updateCalendarEvent,
  deleteCalendarEvent,
  rescheduleCalendarEvent,
  activateCalendarEvent,
} satisfies Record<string, AgentToolHandler>
