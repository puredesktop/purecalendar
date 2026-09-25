export type CalendarView = 'day' | 'week' | 'month' | 'agenda'
export type EventStatus = 'confirmed' | 'tentative' | 'cancelled'
export type BusyStatus = 'busy' | 'free' | 'tentative'
export type SyncState = 'synced' | 'pending' | 'failed' | 'conflict'
export type EventLifecycle = 'draft' | 'active'

export interface CalendarSettings {
  viewMode?: CalendarView
  workStart?: number
  workEnd?: number
  availableDays?: number[]
  availableStartHour?: number
  availableEndHour?: number
  timeZoneMode?: 'system' | 'fixed'
  timeZone?: string
  icsFeeds?: Array<{
    id: string
    label: string
    url: string
    visible: boolean
  }>
  /** Set once the user has answered the "remove sample events?" prompt. */
  demoCleared?: boolean
  /**
   * Google calendars the user added by address — shared calendars they
   * can read but that are not in their own calendarList. Fetched
   * alongside the discovered ones.
   */
  googleExtraCalendarIds?: string[]
  /**
   * Calendars the user removed. Kept so a provider calendar does not
   * reappear on the next sync.
   */
  removedCalendarIds?: string[]
}

export interface CalendarAccount {
  id: string
  provider: 'demo' | 'google' | 'caldav' | 'local'
  name: string
  email: string
}

export interface CalendarSource {
  id: string
  accountId: string
  name: string
  syncState: 'online' | 'syncing' | 'offline' | 'error'
}

export interface Calendar {
  id: string
  sourceId: string
  name: string
  color: string
  visible: boolean
  readOnly?: boolean
}

export interface EventAttendee {
  name: string
  email: string
  response: 'accepted' | 'declined' | 'tentative' | 'needsAction'
}

export interface EventReminder {
  id: string
  minutesBefore: number
}

export interface EventAttachment {
  id: string
  name: string
  mimeType: string
  sizeLabel: string
}

export interface EventLink {
  type: 'email' | 'document' | 'project' | 'contact' | 'task'
  id: string
  label: string
}

export interface RecurrenceRule {
  frequency: 'daily' | 'weekly' | 'monthly'
  interval: number
  count?: number
  until?: string
  excludedStartsAt?: string[]
}

export interface CalendarEvent {
  id: string
  calendarId: string
  externalUid?: string
  externalSequence?: number
  externalMethod?: 'REQUEST' | 'REPLY' | 'CANCEL' | 'PUBLISH'
  sourceAccountId?: string
  sourceThreadId?: string
  sourceMessageId?: string
  title: string
  description: string
  location?: string
  conferenceLink?: string
  startsAt: string
  endsAt: string
  timeZone: string
  allDay: boolean
  status: EventStatus
  /**
   * A 'draft' event is a private working copy: attendees may be listed on it
   * but are never sent to providers, so nobody is invited or notified until
   * the event is switched to 'active'. Absent means 'active' — events predate
   * the field, and everything imported from a provider is already real.
   */
  lifecycle?: EventLifecycle
  visibility: 'default' | 'private' | 'public'
  busyStatus: BusyStatus
  organizer?: EventAttendee
  attendees: EventAttendee[]
  reminders: EventReminder[]
  attachments: EventAttachment[]
  linkedItems: EventLink[]
  recurrenceRule?: RecurrenceRule
  source: 'demo' | 'provider' | 'task' | 'feed'
  syncState: SyncState
}

export interface CalendarTask {
  id: string
  /**
   * Calendar this task belongs to, for visibility filtering. Optional because
   * tasks predate per-task calendars; an unassigned task is treated as living
   * on the Focus calendar (the task lane) when the store has one.
   */
  calendarId?: string
  title: string
  dueAt?: string
  scheduledStart?: string
  scheduledEnd?: string
  sourceLabel: string
  status: 'open' | 'done'
  syncState: SyncState
}

export interface CalendarStore {
  /**
   * Calendars whose events could not be read on the fetch that produced
   * this store. Transient (never persisted): the merge keeps the events
   * it already had for these, instead of reading an empty result as
   * "this calendar is now empty".
   */
  failedCalendarIds?: string[]
  /**
   * Tombstones for deleted provider-backed events. A locally-deleted Google
   * event would otherwise resurrect on the next snapshot merge; its id stays
   * here until the provider confirms the delete, the merge skips tombstoned
   * ids, and the sync loop retries the provider delete while an id remains.
   */
  removedEventIds?: string[]
  accounts: CalendarAccount[]
  sources: CalendarSource[]
  calendars: Calendar[]
  events: CalendarEvent[]
  tasks: CalendarTask[]
  settings: CalendarSettings
}

export interface CalendarProvider {
  fetchStore(): Promise<CalendarStore>
  sync(store: CalendarStore): Promise<CalendarStore>
  createEvent(event: CalendarEvent): Promise<CalendarEvent>
  updateEvent(event: CalendarEvent): Promise<CalendarEvent>
  deleteEvent(eventId: string): Promise<void>
  rsvp(
    eventId: string,
    response: EventAttendee['response'],
  ): Promise<CalendarEvent>
}
