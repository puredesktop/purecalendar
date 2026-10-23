import type { TeamCalendarEvent, TeamCalendarInput, TeamCalendarListing } from '../bridge/platformBridge'
import type { Calendar, CalendarEvent, CalendarStore, EventAttendee } from '../types'

/**
 * The team calendar: the organisation's own, kept on its server, shown as one
 * more account here. The whole organisation's calendar, and one for each team
 * the person is in; on each, meetings booked with teammates (who answer Yes,
 * Maybe or No) and the team's important dates (all day).
 *
 * Events from the server are `t:<id>` on `team:org` or `team:<team id>`.
 * Attendees are teammates; each has the address `<person id>@team.invalid`,
 * so this person's own copy is found as any account's is (the account's
 * address is theirs).
 */
export const TEAM_ACCOUNT_ID = 'team-account'
export const TEAM_SOURCE_ID = 'team-source'
const ORG = 'team:org'
const EVENT_PREFIX = 't:'
const ADDRESS = '@team.invalid'

export const isTeamCalendarId = (id: string): boolean => id.startsWith('team:')
export const isTeamEvent = (event: CalendarEvent): boolean => isTeamCalendarId(event.calendarId)
export const teamCalendarId = (teamId: string | null): string => (teamId ? `team:${teamId}` : ORG)
export const teamIdOfCalendar = (calendarId: string): string | null => (calendarId === ORG ? null : calendarId.slice('team:'.length))
/** The server's id of a team event already kept there, or null for one not yet sent. */
export const teamServerId = (eventId: string): string | null => (eventId.startsWith(EVENT_PREFIX) ? eventId.slice(EVENT_PREFIX.length) : null)
export const teammateAddress = (personId: string): string => `${personId}${ADDRESS}`
export const teammateId = (address: string): string | null => (address.endsWith(ADDRESS) ? address.slice(0, -ADDRESS.length) : null)

const RESPONSE_IN: Record<TeamCalendarEvent['attendees'][number]['response'], EventAttendee['response']> = {
  invited: 'needsAction',
  yes: 'accepted',
  maybe: 'tentative',
  no: 'declined',
}
export const teamResponse = (response: EventAttendee['response']): 'yes' | 'no' | 'maybe' | null =>
  response === 'accepted' ? 'yes' : response === 'declined' ? 'no' : response === 'tentative' ? 'maybe' : null

/** A calendar's own colours: the organisation's slate blue, each team its own after. */
const TEAM_COLOURS = ['#3f5f8a', '#7a4f9a', '#2f7a6d', '#a3582f', '#8a6d1f', '#9a3f62', '#4f7a2f']

export function calendarEventFromTeam(
  event: TeamCalendarEvent,
  me: string | null,
  timeZone: string,
): CalendarEvent {
  const mine = event.attendees.find(attendee => attendee.id === me)
  return {
    id: `${EVENT_PREFIX}${event.id}`,
    calendarId: teamCalendarId(event.team?.id ?? null),
    title: event.title,
    description: event.notes ?? '',
    ...(event.location ? { location: event.location } : {}),
    startsAt: event.start,
    endsAt: event.end,
    timeZone,
    allDay: event.allDay,
    status: 'confirmed',
    lifecycle: 'active',
    visibility: 'default',
    busyStatus:
      event.kind === 'date' || mine?.response === 'no'
        ? 'free'
        : mine?.response === 'maybe' || mine?.response === 'invited'
          ? 'tentative'
          : 'busy',
    organizer: { name: event.createdBy.name, email: teammateAddress(event.createdBy.id), response: 'accepted' },
    attendees: event.attendees.map(attendee => ({
      name: attendee.name,
      email: teammateAddress(attendee.id),
      response: RESPONSE_IN[attendee.response],
    })),
    reminders: event.kind === 'meeting' && !event.allDay ? [{ id: 'reminder_default', minutesBefore: 10 }] : [],
    attachments: [],
    linkedItems: [],
    source: 'provider',
    syncState: 'synced',
    team: { kind: event.kind, revision: event.revision, mayEdit: event.mayEdit },
  }
}

/** The day an all-day event's time falls on, here (a time saved as UTC midnight elsewhere is still that day). */
function dayOf(value: string, timeZone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return value.slice(0, 10)
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
  return parts
}

/** What the server keeps of an event here: its kind, times, place, notes, calendar and who is invited. */
export function teamInputFromEvent(event: CalendarEvent): TeamCalendarInput {
  const kind = event.team?.kind ?? (event.allDay && !event.attendees.length ? 'date' : 'meeting')
  const allDay = kind === 'date' || event.allDay
  let start = allDay ? dayOf(event.startsAt, event.timeZone) : new Date(event.startsAt).toISOString()
  let end = allDay ? dayOf(event.endsAt, event.timeZone) : new Date(event.endsAt).toISOString()
  if (allDay && end <= start) {
    const next = new Date(`${start}T00:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    end = next.toISOString().slice(0, 10)
  }
  if (!allDay && end <= start) end = new Date(Date.parse(start) + 30 * 60_000).toISOString()
  start ||= event.startsAt
  return {
    ...(teamServerId(event.id) ? { id: teamServerId(event.id)!, ...(event.team ? { ifRevision: event.team.revision } : {}) } : {}),
    kind,
    title: event.title.trim(),
    start,
    end,
    allDay,
    location: event.location?.trim() || null,
    notes: event.description.trim() || null,
    teamId: teamIdOfCalendar(event.calendarId),
    attendees: kind === 'date' ? [] : event.attendees.map(attendee => teammateId(attendee.email)).filter((id): id is string => !!id),
  }
}

/**
 * The team calendar as the server has it now, put into the store: its account,
 * its calendars (the organisation's and one per team, keeping what the person
 * chose for each), and its events, except those changed here and not yet sent,
 * and those removed here and not yet gone there. Not in an organisation: all of
 * it goes.
 */
export function mergeTeamSnapshot(local: CalendarStore, listing: TeamCalendarListing, timeZone: string): CalendarStore {
  if (!listing.available || !listing.me) {
    if (!local.calendars.some(calendar => isTeamCalendarId(calendar.id))) return local
    return {
      ...local,
      accounts: local.accounts.filter(account => account.id !== TEAM_ACCOUNT_ID),
      sources: local.sources.filter(source => source.id !== TEAM_SOURCE_ID),
      calendars: local.calendars.filter(calendar => !isTeamCalendarId(calendar.id)),
      events: local.events.filter(event => !isTeamEvent(event)),
    }
  }
  const organisation = listing.organisation ?? 'Organisation'
  const wanted: Array<{ id: string; name: string }> = [
    { id: ORG, name: organisation },
    ...listing.teams.map(team => ({ id: teamCalendarId(team.id), name: team.name })),
  ]
  const removed = new Set(local.settings.removedCalendarIds ?? [])
  const had = new Map(local.calendars.map(calendar => [calendar.id, calendar]))
  const calendars: Calendar[] = wanted
    .filter(calendar => !removed.has(calendar.id))
    .map((calendar, index) => {
      const before = had.get(calendar.id)
      return before
        ? { ...before, name: calendar.name, sourceId: TEAM_SOURCE_ID, readOnly: false }
        : { id: calendar.id, sourceId: TEAM_SOURCE_ID, name: calendar.name, color: TEAM_COLOURS[index % TEAM_COLOURS.length], visible: true, readOnly: false }
    })
  const calendarIds = new Set(calendars.map(calendar => calendar.id))
  const unsent = local.events.filter(event => isTeamEvent(event) && event.syncState !== 'synced')
  const unsentIds = new Set(unsent.map(event => event.id))
  const tombstones = new Set(local.removedEventIds ?? [])
  const reminders = new Map(local.events.filter(isTeamEvent).map(event => [event.id, event.reminders]))
  const remote = listing.events
    .map(event => calendarEventFromTeam(event, listing.me!.id, timeZone))
    .filter(event => !unsentIds.has(event.id) && !tombstones.has(event.id) && calendarIds.has(event.calendarId))
    .map(event => (reminders.has(event.id) ? { ...event, reminders: reminders.get(event.id)! } : event))
  const account = { id: TEAM_ACCOUNT_ID, provider: 'team' as const, name: organisation, email: teammateAddress(listing.me.id) }
  return {
    ...local,
    accounts: [...local.accounts.filter(item => item.id !== TEAM_ACCOUNT_ID), account],
    sources: [...local.sources.filter(item => item.id !== TEAM_SOURCE_ID), { id: TEAM_SOURCE_ID, accountId: TEAM_ACCOUNT_ID, name: organisation, syncState: 'online' }],
    calendars: [...local.calendars.filter(calendar => !isTeamCalendarId(calendar.id)), ...calendars],
    events: [
      ...local.events.filter(event => !isTeamEvent(event)),
      ...unsent.filter(event => calendarIds.has(event.calendarId)),
      ...remote,
    ],
  }
}

/** Team events changed here and ready to send: titled (the server needs a title) and not a private draft. */
export function teamEventsToSend(store: CalendarStore): CalendarEvent[] {
  return store.events.filter(
    event => isTeamEvent(event) && event.syncState === 'pending' && event.title.trim().length > 0 && (event.team?.mayEdit ?? true),
  )
}
export const teamTombstones = (store: CalendarStore): string[] => (store.removedEventIds ?? []).filter(id => teamServerId(id) !== null)

export type TeamPushOutcome =
  | { kind: 'saved'; sent: CalendarEvent; event: TeamCalendarEvent; clashes: Array<{ title: string; people: string[] }> }
  | { kind: 'refused'; sent: CalendarEvent; problem: string; conflict: boolean }
  | { kind: 'removed'; id: string }

/**
 * What came back from sending, put into the store as it is now: an event saved
 * there takes the server's copy (and its `t:` id when it was new), unless it
 * was changed again while sending (then it keeps those changes, still to send,
 * against the new revision); one refused says why; a removal confirmed lets
 * its tombstone go.
 */
export function mergeTeamPushResult(
  current: CalendarStore,
  outcomes: TeamPushOutcome[],
  me: string | null,
  timeZone: string,
): { store: CalendarStore; renamed: Map<string, string> } {
  const renamed = new Map<string, string>()
  let events = current.events
  let removedEventIds = current.removedEventIds ?? []
  for (const outcome of outcomes) {
    if (outcome.kind === 'removed') {
      removedEventIds = removedEventIds.filter(id => id !== outcome.id)
      continue
    }
    const at = events.findIndex(event => event.id === outcome.sent.id)
    if (at < 0) continue
    const now = events[at]!
    const unchanged = now === outcome.sent
    let next: CalendarEvent
    if (outcome.kind === 'saved') {
      const saved = calendarEventFromTeam(outcome.event, me, timeZone)
      next = unchanged
        ? { ...saved, reminders: now.reminders }
        : { ...now, id: saved.id, team: { ...saved.team!, problem: undefined }, syncState: 'pending' }
      if (saved.id !== now.id) renamed.set(now.id, saved.id)
    } else {
      next = { ...now, syncState: unchanged ? (outcome.conflict ? 'conflict' : 'failed') : 'pending', team: { ...(now.team ?? { kind: 'meeting', revision: 0, mayEdit: true }), problem: outcome.problem } }
    }
    events = [...events.slice(0, at), next, ...events.slice(at + 1)]
  }
  return { store: { ...current, events, removedEventIds }, renamed }
}

/**
 * The first time from `from`, within working hours on working days, when
 * nobody chosen is taken, for a meeting `minutes` long; searched a fortnight
 * ahead, in 15-minute steps. Null when there is none.
 */
export function firstFreeTime(
  busy: Array<{ start: string; end: string }>,
  options: { from: Date; minutes: number; workStart: number; workEnd: number; days: number[]; timeZone: string },
): { start: string; end: string } | null {
  const taken = busy.map(time => [Date.parse(time.start), Date.parse(time.end)] as const).filter(([a, b]) => b > a)
  const step = 15 * 60_000
  const length = options.minutes * 60_000
  let at = Math.ceil(options.from.getTime() / step) * step
  const until = at + 14 * 86_400_000
  const wall = new Intl.DateTimeFormat('en-GB', { timeZone: options.timeZone, hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const local = (ms: number) => {
    const parts = Object.fromEntries(wall.formatToParts(new Date(ms)).map(part => [part.type, part.value]))
    return { day: weekdays.indexOf(parts.weekday ?? ''), hours: Number(parts.hour) + Number(parts.minute) / 60 }
  }
  for (; at < until; at += step) {
    const start = local(at)
    const end = local(at + length)
    if (!options.days.includes(start.day) || start.day !== end.day) continue
    if (start.hours < options.workStart || end.hours > options.workEnd || end.hours <= start.hours) continue
    if (taken.some(([a, b]) => a < at + length && b > at)) continue
    return { start: new Date(at).toISOString(), end: new Date(at + length).toISOString() }
  }
  return null
}
