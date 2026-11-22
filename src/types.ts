export type CalendarView = 'day' | 'threeDay' | 'week' | 'month' | 'agenda'
export type EventStatus = 'confirmed' | 'tentative' | 'cancelled'
export type BusyStatus = 'busy' | 'free' | 'tentative'
export type SyncState = 'synced' | 'pending' | 'failed' | 'conflict'
export type EventLifecycle = 'draft' | 'active'

export interface PinnedTimeZone {
  id: string
  timeZone: string
  label: string
  showOnGrid: boolean
  workStart?: number
  workEnd?: number
}

export interface SavedTimeZoneContact {
  id: string
  name: string
  email?: string
  timeZone: string
  workStart?: number
  workEnd?: number
  group?: string
}

export type SchedulingLinkKind = 'booking' | 'oneoff' | 'poll'
export type PollVoteChoice = 'yes' | 'maybe' | 'no'

export interface SchedulingTimeWindow {
  start: string
  end: string
}

export interface SchedulingAvailabilityConfig {
  weekdays: Record<string, SchedulingTimeWindow[]>
  dateOverrides?: Record<string, SchedulingTimeWindow[]>
  bufferBeforeMinutes: number
  bufferAfterMinutes: number
  minNoticeMinutes: number
  maxBookingsPerDay: number | null
  rollingDays: number
  slotStepMinutes: number
}

export interface SchedulingQuestion {
  id: string
  label: string
  required?: boolean
  type?: 'text' | 'textarea'
}

export interface CandidateSlot {
  start: string
  end: string
}

export interface SchedulingLink {
  id: string
  kind: SchedulingLinkKind
  slug: string | null
  token: string
  url: string
  title: string
  description: string | null
  location: string | null
  hostName: string
  hostEmail: string | null
  hostTimeZone: string
  durations: number[]
  defaultDuration: number
  availability: SchedulingAvailabilityConfig
  candidateSlots: CandidateSlot[]
  questions: SchedulingQuestion[]
  requireConfirmation: boolean
  active: boolean
  expiresAt: number | null
  bookingCount: number
  pollVoteCount: number
  createdAt: number
  updatedAt: number
  localOnly?: boolean
}

export interface SchedulingBooking {
  id: string
  linkId: string
  linkTitle: string
  linkKind: SchedulingLinkKind
  status: 'confirmed' | 'pending' | 'cancelled'
  startsAt: string
  endsAt: string
  guestName: string
  guestEmail: string
  guestTimeZone: string
  notes: string | null
  answers: Record<string, string>
  manageUrl: string
  icsUid: string
  createdAt: number
  updatedAt: number
}

export interface SchedulingPollVote {
  id: string
  voterName: string
  voterEmail: string
  voterTimeZone: string
  votes: Record<string, PollVoteChoice>
  updatedAt: number
}

export interface ProposedSlot {
  start: string
  end: string
  holdEventId?: string
}

export interface CalendarSettings {
  viewMode?: CalendarView
  workStart?: number
  workEnd?: number
  availableDays?: number[]
  availableStartHour?: number
  availableEndHour?: number
  timeZoneMode?: 'system' | 'fixed'
  timeZone?: string
  /** Optional second IANA timezone displayed alongside the primary timezone. */
  secondaryTimeZone?: string
  /** Secondary timezones pinned for world clocks and side-by-side grid rails. */
  pinnedTimeZones?: PinnedTimeZone[]
  /** Temporary travel/guest timezone preview without modifying the home timezone. */
  previewTimeZone?: string | null
  /** Saved contacts & team members with remembered timezones and working hours. */
  savedContacts?: SavedTimeZoneContact[]
  /** Whether the left desk navigator rail (mini-month, clocks, calendars, links) is open. */
  showLeftRail?: boolean
  /** 12-hour or 24-hour clock display. */
  timeFormat?: '12h' | '24h'
  /** Draft / offline scheduling link templates kept locally until PureServer is attached. */
  localSchedulingLinks?: SchedulingLink[]
  icsFeeds?: Array<{
    id: string
    label: string
    url: string
    visible: boolean
    lastSyncedAt?: string
    lastSyncError?: string
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
  provider: 'demo' | 'google' | 'caldav' | 'local' | 'team'
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
  /** ISO timestamp of the last successful sync for this calendar. */
  lastSyncedAt?: string
  /** Last sync error message for this calendar, if any. */
  lastSyncError?: string
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
  /**
   * On a team calendar (the organisation's, kept on its server): a meeting
   * booked with teammates or an important date, the server's revision of it,
   * and whether this person may change it. Attendees there are teammates,
   * each with a `<person id>@team.invalid` address (lib/teamCalendar.ts).
   */
  team?: TeamEventFacts
  /** Optional group id linking temporary "Share availability" tentative holds for one-click release. */
  holdGroupId?: string
}

export interface TeamEventFacts {
  kind: 'meeting' | 'date'
  revision: number
  mayEdit: boolean
  /** Why the server refused the last change, said to the person. */
  problem?: string
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
   * Transient window covered by the provider fetch that produced this store.
   * `mergeGoogleSnapshot` keeps synced events outside this window so far-future
   * or past events are never wiped by a bounded refresh.
   */
  fetchedWindow?: { start: string; end: string }
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
  /** Preserve input event order, including unchanged local entries, so push acknowledgements can be reconciled. */
  sync(store: CalendarStore): Promise<CalendarStore>
  createEvent(event: CalendarEvent): Promise<CalendarEvent>
  updateEvent(event: CalendarEvent): Promise<CalendarEvent>
  deleteEvent(eventId: string): Promise<void>
  rsvp(
    eventId: string,
    response: EventAttendee['response'],
  ): Promise<CalendarEvent>
}
