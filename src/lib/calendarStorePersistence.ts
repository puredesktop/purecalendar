import type {
  Calendar,
  CalendarAccount,
  CalendarEvent,
  CalendarSettings,
  CalendarSource,
  CalendarStore,
  CalendarTask,
  EventAttendee,
} from '../types'

/**
 * Validation for the persisted calendar store. Everything read back from disk
 * is untrusted: a torn write, a hand-edited file, or an older schema must
 * never crash boot or corrupt the in-memory model. Invalid top-level shapes
 * reject the whole blob (the caller falls back to the rolling backup, then
 * the demo seed); invalid individual records are dropped with the rest kept.
 */

export const CALENDAR_STORE_FILE = 'calendar-store.json'
export const CALENDAR_STORE_BACKUP_FILE = 'calendar-store.bak.json'
export const CALENDAR_STORE_CORRUPT_FILE = 'calendar-store.corrupt.json'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  return Number.isNaN(Date.parse(value)) ? undefined : value
}

function normalizeAttendee(input: unknown): EventAttendee | null {
  if (!isRecord(input)) return null
  const email = asString(input.email)
  if (email === undefined) return null
  const response = input.response
  return {
    name: asString(input.name) ?? '',
    email,
    response:
      response === 'accepted' ||
      response === 'declined' ||
      response === 'tentative'
        ? response
        : 'needsAction',
  }
}

function normalizeEvent(input: unknown): CalendarEvent | null {
  if (!isRecord(input)) return null
  const id = asString(input.id)
  const calendarId = asString(input.calendarId)
  const startsAt = asIsoDate(input.startsAt)
  const endsAt = asIsoDate(input.endsAt)
  // An event without a valid identity or time range cannot be represented on
  // the grid; dropping it is the only option that keeps the rest loadable.
  if (!id || !calendarId || !startsAt || !endsAt) return null
  const status = input.status
  const busyStatus = input.busyStatus
  const visibility = input.visibility
  const source = input.source
  const syncState = input.syncState
  const rule = isRecord(input.recurrenceRule) ? input.recurrenceRule : null
  const ruleFrequency = rule ? rule.frequency : null
  const attendees = Array.isArray(input.attendees)
    ? input.attendees
        .map(normalizeAttendee)
        .filter((item): item is EventAttendee => item !== null)
    : []
  const organizer = normalizeAttendee(input.organizer)
  return {
    id,
    calendarId,
    externalUid: asString(input.externalUid),
    externalSequence:
      typeof input.externalSequence === 'number' &&
      Number.isFinite(input.externalSequence)
        ? input.externalSequence
        : undefined,
    externalMethod:
      input.externalMethod === 'REQUEST' ||
      input.externalMethod === 'REPLY' ||
      input.externalMethod === 'CANCEL' ||
      input.externalMethod === 'PUBLISH'
        ? input.externalMethod
        : undefined,
    sourceAccountId: asString(input.sourceAccountId),
    sourceThreadId: asString(input.sourceThreadId),
    sourceMessageId: asString(input.sourceMessageId),
    title: asString(input.title) ?? '',
    description: asString(input.description) ?? '',
    location: asString(input.location),
    conferenceLink: asString(input.conferenceLink),
    startsAt,
    endsAt,
    timeZone: asString(input.timeZone) ?? 'UTC',
    allDay: input.allDay === true,
    status:
      status === 'confirmed' || status === 'tentative' || status === 'cancelled'
        ? status
        : 'confirmed',
    ...(input.lifecycle === 'draft' || input.lifecycle === 'active'
      ? { lifecycle: input.lifecycle }
      : {}),
    visibility:
      visibility === 'private' || visibility === 'public'
        ? visibility
        : 'default',
    busyStatus:
      busyStatus === 'busy' || busyStatus === 'free' || busyStatus === 'tentative'
        ? busyStatus
        : 'busy',
    organizer: organizer ?? undefined,
    attendees,
    reminders: Array.isArray(input.reminders)
      ? input.reminders.filter(
          (item): item is CalendarEvent['reminders'][number] =>
            isRecord(item) &&
            typeof item.id === 'string' &&
            typeof item.minutesBefore === 'number' &&
            Number.isFinite(item.minutesBefore),
        )
      : [],
    attachments: Array.isArray(input.attachments)
      ? input.attachments.filter(
          (item): item is CalendarEvent['attachments'][number] =>
            isRecord(item) &&
            typeof item.id === 'string' &&
            typeof item.name === 'string',
        )
      : [],
    linkedItems: Array.isArray(input.linkedItems)
      ? input.linkedItems.filter(
          (item): item is CalendarEvent['linkedItems'][number] =>
            isRecord(item) &&
            typeof item.id === 'string' &&
            typeof item.label === 'string' &&
            (item.type === 'email' ||
              item.type === 'document' ||
              item.type === 'project' ||
              item.type === 'contact' ||
              item.type === 'task'),
        )
      : [],
    recurrenceRule:
      rule &&
      (ruleFrequency === 'daily' ||
        ruleFrequency === 'weekly' ||
        ruleFrequency === 'monthly')
        ? {
            frequency: ruleFrequency,
            interval:
              typeof rule.interval === 'number' &&
              Number.isFinite(rule.interval) &&
              rule.interval >= 1
                ? rule.interval
                : 1,
            count:
              typeof rule.count === 'number' && Number.isFinite(rule.count)
                ? rule.count
                : undefined,
            until: asIsoDate(rule.until),
            excludedStartsAt: Array.isArray(rule.excludedStartsAt)
              ? rule.excludedStartsAt.filter(
                  (item): item is string => typeof item === 'string',
                )
              : undefined,
          }
        : undefined,
    source:
      source === 'demo' ||
      source === 'provider' ||
      source === 'task' ||
      source === 'feed'
        ? source
        : 'provider',
    syncState:
      syncState === 'synced' ||
      syncState === 'pending' ||
      syncState === 'failed' ||
      syncState === 'conflict'
        ? syncState
        : 'pending',
  }
}

function normalizeTask(input: unknown): CalendarTask | null {
  if (!isRecord(input)) return null
  const id = asString(input.id)
  const title = asString(input.title)
  if (!id || title === undefined) return null
  const syncState = input.syncState
  return {
    id,
    title,
    dueAt: asIsoDate(input.dueAt),
    scheduledStart: asIsoDate(input.scheduledStart),
    scheduledEnd: asIsoDate(input.scheduledEnd),
    sourceLabel: asString(input.sourceLabel) ?? '',
    status: input.status === 'done' ? 'done' : 'open',
    syncState:
      syncState === 'synced' ||
      syncState === 'pending' ||
      syncState === 'failed' ||
      syncState === 'conflict'
        ? syncState
        : 'pending',
  }
}

function normalizeCalendar(input: unknown): Calendar | null {
  if (!isRecord(input)) return null
  const id = asString(input.id)
  const sourceId = asString(input.sourceId)
  const name = asString(input.name)
  if (!id || !sourceId || name === undefined) return null
  return {
    id,
    sourceId,
    name,
    color: asString(input.color) ?? '#5b8def',
    visible: input.visible !== false,
    readOnly: input.readOnly === true ? true : undefined,
  }
}

function normalizeAccount(input: unknown): CalendarAccount | null {
  if (!isRecord(input)) return null
  const id = asString(input.id)
  const name = asString(input.name)
  if (!id || name === undefined) return null
  return {
    id,
    provider:
      input.provider === 'google' ||
      input.provider === 'caldav' ||
      input.provider === 'local'
        ? input.provider
        : 'demo',
    name,
    email: asString(input.email) ?? '',
  }
}

function normalizeSource(input: unknown): CalendarSource | null {
  if (!isRecord(input)) return null
  const id = asString(input.id)
  const accountId = asString(input.accountId)
  const name = asString(input.name)
  if (!id || !accountId || name === undefined) return null
  const syncState = input.syncState
  return {
    id,
    accountId,
    name,
    syncState:
      syncState === 'online' ||
      syncState === 'syncing' ||
      syncState === 'offline' ||
      syncState === 'error'
        ? syncState
        : 'online',
  }
}

function normalizeSettings(input: unknown): CalendarSettings {
  if (!isRecord(input)) return {}
  const settings: CalendarSettings = {}
  const viewMode = input.viewMode
  // 'timeline' and 'availability' were removed as views; a store persisted
  // while one of them was selected falls back to the default view.
  if (
    viewMode === 'day' ||
    viewMode === 'week' ||
    viewMode === 'month' ||
    viewMode === 'agenda'
  ) {
    settings.viewMode = viewMode
  }
  for (const key of [
    'workStart',
    'workEnd',
    'availableStartHour',
    'availableEndHour',
  ] as const) {
    const value = input[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      settings[key] = value
    }
  }
  if (
    Array.isArray(input.availableDays) &&
    input.availableDays.every(day => typeof day === 'number')
  ) {
    settings.availableDays = input.availableDays
  }
  if (input.timeZoneMode === 'system' || input.timeZoneMode === 'fixed') {
    settings.timeZoneMode = input.timeZoneMode
  }
  const timeZone = asString(input.timeZone)
  if (timeZone) settings.timeZone = timeZone
  // Legacy `google` keys from pre-shell-credential stores are dropped on
  // parse — connection state lives in the shell vault now.
  if (Array.isArray(input.icsFeeds)) {
    settings.icsFeeds = input.icsFeeds.filter(
      (item): item is NonNullable<CalendarSettings['icsFeeds']>[number] =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        typeof item.label === 'string' &&
        typeof item.url === 'string' &&
        typeof item.visible === 'boolean',
    )
  }
  if (input.demoCleared === true) settings.demoCleared = true
  return settings
}

/**
 * Parse a persisted store blob. Returns null when the blob is not a plausible
 * calendar store at all (caller should try the backup); otherwise returns a
 * fully-normalized store with invalid individual records dropped.
 */
export function parsePersistedCalendarStore(
  value: unknown,
): CalendarStore | null {
  if (!isRecord(value)) return null
  if (
    !Array.isArray(value.events) ||
    !Array.isArray(value.calendars) ||
    !Array.isArray(value.accounts)
  ) {
    return null
  }
  const calendars = value.calendars
    .map(normalizeCalendar)
    .filter((item): item is Calendar => item !== null)
  // A store with no calendars cannot hold events; treat as corrupt so the
  // caller recovers from backup instead of silently blanking the workspace.
  if (calendars.length === 0) return null
  const calendarIds = new Set(calendars.map(calendar => calendar.id))
  // Tombstones for deleted provider events must survive a reload, or the
  // next snapshot merge resurrects the event before the delete is pushed.
  const removedEventIds = Array.isArray(value.removedEventIds)
    ? value.removedEventIds.filter(
        (item): item is string => typeof item === 'string' && item.length > 0,
      )
    : []
  return {
    ...(removedEventIds.length ? { removedEventIds } : {}),
    accounts: value.accounts
      .map(normalizeAccount)
      .filter((item): item is CalendarAccount => item !== null),
    sources: Array.isArray(value.sources)
      ? value.sources
          .map(normalizeSource)
          .filter((item): item is CalendarSource => item !== null)
      : [],
    calendars,
    events: value.events
      .map(normalizeEvent)
      .filter(
        (item): item is CalendarEvent =>
          item !== null && calendarIds.has(item.calendarId),
      ),
    tasks: Array.isArray(value.tasks)
      ? value.tasks
          .map(normalizeTask)
          .filter((item): item is CalendarTask => item !== null)
      : [],
    settings: normalizeSettings(value.settings),
  }
}
