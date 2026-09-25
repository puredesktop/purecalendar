import { AppSettingsPages, useAppSettings } from '@purescience/platform-bridge/components/settings/AppSettings'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { styled } from 'styled-components'
import { X } from 'lucide-react'
import {
  bridge,
  PLATFORM_BRIDGE_METHODS,
} from '@purescience/platform-ui/bridge/client'
import {
  CALENDAR_DRAFT_INTENT_STORAGE_FILE,
  CALENDAR_DRAFT_INTENT_STORAGE_SLUG,
  isCalendarDraftResourceId,
  normalizeCalendarDraftIntentStore,
  type CalendarDraftIntent,
} from '@purescience/platform-ui/bridge/calendarDraftIntent'
import {
  CALENDAR_INVITE_INTENT_STORAGE_FILE,
  CALENDAR_INVITE_INTENT_STORAGE_SLUG,
  isCalendarInviteResourceId,
  normalizeCalendarInviteIntentStore,
  type CalendarInviteIntent,
  type CalendarInviteResponse,
} from '@purescience/platform-ui/bridge/calendarInviteIntent'
import type { ResourceOpenEvent } from '@purescience/platform-ui/bridge/types'
import {
  calendarInviteIntentFromIcsFile,
  isIcsFilePath,
  parseIcsFileInvite,
} from '../lib/icsFileInvite'
import { intentStoreWithoutKey } from '../lib/intentConsumption'
import { Button } from '@purescience/platform-ui/components/common/buttons/Button'
import { CALENDAR_SCOPES } from '@purescience/platform-ui/bridge/googleAuth'
import { ProviderConnection } from '@purescience/platform-ui/components/common/connections/ProviderConnection.js'
import { PlatformIcon } from '@purescience/platform-ui/components/chrome/PlatformIcon'
import { SegmentedControl } from '@purescience/platform-ui/components/common/buttons/SegmentedControl'
import { Badge } from '@purescience/platform-ui/components/common/feedback/Badge'
import { openExternalUrl } from '@purescience/platform-ui/bridge/os.mjs'
import { firstUrlIn, splitTextIntoLinks } from '../lib/eventLinks'
import { EmptyState } from '@purescience/platform-ui/components/common/feedback/EmptyState'
import { generateIcsEventExport } from '@purescience/platform-ui/ics/generateIcs'
import {
  cancelNotification,
  scheduleNotification,
} from '@purescience/platform-ui/bridge/notifications'
import {
  fetchGoogleCredentialStatus,
  GOOGLE_CREDENTIAL_ID,
  isStandaloneDevMode,
  networkFetch,
  recordOperation,
  saveCalendarSettings,
  saveTextFile,
  writeCalendarStoreFile,
  type OAuthCredentialStatus,
} from '../bridge/platformBridge'
import { mergeGoogleSnapshot } from '../hooks/usePureCalendarBoot'
import {
  syncAgentStore,
  setAgentStoreDispatch,
} from '../agents/handlers'
import {
  mergeIcsFeedEvents,
  parseIcsFeed,
  pruneIcsFeeds,
} from '../lib/icsFeed'
import {
  CALENDAR_STORE_BACKUP_FILE,
  CALENDAR_STORE_FILE,
} from '../lib/calendarStorePersistence'
import { calendarCommandForKey } from '../lib/calendarCommands'
import {
  allDayEventPatch,
  allDayEventsInRange,
  applyRecurringEventEdit,
  calendarSyncSummary,
  canEditCalendarEvent,
  createDraftEvent,
  createEventFromCalendarDraftIntent,
  dateKeyInTimeZone,
  dateTimeLocalToIsoInTimeZone,
  dateTimeLocalValueInTimeZone,
  duplicateEvent,
  editableCalendars,
  formatDayInTimeZone,
  formatEventAttendeesText,
  formatEventReminderMinutes,
  firstEditableCalendarId,
  formatTimeInTimeZone,
  instantFromZonedWallTime,
  isAvailableWallTime,
  moveEvent,
  normalizeAvailabilitySettings,
  parseEventAttendeesText,
  parseEventReminderMinutes,
  quickAddCalendarEvent,
  recoverCalendarEventSync,
  recoverCalendarTaskSync,
  recurrenceBaseEventId,
  recurrenceInstanceIndex,
  clearDemoData,
  computeEventReminders,
  keepDemoData,
  removeEventWithTombstone,
  resolveRsvpAttendee,
  retryCalendarSyncFailures,
  rsvpEvent,
  type RecurrenceEditScope,
  resolveCalendarTimeZone,
  searchCalendarStore,
  addLocalCalendar,
  removeCalendar,
  setCalendarVisibility,
  undoCalendarEventChange,
  updateCalendar,
  updateCalendarTask,
  isDraftEvent,
  upsertInviteEvent,
  upsertMirroredInviteEvent,
  visibleCalendarEvents,
  visibleScheduledTasks,
  weekRange,
} from '../lib/calendarModel'
import type { CalendarEventUndo } from '../lib/calendarModel'
import { readableAccentColor } from '../lib/calendarColors'
import { parseGoogleEventLocalId } from '../lib/googleCalendarProvider'
import { setGoogleCalendarPreferences } from '../lib/googleCalendarPreferences'
import {
  GRID_Z_DRAGGING_EVENT,
  GRID_Z_EVENT,
  GRID_Z_NOW_MARKER,
  GRID_Z_RESIZE_HANDLE,
  GRID_Z_STICKY_HEADER,
} from '../lib/gridLayers'
import {
  labelForIcsFeedUrl,
  parseCalendarAddress,
  parseIcsFeedUrl,
} from '../lib/calendarAddress'
import type {
  BusyStatus,
  Calendar,
  CalendarEvent,
  CalendarProvider,
  CalendarStore,
  CalendarTask,
  CalendarView,
  EventAttendee,
  EventStatus,
  RecurrenceRule,
} from '../types'

interface PendingCalendarDraft {
  intent: CalendarDraftIntent
  title: string
  description: string
  calendarId: string
  startsAt: string
  endsAt: string
}

interface PendingCalendarInvite {
  intent: CalendarInviteIntent
  title: string
  description: string
  calendarId: string
  response: CalendarInviteResponse
}

function calendarResourcePath(path: string): string {
  const prefix = 'purescience://calendar/'
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}

interface GridDraftSelection {
  dayKey: string
  pointerId: number
  startMinutes: number
  endMinutes: number
}

interface EventResizeState {
  dayKey: string
  edge: 'start' | 'end'
  eventId: string
  originalEvent: CalendarEvent
  originalStartMinutes: number
  originalEndMinutes: number
  pointerId: number
}

interface EventDragState {
  dayKey: string
  eventId: string
  originalEvent: CalendarEvent
  pointerId: number
  pointerOffsetMinutes: number
  targetDayKey: string
}

interface TimedItemLayout {
  compact: boolean
  event?: CalendarEvent
  style: CSSProperties
  task?: CalendarTask
  type: 'event' | 'task'
}

const EVENT_CATEGORY_COLORS = {
  work: '#3F7F59',
  focus: '#9B6B3E',
  personal: '#7A5A8E',
  tasks: '#A56A2D',
  fallback: '#6F6A5A',
} as const

const FALLBACK_EVENT_CATEGORY_SEQUENCE = [
  EVENT_CATEGORY_COLORS.work,
  EVENT_CATEGORY_COLORS.focus,
  EVENT_CATEGORY_COLORS.personal,
  '#8A4E62',
  '#5F7B4B',
  '#7A6848',
] as const

function stableCategoryIndex(value: string): number {
  return Array.from(value).reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  )
}

function calendarCategoryColor(
  calendar?: Pick<Calendar, 'id' | 'name' | 'color'> | null,
): string {
  if (!calendar) return EVENT_CATEGORY_COLORS.fallback
  // The calendar's OWN colour comes first — that is what distinguishes
  // one Google calendar's events from another's. Only a calendar with no
  // usable colour falls through to the keyword/hash palette.
  if (calendar.color) {
    const accent = readableAccentColor(calendar.color)
    if (accent) return accent
  }
  const key = `${calendar.id} ${calendar.name}`.toLowerCase()
  if (key.includes('work')) return EVENT_CATEGORY_COLORS.work
  if (key.includes('focus')) return EVENT_CATEGORY_COLORS.focus
  if (key.includes('personal')) return EVENT_CATEGORY_COLORS.personal
  return FALLBACK_EVENT_CATEGORY_SEQUENCE[
    stableCategoryIndex(key) % FALLBACK_EVENT_CATEGORY_SEQUENCE.length
  ]
}

const DAY_START_HOUR = 0
const DAY_END_HOUR = 24
const SNAP_MINUTES = 15
const MIN_EVENT_MINUTES = 15
const DEFAULT_CLICK_MINUTES = 30
const HOUR_HEIGHT = 56


interface CalendarProviderOption {
  id: string
  title: string
  description: string
  meta: string
  badge: string
  defaults: string
}

/**
 * Exactly the ways a calendar can actually be added, and nothing else.
 *
 * This list used to advertise iCloud, Outlook, CalDAV, Microsoft 365 and a
 * bring-your-own Google client. None of them were reachable: the add-calendar
 * flow has only ever had three modes, and those five ids were never read by
 * any code. Meanwhile "On this device" — which does work — was missing from
 * the list entirely. A catalogue that names connectors you cannot pick is
 * worse than a short one: every entry reads as a promise.
 *
 * iCloud and Outlook are not gone, they were never separate. Both publish
 * ordinary webcal/ICS links, which the feed option below takes.
 */
const CALENDAR_PROVIDER_OPTIONS: CalendarProviderOption[] = [
  {
    id: 'google',
    title: 'Google Calendar',
    description:
      'Best live path. Sign in through Google, sync events, and keep events editable.',
    meta: 'Browser sign-in · editable events',
    badge: 'works now',
    defaults:
      'Uses a desktop OAuth client with PKCE and Google Calendar scopes. Public client settings are shared with PureMail; tokens stay in the shell vault.',
  },
  {
    id: 'ics',
    title: 'ICS or webcal feed',
    description:
      'Subscribe to a read-only published calendar — including iCloud and Outlook, which both publish ordinary webcal links.',
    meta: 'Read-only · no password',
    badge: 'works now',
    defaults:
      'Accepts HTTPS .ics URLs and webcal links from Google, iCloud, Outlook, Fastmail, Nextcloud, and most hosted calendars. Feeds are read-only and can lag by provider.',
  },
  {
    id: 'local',
    title: 'On this device',
    description:
      'A calendar kept in your workspace. Nothing to sign in to, and events are yours to edit.',
    meta: 'Local · editable',
    badge: 'works now',
    defaults:
      'Stored with the rest of your workspace data. Nothing leaves the machine and no provider can rate-limit it.',
  },
]

function calendarHandoffErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/Missing permission "filesystem"/i.test(message)) {
    return 'Calendar handoff permission is missing. Restart PureDesktop after enabling filesystem permission for PureMail and PureCalendar.'
  }
  return message || 'Could not load calendar handoff.'
}

/**
 * Deletes ONE consumed invite intent from the shared intent file. Mail keeps
 * adding intents to the same keyed map concurrently, so this re-reads the
 * file immediately before writing and removes only the consumed key —
 * writing back the map captured at consume time could silently drop intents
 * mail added in between. Best-effort: if the removal fails, the intent is
 * offered again on the next open, and `upsertInviteEvent` dedups by UID.
 */
async function removeConsumedInviteIntent(resourceId: string): Promise<void> {
  try {
    const result = (await bridge.call(
      PLATFORM_BRIDGE_METHODS.STORAGE_READ_JSON,
      [
        {
          appSlug: CALENDAR_INVITE_INTENT_STORAGE_SLUG,
          fileName: CALENDAR_INVITE_INTENT_STORAGE_FILE,
        },
      ],
    )) as { value?: unknown } | null
    const fresh = normalizeCalendarInviteIntentStore(result?.value)
    if (!(resourceId in fresh.intents)) return
    await bridge.call(PLATFORM_BRIDGE_METHODS.STORAGE_WRITE_JSON, [
      {
        appSlug: CALENDAR_INVITE_INTENT_STORAGE_SLUG,
        fileName: CALENDAR_INVITE_INTENT_STORAGE_FILE,
        value: intentStoreWithoutKey(fresh, resourceId),
      },
    ])
  } catch {
    // Cleanup only — the intent stays until a later consume removes it.
  }
}


/**
 * Marks an element for the platform chrome stylesheet (theme/chromeCss in
 * @purescience/platform-ui): sidebars, rows, section labels, meta, fields,
 * toolbars and list rows get their measures, faces and theme colours from
 * the --pure-chrome-* tokens, so nothing here restates a width or a grey.
 * Typed loosely on purpose: styled-components' attrs rejects data-* literals.
 */
const chrome = (
  kind: string,
  extra: Record<string, string> = {},
): Record<string, string> => ({ 'data-chrome': kind, ...extra })

const Root = styled.div`
  /* The app's palette, read from the platform chrome tokens so light and
     dark are the same room lit differently. */
  --app-primary-fill: var(--pure-chrome-accent);
  --calendar-accent-fill: var(--pure-chrome-accent);
  --calendar-accent-hover: var(--app-text, var(--pure-chrome-accent));
  --calendar-bg: var(--platform-colors-bg);
  --calendar-ink: var(--platform-colors-text);
  --calendar-ink-faint: var(--pure-chrome-muted);
  --calendar-page: var(--pure-chrome-paper);
  --calendar-surface: var(--platform-colors-surface);
  --calendar-surface-muted: var(--pure-chrome-well);
  --calendar-time-gutter-width: 76px;
  --calendar-grid-line: var(--pure-chrome-line);
  --calendar-grid-line-strong: var(--platform-colors-border-strong);
  --calendar-today-bg: var(
    --app-bg,
    color-mix(in srgb, var(--calendar-accent-fill) 8%, var(--calendar-bg))
  );
  --calendar-today-text: var(--calendar-accent-hover);
  --calendar-time-rule: color-mix(
    in srgb,
    var(--calendar-grid-line-strong) 76%,
    transparent
  );
  --calendar-time-rule-soft: color-mix(
    in srgb,
    var(--calendar-grid-line) 42%,
    transparent
  );
  --calendar-draft-stripe: var(--platform-colors-divider);
  --calendar-unavailable-bg: color-mix(
    in srgb,
    var(--platform-colors-text) 2.5%,
    transparent
  );
  --calendar-danger: var(--platform-colors-danger);
  /* Accent-filled controls: the chrome relights the accent for dusk and
     pairs it with its own ink, so the fill reads in both themes. */
  --platform-colors-text-on-accent: var(--pure-chrome-on-accent);

  display: flex;
  flex-direction: row;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--calendar-bg);
  color: var(--platform-colors-text);

  && [role='group'][aria-label='Calendar view'] {
    border-color: var(--calendar-grid-line);
    background: var(--calendar-surface);
  }

  && [role='group'][aria-label='Calendar view'] button {
    position: relative;
    color: var(--platform-colors-text-secondary);
  }

  && [role='group'][aria-label='Calendar view'] button[aria-pressed='true'] {
    background: var(--calendar-today-bg);
    color: var(--calendar-today-text);
  }

  &&
    [role='group'][aria-label='Calendar view']
    button[aria-pressed='true']::after {
    position: absolute;
    right: 8px;
    bottom: 0;
    left: 8px;
    height: 2px;
    background: var(--calendar-accent-fill);
    content: '';
  }

  [data-platform-theme='dark'] & {
    --calendar-time-rule: color-mix(
      in srgb,
      var(--platform-colors-border) 82%,
      transparent
    );
    --calendar-time-rule-soft: color-mix(
      in srgb,
      var(--platform-colors-border) 46%,
      transparent
    );
    --calendar-unavailable-bg: color-mix(
      in srgb,
      var(--platform-colors-text) 4%,
      transparent
    );
  }
`

const Main = styled.main`
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--calendar-bg);
`

const DetailsOverlayBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 22;
  display: grid;
  place-items: center;
  padding: 28px;
  background: rgb(18 22 28 / 0.26);
  backdrop-filter: blur(2px);
`

const DetailsOverlay = styled.section`
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  width: min(1120px, calc(100vw - 56px));
  max-height: min(820px, calc(100vh - 56px));
  overflow: hidden;
  border: 1px solid
    color-mix(in srgb, var(--platform-colors-border) 82%, transparent);
  border-radius: var(--platform-radius-sm);
  /* Canvas is the system surface colour, so this stays opaque and follows
     light/dark even when the shell's tokens are absent — outside the desktop
     app they are, and a modal you can read the calendar through is not one. */
  background: var(--platform-colors-surface, Canvas);
  color: var(--platform-colors-text, CanvasText);
  box-shadow: 0 24px 80px rgb(0 0 0 / 0.26);
`

const DetailsOverlayHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 18px 22px;
  border-bottom: 1px solid var(--platform-colors-border);
  background: color-mix(
    in srgb,
    var(--platform-colors-surface) 88%,
    var(--calendar-surface-muted) 12%
  );
`

const DetailsHeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
`

const DetailsSaveButton = styled.button`
  flex: none;
  height: var(--pure-chrome-control-height);
  padding: 0 12px;
  border: 1px solid var(--calendar-accent-fill);
  background: var(--calendar-accent-fill);
  color: var(--platform-colors-text-on-accent);
  font: inherit;
  font-size: var(--platform-typography-font-size-sm, 13px);
  font-weight: 500;
  cursor: pointer;

  &:hover:not(:disabled) {
    border-color: var(--calendar-accent-hover);
    background: var(--calendar-accent-hover);
  }

  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
`

/**
 * The family's slim status band at the foot of the window: save state, sync
 * recency and a count, in one upright mono line. Pending reads as attention;
 * at rest it stays quiet.
 */
/**
 * The family's slim status band at the foot of the window: save state, sync
 * recency and a count, in one upright mono line. Pending reads as attention;
 * at rest it stays quiet.
 */
const StatusBand = styled.footer.attrs(chrome('meta'))`
  display: flex;
  flex: none;
  align-items: center;
  gap: 14px;
  min-width: 0;
  padding: 6px var(--pure-chrome-inset);
  border-top: 1px solid var(--pure-chrome-line);
  background: var(--pure-chrome-bar);
`

const StatusBandItem = styled.span<{ $tone: 'pending' | 'rest' }>`
  overflow: hidden;
  text-overflow: ellipsis;
  color: ${({ $tone }) =>
    $tone === 'pending'
      ? 'var(--platform-colors-semantic-orange-text, #7a5114)'
      : 'inherit'};
`

const DetailsCloseButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--pure-chrome-control-height);
  height: var(--pure-chrome-control-height);
  flex: 0 0 auto;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--platform-colors-text-secondary);
  cursor: pointer;

  &:hover {
    background: var(--platform-colors-surface-hover);
    color: var(--platform-colors-text);
  }

  &:focus-visible {
    outline: 1px solid var(--platform-colors-focus);
    outline-offset: 2px;
  }
`

const DetailsHeaderCopy = styled.div`
  min-width: 0;
`

const DetailsOverlayBody = styled.div`
  min-height: 0;
  overflow: auto;
  padding: 22px;
  background: var(--calendar-bg);
`

const DetailsPanel = styled.div`
  display: grid;
  gap: 18px;
  padding: 18px;
  border: 1px solid var(--platform-colors-border);
  border-radius: var(--platform-radius-sm);
  background: var(--platform-colors-surface);
`

const DetailsEventGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(280px, 0.75fr);
  gap: 18px;
  align-items: start;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`

const DetailsFormGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`

const DetailsFullWidth = styled.div`
  grid-column: 1 / -1;
`

const DetailsSummaryPanel = styled.aside`
  display: grid;
  gap: 14px;
  /* A grid item's default min-width is its content, so one long token — an
     IMAP thread id, a conference URL — pushes the panel past the dialog
     instead of wrapping inside it. */
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--calendar-grid-line);
  border-radius: var(--platform-radius-sm);
  background: color-mix(
    in srgb,
    var(--calendar-surface-muted) 72%,
    var(--platform-colors-surface) 28%
  );
`

const DetailsMetaList = styled.div`
  display: grid;
  gap: 10px;
  min-width: 0;
  color: var(--platform-colors-text-secondary);
  font-size: var(--platform-typography-font-size-sm);
  line-height: 1.45;
  /* Ids and links here are opaque runs with nowhere to break: let them
     break anywhere rather than run out of the panel. */
  overflow-wrap: anywhere;

  > * {
    min-width: 0;
  }
`

const DetailsBadgeRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`

const DetailsActionRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
`

/* ── Event read view: the important facts first, links live, edit behind a button ── */
const EventReadTitle = styled.h2`
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.25;
  color: var(--calendar-ink, var(--platform-colors-text));
`

const EventReadWhen = styled.div`
  font-size: 14px;
  color: var(--platform-colors-text);
`

const EventReadSubWhen = styled.div`
  margin-top: 2px;
  font-size: var(--platform-typography-font-size-sm);
  color: var(--platform-colors-text-secondary);
`

const EventReadBadgeRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 12px 0 0;
`

const EventReadFacts = styled.dl`
  display: grid;
  grid-template-columns: minmax(88px, max-content) 1fr;
  gap: 8px 16px;
  margin: 16px 0 0;

  dt {
    color: var(--platform-colors-text-secondary);
    font-size: var(--platform-typography-font-size-xs);
    font-family: var(--platform-typography-font-family-mono);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding-top: 2px;
  }
  dd {
    margin: 0;
    min-width: 0;
    font-size: 13.5px;
    color: var(--platform-colors-text);
    overflow-wrap: break-word;
  }
`

const EventReadDescription = styled.div`
  margin: 16px 0 0;
  padding: 12px 14px;
  border: 1px solid var(--calendar-grid-line);
  border-radius: 10px;
  background: var(--calendar-surface, var(--platform-colors-surface));
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--platform-colors-text);
  white-space: pre-wrap;
  overflow-wrap: break-word;
  max-height: 340px;
  overflow-y: auto;

  a {
    color: var(--platform-colors-info, #0b57d0);
    text-decoration: underline;
    text-underline-offset: 0.16em;
    word-break: break-word;
  }
`

const EventReadRsvp = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 16px 0 0;

  select {
    max-width: 220px;
  }
`

const EventJoinRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 14px 0 0;
`

/**
 * The event overlay's default face: what you opened the event to find —
 * when, where, how to join, who's coming — as text with live links, not a
 * wall of form fields. Editing (behind the Edit button) reveals the form.
 */
function EventReadBody({
  event,
  calendar,
  timeZone,
  outsideAvailability,
  rsvpAttendee,
  readOnly,
  onRsvp,
}: {
  event: CalendarEvent
  calendar: Calendar
  timeZone: string
  outsideAvailability: boolean
  rsvpAttendee: EventAttendee | undefined
  readOnly: boolean
  onRsvp: (response: EventAttendee['response'], email?: string) => void
}): React.ReactElement {
  const startDay = dayLabel(new Date(event.startsAt), timeZone)
  const endDay = dayLabel(new Date(event.endsAt), timeZone)
  const when = event.allDay
    ? `${startDay} · All day`
    : startDay === endDay
    ? `${startDay} · ${formatTime(event.startsAt, timeZone)} – ${formatTime(event.endsAt, timeZone)}`
    : `${startDay} ${formatTime(event.startsAt, timeZone)} → ${endDay} ${formatTime(event.endsAt, timeZone)}`
  const repeat = event.recurrenceRule
    ? `Repeats ${event.recurrenceRule.interval && event.recurrenceRule.interval > 1 ? `every ${event.recurrenceRule.interval} ` : ''}${event.recurrenceRule.frequency}`
    : null
  const joinUrl = event.conferenceLink?.trim() || firstUrlIn(event.description) || null
  const reminder = formatEventReminderMinutes(event.reminders)
  const attendees = event.attendees
    .map(attendee => attendee.name || attendee.email)
    .filter(Boolean)

  return (
    <div>
      <EventReadTitle>{event.title || 'Untitled event'}</EventReadTitle>
      <EventReadWhen>{when}</EventReadWhen>
      {(repeat || outsideAvailability) && (
        <EventReadSubWhen>
          {[repeat, outsideAvailability ? 'Outside available hours' : null]
            .filter(Boolean)
            .join(' · ')}
        </EventReadSubWhen>
      )}

      <EventReadBadgeRow>
        <Badge tone="accent">{calendar.name}</Badge>
        {calendar.readOnly && <Badge tone="neutral">read-only</Badge>}
        {event.status !== 'confirmed' && (
          <Badge tone="neutral">{event.status}</Badge>
        )}
        {event.lifecycle === 'draft' && <Badge tone="neutral">draft</Badge>}
      </EventReadBadgeRow>

      {joinUrl && (
        <EventJoinRow>
          <Button
            size="sm"
            variant="primary"
            onClick={() => void openExternalUrl(joinUrl)}
          >
            Join
          </Button>
        </EventJoinRow>
      )}

      {rsvpAttendee && (
        <EventReadRsvp>
          <Kicker>
            RSVP as {rsvpAttendee.name || rsvpAttendee.email}
          </Kicker>
          <select
            value={rsvpAttendee.response ?? 'needsAction'}
            disabled={readOnly}
            onChange={changeEvent =>
              onRsvp(
                changeEvent.target.value as EventAttendee['response'],
                rsvpAttendee.email,
              )
            }
          >
            <option value="needsAction">No response yet</option>
            <option value="accepted">Accepted</option>
            <option value="tentative">Tentative</option>
            <option value="declined">Declined</option>
          </select>
        </EventReadRsvp>
      )}

      <EventReadFacts>
        {event.location?.trim() && (
          <>
            <dt>Location</dt>
            <dd>{event.location}</dd>
          </>
        )}
        {joinUrl && (
          <>
            <dt>Join link</dt>
            <dd>
              <a
                href={joinUrl}
                onClick={anchorEvent => {
                  anchorEvent.preventDefault()
                  void openExternalUrl(joinUrl)
                }}
              >
                {joinUrl}
              </a>
            </dd>
          </>
        )}
        {attendees.length > 0 && (
          <>
            <dt>Attendees</dt>
            <dd>{attendees.join(', ')}</dd>
          </>
        )}
        {reminder && (
          <>
            <dt>Reminder</dt>
            <dd>{reminder} before</dd>
          </>
        )}
      </EventReadFacts>

      {event.description.trim() && (
        <EventReadDescription>
          {splitTextIntoLinks(event.description).map((segment, index) =>
            segment.type === 'link' ? (
              <a
                key={index}
                href={segment.href}
                onClick={anchorEvent => {
                  if (segment.href?.startsWith('mailto:')) return
                  anchorEvent.preventDefault()
                  void openExternalUrl(segment.href ?? segment.value)
                }}
              >
                {segment.value}
              </a>
            ) : (
              <span key={index}>{segment.value}</span>
            ),
          )}
        </EventReadDescription>
      )}
    </div>
  )
}

/** The calendars column: the platform sidebar, slid in beside the grid. */
const CalendarDrawer = styled.aside.attrs(chrome('sidebar'))`
  order: -1;
  height: 100%;
  box-shadow: 18px 0 34px rgb(0 0 0 / 0.12);
`

const DrawerHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px var(--pure-chrome-inset);
  border-bottom: 1px solid var(--pure-chrome-line);
`

const Section = styled.section`
  padding: 16px var(--pure-chrome-inset);
  border-bottom: 1px solid var(--pure-chrome-line);
`

/** A section label: mono, tracked, uppercase — the platform's. */
const Kicker = styled.div`
  color: var(--pure-chrome-muted);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-label-size);
  font-weight: 500;
  letter-spacing: var(--pure-chrome-label-tracking);
  text-transform: uppercase;
`

const Header = styled.header`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding: 12px var(--pure-chrome-inset) 8px;
  border-bottom: 1px solid var(--pure-chrome-line);
  background: var(--pure-chrome-bar);
`

const Title = styled.h1`
  margin: 0;
  font-size: 21px;
  letter-spacing: 0;
`

const HeaderTitleRow = styled.div`
  display: flex;
  align-items: baseline;
  gap: 10px;
`

const HeaderYear = styled.span`
  color: var(--platform-colors-text-secondary);
  font-size: 22px;
  font-weight: 700;
`



const Toolbar = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 8px var(--pure-chrome-inset) 9px;
  border-bottom: 1px solid var(--pure-chrome-line);
  background: var(--pure-chrome-bar);
`

const ToolbarGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;

  &:nth-child(2) {
    justify-content: center;
  }

  &:last-child {
    justify-content: flex-end;
  }
`

const SearchBox = styled.div`
  position: relative;
  width: min(280px, 100%);
`

const SearchInput = styled.input.attrs(chrome('field'))`
  width: 100%;
`

const QuickAddInput = styled(SearchInput)`
  width: min(260px, 30vw);
`

const SearchResults = styled.div`
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 18;
  display: grid;
  gap: 4px;
  width: min(360px, 88vw);
  max-height: 320px;
  overflow: auto;
  border: 1px solid var(--platform-colors-border);
  border-radius: var(--platform-radius-sm);
  background: var(--platform-colors-surface);
  box-shadow: 0 14px 34px rgb(0 0 0 / 0.14);
  padding: 6px;
`

const SearchResultButton = styled.button`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  border: 0;
  border-radius: var(--platform-radius-sm);
  background: transparent;
  color: var(--platform-colors-text);
  padding: 8px;
  text-align: left;

  &:hover {
    background: color-mix(
      in srgb,
      var(--calendar-accent-fill) 12%,
      transparent
    );
  }

  span {
    min-width: 0;
  }

  strong,
  small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    color: var(--platform-colors-text-secondary);
    font-size: var(--platform-typography-font-size-xs);
  }
`

const SearchEmpty = styled.div`
  padding: 10px;
  color: var(--platform-colors-text-secondary);
  font-size: var(--platform-typography-font-size-sm);
`

const CalendarViewport = styled.div`
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  background: var(--calendar-bg);
`

const RangeControls = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px;
  border: 1px solid var(--pure-chrome-line);
  border-radius: var(--platform-radius-sm);
  background: var(--pure-chrome-well);
`

/** Palette offered when recolouring a calendar (Google-ish hues). */
const CALENDAR_COLOR_CHOICES = [
  '#4285f4',
  '#16a765',
  '#fa573c',
  '#f6bf26',
  '#9fe1e7',
  '#7c6ff0',
  '#e67c73',
  '#8e24aa',
  '#616161',
] as const

/**
 * One calendar: toggle | edit | delete, on the platform row measure. A grid,
 * not a chrome row, because the edit panel opens inside it across all three
 * columns.
 */
const CalendarManageRow = styled.div`
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 2px;
  min-height: var(--pure-chrome-row-height);
  border-radius: var(--pure-chrome-radius);
  font-size: var(--pure-chrome-ui-size);

  &:hover {
    background: var(--pure-chrome-hover);
  }
`

const CalendarToggle = styled.button`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  min-height: var(--pure-chrome-row-height);
  padding: 0 4px 0 8px;
  border: 0;
  background: none;
  color: var(--platform-colors-text);
  font: inherit;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
`

const Checkbox = styled.span<{ $on: boolean; $color: string }>`
  display: grid;
  place-items: center;
  width: 15px;
  height: 15px;
  flex: none;
  border-radius: 4px;
  border: 1.5px solid ${({ $color }) => $color};
  background: ${({ $on, $color }) => ($on ? $color : 'transparent')};
  color: #fff;
  font-size: 10px;
  line-height: 1;
`

const CalendarName = styled.span<{ $dim: boolean }>`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--pure-chrome-ui-size);
  opacity: ${({ $dim }) => ($dim ? 0.5 : 1)};
`

const ReadOnlyMark = styled.span.attrs(chrome('meta'))`
  margin-left: 6px;
`

const RowAction = styled.button<{ $danger?: boolean }>`
  padding: 4px 6px;
  border: 0;
  border-radius: var(--platform-radius-sm);
  background: none;
  color: ${({ $danger }) =>
    $danger
      ? 'var(--platform-colors-danger-text)'
      : 'var(--platform-colors-text-secondary)'};
  font: inherit;
  font-size: var(--pure-chrome-ui-size);
  cursor: pointer;
  opacity: ${({ $danger }) => ($danger ? 1 : 0)};

  ${CalendarManageRow}:hover & {
    opacity: 1;
  }

  &:hover {
    color: var(--platform-colors-text);
  }
`

const CalendarEditPanel = styled.div`
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
`

const EditField = styled.input`
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border: 1px solid var(--platform-colors-border);
  border-radius: var(--platform-radius-sm);
  background: var(--platform-colors-surface);
  color: var(--platform-colors-text);
  font: inherit;
  font-size: var(--pure-chrome-ui-size);
`

const ColorSwatches = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`

const ColorSwatch = styled.button<{ $color: string; $selected: boolean }>`
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid
    ${({ $selected }) =>
      $selected ? 'var(--platform-colors-text)' : 'transparent'};
  background: ${({ $color }) => $color};
  cursor: pointer;
  padding: 0;
`

const AddRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 8px;
`

const LinkButton = styled.button`
  border: 0;
  background: none;
  padding: 0;
  color: var(--calendar-accent-fill);
  font: inherit;
  font-size: var(--pure-chrome-ui-size);
  cursor: pointer;

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }

  &:hover:not(:disabled) {
    text-decoration: underline;
  }
`

const HelpNote = styled.p`
  margin: 0;
  font-size: var(--pure-chrome-ui-size);
  line-height: 1.45;
  color: var(--platform-colors-text-secondary);
`

const ErrorNote = styled.p`
  margin: 0;
  font-size: var(--pure-chrome-ui-size);
  color: var(--platform-colors-danger-text);
`

/** One task in the details overlay's Tasks panel: a platform list row. */
const CalendarRow = styled.button.attrs(chrome('list-row'))<{ $active?: boolean }>`
  width: 100%;
  border: 0;
  font: inherit;
  text-align: left;
  cursor: pointer;

  && {
    background: ${({ $active }) =>
      $active ? 'var(--pure-chrome-selection)' : 'transparent'};
  }
`

const TimeGrid = styled.div<{ $days: number; $timelineHeight: number }>`
  display: grid;
  grid-template-columns: var(--calendar-time-gutter-width) repeat(
      ${({ $days }) => $days},
      minmax(156px, 1fr)
    );
  grid-template-rows: auto auto minmax(
      ${({ $timelineHeight }) => $timelineHeight}px,
      1fr
    );
  flex: 1;
  gap: 0;
  width: 100%;
  min-height: 100%;
  min-width: calc(
    var(--calendar-time-gutter-width) + ${({ $days }) => $days * 156}px
  );
`

const MonthGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(7, minmax(140px, 1fr));
  grid-template-rows: auto repeat(6, minmax(118px, 1fr));
  flex: 1;
  gap: 0;
  width: 100%;
  min-width: 980px;
  min-height: 100%;
`

const MonthWeekday = styled.div`
  padding: 0 10px 8px;
  color: var(--platform-colors-text-secondary);
  font-size: var(--platform-typography-font-size-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  background: var(--calendar-surface);
`

const MonthCell = styled.div<{ $muted?: boolean; $today?: boolean }>`
  display: grid;
  align-content: start;
  gap: 6px;
  min-width: 0;
  min-height: 118px;
  padding: 9px;
  border: 0;
  border-top: 1px solid var(--calendar-grid-line);
  border-left: 1px solid var(--calendar-grid-line);
  background: ${({ $today }) =>
    $today ? 'var(--calendar-today-bg)' : 'var(--calendar-bg)'};
  color: ${({ $muted }) =>
    $muted
      ? 'var(--platform-colors-text-secondary)'
      : 'var(--platform-colors-text)'};
  text-align: left;
  cursor: crosshair;

  &:nth-child(7n + 1) {
    border-left: 0;
  }

  &:hover {
    background: color-mix(
      in srgb,
      var(--calendar-accent-fill) 10%,
      var(--calendar-surface)
    );
  }
`

const MonthDate = styled.div<{ $today?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  justify-self: start;
  min-width: 24px;
  height: 24px;
  padding: 0 6px;
  border-radius: var(--platform-radius-sm);
  background: ${({ $today }) =>
    $today ? 'var(--calendar-today-bg)' : 'transparent'};
  border: 1px solid
    ${({ $today }) =>
      $today
        ? 'color-mix(in srgb, var(--calendar-accent-fill) 34%, transparent)'
        : 'transparent'};
  color: ${({ $today }) => ($today ? 'var(--calendar-today-text)' : 'inherit')};
  font-size: var(--platform-typography-font-size-sm);
  font-family: var(--platform-typography-font-family-mono);
  font-weight: 700;
`

const MonthItem = styled.button<{ $color: string; $draft?: boolean }>`
  position: relative;
  min-width: 0;
  overflow: hidden;
  padding: 5px 8px 5px 9px;
  border: 1px solid var(--calendar-grid-line);
  border-left: 3px solid ${({ $color }) => $color};
  border-radius: 0;
  border-style: ${({ $draft }) => ($draft ? 'dashed' : 'solid')};
  border-left-style: solid;
  background: ${({ $draft }) =>
    $draft
      ? `repeating-linear-gradient(
          -45deg,
          var(--calendar-page),
          var(--calendar-page) 7px,
          color-mix(in srgb, var(--calendar-draft-stripe) 55%, var(--calendar-page)) 7px,
          color-mix(in srgb, var(--calendar-draft-stripe) 55%, var(--calendar-page)) 14px
        )`
      : 'var(--calendar-page)'};
  color: var(--calendar-ink);
  text-align: left;
  cursor: pointer;

  &:hover {
    border-color: color-mix(
      in srgb,
      ${({ $color }) => $color} 34%,
      var(--calendar-grid-line)
    );
    border-left-color: ${({ $color }) => $color};
  }

  strong,
  div {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    font-size: var(--platform-typography-font-size-xs);
    line-height: 1.2;
  }

  div {
    color: var(--calendar-ink-faint);
    font-size: 10px;
    font-family: var(--platform-typography-font-family-mono);
    line-height: 1.2;
  }
`

const TimeHeaderSpacer = styled.div`
  /* The corner above the time rail sticks with the day headers it is part
     of; left behind, it scrolled away and the hour labels rode up into
     the header row. */
  position: sticky;
  top: 0;
  z-index: ${GRID_Z_STICKY_HEADER};
  border-bottom: 1px solid var(--calendar-grid-line);
  background: var(--calendar-surface);
`

const AllDayRail = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-height: 42px;
  padding: 8px 10px 8px 0;
  border-right: 1px solid var(--calendar-grid-line);
  border-bottom: 1px solid var(--calendar-grid-line);
  background: var(--calendar-surface);
  color: var(--calendar-ink-faint);
  font-size: var(--platform-typography-font-size-xs);
  font-family: var(--platform-typography-font-family-mono);
  font-weight: 600;
  white-space: nowrap;
`

const AllDayCell = styled.div<{ $today?: boolean; $weekend?: boolean }>`
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 5px;
  min-width: 0;
  min-height: 42px;
  padding: 6px 8px;
  border-right: 1px solid var(--calendar-grid-line);
  border-bottom: 1px solid var(--calendar-grid-line);
  background: ${({ $today }) =>
    $today ? 'var(--calendar-today-bg)' : 'var(--calendar-surface)'};
  opacity: ${({ $weekend }) => ($weekend ? 0.82 : 1)};

  &:last-of-type {
    border-right: 0;
  }
`

const AllDayItem = styled.button<{ $color: string; $draft?: boolean }>`
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  padding: 4px 8px 4px 9px;
  border: 1px solid var(--calendar-grid-line);
  border-left: 3px solid ${({ $color }) => $color};
  border-radius: 0;
  border-style: ${({ $draft }) => ($draft ? 'dashed' : 'solid')};
  border-left-style: solid;
  background: ${({ $draft }) =>
    $draft
      ? `repeating-linear-gradient(
          -45deg,
          var(--calendar-page),
          var(--calendar-page) 7px,
          color-mix(in srgb, var(--calendar-draft-stripe) 55%, var(--calendar-page)) 7px,
          color-mix(in srgb, var(--calendar-draft-stripe) 55%, var(--calendar-page)) 14px
        )`
      : 'var(--calendar-page)'};
  color: var(--calendar-ink);
  font-size: var(--platform-typography-font-size-xs);
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
`

const TimeRail = styled.div`
  position: relative;
  min-height: 100%;
  border-right: 1px solid var(--calendar-grid-line);
  background: var(--calendar-surface);
`

const TimeLabel = styled.div<{ $top: number }>`
  position: absolute;
  top: ${({ $top }) => $top}px;
  right: 0;
  transform: translateY(-50%);
  width: 100%;
  padding: 0 10px 0 0;
  box-sizing: border-box;
  color: var(--calendar-ink-faint);
  font-size: var(--platform-typography-font-size-xs);
  font-family: var(--platform-typography-font-family-mono);
  line-height: 1;
  text-align: right;
`

const TimedDayColumn = styled.section<{ $today?: boolean; $weekend?: boolean }>`
  min-width: 0;
  border-right: 1px solid var(--calendar-grid-line);
  background: ${({ $today }) =>
    $today ? 'var(--calendar-today-bg)' : 'var(--calendar-bg)'};
  opacity: ${({ $weekend }) => ($weekend ? 0.82 : 1)};

  &:last-child {
    border-right: 0;
  }
`

const TimedDayHeader = styled.div`
  position: sticky;
  top: 0;
  z-index: ${GRID_Z_STICKY_HEADER};
  padding: 9px 12px;
  border-bottom: 1px solid var(--calendar-grid-line);
  background: var(--calendar-surface);
  color: var(--calendar-ink-faint);
  font-size: var(--platform-typography-font-size-sm);
  font-weight: 700;
`

const TimedDayHeaderInner = styled.div<{
  $today?: boolean
  $weekend?: boolean
}>`
  color: ${({ $today, $weekend }) =>
    $today
      ? 'var(--calendar-today-text)'
      : $weekend
      ? 'var(--platform-colors-text-secondary)'
      : 'var(--calendar-ink-faint)'};
`

const TimedDayBody = styled.div<{ $dropTarget?: boolean }>`
  position: relative;
  min-height: 100%;
  cursor: crosshair;
  touch-action: none;
  background: ${({ $dropTarget }) =>
      $dropTarget
        ? `linear-gradient(
        color-mix(in srgb, var(--calendar-accent-fill) 10%, transparent),
        color-mix(in srgb, var(--calendar-accent-fill) 10%, transparent)
      ),`
        : ''}
    repeating-linear-gradient(
      to bottom,
      transparent 0,
      transparent 27px,
      var(--calendar-time-rule-soft) 27px,
      var(--calendar-time-rule-soft) 28px,
      transparent 28px,
      transparent 55px,
      var(--calendar-time-rule) 55px,
      var(--calendar-time-rule) 56px
    );

  &:hover {
    background: linear-gradient(
        color-mix(in srgb, var(--calendar-accent-fill) 4%, transparent),
        color-mix(in srgb, var(--calendar-accent-fill) 4%, transparent)
      ),
      repeating-linear-gradient(
        to bottom,
        transparent 0,
        transparent 27px,
        var(--calendar-time-rule-soft) 27px,
        var(--calendar-time-rule-soft) 28px,
        transparent 28px,
        transparent 55px,
        var(--calendar-time-rule) 55px,
        var(--calendar-time-rule) 56px
      );
  }

  ${({ $dropTarget }) =>
    $dropTarget
      ? `
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--calendar-accent-fill) 28%, transparent);
  `
      : ''}
`

const NowMarker = styled.div<{ $top: number }>`
  position: absolute;
  right: 0;
  left: 0;
  top: ${({ $top }) => $top}px;
  /* The top property positions the row's TOP edge, but the 1px rule that
     reads as "now" is centred in it, and the row is as tall as the time
     pill. Without this the line drew half a pill below the true time:
     ~10px, which at 56px/hour is ~11 minutes, so 8:29 rendered where
     8:40 belongs. Pulling the row up by half its height puts the rule
     itself on the time, whatever the pill's font metrics do. */
  transform: translateY(-50%);
  z-index: ${GRID_Z_NOW_MARKER};
  display: flex;
  align-items: center;
  pointer-events: none;
`

const NowMarkerDot = styled.span`
  width: 8px;
  height: 8px;
  margin-left: -4px;
  border-radius: 50%;
  background: var(--calendar-danger);
  box-shadow: 0 0 0 2px var(--platform-colors-surface);
`

const NowMarkerLine = styled.span`
  flex: 1;
  height: 1px;
  background: var(--calendar-danger);
`

const NowMarkerLabel = styled.span`
  margin-right: 6px;
  padding: 1px 5px;
  border-radius: var(--platform-radius-sm);
  background: var(--calendar-danger);
  color: var(--platform-colors-text-on-danger, #fff);
  font-size: 10px;
  font-family: var(--platform-typography-font-family-mono);
  font-weight: 600;
  letter-spacing: 0.01em;
`

const TimedEventBlock = styled.button<{
  $color: string
  $compact?: boolean
  $dragging?: boolean
  $landed?: boolean
  $draft?: boolean
}>`
  position: absolute;
  right: 8px;
  left: 8px;
  z-index: ${({ $dragging, $landed }) =>
    $dragging || $landed ? GRID_Z_DRAGGING_EVENT : GRID_Z_EVENT};
  display: grid;
  align-content: ${({ $compact }) => ($compact ? 'center' : 'start')};
  gap: ${({ $compact }) => ($compact ? 0 : 2)}px;
  overflow: hidden;
  min-width: 0;
  min-height: 24px;
  padding: ${({ $compact }) =>
    $compact ? '4px 8px 4px 9px' : '8px 9px 6px 9px'};
  border: 1px solid var(--calendar-grid-line);
  border-left: 3px solid ${({ $color }) => $color};
  border-radius: 0;
  border-style: ${({ $draft }) => ($draft ? 'dashed' : 'solid')};
  border-left-style: solid;
  background: ${({ $draft }) =>
    $draft
      ? `repeating-linear-gradient(
          -45deg,
          var(--calendar-page),
          var(--calendar-page) 7px,
          color-mix(in srgb, var(--calendar-draft-stripe) 55%, var(--calendar-page)) 7px,
          color-mix(in srgb, var(--calendar-draft-stripe) 55%, var(--calendar-page)) 14px
        )`
      : 'var(--calendar-page)'};
  color: var(--calendar-ink);
  text-align: left;
  cursor: ${({ $dragging }) => ($dragging ? 'grabbing' : 'grab')};
  transform: ${({ $dragging, $landed }) =>
    $dragging ? 'scale(1.018)' : $landed ? 'scale(1.01)' : 'scale(1)'};
  transition: border-color 120ms ease, box-shadow 140ms ease,
    transform 140ms ease, background 140ms ease;
  box-shadow: ${({ $dragging, $landed, $color }) =>
    $dragging
      ? `0 9px 22px color-mix(in srgb, ${$color} 22%, transparent), 0 0 0 2px color-mix(in srgb, ${$color} 24%, transparent)`
      : $landed
      ? `0 0 0 3px color-mix(in srgb, ${$color} 24%, transparent)`
      : 'none'};

  strong,
  div {
    position: relative;
    z-index: 1;
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    font-size: ${({ $compact }) => ($compact ? 12 : 13)}px;
    font-weight: 700;
    line-height: 1.15;
  }

  div {
    display: ${({ $compact }) => ($compact ? 'none' : 'block')};
    color: var(--calendar-ink-faint);
    font-size: 11px;
    font-family: var(--platform-typography-font-family-mono);
    line-height: 1.15;
  }

  &:hover {
    border-color: color-mix(
      in srgb,
      ${({ $color }) => $color} 34%,
      var(--calendar-grid-line)
    );
    border-left-color: ${({ $color }) => $color};
  }

  ${({ $landed, $color }) =>
    $landed
      ? `
    animation: calendar-event-landed 420ms ease-out;

    @keyframes calendar-event-landed {
      0% {
        box-shadow:
          0 0 0 0 color-mix(in srgb, ${$color} 30%, transparent),
          0 8px 20px color-mix(in srgb, ${$color} 18%, transparent);
      }
      100% {
        box-shadow:
          0 0 0 8px color-mix(in srgb, ${$color} 0%, transparent),
          0 0 0 0 transparent;
      }
    }
  `
      : ''}

  &[aria-pressed='true'] {
    border-color: color-mix(
      in srgb,
      ${({ $color }) => $color} 52%,
      transparent
    );
    border-left-color: ${({ $color }) => $color};
    box-shadow: 0 0 0 1px
      color-mix(in srgb, ${({ $color }) => $color} 36%, transparent);
    outline-offset: 0;
  }
`

const TimedDraftBlock = styled.div`
  position: absolute;
  right: 8px;
  left: 8px;
  z-index: ${GRID_Z_EVENT};
  display: grid;
  align-content: center;
  min-height: 22px;
  padding: 6px 9px 6px 12px;
  border: 1px dashed var(--platform-colors-border);
  border-radius: var(--platform-radius-sm);
  background: repeating-linear-gradient(
    135deg,
    var(--platform-colors-bg),
    var(--platform-colors-bg) 7px,
    var(--calendar-draft-stripe) 7px,
    var(--calendar-draft-stripe) 14px
  );
  color: var(--platform-colors-text-secondary);
  font-size: var(--platform-typography-font-size-sm);
  font-weight: 700;
  pointer-events: none;

  &::before {
    position: absolute;
    top: 6px;
    bottom: 6px;
    left: 0;
    width: 3px;
    border-radius: var(--platform-radius-sm);
    background: var(--platform-colors-text-secondary);
    content: '';
  }
`

const ResizeHandle = styled.span<{
  $edge: 'start' | 'end'
  $compact?: boolean
}>`
  position: absolute;
  display: block;
  right: 12px;
  left: 12px;
  ${({ $edge }) => ($edge === 'start' ? 'top: 1px;' : 'bottom: 1px;')}
  z-index: ${GRID_Z_RESIZE_HANDLE};
  height: 6px;
  opacity: ${({ $compact }) => ($compact ? 0 : 1)};
  cursor: ns-resize;

  &::after {
    position: absolute;
    top: 2px;
    right: 34%;
    left: 34%;
    height: 1px;
    border-radius: var(--platform-radius-sm);
    background: var(--calendar-ink-faint);
    content: '';
  }
`

const AvailabilityBand = styled.div<{ $available: boolean }>`
  position: absolute;
  right: 0;
  left: 0;
  background: ${({ $available }) =>
    $available ? 'transparent' : 'var(--calendar-unavailable-bg)'};
  pointer-events: none;
`

const EventBlock = styled.button<{ $color: string; $draft?: boolean }>`
  position: relative;
  display: block;
  width: calc(100% - 16px);
  min-width: 0;
  overflow: hidden;
  margin: 8px;
  padding: 10px 10px 10px 11px;
  border: 1px solid var(--calendar-grid-line);
  border-left: 3px solid ${({ $color }) => $color};
  border-radius: 0;
  border-style: ${({ $draft }) => ($draft ? 'dashed' : 'solid')};
  border-left-style: solid;
  background: ${({ $draft }) =>
    $draft
      ? `repeating-linear-gradient(
          -45deg,
          var(--calendar-page),
          var(--calendar-page) 7px,
          color-mix(in srgb, var(--calendar-draft-stripe) 55%, var(--calendar-page)) 7px,
          color-mix(in srgb, var(--calendar-draft-stripe) 55%, var(--calendar-page)) 14px
        )`
      : 'var(--calendar-page)'};
  color: var(--calendar-ink);
  text-align: left;
  cursor: pointer;

  &:hover {
    border-color: color-mix(
      in srgb,
      ${({ $color }) => $color} 34%,
      var(--calendar-grid-line)
    );
    border-left-color: ${({ $color }) => $color};
  }

  strong,
  div {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  strong {
    white-space: nowrap;
  }

  div {
    color: var(--calendar-ink-faint);
    font-family: var(--platform-typography-font-family-mono);
  }
`

const Agenda = styled.div`
  display: grid;
  gap: 10px;
  padding: 18px 24px;
`

const AgendaRow = styled(EventBlock)`
  width: 100%;
  margin: 0;
`

const FieldStack = styled.div`
  display: grid;
  gap: 10px;
  margin: 14px 0;
`

const InlineError = styled.p`
  margin: -4px 0 8px;
  color: var(--platform-colors-danger-text);
  font-size: var(--platform-typography-font-size-sm);
`

const AvailabilityControls = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`

const WeekdayToggle = styled.button<{ $active: boolean }>`
  min-width: 44px;
  padding: 6px 8px;
  border: 1px solid
    ${({ $active }) =>
      $active
        ? 'var(--calendar-accent-fill)'
        : 'var(--platform-colors-border)'};
  border-radius: var(--platform-radius-sm);
  background: ${({ $active }) =>
    $active
      ? 'color-mix(in srgb, var(--calendar-accent-fill) 14%, var(--calendar-surface))'
      : 'var(--platform-colors-surface)'};
  color: var(--platform-colors-text);
  cursor: pointer;
`

const FieldLabel = styled.label`
  display: grid;
  gap: 5px;
  color: var(--platform-colors-text-secondary);
  font-size: var(--platform-typography-font-size-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;

  input,
  textarea,
  select {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border: 1px solid var(--platform-colors-border);
    border-radius: var(--platform-radius-sm);
    background: var(--platform-colors-surface);
    color: var(--platform-colors-text);
    font: inherit;
    font-weight: 500;
    letter-spacing: 0;
    text-transform: none;
  }

  textarea {
    min-height: 110px;
    resize: vertical;
  }

  input[type='checkbox'] {
    width: auto;
    justify-self: start;
  }
`

const ProviderPanel = styled.div`
  display: grid;
  gap: 12px;
  margin-top: 12px;
  padding: 14px;
  border: 1px solid var(--calendar-grid-line);
  border-radius: var(--platform-radius-sm);
  background: var(--platform-colors-bg);
`

const GoogleProviderPanel = styled(ProviderPanel)`
  gap: 14px;
  padding: 18px;
  border-color: transparent;
  border-radius: var(--platform-radius-sm);
  background: var(--calendar-surface-muted);
`

const ProviderRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
`

const GoogleProviderTitle = styled.strong`
  display: block;
  margin-bottom: 6px;
  color: var(--platform-colors-text);
  font-size: 18px;
`

const GoogleProviderDescription = styled.div`
  max-width: 760px;
  color: var(--platform-colors-text-secondary);
  font-size: 16px;
  line-height: 1.45;
`

const ProviderOptionGrid = styled.div`
  display: grid;
  gap: 10px;
  margin-top: 12px;
`

const ProviderOptionCard = styled.button<{ $active?: boolean }>`
  display: grid;
  gap: 8px;
  width: 100%;
  padding: 12px;
  border: 1px solid
    ${({ $active }) =>
      $active
        ? 'var(--calendar-accent-fill)'
        : 'var(--calendar-grid-line)'};
  border-radius: var(--platform-radius-sm);
  background: ${({ $active }) =>
    $active
      ? 'color-mix(in srgb, var(--calendar-accent-fill) 10%, var(--calendar-surface))'
      : 'var(--platform-colors-surface)'};
  color: var(--platform-colors-text);
  text-align: left;
  cursor: pointer;

  &:hover {
    border-color: var(--calendar-accent-fill);
  }
`

const ProviderOptionTitleRow = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
`

const ProviderOptionTitle = styled.strong`
  display: block;
  color: var(--platform-colors-text);
`

const ProviderOptionDescription = styled.div`
  color: var(--platform-colors-text-secondary);
  font-size: var(--platform-typography-font-size-sm);
  line-height: 1.4;
`

const ProviderOptionMeta = styled.div`
  color: var(--platform-colors-text);
  font-size: var(--platform-typography-font-size-xs);
  font-weight: 700;
`

const COMMON_TIME_ZONES = [
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Asia/Tokyo',
  'Australia/Sydney',
]

const WEEKDAY_OPTIONS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
]

function formatTime(iso: string, timeZone: string): string {
  return formatTimeInTimeZone(iso, timeZone)
}

function dayLabel(date: Date, timeZone: string): string {
  return formatDayInTimeZone(date, timeZone)
}

function hourLabel(hour: number, timeZone: string): string {
  return formatTimeInTimeZone(
    instantFromZonedWallTime('2026-01-01', hour, 0, timeZone),
    timeZone,
  )
}

function compactHourLabel(hour: number): string {
  const suffix = hour < 12 ? 'AM' : 'PM'
  const displayHour = hour % 12 === 0 ? 12 : hour % 12
  if (hour === DAY_START_HOUR || hour === 12 || hour === DAY_END_HOUR - 1) {
    return `${displayHour} ${suffix}`
  }
  return String(displayHour)
}

function calendarRangeTitle(
  view: CalendarView,
  anchor: Date,
  days: Date[],
): { title: string; year: string } {
  if (view === 'month') {
    return {
      title: new Intl.DateTimeFormat(undefined, { month: 'long' }).format(
        anchor,
      ),
      year: new Intl.DateTimeFormat(undefined, { year: 'numeric' }).format(
        anchor,
      ),
    }
  }
  if (view === 'day') {
    return {
      title: new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
      }).format(anchor),
      year: new Intl.DateTimeFormat(undefined, { year: 'numeric' }).format(
        anchor,
      ),
    }
  }
  const first = days[0] ?? anchor
  const last = days[days.length - 1] ?? anchor
  const firstLabel = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(first)
  const sameMonth = first.getMonth() === last.getMonth()
  const lastLabel = new Intl.DateTimeFormat(undefined, {
    month: sameMonth ? undefined : 'short',
    day: 'numeric',
  }).format(last)
  return {
    title: `${firstLabel} - ${lastLabel}`,
    year: new Intl.DateTimeFormat(undefined, { year: 'numeric' }).format(last),
  }
}

function availabilityLabel(
  days: number[],
  startHour: number,
  endHour: number,
  timeZone: string,
): string {
  const activeLabels = WEEKDAY_OPTIONS.filter(option =>
    days.includes(option.value),
  ).map(option => option.label)
  const dayLabelText =
    activeLabels.length === 5 &&
    days.every(day => [1, 2, 3, 4, 5].includes(day))
      ? 'Mon-Fri'
      : activeLabels.join(', ') || 'No days'
  return `Available ${dayLabelText}, ${hourLabel(
    startHour,
    timeZone,
  )} to ${hourLabel(endHour, timeZone)}`
}

function sameDate(left: Date, right: Date, timeZone: string): boolean {
  return (
    dateKeyInTimeZone(left, timeZone) === dateKeyInTimeZone(right, timeZone)
  )
}

function formatNowTime(date: Date, timeZone: string): string {
  return formatTimeInTimeZone(date.toISOString(), timeZone)
}

function monthGridDays(anchor: Date): Date[] {
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const mondayOffset = (firstOfMonth.getDay() + 6) % 7
  const firstCell = new Date(firstOfMonth)
  firstCell.setDate(firstOfMonth.getDate() - mondayOffset)
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(firstCell)
    day.setDate(firstCell.getDate() + index)
    return day
  })
}

function startOfDayIso(day: Date, timeZone: string): string {
  return instantFromZonedWallTime(
    dateKeyInTimeZone(day, timeZone),
    0,
    0,
    timeZone,
  )
}

function endOfDayIso(day: Date, timeZone: string): string {
  return instantFromZonedWallTime(
    dateKeyInTimeZone(day, timeZone),
    23,
    59,
    timeZone,
  )
}

function toDateTimeLocalValue(
  iso: string | undefined,
  timeZone: string,
): string {
  return dateTimeLocalValueInTimeZone(iso, timeZone)
}

function dateTimeLocalToIso(value: string, timeZone: string): string | null {
  return dateTimeLocalToIsoInTimeZone(value, timeZone)
}

function decimalHourInTimeZone(iso: string, timeZone: string): number {
  const local = dateTimeLocalValueInTimeZone(iso, timeZone)
  const match = local.match(/T(\d{2}):(\d{2})$/)
  if (!match) return 0
  return Number(match[1]) + Number(match[2]) / 60
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function snapMinutes(minutes: number): number {
  return clamp(
    Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES,
    0,
    DAY_END_HOUR * 60,
  )
}

function normalizedRange(
  startMinutes: number,
  endMinutes: number,
): { startMinutes: number; endMinutes: number } {
  const start = Math.min(startMinutes, endMinutes)
  const end = Math.max(startMinutes, endMinutes)
  if (end - start >= MIN_EVENT_MINUTES) {
    return { startMinutes: start, endMinutes: end }
  }
  const expandedEnd = Math.min(DAY_END_HOUR * 60, start + DEFAULT_CLICK_MINUTES)
  if (expandedEnd - start >= MIN_EVENT_MINUTES) {
    return { startMinutes: start, endMinutes: expandedEnd }
  }
  return {
    startMinutes: Math.max(0, expandedEnd - DEFAULT_CLICK_MINUTES),
    endMinutes: expandedEnd,
  }
}

function minutesFromIso(iso: string, timeZone: string): number {
  return snapMinutes(decimalHourInTimeZone(iso, timeZone) * 60)
}

function styleForMinuteRange(
  startMinutes: number,
  endMinutes: number,
): CSSProperties {
  const range = normalizedRange(startMinutes, endMinutes)
  return {
    top: (range.startMinutes / 60) * HOUR_HEIGHT,
    height: Math.max(
      22,
      ((range.endMinutes - range.startMinutes) / 60) * HOUR_HEIGHT,
    ),
  }
}

function layoutTimedItems(
  events: CalendarEvent[],
  tasks: CalendarTask[],
  dayKey: string,
  timeZone: string,
  fallbackHour: number,
): TimedItemLayout[] {
  const sorted = [
    ...events.map(event => {
      const startMinutes = minutesFromIso(event.startsAt, timeZone)
      const endMinutes = Math.max(
        startMinutes + MIN_EVENT_MINUTES,
        minutesFromIso(event.endsAt, timeZone),
      )
      return { type: 'event' as const, event, startMinutes, endMinutes }
    }),
    ...tasks.map(task => {
      const startsAt =
        task.scheduledStart ??
        task.dueAt ??
        instantFromZonedWallTime(dayKey, fallbackHour, 0, timeZone)
      const startMinutes = minutesFromIso(startsAt, timeZone)
      const endMinutes = task.scheduledEnd
        ? Math.max(
            startMinutes + MIN_EVENT_MINUTES,
            minutesFromIso(task.scheduledEnd, timeZone),
          )
        : startMinutes + 45
      return { type: 'task' as const, task, startMinutes, endMinutes }
    }),
  ].sort(
    (left, right) =>
      left.startMinutes - right.startMinutes ||
      left.endMinutes - right.endMinutes,
  )

  const layouts: TimedItemLayout[] = []

  for (let index = 0; index < sorted.length; ) {
    const cluster = [sorted[index]]
    let clusterEnd = sorted[index].endMinutes
    index += 1

    while (index < sorted.length && sorted[index].startMinutes < clusterEnd) {
      cluster.push(sorted[index])
      clusterEnd = Math.max(clusterEnd, sorted[index].endMinutes)
      index += 1
    }

    const laneEnds: number[] = []
    const assigned = cluster.map(item => {
      const lane = laneEnds.findIndex(end => end <= item.startMinutes)
      const assignedLane = lane === -1 ? laneEnds.length : lane
      laneEnds[assignedLane] = item.endMinutes
      return { ...item, lane: assignedLane }
    })
    const laneCount = Math.max(1, laneEnds.length)

    for (const item of assigned) {
      const duration = item.endMinutes - item.startMinutes
      layouts.push({
        compact: duration <= 45,
        event: item.type === 'event' ? item.event : undefined,
        style: {
          ...styleForMinuteRange(item.startMinutes, item.endMinutes),
          ...(item.type === 'task' ? { height: 36 } : {}),
          left:
            laneCount > 1
              ? `calc(8px + ((100% - 16px) / ${laneCount}) * ${item.lane})`
              : 8,
          right: 'auto',
          width:
            laneCount > 1
              ? `calc((100% - 16px) / ${laneCount} - 3px)`
              : 'calc(100% - 16px)',
        },
        task: item.type === 'task' ? item.task : undefined,
        type: item.type,
      })
    }
  }

  return layouts
}

/** "just now" for the first minute, then a clock time. */
function formatSavedAt(at: Date): string {
  const secondsAgo = Math.round((Date.now() - at.getTime()) / 1000)
  if (secondsAgo < 60) return 'just now'
  return `at ${at.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })}`
}

function selectedEventIdForRecurringScope(
  event: CalendarEvent,
  scope: RecurrenceEditScope,
): string {
  if (scope === 'this') {
    return `${recurrenceBaseEventId(event.id)}_only_${recurrenceInstanceIndex(
      event.id,
    )}`
  }
  if (scope === 'following') {
    return `${recurrenceBaseEventId(
      event.id,
    )}_following_${recurrenceInstanceIndex(event.id)}`
  }
  return recurrenceBaseEventId(event.id)
}

export function PureCalendarShell({
  initialStore,
  calendarProvider = null,
  bootNotice,
  resource,
  onResourceHandled = () => undefined,
}: {
  initialStore: CalendarStore
  calendarProvider?: CalendarProvider | null
  bootNotice?: string
  resource?: ResourceOpenEvent | null
  onResourceHandled?: () => void
}): React.ReactElement {
  const [store, setStore] = useState(initialStore)
  const [view, setView] = useState<CalendarView>(
    initialStore.settings.viewMode ?? 'week',
  )
  const [anchorDate, setAnchorDate] = useState(new Date())
  const [selectedEventId, setSelectedEventId] = useState<string | null>(
    store.events[0]?.id ?? null,
  )
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [pendingDraft, setPendingDraft] = useState<PendingCalendarDraft | null>(
    null,
  )
  const [pendingInvite, setPendingInvite] =
    useState<PendingCalendarInvite | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [pendingEventDelete, setPendingEventDelete] = useState(false)
  // The overlay opens on a READ view for an existing event; Edit reveals
  // the form. A brand-new event (no title yet) opens straight into edit.
  const [eventEditing, setEventEditing] = useState(false)
  const [calendarPanelOpen, setCalendarPanelOpen] = useState(false)
  const appSettings = useAppSettings()
  const settingsOpen = appSettings.isOpen
  const setSettingsOpen = useCallback((open: boolean) => open ? appSettings.open() : appSettings.close(), [appSettings.open, appSettings.close])
  const [selectedCalendarProviderId, setSelectedCalendarProviderId] =
    useState('google')
  const [now, setNow] = useState(() => new Date())

  // PureMail mirrors IMAP-delivered invites into the shared intent file
  // WITHOUT opening this app (its Gmail accounts already reach Google
  // Calendar server-side, so mail only writes these for IMAP). Sweep the
  // file — at mount, on refocus, and on a slow interval — and add each
  // auto-create invite silently: no selection, no navigation, no dialog.
  // Intents younger than a few seconds are left alone; those belong to a
  // resource-open in flight (the manual RSVP flow), and consuming one here
  // would make that open report "payload was not found".
  const inviteSweepBusyRef = useRef(false)
  useEffect(() => {
    const sweep = async (): Promise<void> => {
      if (inviteSweepBusyRef.current) return
      inviteSweepBusyRef.current = true
      try {
        const result = (await bridge.call(
          PLATFORM_BRIDGE_METHODS.STORAGE_READ_JSON,
          [
            {
              appSlug: CALENDAR_INVITE_INTENT_STORAGE_SLUG,
              fileName: CALENDAR_INVITE_INTENT_STORAGE_FILE,
            },
          ],
        )) as { value?: unknown } | null
        const intentStore = normalizeCalendarInviteIntentStore(result?.value)
        const nowMs = Date.now()
        const ready = Object.entries(intentStore.intents).filter(
          ([, intent]) =>
            intent.autoCreate === true &&
            (intent.response ?? 'needsAction') === 'needsAction' &&
            nowMs - Date.parse(intent.createdAt) > 15_000,
        )
        if (ready.length === 0) return
        setStore(current => {
          let next = current
          for (const [, intent] of ready) {
            next = upsertMirroredInviteEvent(next, intent).store
          }
          return next
        })
        for (const [resourceId] of ready) {
          await removeConsumedInviteIntent(resourceId)
        }
      } catch {
        // Best-effort: unconsumed intents are offered again next sweep, and
        // upsertInviteEvent dedups by UID if one is applied twice.
      } finally {
        inviteSweepBusyRef.current = false
      }
    }
    void sweep()
    const interval = window.setInterval(() => void sweep(), 120_000)
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void sweep()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const [gridDraft, setGridDraft] = useState<GridDraftSelection | null>(null)
  const [dragState, setDragState] = useState<EventDragState | null>(null)
  const [landedEventId, setLandedEventId] = useState<string | null>(null)
  const [resizeState, setResizeState] = useState<EventResizeState | null>(null)
  const [eventUndoStack, setEventUndoStack] = useState<CalendarEventUndo[]>([])
  const [persistFailure, setPersistFailure] = useState<string | null>(null)
  /**
   * What the store's persistence is actually doing. `dirty` means an edit
   * is made but not yet written — the state the old unconditional "Saved"
   * label misreported.
   */
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved'>(
    'idle',
  )
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  // Last successfully-persisted snapshot (serialized for cheap comparison,
  // value for rolling into the backup file before the next overwrite).
  const lastPersistedRef = useRef<{
    serialized: string
    value: CalendarStore
  } | null>(null)
  const persistDirtyRef = useRef(false)
  // Serialized settings as last flushed to app settings; boot-hydrated
  // settings match what is already on disk, so the first run is a no-op.
  const lastSavedSettingsRef = useRef<string | null>(
    JSON.stringify(initialStore.settings),
  )
  const [selectedRangeError, setSelectedRangeError] = useState<string | null>(
    null,
  )
  const [recurrenceEditScope, setRecurrenceEditScope] =
    useState<RecurrenceEditScope>('this')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const timedBodyRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const calendarViewportRef = useRef<HTMLDivElement | null>(null)
  const landedEventTimeoutRef = useRef<number | null>(null)
  const [googleStatus, setGoogleStatus] =
    useState<OAuthCredentialStatus | null>(null)
  useEffect(() => {
    let cancelled = false
    void fetchGoogleCredentialStatus()
      .then(status => {
        if (!cancelled) setGoogleStatus(status)
      })
      .catch((error: unknown) => {
        // Settings just render the "not connected" state without a status.
        console.warn(
          '[purecalendar] failed to read google credential status for the providers panel:',
          error,
        )
      })
    return () => {
      cancelled = true
    }
  }, [])
  useEffect(() => {
    syncAgentStore(store)
  }, [store])
  useEffect(() => {
    setAgentStoreDispatch(setStore)
    return () => {
      setAgentStoreDispatch(null)
    }
  }, [])
  const googleStateLabel = googleStatus?.connected
    ? 'connected'
    : googleStatus?.needsReconnect
      ? 'reconnect required'
      : googleStatus?.configured
        ? 'configured'
        : 'not configured'
  const selectedCalendarProvider =
    CALENDAR_PROVIDER_OPTIONS.find(
      option => option.id === selectedCalendarProviderId,
    ) ?? CALENDAR_PROVIDER_OPTIONS[0]
  const timeZoneConfig = useMemo(
    () => resolveCalendarTimeZone(store.settings),
    [store.settings],
  )
  const displayTimeZone = timeZoneConfig.timeZone
  const range = weekRange(anchorDate)
  const visibleEvents = useMemo(
    () => visibleCalendarEvents(store, range.start, range.end),
    [range.end, range.start, store],
  )
  const selectedEvent =
    visibleEvents.find(event => event.id === selectedEventId) ??
    store.events.find(event => event.id === selectedEventId) ??
    null
  const selectedTask =
    store.tasks.find(task => task.id === selectedTaskId) ?? null
  const selectedCalendar = selectedEvent
    ? store.calendars.find(calendar => calendar.id === selectedEvent.calendarId)
    : null
  const selectedEventReadOnly = selectedEvent
    ? !canEditCalendarEvent(store, selectedEvent)
    : false
  const writableCalendars = useMemo(() => editableCalendars(store), [store])
  const availability = useMemo(
    () => normalizeAvailabilitySettings(store.settings),
    [store.settings],
  )
  const selectedEventOutsideAvailability = selectedEvent
    ? !isAvailableWallTime(
        store.settings,
        selectedEvent.startsAt,
        decimalHourInTimeZone(selectedEvent.startsAt, displayTimeZone),
        displayTimeZone,
      ) ||
      !isAvailableWallTime(
        store.settings,
        selectedEvent.endsAt,
        Math.max(
          0,
          decimalHourInTimeZone(selectedEvent.endsAt, displayTimeZone) - 0.01,
        ),
        displayTimeZone,
      )
    : false
  const scheduledTasks = visibleScheduledTasks(
    store.tasks,
    range.start,
    range.end,
    store.calendars,
  )
  const days = Array.from(
    { length: 7 },
    (_, index) =>
      new Date(Date.parse(range.start) + index * 24 * 60 * 60 * 1000),
  )
  const headerRange = calendarRangeTitle(view, anchorDate, days)
  const searchResults = useMemo(
    () => searchCalendarStore(store, searchQuery),
    [searchQuery, store],
  )
  const syncSummary = useMemo(() => calendarSyncSummary(store), [store])
  const needsSyncAttention = syncSummary.failed > 0 || syncSummary.conflict > 0
  // Offer to clear the first-run demo seed once a real account is connected
  // and sample events are still interleaved with real ones. Asked once.
  const showDemoExit =
    calendarProvider != null &&
    !store.settings.demoCleared &&
    store.events.some(event => event.source === 'demo')

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  // Clear the two-step delete confirmation whenever the details overlay
  // closes, so a stale "Confirm delete" never greets the next event opened.
  useEffect(() => {
    if (!detailsOpen) setPendingEventDelete(false)
  }, [detailsOpen])

  // On opening a different event: a titled, editable event shows its read
  // view first; a fresh untitled one (just created) opens in edit; a
  // read-only event never edits.
  useEffect(() => {
    setEventEditing(
      !selectedEventReadOnly && !(selectedEvent?.title ?? '').trim().length,
    )
  }, [selectedEvent?.id, selectedEventReadOnly])

  // Persist every store change (debounced). Before this, all events, tasks,
  // and edits lived only in React state and were silently lost on reload.
  // The previous good save is rolled into a backup file first so a torn or
  // corrupt write is always one step recoverable (same pattern as PureSheets).
  //
  // The details overlay reports this state rather than asserting "Saved":
  // the header used to say so unconditionally, including during the 800ms
  // the write had not happened yet, which is the moment a reader most
  // needs the truth.
  useEffect(() => {
    const serialized = JSON.stringify(store)
    if (serialized === lastPersistedRef.current?.serialized) return
    persistDirtyRef.current = true
    setSaveState('dirty')
    const timeout = window.setTimeout(() => {
      const previous = lastPersistedRef.current
      void (async () => {
        try {
          if (previous && previous.serialized !== serialized) {
            await writeCalendarStoreFile(
              CALENDAR_STORE_BACKUP_FILE,
              previous.value,
            ).catch((error: unknown) => {
              // The main write below still runs (and surfaces its own
              // failure); losing one backup generation is tolerable but
              // worth a trace in the log.
              console.warn(
                '[purecalendar] failed to write store backup file:',
                error,
              )
            })
          }
          setSaveState('saving')
          await writeCalendarStoreFile(CALENDAR_STORE_FILE, store)
          lastPersistedRef.current = { serialized, value: store }
          persistDirtyRef.current = false
          setPersistFailure(null)
          setSaveState('saved')
          setLastSavedAt(new Date())
        } catch (error) {
          // A failed write is a standing data-loss risk, not a transient
          // hiccup — surface it until a later save succeeds.
          setSaveState('dirty')
          setPersistFailure(
            error instanceof Error
              ? error.message
              : 'The calendar store could not be saved.',
          )
        }
      })()
    }, 800)
    return () => window.clearTimeout(timeout)
  }, [store])

  // Push pending edits of Google-backed events to the provider (debounced).
  // Only events whose content is unchanged since the push are replaced with
  // the synced result — an edit racing the push simply stays pending and is
  // picked up by the next round.
  const googleSyncInFlightRef = useRef(false)
  useEffect(() => {
    if (!calendarProvider) return
    if (googleSyncInFlightRef.current) return
    const hasPending = store.events.some(
      event => event.source === 'provider' && event.syncState === 'pending',
    )
    // Deletions (tombstoned provider events) push through the same loop.
    const hasTombstones = (store.removedEventIds ?? []).some(id =>
      parseGoogleEventLocalId(id),
    )
    if (!hasPending && !hasTombstones) return
    const pushed = store
    const timeout = window.setTimeout(() => {
      googleSyncInFlightRef.current = true
      void calendarProvider
        .sync(pushed)
        .then(result => {
          const replacements = new Map<
            string,
            { original: CalendarEvent; next: CalendarEvent }
          >()
          pushed.events.forEach((event, index) => {
            const next = result.events[index]
            if (next && next !== event) {
              replacements.set(event.id, { original: event, next })
            }
          })
          // Tombstones the provider confirmed deleting are pruned; ones the
          // user added while this push was in flight stay queued.
          const confirmedDeletes = new Set(
            (pushed.removedEventIds ?? []).filter(
              id => !(result.removedEventIds ?? []).includes(id),
            ),
          )
          if (replacements.size === 0 && confirmedDeletes.size === 0) return
          setStore(current => ({
            ...current,
            events: current.events.map(event => {
              const replacement = replacements.get(event.id)
              return replacement &&
                JSON.stringify(event) === JSON.stringify(replacement.original)
                ? replacement.next
                : event
            }),
            ...(confirmedDeletes.size
              ? {
                  removedEventIds: (current.removedEventIds ?? []).filter(
                    id => !confirmedDeletes.has(id),
                  ),
                }
              : {}),
          }))
        })
        .catch(error => {
          console.warn(
            '[purecalendar] google push failed; edits stay pending:',
            error instanceof Error ? error.message : error,
          )
        })
        .finally(() => {
          googleSyncInFlightRef.current = false
        })
    }, 1200)
    return () => window.clearTimeout(timeout)
  }, [store, calendarProvider])

  // Pull a fresh snapshot from Google and merge it in. Boot does this once;
  // without a periodic + manual refresh a day-long session silently drifts
  // stale. mergeGoogleSnapshot keeps pending local edits, so a refresh mid-
  // edit never clobbers unsynced work.
  const [refreshing, setRefreshing] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const refreshFromProvider = useCallback(async (): Promise<void> => {
    if (!calendarProvider) return
    // Mutually exclusive with the debounced push so the two never race on
    // setStore; a skipped refresh is retried on the next interval/click.
    if (googleSyncInFlightRef.current) return
    googleSyncInFlightRef.current = true
    setRefreshing(true)
    setRefreshError(null)
    try {
      const remote = await calendarProvider.fetchStore()
      setStore(current => mergeGoogleSnapshot(current, remote))
      setLastSyncedAt(Date.now())
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn('[purecalendar] manual/interval refresh failed:', message)
      setRefreshError(message)
    } finally {
      googleSyncInFlightRef.current = false
      setRefreshing(false)
    }
  }, [calendarProvider])

  // Fetch subscribed ICS feeds (holidays, team calendars) and mirror them as
  // read-only calendars. The setting existed but was never fetched. Feeds are
  // independent of the Google account. A ref keeps the callback stable while
  // still reading the latest subscription list.
  const feedsRef = useRef(store.settings.icsFeeds)
  feedsRef.current = store.settings.icsFeeds
  const refreshIcsFeeds = useCallback(async (): Promise<void> => {
    const feeds = (feedsRef.current ?? []).filter(
      feed => feed.url.trim().length > 0,
    )
    const keepIds = new Set(feeds.map(feed => feed.id))
    setStore(current => pruneIcsFeeds(current, keepIds))
    const now = Date.now()
    const windowStart = now - 30 * 24 * 60 * 60 * 1000
    const windowEnd = now + 180 * 24 * 60 * 60 * 1000
    for (const feed of feeds.filter(feed => feed.visible)) {
      try {
        const response = await networkFetch({ url: feed.url })
        if (!response.ok) {
          console.warn(
            `[purecalendar] ICS feed "${feed.label}" fetch failed: HTTP ${response.status}`,
          )
          continue
        }
        const events = parseIcsFeed(
          response.body,
          feed.id,
          windowStart,
          windowEnd,
        )
        if (!events) continue
        setStore(current => mergeIcsFeedEvents(current, feed, events))
      } catch (error) {
        console.warn(
          `[purecalendar] ICS feed "${feed.label}" refresh failed:`,
          error instanceof Error ? error.message : error,
        )
      }
    }
  }, [])

  // Refresh feeds on mount and whenever the subscription list changes.
  const feedsKey = JSON.stringify(
    (store.settings.icsFeeds ?? []).map(feed => [
      feed.id,
      feed.url,
      feed.visible,
      feed.label,
    ]),
  )
  useEffect(() => {
    void refreshIcsFeeds()
  }, [feedsKey, refreshIcsFeeds])

  // Periodic background refresh (every 5 min): the Google account when
  // connected, and the ICS feeds always. Without this a day-long session
  // silently drifts stale.
  useEffect(() => {
    const hasFeeds = (store.settings.icsFeeds ?? []).some(feed =>
      feed.url.trim(),
    )
    if (!calendarProvider && !hasFeeds) return
    const interval = window.setInterval(
      () => {
        if (calendarProvider) void refreshFromProvider()
        void refreshIcsFeeds()
      },
      5 * 60 * 1000,
    )
    return () => window.clearInterval(interval)
  }, [calendarProvider, refreshFromProvider, refreshIcsFeeds, feedsKey])

  // Schedule OS notifications for event reminders through the shell (which
  // owns the timers). Reminders while the app is CLOSED are out of scope.
  // Only ids no longer wanted are cancelled — cancelAll would clobber other
  // apps' notifications since the shell scheduler is process-wide.
  const scheduledReminderIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (isStandaloneDevMode()) return
    const timeout = window.setTimeout(() => {
      const desired = computeEventReminders(
        store.events,
        Date.now(),
        30 * 24 * 60 * 60 * 1000,
      )
      const desiredIds = new Set(desired.map(reminder => reminder.id))
      for (const id of scheduledReminderIdsRef.current) {
        if (!desiredIds.has(id)) {
          void cancelNotification({ id }).catch(() => undefined)
        }
      }
      for (const reminder of desired) {
        void scheduleNotification(reminder).catch(() => undefined)
      }
      scheduledReminderIdsRef.current = desiredIds
    }, 1000)
    return () => window.clearTimeout(timeout)
  }, [store.events])

  // Persist settings whenever they change. Previously only viewMode was
  // written (a special case inside changeView); working hours, availability
  // days, and timezone mode silently reset on every reload. One effect for
  // all settings replaces the per-handler merges and their read-modify-write
  // interleaving hazard.
  useEffect(() => {
    const serialized = JSON.stringify(store.settings)
    if (serialized === lastSavedSettingsRef.current) return
    const timeout = window.setTimeout(() => {
      void saveCalendarSettings(store.settings)
        .then(() => {
          lastSavedSettingsRef.current = serialized
        })
        .catch(() => {
          setPersistFailure('Calendar settings could not be saved.')
        })
    }, 500)
    return () => window.clearTimeout(timeout)
  }, [store.settings])

  // Warn before closing while a save is pending or failed; the debounce above
  // means the last edit can be up to ~800ms behind the disk.
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (!persistDirtyRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  useEffect(() => {
    if (view !== 'day' && view !== 'week') return
    const viewport = calendarViewportRef.current
    if (!viewport) return
    viewport.scrollTop = Math.max(
      0,
      (availability.availableStartHour - 1) * HOUR_HEIGHT,
    )
  }, [availability.availableStartHour, view])

  useEffect(() => {
    if (
      !detailsOpen &&
      !calendarPanelOpen &&
      !settingsOpen &&
      !gridDraft &&
      !dragState &&
      !resizeState
    )
      return

    const closeOpenDrawer = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setGridDraft(null)
      setDragState(null)
      setResizeState(null)
      setDetailsOpen(false)
      setCalendarPanelOpen(false)
      setSettingsOpen(false)
    }

    window.addEventListener('keydown', closeOpenDrawer)
    return () => window.removeEventListener('keydown', closeOpenDrawer)
  }, [
    calendarPanelOpen,
    detailsOpen,
    dragState,
    gridDraft,
    resizeState,
    settingsOpen,
  ])

  useEffect(
    () => () => {
      if (landedEventTimeoutRef.current !== null) {
        window.clearTimeout(landedEventTimeoutRef.current)
      }
    },
    [],
  )

  useEffect(() => {
    if (!resource?.path) return
    const resourcePath = calendarResourcePath(resource.path)
    let cancelled = false
    if (isCalendarDraftResourceId(resourcePath)) {
      bridge
        .call(PLATFORM_BRIDGE_METHODS.STORAGE_READ_JSON, [
          {
            appSlug: CALENDAR_DRAFT_INTENT_STORAGE_SLUG,
            fileName: CALENDAR_DRAFT_INTENT_STORAGE_FILE,
          },
        ])
        .then(result => {
          if (cancelled) return
          const intentStore = normalizeCalendarDraftIntentStore(
            (result as { value?: unknown } | null)?.value,
          )
          const intent = intentStore.intents[resourcePath]
          if (!intent) {
            setDraftError('Calendar draft payload was not found.')
            return
          }
          const calendarId = firstEditableCalendarId(store)
          if (!calendarId) {
            setDraftError('No editable calendar is available for this draft.')
            return
          }
          setPendingInvite(null)
          setDetailsOpen(true)
          setPendingDraft({
            intent,
            title: intent.title,
            description: intent.description,
            calendarId,
            startsAt: toDateTimeLocalValue(intent.startsAt, displayTimeZone),
            endsAt: toDateTimeLocalValue(intent.endsAt, displayTimeZone),
          })
          setDraftError(null)
        })
        .catch(error => {
          if (cancelled) return
          setDraftError(calendarHandoffErrorMessage(error))
        })
        .finally(() => {
          if (!cancelled) onResourceHandled()
        })
    } else if (isCalendarInviteResourceId(resourcePath)) {
      bridge
        .call(PLATFORM_BRIDGE_METHODS.STORAGE_READ_JSON, [
          {
            appSlug: CALENDAR_INVITE_INTENT_STORAGE_SLUG,
            fileName: CALENDAR_INVITE_INTENT_STORAGE_FILE,
          },
        ])
        .then(result => {
          if (cancelled) return
          const intentStore = normalizeCalendarInviteIntentStore(
            (result as { value?: unknown } | null)?.value,
          )
          const intent = intentStore.intents[resourcePath]
          if (!intent) {
            setDraftError('Calendar invite payload was not found.')
            return
          }
          const calendarId = firstEditableCalendarId(store)
          if (!calendarId) {
            setDraftError('No editable calendar is available for this invite.')
            return
          }
          if (intent.autoCreate) {
            setPendingDraft(null)
            setPendingInvite(null)
            const response = intent.response ?? 'needsAction'
            setStore(current => {
              const result = upsertInviteEvent(
                current,
                intent,
                calendarId,
                response,
              )
              setSelectedEventId(result.event.id)
              setSelectedTaskId(null)
              setAnchorDate(new Date(result.event.startsAt))
              setDetailsOpen(true)
              return result.store
            })
            setDraftError(null)
            void removeConsumedInviteIntent(resourcePath)
            return
          }
          setPendingDraft(null)
          setDetailsOpen(true)
          setPendingInvite({
            intent,
            title: intent.title,
            description: intent.description,
            calendarId,
            response: intent.response ?? 'needsAction',
          })
          setDraftError(null)
          // The intent now lives in pendingInvite state; delete it from the
          // shared file right away so it is not replayed forever.
          void removeConsumedInviteIntent(resourcePath)
        })
        .catch(error => {
          if (cancelled) return
          setDraftError(calendarHandoffErrorMessage(error))
        })
        .finally(() => {
          if (!cancelled) onResourceHandled()
        })
    } else if (isIcsFilePath(resourcePath)) {
      bridge
        .call<string>(PLATFORM_BRIDGE_METHODS.FS_READ, [resource.path])
        .then(content => {
          if (cancelled) return
          const invite = parseIcsFileInvite(String(content ?? ''))
          if (!invite) {
            setDraftError(
              'This .ics file could not be read as a calendar invite. Nothing was added.',
            )
            return
          }
          const calendarId = firstEditableCalendarId(store)
          if (!calendarId) {
            setDraftError('No editable calendar is available for this invite.')
            return
          }
          const intent = calendarInviteIntentFromIcsFile(invite, {
            path: resource.path,
            ...(resource.name ? { name: resource.name } : {}),
          })
          setPendingDraft(null)
          setDetailsOpen(true)
          setPendingInvite({
            intent,
            title: intent.title,
            description: intent.description,
            calendarId,
            response: intent.response ?? 'needsAction',
          })
          setDraftError(null)
        })
        .catch(error => {
          if (cancelled) return
          setDraftError(calendarHandoffErrorMessage(error))
        })
        .finally(() => {
          if (!cancelled) onResourceHandled()
        })
    }
    return () => {
      cancelled = true
    }
  }, [displayTimeZone, onResourceHandled, resource, store.calendars])

  // Operations-ledger convention (see AGENTS.md): record every meaningful
  // user interaction. Fire-and-forget — the ledger never blocks the UI.
  const recordUserOperation = (kind: string, summary: string): void => {
    void recordOperation({
      lane: 'user',
      kind,
      appSlug: 'calendar',
      summary,
    }).catch(() => undefined)
  }

  const shiftRange = (direction: number): void => {
    // Previous/Next should step by the unit the current view shows: a day in
    // day view, a month in month view, otherwise a week. Previously it always
    // moved 7 days, so Day view jumped a week and Month view only advanced a
    // month after crossing a week boundary.
    setAnchorDate(current => {
      const next = new Date(current)
      if (view === 'day') {
        next.setDate(next.getDate() + direction)
      } else if (view === 'month') {
        // Normalize to the 1st first so month-length differences can't skip a
        // month (e.g. Jan 31 → Mar 3).
        next.setDate(1)
        next.setMonth(next.getMonth() + direction)
      } else {
        next.setDate(next.getDate() + direction * 7)
      }
      return next
    })
  }

  const createEvent = (): void => {
    const calendarId = firstEditableCalendarId(store)
    if (!calendarId) {
      setDraftError('No editable calendar is available.')
      return
    }
    const event = createDraftEvent(
      calendarId,
      instantFromZonedWallTime(
        dateKeyInTimeZone(anchorDate, displayTimeZone),
        availability.availableStartHour,
        0,
        displayTimeZone,
      ),
      'Draft event',
      displayTimeZone,
    )
    setStore(current => ({ ...current, events: [...current.events, event] }))
    recordUserOperation(
      'calendar.event.create',
      `Created draft event starting ${event.startsAt}`,
    )
    setSelectedEventId(event.id)
    setSelectedTaskId(null)
    setDetailsOpen(true)
  }

  /**
   * Quick-add: "tomorrow 2:30pm Planning review" → a draft event at the
   * parsed time. The parser is forgiving; anything unparseable as a time
   * still becomes a titled draft at the default hour.
   */
  const [quickAddValue, setQuickAddValue] = useState('')
  const submitQuickAdd = (): void => {
    const input = quickAddValue.trim()
    if (!input) return
    const event = quickAddCalendarEvent(store, input, {
      timeZone: displayTimeZone,
    })
    if (!event) {
      setDraftError('No editable calendar is available.')
      return
    }
    setStore(current => ({ ...current, events: [...current.events, event] }))
    recordUserOperation(
      'calendar.event.create',
      `Created draft event "${event.title}" via quick add`,
    )
    setQuickAddValue('')
    setAnchorDate(new Date(event.startsAt))
    setSelectedEventId(event.id)
    setSelectedTaskId(null)
    setDraftError(null)
    setDetailsOpen(true)
  }

  const createEventOnDay = (
    day: Date,
    hour = availability.availableStartHour,
    minute = 0,
  ): void => {
    const dayKey = dateKeyInTimeZone(day, displayTimeZone)
    createEventOnDayRange(
      dayKey,
      hour * 60 + minute,
      hour * 60 + minute + DEFAULT_CLICK_MINUTES,
    )
  }

  const createEventOnDayRange = (
    dayKey: string,
    startMinutes: number,
    endMinutes: number,
  ): void => {
    const calendarId = firstEditableCalendarId(store)
    if (!calendarId) {
      setSelectedRangeError('No editable calendar is available.')
      return
    }
    const range = normalizedRange(startMinutes, endMinutes)
    const startsAt = instantFromZonedWallTime(
      dayKey,
      Math.floor(range.startMinutes / 60),
      range.startMinutes % 60,
      displayTimeZone,
    )
    const event = createDraftEvent(
      calendarId,
      startsAt,
      'New event',
      displayTimeZone,
    )
    event.endsAt = instantFromZonedWallTime(
      dayKey,
      Math.floor(range.endMinutes / 60),
      range.endMinutes % 60,
      displayTimeZone,
    )
    setStore(current => ({ ...current, events: [...current.events, event] }))
    recordUserOperation(
      'calendar.event.create',
      `Created draft event starting ${startsAt}`,
    )
    setAnchorDate(new Date(startsAt))
    setSelectedEventId(event.id)
    setSelectedTaskId(null)
    setSelectedRangeError(null)
    setDetailsOpen(true)
  }

  /**
   * Write the store now instead of waiting out the debounce. Edits already
   * persist on their own; this exists because closing a panel and trusting
   * an autosave you cannot see is an uncomfortable way to leave work, and
   * because it gives a failure somewhere to be reported at the moment the
   * user asked for it.
   */
  const saveNow = async (): Promise<void> => {
    const serialized = JSON.stringify(store)
    if (serialized === lastPersistedRef.current?.serialized) {
      setSaveState('saved')
      return
    }
    setSaveState('saving')
    try {
      const previous = lastPersistedRef.current
      if (previous && previous.serialized !== serialized) {
        await writeCalendarStoreFile(
          CALENDAR_STORE_BACKUP_FILE,
          previous.value,
        ).catch((error: unknown) => {
          console.warn('[purecalendar] failed to write store backup file:', error)
        })
      }
      await writeCalendarStoreFile(CALENDAR_STORE_FILE, store)
      lastPersistedRef.current = { serialized, value: store }
      persistDirtyRef.current = false
      setPersistFailure(null)
      setSaveState('saved')
      setLastSavedAt(new Date())
    } catch (error) {
      setSaveState('dirty')
      setPersistFailure(
        error instanceof Error
          ? error.message
          : 'The calendar store could not be saved.',
      )
    }
  }

  const updateSelectedEvent = (patch: Partial<CalendarEvent>): void => {
    if (!selectedEvent) return
    if (!canEditCalendarEvent(store, selectedEvent)) {
      setSelectedRangeError('This calendar is read-only.')
      return
    }
    if (
      patch.calendarId &&
      !store.calendars.some(
        calendar => calendar.id === patch.calendarId && !calendar.readOnly,
      )
    ) {
      setSelectedRangeError('Choose an editable calendar.')
      return
    }
    if (selectedEvent.recurrenceRule) {
      const nextSelectedEventId = selectedEventIdForRecurringScope(
        selectedEvent,
        recurrenceEditScope,
      )
      setStore(current => ({
        ...current,
        events: applyRecurringEventEdit(
          current.events,
          selectedEvent,
          patch,
          recurrenceEditScope,
        ),
      }))
      setSelectedEventId(nextSelectedEventId)
      return
    }
    setStore(current => ({
      ...current,
      events: current.events.map(event =>
        event.id === selectedEvent.id
          ? { ...event, ...patch, syncState: 'pending' }
          : event,
      ),
    }))
  }

  const updateSelectedEventAttendees = (input: string): void => {
    if (!selectedEvent) return
    if (!canEditCalendarEvent(store, selectedEvent)) return
    const existingResponses = new Map(
      selectedEvent.attendees.map(attendee => [
        attendee.email.toLowerCase(),
        attendee.response,
      ]),
    )
    updateSelectedEvent({
      attendees: parseEventAttendeesText(input).map(attendee => ({
        ...attendee,
        response:
          existingResponses.get(attendee.email.toLowerCase()) ??
          attendee.response,
      })),
    })
  }

  // "Me" for RSVP purposes: the attendee matching a connected account's
  // address, falling back to the first listed attendee.
  const accountEmails = useMemo(
    () =>
      [
        ...store.accounts.map(account => account.email),
        ...(googleStatus?.email ? [googleStatus.email] : []),
      ].filter(Boolean),
    [store.accounts, googleStatus?.email],
  )
  const selectedEventRsvpAttendee = selectedEvent
    ? resolveRsvpAttendee(selectedEvent, accountEmails)
    : undefined

  const rsvpSelectedEvent = (
    response: EventAttendee['response'],
    attendeeEmail?: string,
  ): void => {
    if (!selectedEvent) return
    if (!canEditCalendarEvent(store, selectedEvent)) {
      setSelectedRangeError('This calendar is read-only.')
      return
    }
    const selfEmail =
      attendeeEmail ?? resolveRsvpAttendee(selectedEvent, accountEmails)?.email
    const updated = rsvpEvent(selectedEvent, response, selfEmail)
    recordUserOperation(
      'calendar.event.rsvp',
      `Responded ${response} to "${selectedEvent.title}"`,
    )

    // A Google-backed event routes through provider.rsvp, which resolves the
    // account's own attendee copy and deliberately avoids sendUpdates — a
    // full PATCH with sendUpdates=all would email every guest about our own
    // response. The local copy is updated optimistically WITHOUT marking it
    // pending, so the generic push loop does not also send that PATCH.
    const eventId = selectedEvent.id
    const providerEligible =
      calendarProvider !== null &&
      parseGoogleEventLocalId(eventId) !== null &&
      !eventId.includes('#')
    if (providerEligible && calendarProvider) {
      setStore(current => ({
        ...current,
        events: current.events.map(event =>
          event.id === eventId
            ? {
                ...event,
                attendees: updated.attendees,
                status: updated.status,
                busyStatus: updated.busyStatus,
              }
            : event,
        ),
      }))
      void calendarProvider
        .rsvp(eventId, response)
        .then(remote => {
          setStore(current => ({
            ...current,
            events: current.events.map(event =>
              event.id === eventId
                ? {
                    ...remote,
                    // Keep local-only enrichments Google does not round-trip.
                    reminders: event.reminders,
                    linkedItems: event.linkedItems,
                  }
                : event,
            ),
          }))
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error ? error.message : String(error)
          console.warn('[purecalendar] provider RSVP failed:', message)
          setSelectedRangeError(`Could not send the RSVP to Google. (${message})`)
          setStore(current => ({
            ...current,
            events: current.events.map(event =>
              event.id === eventId
                ? { ...event, syncState: 'failed' }
                : event,
            ),
          }))
        })
      return
    }

    // Non-Google events (mail invites, feeds, local calendars) keep the
    // local-update path; feed/local events are never pushed anyway.
    updateSelectedEvent({
      attendees: updated.attendees,
      status: updated.status,
      busyStatus: updated.busyStatus,
    })
  }

  const commitRecurringEventEdit = (
    event: CalendarEvent,
    patch: Partial<CalendarEvent>,
  ): void => {
    if (!canEditCalendarEvent(store, event)) {
      setSelectedRangeError('This calendar is read-only.')
      return
    }
    const nextSelectedEventId = selectedEventIdForRecurringScope(
      event,
      recurrenceEditScope,
    )
    setStore(current => ({
      ...current,
      events: applyRecurringEventEdit(
        current.events,
        event,
        patch,
        recurrenceEditScope,
      ),
    }))
    setSelectedEventId(nextSelectedEventId)
    setSelectedTaskId(null)
    setDetailsOpen(true)
  }

  const openTaskDetail = (task: CalendarTask): void => {
    const startsAt = task.scheduledStart ?? task.dueAt
    if (startsAt) setAnchorDate(new Date(startsAt))
    setSelectedEventId(null)
    setSelectedTaskId(task.id)
    setDetailsOpen(true)
  }

  const updateSelectedTask = (
    task: CalendarTask,
    patch: Partial<
      Pick<
        CalendarTask,
        | 'title'
        | 'dueAt'
        | 'scheduledStart'
        | 'scheduledEnd'
        | 'sourceLabel'
        | 'status'
      >
    >,
  ): void => {
    setStore(current => ({
      ...current,
      tasks: current.tasks.map(item =>
        item.id === task.id ? updateCalendarTask(item, patch) : item,
      ),
    }))
    setSelectedTaskId(task.id)
  }

  const retrySelectedEventSync = (): void => {
    if (!selectedEvent) return
    setStore(current =>
      recoverCalendarEventSync(current, selectedEvent.id, 'retry'),
    )
  }

  const resolveSelectedEventSync = (): void => {
    if (!selectedEvent) return
    setStore(current =>
      recoverCalendarEventSync(current, selectedEvent.id, 'resolve'),
    )
  }

  const retrySelectedTaskSync = (): void => {
    if (!selectedTask) return
    setStore(current =>
      recoverCalendarTaskSync(current, selectedTask.id, 'retry'),
    )
  }

  const resolveSelectedTaskSync = (): void => {
    if (!selectedTask) return
    setStore(current =>
      recoverCalendarTaskSync(current, selectedTask.id, 'resolve'),
    )
  }

  const createPendingDraftEvent = (): void => {
    if (!pendingDraft) return
    if (
      !writableCalendars.some(
        calendar => calendar.id === pendingDraft.calendarId,
      )
    ) {
      setDraftError('Choose an editable calendar before creating the event.')
      return
    }
    const startsAt = dateTimeLocalToIso(pendingDraft.startsAt, displayTimeZone)
    const endsAt = dateTimeLocalToIso(pendingDraft.endsAt, displayTimeZone)
    if (!startsAt || !endsAt || Date.parse(endsAt) <= Date.parse(startsAt)) {
      setDraftError(
        'Choose a valid start and end time before creating the event.',
      )
      return
    }
    const event = createEventFromCalendarDraftIntent(
      {
        ...pendingDraft.intent,
        title: pendingDraft.title,
        description: pendingDraft.description,
      },
      pendingDraft.calendarId,
      startsAt,
      endsAt,
      Date.now(),
      displayTimeZone,
    )
    setStore(current => ({ ...current, events: [...current.events, event] }))
    recordUserOperation(
      'calendar.event.create',
      `Created event "${event.title}" from a mail draft handoff`,
    )
    setSelectedEventId(event.id)
    setSelectedTaskId(null)
    setAnchorDate(new Date(startsAt))
    setPendingDraft(null)
    setDraftError(null)
    setDetailsOpen(true)
  }

  const createPendingInviteEvent = (): void => {
    if (!pendingInvite) return
    if (
      !writableCalendars.some(
        calendar => calendar.id === pendingInvite.calendarId,
      )
    ) {
      setDraftError('Choose an editable calendar before confirming the invite.')
      return
    }
    const intent: CalendarInviteIntent = {
      ...pendingInvite.intent,
      title: pendingInvite.title,
      description: pendingInvite.description,
      response: pendingInvite.response,
    }
    setStore(current => {
      const result = upsertInviteEvent(
        current,
        intent,
        pendingInvite.calendarId,
        pendingInvite.response,
      )
      setSelectedEventId(result.event.id)
      setSelectedTaskId(null)
      setAnchorDate(new Date(result.event.startsAt))
      setDetailsOpen(true)
      return result.store
    })
    recordUserOperation(
      'calendar.event.create',
      `Applied mail invite "${intent.title}"`,
    )
    setPendingInvite(null)
    setDraftError(null)
  }

  const moveSelectedTomorrow = (): void => {
    if (!selectedEvent) return
    if (!canEditCalendarEvent(store, selectedEvent)) {
      setSelectedRangeError('This calendar is read-only.')
      return
    }
    const moved = moveEvent(
      selectedEvent,
      new Date(
        Date.parse(selectedEvent.startsAt) + 24 * 60 * 60 * 1000,
      ).toISOString(),
    )
    if (selectedEvent.recurrenceRule) {
      updateSelectedEvent({
        startsAt: moved.startsAt,
        endsAt: moved.endsAt,
        timeZone: moved.timeZone,
      })
      return
    }
    rememberGestureUndo('move', selectedEvent, moved)
    setStore(current => ({
      ...current,
      events: current.events.map(event =>
        event.id === selectedEvent.id ? moved : event,
      ),
    }))
  }

  const duplicateSelectedEvent = (): void => {
    if (!selectedEvent) return
    const calendarId = firstEditableCalendarId(store)
    if (!calendarId) {
      setSelectedRangeError('No editable calendar is available.')
      return
    }
    const duplicated = duplicateEvent(
      selectedEvent,
      new Date(
        Date.parse(selectedEvent.startsAt) + 60 * 60 * 1000,
      ).toISOString(),
    )
    setStore(current => ({
      ...current,
      events: [...current.events, { ...duplicated, calendarId }],
    }))
    setSelectedEventId(duplicated.id)
    setSelectedTaskId(null)
    setDetailsOpen(true)
  }

  const downloadSelectedEvent = (): void => {
    if (!selectedEvent) return
    // Exports the event as a single VEVENT (its base occurrence). A recurring
    // series' RRULE is intentionally not written — "download this event to
    // share" targets the occurrence, and a mis-serialized rule is worse than
    // none.
    const ics = generateIcsEventExport({
      uid: selectedEvent.externalUid || selectedEvent.id,
      timestamp: new Date().toISOString(),
      title: selectedEvent.title,
      ...(selectedEvent.description
        ? { description: selectedEvent.description }
        : {}),
      ...(selectedEvent.location ? { location: selectedEvent.location } : {}),
      startsAt: selectedEvent.startsAt,
      endsAt: selectedEvent.endsAt,
      ...(selectedEvent.allDay ? { allDay: true } : {}),
    })
    const slug =
      selectedEvent.title
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'event'
    void saveTextFile(ics, {
      defaultName: `${slug}.ics`,
      filters: [{ name: 'iCalendar', extensions: ['ics'] }],
    }).then(saved => {
      if (saved) {
        recordUserOperation(
          'calendar.event.export',
          `Exported "${selectedEvent.title}" as .ics`,
        )
      }
    }).catch(error => {
      setSelectedRangeError(
        error instanceof Error
          ? `Could not save the .ics file: ${error.message}`
          : 'Could not save the .ics file.',
      )
    })
  }

  const deleteSelectedEvent = (): void => {
    if (!selectedEvent) return
    if (!canEditCalendarEvent(store, selectedEvent)) {
      setSelectedRangeError('This calendar is read-only.')
      return
    }
    // removeEventWithTombstone also records a tombstone for provider-backed
    // events, so the delete reaches Google via the sync loop and the next
    // snapshot merge cannot resurrect the event.
    setStore(current => removeEventWithTombstone(current, selectedEvent.id))
    recordUserOperation(
      'calendar.event.delete',
      `Deleted event "${selectedEvent.title}"`,
    )
    setPendingEventDelete(false)
    setSelectedEventId(null)
    setDetailsOpen(false)
  }

  const changeView = (nextView: CalendarView): void => {
    setView(nextView)
    // Persistence rides on the store.settings effect — no per-handler merge.
    setStore(current => ({
      ...current,
      settings: {
        ...current.settings,
        viewMode: nextView,
      },
    }))
  }

  const showDropConnected = (eventId: string): void => {
    if (landedEventTimeoutRef.current !== null) {
      window.clearTimeout(landedEventTimeoutRef.current)
    }
    setLandedEventId(eventId)
    landedEventTimeoutRef.current = window.setTimeout(() => {
      setLandedEventId(null)
      landedEventTimeoutRef.current = null
    }, 520)
  }

  // The provider reads these at fetch time (it is built once at boot).
  useEffect(() => {
    setGoogleCalendarPreferences({
      ...(store.settings.googleExtraCalendarIds
        ? { extraCalendarIds: store.settings.googleExtraCalendarIds }
        : {}),
      ...(store.settings.removedCalendarIds
        ? { removedCalendarIds: store.settings.removedCalendarIds }
        : {}),
    })
  }, [store.settings.googleExtraCalendarIds, store.settings.removedCalendarIds])

  const [calendarEditId, setCalendarEditId] = useState<string | null>(null)
  const [calendarRemoveArmedId, setCalendarRemoveArmedId] = useState<
    string | null
  >(null)
  const [addCalendarMode, setAddCalendarMode] = useState<
    null | 'local' | 'google' | 'ics'
  >(null)
  const [addCalendarDraft, setAddCalendarDraft] = useState('')
  const [addCalendarBusy, setAddCalendarBusy] = useState(false)
  const [addCalendarError, setAddCalendarError] = useState<string | null>(null)

  // Settings keeps its own draft. Sharing the drawer's would mean typing in
  // one place quietly arms the other, and adding from here would leave the
  // drawer sitting open mid-add.
  const [settingsCalendarDraft, setSettingsCalendarDraft] = useState('')

  const submitSettingsCalendar = (): void => {
    const value = settingsCalendarDraft.trim()
    if (!value) return
    if (selectedCalendarProviderId === 'ics') {
      addIcsFeedFromUrl(value)
    } else if (selectedCalendarProviderId === 'local') {
      addLocalCalendarNamed(value)
    }
    setSettingsCalendarDraft('')
  }

  const closeAddCalendar = (): void => {
    setAddCalendarMode(null)
    setAddCalendarDraft('')
    setAddCalendarError(null)
    setAddCalendarBusy(false)
  }

  const addIcsFeedFromUrl = (raw: string): void => {
    const url = parseIcsFeedUrl(raw)
    if (!url) {
      setAddCalendarError(
        'That needs to be an https .ics address or a webcal:// link.',
      )
      return
    }
    setStore(current => {
      const feeds = current.settings.icsFeeds ?? []
      if (feeds.some(feed => feed.url === url)) return current
      return {
        ...current,
        settings: {
          ...current.settings,
          icsFeeds: [
            ...feeds,
            {
              id: `ics_${Date.now().toString(36)}`,
              label: labelForIcsFeedUrl(url),
              url,
              visible: true,
            },
          ],
        },
      }
    })
    recordUserOperation(
      'calendar.calendar.add',
      `Subscribed to ICS feed ${labelForIcsFeedUrl(url)}`,
    )
    closeAddCalendar()
  }

  const addLocalCalendarNamed = (name: string): void => {
    if (!name.trim()) return
    setStore(current => {
      const used = new Set(current.calendars.map(calendar => calendar.color))
      const color =
        FALLBACK_EVENT_CATEGORY_SEQUENCE.find(item => !used.has(item)) ??
        FALLBACK_EVENT_CATEGORY_SEQUENCE[
          current.calendars.length % FALLBACK_EVENT_CATEGORY_SEQUENCE.length
        ]!
      return addLocalCalendar(current, { name, color }).store
    })
    recordUserOperation(
      'calendar.calendar.add',
      `Created local calendar "${name.trim()}"`,
    )
    closeAddCalendar()
  }

  /**
   * Add a shared Google calendar by address. It is fetched by id rather
   * than subscribed in Google, so no extra OAuth scope is needed: the
   * events scope already reads any calendar this account can see.
   */
  const addGoogleCalendarById = async (raw: string): Promise<void> => {
    // Accepts the calendar id, or the share link Google actually hands
    // people (the id is base64 inside its `cid`).
    const calendarId = parseCalendarAddress(raw)
    if (!calendarId) {
      if (raw.trim()) {
        setAddCalendarError(
          'That does not look like a calendar address or Google calendar link.',
        )
      }
      return
    }
    const googleProvider = calendarProvider as
      | { describeCalendar?: (id: string) => Promise<{
          id: string
          name: string
          color?: string
        }> }
      | null
    if (!googleProvider?.describeCalendar) {
      setAddCalendarError('Connect Google Calendar first.')
      return
    }
    setAddCalendarBusy(true)
    setAddCalendarError(null)
    try {
      const described = await googleProvider.describeCalendar(calendarId)
      setStore(current => {
        if (current.calendars.some(item => item.id === described.id)) {
          return current
        }
        const extras = new Set(
          current.settings.googleExtraCalendarIds ?? [],
        )
        extras.add(described.id)
        return {
          ...current,
          calendars: [
            ...current.calendars,
            {
              id: described.id,
              sourceId: current.calendars[0]?.sourceId ?? 'src_google',
              name: described.name,
              color: described.color ?? EVENT_CATEGORY_COLORS.fallback,
              visible: true,
              readOnly: true,
            },
          ],
          settings: {
            ...current.settings,
            googleExtraCalendarIds: [...extras],
            removedCalendarIds: (
              current.settings.removedCalendarIds ?? []
            ).filter(id => id !== described.id),
          },
        }
      })
      recordUserOperation(
        'calendar.calendar.add',
        `Added shared Google calendar "${described.name}"`,
      )
      closeAddCalendar()
      void refreshFromProvider()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setAddCalendarError(
        /404|not found/i.test(message)
          ? 'No calendar at that address, or it is not shared with this account.'
          : message,
      )
    } finally {
      setAddCalendarBusy(false)
    }
  }

  const openSearchResult = (
    result: ReturnType<typeof searchCalendarStore>[number],
  ): void => {
    if (result.startsAt) setAnchorDate(new Date(result.startsAt))
    if (result.eventId) {
      setSelectedEventId(result.eventId)
      setSelectedTaskId(null)
      setDetailsOpen(true)
    }
    if (result.taskId) {
      const task = store.tasks.find(item => item.id === result.taskId)
      if (task) openTaskDetail(task)
      else setSelectedEventId(null)
      setDetailsOpen(true)
    }
    setSearchOpen(false)
  }

  const rememberEventUndo = (undo: CalendarEventUndo | null): void => {
    if (!undo) return
    setEventUndoStack(current => [...current.slice(-19), undo])
  }

  const rememberGestureUndo = (
    action: CalendarEventUndo['action'],
    before: CalendarEvent,
    after: CalendarEvent | undefined,
  ): void => {
    if (!after) return
    if (before.startsAt === after.startsAt && before.endsAt === after.endsAt)
      return
    rememberEventUndo({
      id: `calendar_undo_${before.id}_${Date.now()}`,
      eventId: before.id,
      action,
      before,
      after,
      createdAt: new Date().toISOString(),
    })
  }

  const undoLastEventChange = (): void => {
    // State updaters must stay pure — the previous version called setStore
    // and three other setters INSIDE the setEventUndoStack updater, which
    // StrictMode double-invokes: one Ctrl-Z could apply the undo delta twice.
    const undo = eventUndoStack[eventUndoStack.length - 1]
    if (!undo) return
    setEventUndoStack(current => current.slice(0, -1))
    setStore(storeCurrent => undoCalendarEventChange(storeCurrent, undo))
    setSelectedEventId(undo.eventId)
    setSelectedTaskId(null)
    setDetailsOpen(true)
  }

  const updateEventById = (
    eventId: string,
    patch: Partial<CalendarEvent>,
  ): void => {
    setStore(current => ({
      ...current,
      events: current.events.map(event =>
        event.id === eventId && canEditCalendarEvent(current, event)
          ? { ...event, ...patch, syncState: 'pending' }
          : event,
      ),
    }))
  }

  const moveEventById = (eventId: string, startsAt: string): void => {
    setStore(current => {
      return {
        ...current,
        events: current.events.map(event =>
          event.id === eventId && canEditCalendarEvent(current, event)
            ? moveEvent(event, startsAt)
            : event,
        ),
      }
    })
  }

  const pointerMinutesForDay = (
    dayKey: string,
    clientY: number,
  ): number | null => {
    const body = timedBodyRefs.current[dayKey]
    if (!body) return null
    const bounds = body.getBoundingClientRect()
    return snapMinutes(((clientY - bounds.top) / HOUR_HEIGHT) * 60)
  }

  const pointerDayPosition = (
    clientX: number,
    clientY: number,
  ): { dayKey: string; minutes: number } | null => {
    for (const [dayKey, body] of Object.entries(timedBodyRefs.current)) {
      if (!body) continue
      const bounds = body.getBoundingClientRect()
      if (clientX < bounds.left || clientX > bounds.right) continue
      return {
        dayKey,
        minutes: snapMinutes(((clientY - bounds.top) / HOUR_HEIGHT) * 60),
      }
    }
    return null
  }

  const handleGridPointerDown = (
    dayKey: string,
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    if (
      (event.target as HTMLElement).closest(
        '[data-calendar-event], [data-resize-handle]',
      )
    )
      return
    const minutes = pointerMinutesForDay(dayKey, event.clientY)
    if (minutes === null) return
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    setGridDraft({
      dayKey,
      pointerId: event.pointerId,
      startMinutes: minutes,
      endMinutes: Math.min(DAY_END_HOUR * 60, minutes + DEFAULT_CLICK_MINUTES),
    })
  }

  const handleGridPointerMove = (
    dayKey: string,
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    if (
      !gridDraft ||
      gridDraft.pointerId !== event.pointerId ||
      gridDraft.dayKey !== dayKey
    )
      return
    const minutes = pointerMinutesForDay(dayKey, event.clientY)
    if (minutes === null) return
    event.preventDefault()
    setGridDraft(current =>
      current ? { ...current, endMinutes: minutes } : current,
    )
  }

  const handleGridPointerUp = (
    dayKey: string,
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    if (
      !gridDraft ||
      gridDraft.pointerId !== event.pointerId ||
      gridDraft.dayKey !== dayKey
    )
      return
    event.preventDefault()
    const latestEnd =
      pointerMinutesForDay(dayKey, event.clientY) ?? gridDraft.endMinutes
    createEventOnDayRange(dayKey, gridDraft.startMinutes, latestEnd)
    setGridDraft(null)
  }

  const beginEventDrag = (
    eventItem: CalendarEvent,
    dayKey: string,
    pointerEvent: React.PointerEvent<HTMLElement>,
  ): void => {
    if ((pointerEvent.target as HTMLElement).closest('[data-resize-handle]'))
      return
    pointerEvent.stopPropagation()
    pointerEvent.preventDefault()
    if (!canEditCalendarEvent(store, eventItem)) {
      setSelectedEventId(eventItem.id)
      setSelectedTaskId(null)
      setDetailsOpen(true)
      setSelectedRangeError('This calendar is read-only.')
      return
    }
    pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId)
    const minutes = pointerMinutesForDay(dayKey, pointerEvent.clientY)
    if (minutes === null) return
    setSelectedEventId(eventItem.id)
    setSelectedTaskId(null)
    setSelectedRangeError(null)
    setDragState({
      dayKey,
      eventId: eventItem.id,
      originalEvent: eventItem,
      pointerId: pointerEvent.pointerId,
      targetDayKey: dayKey,
      pointerOffsetMinutes: Math.max(
        0,
        minutes - minutesFromIso(eventItem.startsAt, displayTimeZone),
      ),
    })
  }

  const beginEventResize = (
    eventItem: CalendarEvent,
    dayKey: string,
    edge: 'start' | 'end',
    pointerEvent: React.PointerEvent<HTMLSpanElement>,
  ): void => {
    pointerEvent.stopPropagation()
    pointerEvent.preventDefault()
    if (!canEditCalendarEvent(store, eventItem)) {
      setSelectedEventId(eventItem.id)
      setSelectedTaskId(null)
      setDetailsOpen(true)
      setSelectedRangeError('This calendar is read-only.')
      return
    }
    pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId)
    setSelectedEventId(eventItem.id)
    setSelectedTaskId(null)
    setSelectedRangeError(null)
    setResizeState({
      dayKey,
      edge,
      eventId: eventItem.id,
      originalEvent: eventItem,
      originalStartMinutes: minutesFromIso(eventItem.startsAt, displayTimeZone),
      originalEndMinutes: minutesFromIso(eventItem.endsAt, displayTimeZone),
      pointerId: pointerEvent.pointerId,
    })
  }

  useEffect(() => {
    if (!dragState) return

    const onPointerMove = (event: PointerEvent): void => {
      if (event.pointerId !== dragState.pointerId) return
      if (dragState.originalEvent.recurrenceRule) return
      const position = pointerDayPosition(event.clientX, event.clientY)
      if (!position) return
      setDragState(current =>
        current && current.pointerId === event.pointerId
          ? { ...current, targetDayKey: position.dayKey }
          : current,
      )
      const eventItem = store.events.find(item => item.id === dragState.eventId)
      if (!eventItem) return
      const durationMinutes = Math.max(
        MIN_EVENT_MINUTES,
        Math.round(
          (Date.parse(eventItem.endsAt) - Date.parse(eventItem.startsAt)) /
            60_000,
        ),
      )
      const startMinutes = Math.max(
        DAY_START_HOUR * 60,
        Math.min(
          DAY_END_HOUR * 60 - durationMinutes,
          position.minutes - dragState.pointerOffsetMinutes,
        ),
      )
      const startsAt = instantFromZonedWallTime(
        position.dayKey,
        Math.floor(startMinutes / 60),
        startMinutes % 60,
        displayTimeZone,
      )
      moveEventById(dragState.eventId, startsAt)
    }

    const onPointerUp = (event: PointerEvent): void => {
      if (event.pointerId !== dragState.pointerId) return
      if (dragState.originalEvent.recurrenceRule) {
        const position = pointerDayPosition(event.clientX, event.clientY)
        if (position) {
          const durationMinutes = Math.max(
            MIN_EVENT_MINUTES,
            Math.round(
              (Date.parse(dragState.originalEvent.endsAt) -
                Date.parse(dragState.originalEvent.startsAt)) /
                60_000,
            ),
          )
          const startMinutes = Math.max(
            DAY_START_HOUR * 60,
            Math.min(
              DAY_END_HOUR * 60 - durationMinutes,
              position.minutes - dragState.pointerOffsetMinutes,
            ),
          )
          const startsAt = instantFromZonedWallTime(
            position.dayKey,
            Math.floor(startMinutes / 60),
            startMinutes % 60,
            displayTimeZone,
          )
          commitRecurringEventEdit(dragState.originalEvent, {
            startsAt,
            endsAt: new Date(
              Date.parse(startsAt) + durationMinutes * 60_000,
            ).toISOString(),
            timeZone: displayTimeZone,
          })
          showDropConnected(dragState.eventId)
        }
        setDragState(null)
        return
      }
      const eventItem = store.events.find(item => item.id === dragState.eventId)
      rememberGestureUndo('move', dragState.originalEvent, eventItem)
      if (
        eventItem &&
        eventItem.startsAt !== dragState.originalEvent.startsAt
      ) {
        showDropConnected(dragState.eventId)
      }
      setDragState(null)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [displayTimeZone, dragState, recurrenceEditScope, store.events])

  useEffect(() => {
    if (!resizeState) return

    const onPointerMove = (event: PointerEvent): void => {
      if (event.pointerId !== resizeState.pointerId) return
      if (resizeState.originalEvent.recurrenceRule) return
      const minutes = pointerMinutesForDay(resizeState.dayKey, event.clientY)
      if (minutes === null) return
      if (resizeState.edge === 'start') {
        const startMinutes = Math.min(
          minutes,
          resizeState.originalEndMinutes - MIN_EVENT_MINUTES,
        )
        updateEventById(resizeState.eventId, {
          startsAt: instantFromZonedWallTime(
            resizeState.dayKey,
            Math.floor(startMinutes / 60),
            startMinutes % 60,
            displayTimeZone,
          ),
          endsAt: instantFromZonedWallTime(
            resizeState.dayKey,
            Math.floor(resizeState.originalEndMinutes / 60),
            resizeState.originalEndMinutes % 60,
            displayTimeZone,
          ),
          timeZone: displayTimeZone,
        })
        return
      }
      const endMinutes = Math.max(
        minutes,
        resizeState.originalStartMinutes + MIN_EVENT_MINUTES,
      )
      updateEventById(resizeState.eventId, {
        startsAt: instantFromZonedWallTime(
          resizeState.dayKey,
          Math.floor(resizeState.originalStartMinutes / 60),
          resizeState.originalStartMinutes % 60,
          displayTimeZone,
        ),
        endsAt: instantFromZonedWallTime(
          resizeState.dayKey,
          Math.floor(endMinutes / 60),
          endMinutes % 60,
          displayTimeZone,
        ),
        timeZone: displayTimeZone,
      })
    }

    const onPointerUp = (event: PointerEvent): void => {
      if (event.pointerId !== resizeState.pointerId) return
      if (resizeState.originalEvent.recurrenceRule) {
        const minutes = pointerMinutesForDay(resizeState.dayKey, event.clientY)
        if (minutes !== null) {
          if (resizeState.edge === 'start') {
            const startMinutes = Math.min(
              minutes,
              resizeState.originalEndMinutes - MIN_EVENT_MINUTES,
            )
            commitRecurringEventEdit(resizeState.originalEvent, {
              startsAt: instantFromZonedWallTime(
                resizeState.dayKey,
                Math.floor(startMinutes / 60),
                startMinutes % 60,
                displayTimeZone,
              ),
              endsAt: instantFromZonedWallTime(
                resizeState.dayKey,
                Math.floor(resizeState.originalEndMinutes / 60),
                resizeState.originalEndMinutes % 60,
                displayTimeZone,
              ),
              timeZone: displayTimeZone,
            })
          } else {
            const endMinutes = Math.max(
              minutes,
              resizeState.originalStartMinutes + MIN_EVENT_MINUTES,
            )
            commitRecurringEventEdit(resizeState.originalEvent, {
              startsAt: instantFromZonedWallTime(
                resizeState.dayKey,
                Math.floor(resizeState.originalStartMinutes / 60),
                resizeState.originalStartMinutes % 60,
                displayTimeZone,
              ),
              endsAt: instantFromZonedWallTime(
                resizeState.dayKey,
                Math.floor(endMinutes / 60),
                endMinutes % 60,
                displayTimeZone,
              ),
              timeZone: displayTimeZone,
            })
          }
        }
        setResizeState(null)
        return
      }
      rememberGestureUndo(
        'resize',
        resizeState.originalEvent,
        store.events.find(item => item.id === resizeState.eventId),
      )
      setResizeState(null)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [displayTimeZone, recurrenceEditScope, resizeState])

  // Registered once; the handler body lives in a ref refreshed each render.
  // The previous version had NO dependency array, so the window listener was
  // torn down and re-added on every render (including each drag frame and the
  // 60-second clock tick), and a keypress could be handled by a listener from
  // a stale render acting on an outdated selected event.
  const keydownHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {})
  keydownHandlerRef.current = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target?.isContentEditable
    ) {
      return
    }

    const command = calendarCommandForKey(event.key, {
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    })
    if (!command) return
    event.preventDefault()

    if (command === 'new-event') createEvent()
    if (command === 'search') {
      setSearchOpen(true)
      searchInputRef.current?.focus()
    }
    if (command === 'today') setAnchorDate(new Date())
    if (command === 'previous-range') shiftRange(-1)
    if (command === 'next-range') shiftRange(1)
    if (command === 'close-inspector') {
      setGridDraft(null)
      setDragState(null)
      setResizeState(null)
      setDetailsOpen(false)
      setCalendarPanelOpen(false)
      setSettingsOpen(false)
    }
    if (command === 'undo-last-change') undoLastEventChange()
    if (command === 'delete-selected-event') deleteSelectedEvent()
    if (command === 'view-day') changeView('day')
    if (command === 'view-week') changeView('week')
    if (command === 'view-month') changeView('month')
    if (command === 'view-agenda') changeView('agenda')
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void =>
      keydownHandlerRef.current(event)
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const renderEvents = (): React.ReactElement => {
    if (view === 'agenda') {
      return (
        <Agenda>
          {visibleEvents.map(event => {
            const calendar = store.calendars.find(
              item => item.id === event.calendarId,
            )
            return (
              <AgendaRow
                key={event.id}
                $color={calendarCategoryColor(calendar)}
                $draft={isDraftEvent(event)}
                onClick={() => {
                  setSelectedEventId(event.id)
                  setSelectedTaskId(null)
                  setDetailsOpen(true)
                }}
              >
                <strong>{event.title}</strong>
                <div>
                  {isDraftEvent(event) ? 'Draft · ' : ''}
                  {dayLabel(new Date(event.startsAt), displayTimeZone)} ·{' '}
                  {formatTime(event.startsAt, displayTimeZone)} to{' '}
                  {formatTime(event.endsAt, displayTimeZone)}
                </div>
              </AgendaRow>
            )
          })}
        </Agenda>
      )
    }
    if (view === 'month') {
      const monthDays = monthGridDays(anchorDate)
      const monthStart = startOfDayIso(
        monthDays[0] ?? anchorDate,
        displayTimeZone,
      )
      const monthEnd = endOfDayIso(
        monthDays[monthDays.length - 1] ?? anchorDate,
        displayTimeZone,
      )
      const monthEvents = visibleCalendarEvents(store, monthStart, monthEnd)
      const monthTasks = visibleScheduledTasks(
        store.tasks,
        monthStart,
        monthEnd,
        store.calendars,
      )
      const weekdayLabels = monthDays
        .slice(0, 7)
        .map(day =>
          new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(day),
        )
      const today = new Date()
      return (
        <MonthGrid>
          {weekdayLabels.map(label => (
            <MonthWeekday key={label}>{label}</MonthWeekday>
          ))}
          {monthDays.map(day => {
            const key = dateKeyInTimeZone(day, displayTimeZone)
            const muted = day.getMonth() !== anchorDate.getMonth()
            const isToday = sameDate(day, today, displayTimeZone)
            return (
              <MonthCell
                key={key}
                role="button"
                tabIndex={0}
                $muted={muted}
                $today={isToday}
                title={`Create an event on ${dayLabel(day, displayTimeZone)}`}
                onClick={() => createEventOnDay(day)}
                onKeyDown={keyEvent => {
                  if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
                    keyEvent.preventDefault()
                    createEventOnDay(day)
                  }
                }}
              >
                <MonthDate $today={isToday}>
                  {Number(key.slice(8, 10))}
                </MonthDate>
                {monthEvents
                  .filter(
                    event =>
                      dateKeyInTimeZone(event.startsAt, displayTimeZone) ===
                      key,
                  )
                  .map(event => {
                    const calendar = store.calendars.find(
                      item => item.id === event.calendarId,
                    )
                    return (
                      <MonthItem
                        key={event.id}
                        $color={calendarCategoryColor(calendar)}
                        $draft={isDraftEvent(event)}
                        onClick={click => {
                          click.stopPropagation()
                          setSelectedEventId(event.id)
                          setSelectedTaskId(null)
                          setDetailsOpen(true)
                        }}
                      >
                        <strong>{event.title}</strong>
                        <div>
                          {isDraftEvent(event) ? 'Draft · ' : ''}
                          {formatTime(event.startsAt, displayTimeZone)} to{' '}
                          {formatTime(event.endsAt, displayTimeZone)}
                        </div>
                      </MonthItem>
                    )
                  })}
                {monthTasks
                  .filter(task => {
                    const startsAt = task.scheduledStart ?? task.dueAt
                    return startsAt
                      ? dateKeyInTimeZone(startsAt, displayTimeZone) === key
                      : false
                  })
                  .map(task => (
                    <MonthItem
                      key={task.id}
                      $color={EVENT_CATEGORY_COLORS.tasks}
                      onClick={click => {
                        click.stopPropagation()
                        openTaskDetail(task)
                      }}
                    >
                      <strong>{task.title}</strong>
                      <div>Task · {task.sourceLabel}</div>
                    </MonthItem>
                  ))}
              </MonthCell>
            )
          })}
        </MonthGrid>
      )
    }

    const hours = Array.from(
      { length: DAY_END_HOUR - DAY_START_HOUR },
      (_, index) => DAY_START_HOUR + index,
    )
    const timelineHeight = hours.length * HOUR_HEIGHT
    const displayDays = view === 'day' ? [anchorDate] : days
    const allDayEvents = allDayEventsInRange(
      visibleEvents,
      range.start,
      range.end,
    )
    const nowHour = decimalHourInTimeZone(now.toISOString(), displayTimeZone)
    const nowTop = nowHour * HOUR_HEIGHT
    const showNowMarker = nowHour >= DAY_START_HOUR && nowHour <= DAY_END_HOUR

    return (
      <TimeGrid $days={displayDays.length} $timelineHeight={timelineHeight}>
        <TimeHeaderSpacer />
        {displayDays.map(day => {
          const isToday = sameDate(day, now, displayTimeZone)
          const isWeekend = day.getDay() === 0 || day.getDay() === 6
          return (
            <TimedDayHeader key={`${day.toISOString()}-header`}>
              <TimedDayHeaderInner $today={isToday} $weekend={isWeekend}>
                {dayLabel(day, displayTimeZone)}
              </TimedDayHeaderInner>
            </TimedDayHeader>
          )
        })}
        <AllDayRail>All day</AllDayRail>
        {displayDays.map(day => {
          const key = dateKeyInTimeZone(day, displayTimeZone)
          const isToday = sameDate(day, now, displayTimeZone)
          const isWeekend = day.getDay() === 0 || day.getDay() === 6
          const dayAllDayEvents = allDayEventsInRange(
            allDayEvents,
            startOfDayIso(day, displayTimeZone),
            endOfDayIso(day, displayTimeZone),
          )
          return (
            <AllDayCell
              key={`${key}-all-day`}
              $today={isToday}
              $weekend={isWeekend}
            >
              {dayAllDayEvents.map(event => {
                const calendar = store.calendars.find(
                  item => item.id === event.calendarId,
                )
                return (
                  <AllDayItem
                    key={event.id}
                    $color={calendarCategoryColor(calendar)}
                    $draft={isDraftEvent(event)}
                    onClick={() => {
                      setSelectedRangeError(null)
                      setSelectedEventId(event.id)
                      setSelectedTaskId(null)
                      setDetailsOpen(true)
                    }}
                  >
                    {isDraftEvent(event) ? `Draft · ${event.title}` : event.title}
                  </AllDayItem>
                )
              })}
            </AllDayCell>
          )
        })}
        <TimeRail>
          {hours.map(hour => (
            <TimeLabel key={hour} $top={hour * HOUR_HEIGHT}>
              {compactHourLabel(hour)}
            </TimeLabel>
          ))}
        </TimeRail>
        {displayDays.map(day => {
          const key = dateKeyInTimeZone(day, displayTimeZone)
          const isToday = sameDate(day, now, displayTimeZone)
          const isWeekend = day.getDay() === 0 || day.getDay() === 6
          return (
            <TimedDayColumn
              key={key}
              $today={isToday}
              $weekend={isWeekend}
              title={`Create an event on ${dayLabel(day, displayTimeZone)}`}
            >
              <TimedDayBody
                ref={element => {
                  timedBodyRefs.current[key] = element
                }}
                $dropTarget={dragState?.targetDayKey === key}
                onPointerDown={event => handleGridPointerDown(key, event)}
                onPointerMove={event => handleGridPointerMove(key, event)}
                onPointerUp={event => handleGridPointerUp(key, event)}
                onPointerCancel={() => setGridDraft(null)}
              >
                {hours.map(hour => (
                  <AvailabilityBand
                    key={`${key}-${hour}`}
                    $available={isAvailableWallTime(
                      store.settings,
                      day,
                      hour,
                      displayTimeZone,
                    )}
                    style={{ top: hour * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                    aria-hidden="true"
                  />
                ))}
                {isToday && showNowMarker && (
                  <NowMarker $top={nowTop} aria-hidden="true">
                    <NowMarkerDot />
                    <NowMarkerLine />
                    <NowMarkerLabel>
                      Now {formatNowTime(now, displayTimeZone)}
                    </NowMarkerLabel>
                  </NowMarker>
                )}
                {gridDraft?.dayKey === key && (
                  <TimedDraftBlock
                    style={styleForMinuteRange(
                      gridDraft.startMinutes,
                      gridDraft.endMinutes,
                    )}
                  >
                    New event
                  </TimedDraftBlock>
                )}
                {layoutTimedItems(
                  visibleEvents.filter(
                    event =>
                      !event.allDay &&
                      dateKeyInTimeZone(event.startsAt, displayTimeZone) ===
                        key,
                  ),
                  scheduledTasks.filter(task => {
                    const startsAt = task.scheduledStart ?? task.dueAt
                    return startsAt
                      ? dateKeyInTimeZone(startsAt, displayTimeZone) === key
                      : false
                  }),
                  key,
                  displayTimeZone,
                  availability.availableStartHour,
                ).map(({ compact, event, style, task, type }) => {
                  if (type === 'task' && task) {
                    return (
                      <TimedEventBlock
                        key={task.id}
                        data-calendar-event
                        $color={EVENT_CATEGORY_COLORS.tasks}
                        $compact={compact}
                        style={style}
                        onClick={click => {
                          click.stopPropagation()
                          openTaskDetail(task)
                        }}
                      >
                        <strong>{task.title}</strong>
                        <div>Task · {task.sourceLabel}</div>
                      </TimedEventBlock>
                    )
                  }
                  if (!event) return null
                  const calendar = store.calendars.find(
                    item => item.id === event.calendarId,
                  )
                  const selected = event.id === selectedEventId
                  const dragging = dragState?.eventId === event.id
                  const landed = landedEventId === event.id
                  return (
                    <TimedEventBlock
                      key={event.id}
                      data-calendar-event
                      aria-pressed={selected}
                      $color={calendarCategoryColor(calendar)}
                      $compact={compact}
                      $dragging={dragging}
                      $landed={landed}
                      $draft={isDraftEvent(event)}
                      style={style}
                      onPointerDown={pointerEvent =>
                        beginEventDrag(event, key, pointerEvent)
                      }
                      onClick={click => {
                        click.stopPropagation()
                        setSelectedRangeError(null)
                        setSelectedEventId(event.id)
                        setSelectedTaskId(null)
                        setDetailsOpen(true)
                      }}
                    >
                      {selected && (
                        <ResizeHandle
                          data-resize-handle
                          $edge="start"
                          $compact={compact}
                          aria-label="Resize event start"
                          onPointerDown={pointerEvent =>
                            beginEventResize(event, key, 'start', pointerEvent)
                          }
                        />
                      )}
                      <strong>{event.title}</strong>
                      <div>
                        {isDraftEvent(event) ? 'Draft · ' : ''}
                        {formatTime(event.startsAt, displayTimeZone)} to{' '}
                        {formatTime(event.endsAt, displayTimeZone)}
                      </div>
                      {selected && (
                        <ResizeHandle
                          data-resize-handle
                          $edge="end"
                          $compact={compact}
                          aria-label="Resize event end"
                          onPointerDown={pointerEvent =>
                            beginEventResize(event, key, 'end', pointerEvent)
                          }
                        />
                      )}
                    </TimedEventBlock>
                  )
                })}
              </TimedDayBody>
            </TimedDayColumn>
          )
        })}
      </TimeGrid>
    )
  }

  return (
    <Root data-app="calendar">
      <Main>
        <Header>
          <div>
            <HeaderTitleRow>
              <Title>{headerRange.title}</Title>
              <HeaderYear>{headerRange.year}</HeaderYear>
              <Kicker>{view}</Kicker>
            </HeaderTitleRow>
          </div>
          <ToolbarGroup>
            <QuickAddInput
              value={quickAddValue}
              onChange={event => setQuickAddValue(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  submitQuickAdd()
                }
                if (event.key === 'Escape') {
                  setQuickAddValue('')
                  event.currentTarget.blur()
                }
              }}
              placeholder="Quick add: tomorrow 2:30pm Planning review"
              aria-label="Quick add event"
              title="Type a time and title, press Enter to create a draft event"
            />
            <Button size="sm" variant="primary" onClick={createEvent}>
              New event
            </Button>
          </ToolbarGroup>
        </Header>
        <Toolbar>
          <ToolbarGroup>
            <Button
              size="sm"
              variant="subtle"
              onClick={() => setCalendarPanelOpen(true)}
            >
              Calendars
            </Button>
            <RangeControls aria-label="Calendar range controls">
              <Button size="sm" onClick={() => shiftRange(-1)}>
                Previous
              </Button>
              <Button size="sm" onClick={() => setAnchorDate(new Date())}>
                Today
              </Button>
              <Button size="sm" onClick={() => shiftRange(1)}>
                Next
              </Button>
            </RangeControls>
            {calendarProvider && (
              <Button
                size="sm"
                variant="subtle"
                disabled={refreshing}
                onClick={() => {
                  void refreshFromProvider()
                  void refreshIcsFeeds()
                }}
                title={
                  lastSyncedAt
                    ? `Last synced ${formatTimeInTimeZone(
                        new Date(lastSyncedAt).toISOString(),
                        displayTimeZone,
                      )}`
                    : 'Sync with Google Calendar'
                }
              >
                {refreshing ? 'Syncing…' : 'Refresh'}
              </Button>
            )}
          </ToolbarGroup>
          <ToolbarGroup>
            <SegmentedControl
              value={view}
              onValueChange={changeView}
              options={[
                { value: 'day', label: 'Day' },
                { value: 'week', label: 'Week' },
                { value: 'month', label: 'Month' },
                { value: 'agenda', label: 'Agenda' },
              ]}
              aria-label="Calendar view"
            />
          </ToolbarGroup>
          <ToolbarGroup>
            <SearchBox>
              <SearchInput
                ref={searchInputRef}
                value={searchQuery}
                onChange={event => {
                  setSearchQuery(event.target.value)
                  setSearchOpen(true)
                }}
                onFocus={() => setSearchOpen(true)}
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    setSearchOpen(false)
                    event.currentTarget.blur()
                  }
                  if (event.key === 'Enter' && searchResults[0]) {
                    openSearchResult(searchResults[0])
                  }
                }}
                placeholder="Search events, people, tasks"
                aria-label="Search calendar"
              />
              {searchOpen && searchQuery.trim() && (
                <SearchResults
                  role="listbox"
                  aria-label="Calendar search results"
                >
                  {searchResults.length > 0 ? (
                    searchResults.map(result => (
                      <SearchResultButton
                        key={`${result.type}:${result.id}`}
                        type="button"
                        onClick={() => openSearchResult(result)}
                      >
                        <Badge
                          tone={result.type === 'event' ? 'accent' : 'neutral'}
                        >
                          {result.type}
                        </Badge>
                        <span>
                          <strong>{result.title}</strong>
                          <small>{result.subtitle}</small>
                        </span>
                      </SearchResultButton>
                    ))
                  ) : (
                    <SearchEmpty>No results</SearchEmpty>
                  )}
                </SearchResults>
              )}
            </SearchBox>
          </ToolbarGroup>
        </Toolbar>
        {persistFailure && (
          <Section aria-live="assertive">
            <Kicker>Changes are not being saved</Kicker>
            <span style={{ color: 'var(--platform-colors-danger-text)' }}>
              {persistFailure} New events and edits will be lost if the app
              closes before saving succeeds.
            </span>
          </Section>
        )}
        {bootNotice && (
          <Section aria-live="polite">
            <Kicker>Google Calendar</Kicker>
            <span style={{ color: 'var(--platform-colors-text-secondary)' }}>
              {bootNotice}
            </span>
          </Section>
        )}
        {refreshError && (
          <Section aria-live="polite">
            <Kicker>Sync failed</Kicker>
            <span style={{ color: 'var(--platform-colors-text-secondary)' }}>
              Could not refresh from Google Calendar; showing the last synced
              events. ({refreshError})
            </span>
          </Section>
        )}
        {showDemoExit && (
          <Section aria-live="polite">
            <Kicker>Sample events</Kicker>
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <span>
                Your Google Calendar is connected. Remove the sample events
                PureCalendar started with?
              </span>
              <Button
                size="sm"
                onClick={() => setStore(current => clearDemoData(current))}
              >
                Remove samples
              </Button>
              <Button
                size="sm"
                variant="subtle"
                onClick={() => setStore(current => keepDemoData(current))}
              >
                Keep them
              </Button>
            </div>
          </Section>
        )}
        {needsSyncAttention && (
          <Section aria-live="polite">
            <Kicker>Sync needs attention</Kicker>
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <span>
                {syncSummary.conflict} conflict
                {syncSummary.conflict === 1 ? '' : 's'} and {syncSummary.failed}{' '}
                failed item{syncSummary.failed === 1 ? '' : 's'} need review.
              </span>
              <Button
                size="sm"
                variant="subtle"
                onClick={() =>
                  setStore(current => retryCalendarSyncFailures(current))
                }
              >
                Retry all
              </Button>
            </div>
          </Section>
        )}
        {draftError && !pendingDraft && !pendingInvite && (
          <Section aria-live="assertive">
            <Kicker>Calendar handoff</Kicker>
            <span style={{ color: 'var(--platform-colors-danger-text)' }}>
              {draftError}
            </span>
          </Section>
        )}
        {pendingDraft && (
          <Section>
            <Kicker>Draft event from email</Kicker>
            <strong>{pendingDraft.intent.source.label}</strong>
            <div
              style={{
                color: 'var(--platform-colors-text-secondary)',
                marginTop: 4,
              }}
            >
              Review the details, choose a time, then create the event. Nothing
              is added to the calendar until you confirm.
            </div>
          </Section>
        )}
        {pendingInvite && (
          <Section>
            <Kicker>Calendar invite from email</Kicker>
            <strong>{pendingInvite.intent.title}</strong>
            <div
              style={{
                color: 'var(--platform-colors-text-secondary)',
                marginTop: 4,
              }}
            >
              {pendingInvite.intent.method} · sequence{' '}
              {pendingInvite.intent.sequence} ·{' '}
              {pendingInvite.intent.source.label}
            </div>
            <div
              style={{
                color: 'var(--platform-colors-text-secondary)',
                marginTop: 4,
              }}
            >
              Review the invite and response. PureCalendar will add, update, or
              cancel the matching event only after you confirm.
            </div>
          </Section>
        )}
        <CalendarViewport ref={calendarViewportRef}>
          {renderEvents()}
        </CalendarViewport>
        <StatusBand aria-live="polite">
          <StatusBandItem
            $tone={
              persistFailure || saveState === 'dirty' ? 'pending' : 'rest'
            }
          >
            {persistFailure
              ? 'Changes are not being saved'
              : saveState === 'saving'
              ? 'Saving…'
              : saveState === 'dirty'
              ? 'Unsaved changes'
              : lastSavedAt
              ? `Saved ${formatSavedAt(lastSavedAt)}`
              : 'Saved · edits apply as you make them'}
          </StatusBandItem>
          {lastSyncedAt != null && (
            <StatusBandItem $tone="rest">
              Synced{' '}
              {formatTimeInTimeZone(
                new Date(lastSyncedAt).toISOString(),
                displayTimeZone,
              )}
            </StatusBandItem>
          )}
          <StatusBandItem $tone="rest">
            {visibleEvents.length} event
            {visibleEvents.length === 1 ? '' : 's'} this week
          </StatusBandItem>
        </StatusBand>
      </Main>

      {calendarPanelOpen && (
        <CalendarDrawer>
            <DrawerHeader>
              <Kicker>Calendars</Kicker>
              <Button size="sm" onClick={() => setCalendarPanelOpen(false)}>
                Close
              </Button>
            </DrawerHeader>
            <Section>
              <Kicker>Month</Kicker>
              <Title>
                {new Intl.DateTimeFormat(undefined, {
                  month: 'long',
                  year: 'numeric',
                }).format(anchorDate)}
              </Title>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <Button size="sm" onClick={() => shiftRange(-1)}>
                  Previous
                </Button>
                <Button size="sm" onClick={() => setAnchorDate(new Date())}>
                  Today
                </Button>
                <Button size="sm" onClick={() => shiftRange(1)}>
                  Next
                </Button>
              </div>
            </Section>
            <Section>
              <Kicker>Calendars</Kicker>
              {store.calendars.map(calendar => (
                <CalendarManageRow key={calendar.id}>
                  <CalendarToggle
                    type="button"
                    role="switch"
                    aria-checked={calendar.visible}
                    aria-label={`${
                      calendar.visible ? 'Hide' : 'Show'
                    } ${calendar.name}`}
                    onClick={() =>
                      setStore(current =>
                        setCalendarVisibility(
                          current,
                          calendar.id,
                          !calendar.visible,
                        ),
                      )
                    }
                  >
                    <Checkbox
                      $on={calendar.visible}
                      $color={calendarCategoryColor(calendar)}
                    >
                      {calendar.visible ? '✓' : ''}
                    </Checkbox>
                    <CalendarName $dim={!calendar.visible}>
                      {calendar.name}
                      {calendar.readOnly ? <ReadOnlyMark>read-only</ReadOnlyMark> : null}
                    </CalendarName>
                  </CalendarToggle>
                  <RowAction
                    type="button"
                    aria-label={`Edit ${calendar.name}`}
                    onClick={() =>
                      setCalendarEditId(
                        calendarEditId === calendar.id ? null : calendar.id,
                      )
                    }
                  >
                    ✎
                  </RowAction>
                  <RowAction
                    type="button"
                    $danger={calendarRemoveArmedId === calendar.id}
                    aria-label={`Remove ${calendar.name}`}
                    onClick={() => {
                      if (calendarRemoveArmedId !== calendar.id) {
                        setCalendarRemoveArmedId(calendar.id)
                        return
                      }
                      setStore(current => removeCalendar(current, calendar.id))
                      recordUserOperation(
                        'calendar.calendar.remove',
                        `Removed calendar "${calendar.name}"`,
                      )
                      setCalendarRemoveArmedId(null)
                      setCalendarEditId(null)
                    }}
                  >
                    {calendarRemoveArmedId === calendar.id ? 'Sure?' : '×'}
                  </RowAction>
                  {calendarEditId === calendar.id && (
                    <CalendarEditPanel>
                      <EditField
                        aria-label="Calendar name"
                        defaultValue={calendar.name}
                        onKeyDown={event => {
                          if (event.key === 'Escape') setCalendarEditId(null)
                          if (event.key !== 'Enter') return
                          setStore(current =>
                            updateCalendar(current, calendar.id, {
                              name: event.currentTarget.value,
                            }),
                          )
                          setCalendarEditId(null)
                        }}
                        onBlur={event =>
                          setStore(current =>
                            updateCalendar(current, calendar.id, {
                              name: event.currentTarget.value,
                            }),
                          )
                        }
                      />
                      <ColorSwatches>
                        {CALENDAR_COLOR_CHOICES.map(choice => (
                          <ColorSwatch
                            key={choice}
                            type="button"
                            aria-label={`Colour ${choice}`}
                            $color={choice}
                            $selected={
                              calendarCategoryColor(calendar) ===
                              (readableAccentColor(choice) ?? choice)
                            }
                            onClick={() =>
                              setStore(current =>
                                updateCalendar(current, calendar.id, {
                                  color: choice,
                                }),
                              )
                            }
                          />
                        ))}
                      </ColorSwatches>
                    </CalendarEditPanel>
                  )}
                </CalendarManageRow>
              ))}

              {addCalendarMode === null ? (
                <AddRow>
                  <LinkButton
                    type="button"
                    onClick={() => setAddCalendarMode('ics')}
                  >
                    + Calendar by link
                  </LinkButton>
                  <LinkButton
                    type="button"
                    onClick={() => setAddCalendarMode('google')}
                  >
                    + Shared Google calendar
                  </LinkButton>
                  <LinkButton
                    type="button"
                    onClick={() => setAddCalendarMode('local')}
                  >
                    + Local calendar
                  </LinkButton>
                </AddRow>
              ) : (
                <CalendarEditPanel>
                  <EditField
                    autoFocus
                    aria-label={
                      addCalendarMode === 'google'
                        ? 'Google calendar address'
                        : addCalendarMode === 'ics'
                          ? 'Calendar feed address'
                          : 'New calendar name'
                    }
                    placeholder={
                      addCalendarMode === 'google'
                        ? 'Address or Google share link'
                        : addCalendarMode === 'ics'
                          ? 'https://…/basic.ics or webcal://…'
                          : 'Calendar name'
                    }
                    value={addCalendarDraft}
                    onChange={event =>
                      setAddCalendarDraft(event.currentTarget.value)
                    }
                    onKeyDown={event => {
                      if (event.key === 'Escape') closeAddCalendar()
                      if (event.key !== 'Enter') return
                      if (addCalendarMode === 'google') {
                        void addGoogleCalendarById(addCalendarDraft)
                      } else if (addCalendarMode === 'ics') {
                        addIcsFeedFromUrl(addCalendarDraft)
                      } else {
                        addLocalCalendarNamed(addCalendarDraft)
                      }
                    }}
                  />
                  <AddRow>
                    <LinkButton
                      type="button"
                      disabled={addCalendarBusy}
                      onClick={() => {
                        if (addCalendarMode === 'google') {
                          void addGoogleCalendarById(addCalendarDraft)
                        } else if (addCalendarMode === 'ics') {
                          addIcsFeedFromUrl(addCalendarDraft)
                        } else {
                          addLocalCalendarNamed(addCalendarDraft)
                        }
                      }}
                    >
                      {addCalendarBusy ? 'Checking…' : 'Add'}
                    </LinkButton>
                    <LinkButton type="button" onClick={closeAddCalendar}>
                      Cancel
                    </LinkButton>
                  </AddRow>
                  {addCalendarMode === 'ics' && (
                    <HelpNote>
                      In Google Calendar → the calendar's Settings → Integrate
                      calendar, copy “Secret address in iCal format”. Works
                      without connecting a Google account, and covers iCloud,
                      Outlook and most other providers too. Read-only, and it
                      refreshes every 5 minutes. Treat the address like a
                      password — anyone holding it can read the calendar.
                    </HelpNote>
                  )}
                  {addCalendarMode === 'google' && (
                    <HelpNote>
                      Paste the calendar's address (often just someone's
                      email) or the “add this calendar” link Google sends
                      when a calendar is shared. It must already be shared
                      with this account; PureCalendar reads it without
                      subscribing.
                    </HelpNote>
                  )}
                  {addCalendarError && (
                    <ErrorNote role="alert">{addCalendarError}</ErrorNote>
                  )}
                </CalendarEditPanel>
              )}
            </Section>
        </CalendarDrawer>
      )}

      <AppSettingsPages pages={[
        { id: 'availability', label: 'Availability', description: 'Set the days and hours used to suggest meeting times. These preferences save automatically.' },
        { id: 'timezone', label: 'Timezone', description: 'Choose the timezone for display and event editing. Stored event times are unchanged.' },
        { id: 'providers', label: 'Accounts & calendars', description: 'Connect calendars and manage provider access. Credentials are kept in the shell vault.' },
      ]}>
            <Section id="providers">
              <Title>Calendar settings</Title>
              <p
                style={{
                  color: 'var(--platform-colors-text-secondary)',
                  marginTop: 8,
                }}
              >
                Configure provider access here. Public Google settings are
                stored with the app; client secrets and OAuth tokens stay in the
                shell vault.
              </p>
            </Section>
            <Section id="availability">
              <Kicker>Availability</Kicker>
              <ProviderPanel>
                <ProviderRow>
                  <div>
                    <strong>
                      {availabilityLabel(
                        availability.availableDays,
                        availability.availableStartHour,
                        availability.availableEndHour,
                        displayTimeZone,
                      )}
                    </strong>
                    <div
                      style={{
                        color: 'var(--platform-colors-text-secondary)',
                        fontSize: 'var(--platform-typography-font-size-sm)',
                        marginTop: 3,
                      }}
                    >
                      These hours guide scheduling. Day and Week still show
                      every hour.
                    </div>
                  </div>
                </ProviderRow>
                <AvailabilityControls aria-label="Available days">
                  {WEEKDAY_OPTIONS.map(option => {
                    const active = availability.availableDays.includes(
                      option.value,
                    )
                    return (
                      <WeekdayToggle
                        key={option.value}
                        $active={active}
                        type="button"
                        aria-pressed={active}
                        onClick={() => {
                          const nextDays = active
                            ? availability.availableDays.filter(
                                day => day !== option.value,
                              )
                            : [...availability.availableDays, option.value]
                          if (nextDays.length === 0) return
                          setStore(current => ({
                            ...current,
                            settings: {
                              ...current.settings,
                              availableDays: nextDays,
                            },
                          }))
                        }}
                      >
                        {option.label}
                      </WeekdayToggle>
                    )
                  })}
                </AvailabilityControls>
                <ProviderRow>
                  <label>
                    <span style={{ display: 'block', marginBottom: 6 }}>
                      Start
                    </span>
                    <select
                      value={availability.availableStartHour}
                      onChange={event => {
                        const nextStart = Number(event.target.value)
                        setStore(current => ({
                          ...current,
                          settings: {
                            ...current.settings,
                            availableStartHour: nextStart,
                            availableEndHour: Math.max(
                              nextStart + 1,
                              availability.availableEndHour,
                            ),
                          },
                        }))
                      }}
                      aria-label="Available start hour"
                    >
                      {Array.from({ length: 24 }, (_, hour) => (
                        <option key={hour} value={hour}>
                          {hourLabel(hour, displayTimeZone)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span style={{ display: 'block', marginBottom: 6 }}>
                      End
                    </span>
                    <select
                      value={availability.availableEndHour}
                      onChange={event => {
                        const nextEnd = Number(event.target.value)
                        setStore(current => ({
                          ...current,
                          settings: {
                            ...current.settings,
                            availableEndHour: nextEnd,
                            availableStartHour: Math.min(
                              availability.availableStartHour,
                              nextEnd - 1,
                            ),
                          },
                        }))
                      }}
                      aria-label="Available end hour"
                    >
                      {Array.from({ length: 24 }, (_, index) => index + 1).map(
                        hour => (
                          <option key={hour} value={hour}>
                            {hourLabel(hour, displayTimeZone)}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                </ProviderRow>
              </ProviderPanel>
            </Section>
            <Section id="timezone">
              <Kicker>Timezone</Kicker>
              <ProviderPanel>
                <ProviderRow>
                  <div>
                    <strong>
                      Timezone:{' '}
                      {timeZoneConfig.mode === 'system'
                        ? `System (${timeZoneConfig.systemTimeZone})`
                        : displayTimeZone}
                    </strong>
                    <div
                      style={{
                        color: 'var(--platform-colors-text-secondary)',
                        fontSize: 'var(--platform-typography-font-size-sm)',
                        marginTop: 3,
                      }}
                    >
                      Events stay stored as ISO instants. This setting changes
                      calendar display and wall-time editing.
                    </div>
                    {timeZoneConfig.fallback && (
                      <div
                        style={{
                          color: 'var(--platform-colors-warning)',
                          fontSize: 'var(--platform-typography-font-size-sm)',
                          marginTop: 6,
                        }}
                      >
                        Invalid fixed timezone; using system timezone.
                      </div>
                    )}
                  </div>
                  <Badge tone="neutral">{displayTimeZone}</Badge>
                </ProviderRow>
                <label>
                  <span style={{ display: 'block', marginBottom: 6 }}>
                    Mode
                  </span>
                  <select
                    value={store.settings.timeZoneMode ?? 'system'}
                    onChange={event =>
                      setStore(current => ({
                        ...current,
                        settings: {
                          ...current.settings,
                          timeZoneMode: event.target.value as
                            | 'system'
                            | 'fixed',
                        },
                      }))
                    }
                    aria-label="Calendar timezone mode"
                  >
                    <option value="system">System timezone</option>
                    <option value="fixed">Fixed timezone</option>
                  </select>
                </label>
                <label>
                  <span style={{ display: 'block', marginBottom: 6 }}>
                    Fixed timezone
                  </span>
                  <input
                    list="purecalendar-timezones"
                    value={
                      store.settings.timeZone ?? timeZoneConfig.systemTimeZone
                    }
                    onChange={event =>
                      setStore(current => ({
                        ...current,
                        settings: {
                          ...current.settings,
                          timeZone: event.target.value,
                        },
                      }))
                    }
                    aria-label="Calendar fixed timezone"
                  />
                  <datalist id="purecalendar-timezones">
                    {Array.from(
                      new Set([
                        timeZoneConfig.systemTimeZone,
                        ...COMMON_TIME_ZONES,
                      ]),
                    ).map(timeZone => (
                      <option key={timeZone} value={timeZone} />
                    ))}
                  </datalist>
                </label>
              </ProviderPanel>
            </Section>
            <Section id="providers">
              <Kicker>Calendar connections</Kicker>
              <ProviderOptionGrid aria-label="Calendar provider options">
                {CALENDAR_PROVIDER_OPTIONS.map(option => (
                  <ProviderOptionCard
                    key={option.id}
                    type="button"
                    $active={selectedCalendarProvider.id === option.id}
                    onClick={() => setSelectedCalendarProviderId(option.id)}
                  >
                    <ProviderOptionTitleRow>
                      <ProviderOptionTitle>{option.title}</ProviderOptionTitle>
                      <Badge
                        tone="accent"
                      >
                        {option.badge}
                      </Badge>
                    </ProviderOptionTitleRow>
                    <ProviderOptionDescription>
                      {option.description}
                    </ProviderOptionDescription>
                    <ProviderOptionMeta>{option.meta}</ProviderOptionMeta>
                  </ProviderOptionCard>
                ))}
              </ProviderOptionGrid>
            </Section>
            <Section id="providers">
              {/*
                * The setup below follows the card you picked. It used to be
                * "Google provider setup", shown whatever you selected — so two
                * of three connectors were a dead end, and the panel above just
                * repeated the selected card's title back at you.
                */}
              <Kicker>Set up {selectedCalendarProvider.title}</Kicker>
              <GoogleProviderPanel>
                <ProviderRow>
                  <div>
                    <GoogleProviderTitle>
                      {selectedCalendarProvider.title}
                    </GoogleProviderTitle>
                    <GoogleProviderDescription>
                      {selectedCalendarProvider.defaults}
                    </GoogleProviderDescription>
                  </div>
                  {selectedCalendarProvider.id === 'google' ? (
                    <Badge tone={googleStatus?.connected ? 'accent' : 'neutral'}>
                      {googleStateLabel}
                    </Badge>
                  ) : null}
                </ProviderRow>

                {selectedCalendarProvider.id === 'google' ? (
                  <ProviderConnection
                    credentialId={GOOGLE_CREDENTIAL_ID}
                    title="Google account"
                    description="Connect once; Mail and Calendar share the account. New events sync after reopening the app."
                    scopes={CALENDAR_SCOPES}
                    onStatusChange={setGoogleStatus}
                  />
                ) : (
                  <CalendarEditPanel>
                    <EditField
                      aria-label={
                        selectedCalendarProvider.id === 'ics'
                          ? 'Calendar feed address'
                          : 'New calendar name'
                      }
                      placeholder={
                        selectedCalendarProvider.id === 'ics'
                          ? 'https://…/basic.ics or webcal://…'
                          : 'Calendar name'
                      }
                      value={settingsCalendarDraft}
                      onChange={event =>
                        setSettingsCalendarDraft(event.currentTarget.value)
                      }
                      onKeyDown={event => {
                        if (event.key !== 'Enter') return
                        event.preventDefault()
                        submitSettingsCalendar()
                      }}
                    />
                    <AddRow>
                      {/* Only the ics/local paths are reachable here, and
                          neither goes async — the busy flag belongs solely
                          to the drawer's add-by-Google-address flow. */}
                      <LinkButton
                        type="button"
                        disabled={!settingsCalendarDraft.trim()}
                        onClick={submitSettingsCalendar}
                      >
                        {selectedCalendarProvider.id === 'ics'
                          ? 'Subscribe'
                          : 'Create calendar'}
                      </LinkButton>
                    </AddRow>
                    {addCalendarError ? (
                      <HelpNote>{addCalendarError}</HelpNote>
                    ) : null}
                    {selectedCalendarProvider.id === 'ics' ? (
                      <HelpNote>
                        In Google Calendar → the calendar's Settings → Integrate
                        calendar, copy “Secret address in iCal format”. Works
                        without connecting a Google account, and covers iCloud,
                        Outlook and most other providers too. Read-only, and it
                        refreshes every 5 minutes. Treat the address like a
                        password — anyone holding it can read the calendar.
                      </HelpNote>
                    ) : (
                      <HelpNote>
                        Kept with the rest of your workspace. Nothing leaves the
                        machine, and no provider can rate-limit it.
                      </HelpNote>
                    )}
                  </CalendarEditPanel>
                )}
              </GoogleProviderPanel>
            </Section>
      </AppSettingsPages>

      {detailsOpen && (
        <DetailsOverlayBackdrop onClick={() => setDetailsOpen(false)}>
          <DetailsOverlay
            role="dialog"
            aria-modal="true"
            aria-label="Calendar details"
            onClick={event => event.stopPropagation()}
          >
            <DetailsOverlayHeader>
              <DetailsHeaderCopy>
                <Kicker>Details</Kicker>
                <Title>
                  {selectedEvent
                    ? selectedEvent.title || 'Event details'
                    : selectedTask
                    ? selectedTask.title || 'Task details'
                    : pendingInvite
                    ? 'Review calendar invite'
                    : pendingDraft
                    ? 'Review calendar draft'
                    : 'Calendar details'}
                </Title>
              </DetailsHeaderCopy>
              <DetailsHeaderActions>
                {(selectedEvent || selectedTask) && (
                  <DetailsSaveButton
                    type="button"
                    disabled={saveState === 'saving'}
                    // Save is the way out of the dialog: write, then close.
                    // Leaving it open after a save reads as "nothing happened".
                    onClick={() => {
                      void saveNow().then(() => setDetailsOpen(false))
                    }}
                  >
                    {saveState === 'saving' ? 'Saving…' : 'Save'}
                  </DetailsSaveButton>
                )}
                <DetailsCloseButton
                  type="button"
                  aria-label="Close"
                  title="Close"
                  onClick={() => {
                    // Flush before closing: an edit made in the last 800ms
                    // would otherwise ride only on the debounce timer.
                    void saveNow()
                    setDetailsOpen(false)
                  }}
                >
                  <PlatformIcon icon={X} size={16} strokeWidth={1.75} />
                </DetailsCloseButton>
              </DetailsHeaderActions>
            </DetailsOverlayHeader>
            <DetailsOverlayBody>
              <DetailsPanel>
                {pendingInvite ? (
                  <>
                    <Title>Review calendar invite</Title>
                    {draftError && (
                      <p
                        style={{ color: 'var(--platform-colors-danger-text)' }}
                      >
                        {draftError}
                      </p>
                    )}
                    <FieldStack>
                      <FieldLabel>
                        Title
                        <input
                          value={pendingInvite.title}
                          onChange={event =>
                            setPendingInvite(current =>
                              current
                                ? {
                                    ...current,
                                    title: event.target.value,
                                  }
                                : current,
                            )
                          }
                        />
                      </FieldLabel>
                      <FieldLabel>
                        Calendar
                        <select
                          value={pendingInvite.calendarId}
                          onChange={event =>
                            setPendingInvite(current =>
                              current
                                ? {
                                    ...current,
                                    calendarId: event.target.value,
                                  }
                                : current,
                            )
                          }
                          disabled={writableCalendars.length === 0}
                        >
                          {writableCalendars.map(calendar => (
                            <option key={calendar.id} value={calendar.id}>
                              {calendar.name}
                            </option>
                          ))}
                        </select>
                      </FieldLabel>
                      <FieldLabel>
                        Response
                        <select
                          value={pendingInvite.response}
                          onChange={event =>
                            setPendingInvite(current =>
                              current
                                ? {
                                    ...current,
                                    response: event.target
                                      .value as CalendarInviteResponse,
                                  }
                                : current,
                            )
                          }
                        >
                          <option value="needsAction">No response yet</option>
                          <option value="accepted">Accept</option>
                          <option value="tentative">Maybe</option>
                          <option value="declined">Decline</option>
                        </select>
                      </FieldLabel>
                      <FieldLabel>
                        Description
                        <textarea
                          value={pendingInvite.description}
                          onChange={event =>
                            setPendingInvite(current =>
                              current
                                ? {
                                    ...current,
                                    description: event.target.value,
                                  }
                                : current,
                            )
                          }
                        />
                      </FieldLabel>
                    </FieldStack>
                    <p>
                      {formatTime(
                        pendingInvite.intent.startsAt,
                        displayTimeZone,
                      )}{' '}
                      to{' '}
                      {formatTime(pendingInvite.intent.endsAt, displayTimeZone)}
                    </p>
                    <p>
                      Organizer:{' '}
                      {pendingInvite.intent.organizer?.name ?? 'Unknown'}
                    </p>
                    <p>Linked email: {pendingInvite.intent.source.label}</p>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={createPendingInviteEvent}
                      >
                        {pendingInvite.intent.status === 'cancelled'
                          ? 'Apply cancellation'
                          : 'Confirm invite'}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          setPendingInvite(null)
                          setDraftError(null)
                        }}
                      >
                        Cancel review
                      </Button>
                    </div>
                  </>
                ) : pendingDraft ? (
                  <>
                    <Title>Review calendar draft</Title>
                    {draftError && (
                      <p
                        style={{ color: 'var(--platform-colors-danger-text)' }}
                      >
                        {draftError}
                      </p>
                    )}
                    <FieldStack>
                      <FieldLabel>
                        Title
                        <input
                          value={pendingDraft.title}
                          onChange={event =>
                            setPendingDraft(current =>
                              current
                                ? {
                                    ...current,
                                    title: event.target.value,
                                  }
                                : current,
                            )
                          }
                        />
                      </FieldLabel>
                      <FieldLabel>
                        Calendar
                        <select
                          value={pendingDraft.calendarId}
                          onChange={event =>
                            setPendingDraft(current =>
                              current
                                ? {
                                    ...current,
                                    calendarId: event.target.value,
                                  }
                                : current,
                            )
                          }
                          disabled={writableCalendars.length === 0}
                        >
                          {writableCalendars.map(calendar => (
                            <option key={calendar.id} value={calendar.id}>
                              {calendar.name}
                            </option>
                          ))}
                        </select>
                      </FieldLabel>
                      <FieldLabel>
                        Starts
                        <input
                          type="datetime-local"
                          value={pendingDraft.startsAt}
                          onChange={event =>
                            setPendingDraft(current =>
                              current
                                ? {
                                    ...current,
                                    startsAt: event.target.value,
                                  }
                                : current,
                            )
                          }
                        />
                      </FieldLabel>
                      <FieldLabel>
                        Ends
                        <input
                          type="datetime-local"
                          value={pendingDraft.endsAt}
                          onChange={event =>
                            setPendingDraft(current =>
                              current
                                ? {
                                    ...current,
                                    endsAt: event.target.value,
                                  }
                                : current,
                            )
                          }
                        />
                      </FieldLabel>
                      <FieldLabel>
                        Description
                        <textarea
                          value={pendingDraft.description}
                          onChange={event =>
                            setPendingDraft(current =>
                              current
                                ? {
                                    ...current,
                                    description: event.target.value,
                                  }
                                : current,
                            )
                          }
                        />
                      </FieldLabel>
                    </FieldStack>
                    <p>
                      Attendees:{' '}
                      {pendingDraft.intent.attendees
                        .map(attendee => attendee.name)
                        .join(', ') || 'None'}
                    </p>
                    <p>Linked email: {pendingDraft.intent.source.label}</p>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={createPendingDraftEvent}
                      >
                        Create event
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          setPendingDraft(null)
                          setDraftError(null)
                        }}
                      >
                        Cancel draft
                      </Button>
                    </div>
                  </>
                ) : selectedTask ? (
                  <>
                    <Title>Task details</Title>
                    <FieldStack>
                      <FieldLabel>
                        Title
                        <input
                          value={selectedTask.title}
                          onChange={event =>
                            updateSelectedTask(selectedTask, {
                              title: event.target.value,
                            })
                          }
                        />
                      </FieldLabel>
                      <FieldLabel>
                        Source
                        <input
                          value={selectedTask.sourceLabel}
                          onChange={event =>
                            updateSelectedTask(selectedTask, {
                              sourceLabel: event.target.value,
                            })
                          }
                        />
                      </FieldLabel>
                      <FieldLabel>
                        Status
                        <select
                          value={selectedTask.status}
                          onChange={event =>
                            updateSelectedTask(selectedTask, {
                              status: event.target
                                .value as CalendarTask['status'],
                            })
                          }
                        >
                          <option value="open">Open</option>
                          <option value="done">Done</option>
                        </select>
                      </FieldLabel>
                      <FieldLabel>
                        Due
                        <input
                          type="datetime-local"
                          value={toDateTimeLocalValue(
                            selectedTask.dueAt,
                            displayTimeZone,
                          )}
                          onChange={event =>
                            updateSelectedTask(selectedTask, {
                              dueAt:
                                dateTimeLocalToIso(
                                  event.target.value,
                                  displayTimeZone,
                                ) ?? '',
                            })
                          }
                        />
                      </FieldLabel>
                      <FieldLabel>
                        Scheduled start
                        <input
                          type="datetime-local"
                          value={toDateTimeLocalValue(
                            selectedTask.scheduledStart,
                            displayTimeZone,
                          )}
                          onChange={event =>
                            updateSelectedTask(selectedTask, {
                              scheduledStart:
                                dateTimeLocalToIso(
                                  event.target.value,
                                  displayTimeZone,
                                ) ?? '',
                            })
                          }
                        />
                      </FieldLabel>
                      <FieldLabel>
                        Scheduled end
                        <input
                          type="datetime-local"
                          value={toDateTimeLocalValue(
                            selectedTask.scheduledEnd,
                            displayTimeZone,
                          )}
                          onChange={event =>
                            updateSelectedTask(selectedTask, {
                              scheduledEnd:
                                dateTimeLocalToIso(
                                  event.target.value,
                                  displayTimeZone,
                                ) ?? '',
                            })
                          }
                        />
                      </FieldLabel>
                    </FieldStack>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Badge
                        tone={
                          selectedTask.status === 'done' ? 'neutral' : 'accent'
                        }
                      >
                        {selectedTask.status}
                      </Badge>
                      <Badge tone="neutral">{selectedTask.syncState}</Badge>
                    </div>
                    <p>
                      {selectedTask.scheduledStart
                        ? `${dayLabel(
                            new Date(selectedTask.scheduledStart),
                            displayTimeZone,
                          )}, ${formatTime(
                            selectedTask.scheduledStart,
                            displayTimeZone,
                          )}${
                            selectedTask.scheduledEnd
                              ? ` to ${formatTime(
                                  selectedTask.scheduledEnd,
                                  displayTimeZone,
                                )}`
                              : ''
                          }`
                        : selectedTask.dueAt
                        ? `Due ${dayLabel(
                            new Date(selectedTask.dueAt),
                            displayTimeZone,
                          )}, ${formatTime(
                            selectedTask.dueAt,
                            displayTimeZone,
                          )}`
                        : 'No due date or scheduled work block.'}
                    </p>
                    {(selectedTask.syncState === 'failed' ||
                      selectedTask.syncState === 'conflict') && (
                      <div>
                        <Kicker>Sync recovery</Kicker>
                        <p
                          style={{
                            color: 'var(--platform-colors-text-secondary)',
                          }}
                        >
                          This task has not cleanly synced. Retry queues it
                          again; mark resolved clears the local warning.
                        </p>
                        <div
                          style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
                        >
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={retrySelectedTaskSync}
                          >
                            Retry sync
                          </Button>
                          <Button
                            size="sm"
                            variant="subtle"
                            onClick={resolveSelectedTaskSync}
                          >
                            Mark resolved
                          </Button>
                        </div>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Button
                        size="sm"
                        variant={
                          selectedTask.status === 'done' ? 'subtle' : 'primary'
                        }
                        onClick={() =>
                          updateSelectedTask(selectedTask, {
                            status:
                              selectedTask.status === 'done' ? 'open' : 'done',
                          })
                        }
                      >
                        {selectedTask.status === 'done'
                          ? 'Reopen'
                          : 'Mark done'}
                      </Button>
                    </div>
                  </>
                ) : selectedEvent && selectedCalendar ? (
                  <>
                    {eventEditing ? (
                    <DetailsEventGrid>
                      <div>
                        <Kicker>Event</Kicker>
                        <DetailsFormGrid>
                          {selectedEvent.recurrenceRule && (
                            <DetailsFullWidth>
                              <FieldLabel>
                                Edit repeating event
                                <select
                                  value={recurrenceEditScope}
                                  onChange={event =>
                                    setRecurrenceEditScope(
                                      event.target
                                        .value as RecurrenceEditScope,
                                    )
                                  }
                                  disabled={selectedEventReadOnly}
                                >
                                  <option value="this">This event only</option>
                                  <option value="following">
                                    This and following
                                  </option>
                                  <option value="all">All events</option>
                                </select>
                              </FieldLabel>
                            </DetailsFullWidth>
                          )}
                          <DetailsFullWidth>
                            <FieldLabel>
                              Title
                              <input
                                value={selectedEvent.title}
                                onChange={event =>
                                  updateSelectedEvent({
                                    title: event.target.value,
                                  })
                                }
                                disabled={selectedEventReadOnly}
                              />
                            </FieldLabel>
                          </DetailsFullWidth>
                          <FieldLabel>
                            Calendar
                            <select
                              value={selectedEvent.calendarId}
                              onChange={event =>
                                updateSelectedEvent({
                                  calendarId: event.target.value,
                                })
                              }
                              disabled={selectedEventReadOnly}
                            >
                              {(selectedEventReadOnly
                                ? store.calendars
                                : writableCalendars
                              ).map(calendar => (
                                <option key={calendar.id} value={calendar.id}>
                                  {calendar.name}
                                </option>
                              ))}
                            </select>
                          </FieldLabel>
                          <FieldLabel>
                            All-day event
                            <input
                              type="checkbox"
                              checked={selectedEvent.allDay}
                              onChange={event =>
                                updateSelectedEvent(
                                  allDayEventPatch(
                                    selectedEvent,
                                    event.target.checked,
                                    displayTimeZone,
                                  ),
                                )
                              }
                              disabled={selectedEventReadOnly}
                            />
                          </FieldLabel>
                          <FieldLabel>
                            Starts
                            <input
                              type="datetime-local"
                              value={toDateTimeLocalValue(
                                selectedEvent.startsAt,
                                displayTimeZone,
                              )}
                              disabled={selectedEventReadOnly}
                              onChange={event => {
                                const startsAt = dateTimeLocalToIso(
                                  event.target.value,
                                  displayTimeZone,
                                )
                                if (!startsAt) {
                                  setSelectedRangeError(
                                    'Choose a valid start time.',
                                  )
                                  return
                                }
                                setSelectedRangeError(null)
                                const durationMs = Math.max(
                                  MIN_EVENT_MINUTES * 60 * 1000,
                                  Date.parse(selectedEvent.endsAt) -
                                    Date.parse(selectedEvent.startsAt),
                                )
                                updateSelectedEvent({
                                  startsAt,
                                  endsAt: new Date(
                                    Date.parse(startsAt) + durationMs,
                                  ).toISOString(),
                                  timeZone: displayTimeZone,
                                })
                              }}
                            />
                          </FieldLabel>
                          <FieldLabel>
                            Ends
                            <input
                              type="datetime-local"
                              value={toDateTimeLocalValue(
                                selectedEvent.endsAt,
                                displayTimeZone,
                              )}
                              disabled={selectedEventReadOnly}
                              onChange={event => {
                                const endsAt = dateTimeLocalToIso(
                                  event.target.value,
                                  displayTimeZone,
                                )
                                if (!endsAt) {
                                  setSelectedRangeError(
                                    'Choose a valid end time.',
                                  )
                                  return
                                }
                                if (
                                  Date.parse(endsAt) <=
                                  Date.parse(selectedEvent.startsAt)
                                ) {
                                  setSelectedRangeError(
                                    'End time must be after start time.',
                                  )
                                  return
                                }
                                setSelectedRangeError(null)
                                updateSelectedEvent({
                                  endsAt,
                                  timeZone: displayTimeZone,
                                })
                              }}
                            />
                          </FieldLabel>
                          {selectedRangeError && (
                            <DetailsFullWidth>
                              <InlineError>{selectedRangeError}</InlineError>
                            </DetailsFullWidth>
                          )}
                          <FieldLabel>
                            Stage
                            <select
                              value={
                                selectedEvent.lifecycle === 'draft'
                                  ? 'draft'
                                  : 'active'
                              }
                              disabled={selectedEventReadOnly}
                              onChange={event => {
                                updateSelectedEvent({
                                  lifecycle:
                                    event.target.value === 'draft'
                                      ? 'draft'
                                      : 'active',
                                })
                              }}
                            >
                              <option value="active">Active</option>
                              <option value="draft">Draft</option>
                            </select>
                          </FieldLabel>
                          <FieldLabel>
                            Status
                            <select
                              value={selectedEvent.status}
                              disabled={selectedEventReadOnly}
                              onChange={event => {
                                const status = event.target
                                  .value as EventStatus
                                updateSelectedEvent({
                                  status,
                                  busyStatus:
                                    status === 'cancelled'
                                      ? 'free'
                                      : status === 'tentative'
                                      ? 'tentative'
                                      : selectedEvent.busyStatus,
                                })
                              }}
                            >
                              <option value="confirmed">Confirmed</option>
                              <option value="tentative">Tentative</option>
                              <option value="cancelled">Cancelled</option>
                            </select>
                          </FieldLabel>
                          <FieldLabel>
                            Repeat
                            <select
                              value={
                                selectedEvent.recurrenceRule?.frequency ??
                                'none'
                              }
                              disabled={selectedEventReadOnly}
                              onChange={event => {
                                const value = event.target.value
                                const recurrenceRule:
                                  | RecurrenceRule
                                  | undefined =
                                  value === 'daily' ||
                                  value === 'weekly' ||
                                  value === 'monthly'
                                    ? { frequency: value, interval: 1 }
                                    : undefined
                                // Recurrence describes the whole series, so
                                // this always edits the base event — a
                                // scoped "this event only" recurrence change
                                // has no meaning.
                                setStore(current => ({
                                  ...current,
                                  events: applyRecurringEventEdit(
                                    current.events,
                                    selectedEvent,
                                    { recurrenceRule },
                                    'all',
                                  ),
                                }))
                                setSelectedEventId(
                                  recurrenceBaseEventId(selectedEvent.id),
                                )
                              }}
                            >
                              <option value="none">Does not repeat</option>
                              <option value="daily">Daily</option>
                              <option value="weekly">Weekly</option>
                              <option value="monthly">Monthly</option>
                            </select>
                          </FieldLabel>
                          <FieldLabel>
                            Availability
                            <select
                              value={selectedEvent.busyStatus}
                              onChange={event =>
                                updateSelectedEvent({
                                  busyStatus: event.target
                                    .value as BusyStatus,
                                })
                              }
                              disabled={selectedEventReadOnly}
                            >
                              <option value="busy">Busy</option>
                              <option value="free">Free</option>
                              <option value="tentative">Tentative</option>
                            </select>
                          </FieldLabel>
                          <FieldLabel>
                            Visibility
                            <select
                              value={selectedEvent.visibility}
                              onChange={event =>
                                updateSelectedEvent({
                                  visibility: event.target
                                    .value as CalendarEvent['visibility'],
                                })
                              }
                              disabled={selectedEventReadOnly}
                            >
                              <option value="default">Default</option>
                              <option value="private">Private</option>
                              <option value="public">Public</option>
                            </select>
                          </FieldLabel>
                          <FieldLabel>
                            Location
                            <input
                              value={selectedEvent.location ?? ''}
                              onChange={event =>
                                updateSelectedEvent({
                                  location: event.target.value,
                                })
                              }
                              disabled={selectedEventReadOnly}
                            />
                          </FieldLabel>
                          <FieldLabel>
                            Conference link
                            <input
                              value={selectedEvent.conferenceLink ?? ''}
                              onChange={event =>
                                updateSelectedEvent({
                                  conferenceLink:
                                    event.target.value.trim() ||
                                    undefined,
                                })
                              }
                              disabled={selectedEventReadOnly}
                            />
                          </FieldLabel>
                          <DetailsFullWidth>
                            <FieldLabel>
                              Attendees
                              <textarea
                                key={`${selectedEvent.id}:attendees`}
                                defaultValue={formatEventAttendeesText(
                                  selectedEvent.attendees,
                                )}
                                onBlur={event =>
                                  updateSelectedEventAttendees(
                                    event.target.value,
                                  )
                                }
                                disabled={selectedEventReadOnly}
                              />
                            </FieldLabel>
                          </DetailsFullWidth>
                          {selectedEventRsvpAttendee && (
                            <FieldLabel>
                              RSVP as{' '}
                              {selectedEventRsvpAttendee.name ||
                                selectedEventRsvpAttendee.email}
                              <select
                                value={
                                  selectedEventRsvpAttendee.response ??
                                  'needsAction'
                                }
                                disabled={selectedEventReadOnly}
                                onChange={event =>
                                  rsvpSelectedEvent(
                                    event.target
                                      .value as EventAttendee['response'],
                                    selectedEventRsvpAttendee.email,
                                  )
                                }
                              >
                                <option value="needsAction">
                                  No response yet
                                </option>
                                <option value="accepted">Accepted</option>
                                <option value="tentative">Tentative</option>
                                <option value="declined">Declined</option>
                              </select>
                            </FieldLabel>
                          )}
                          <FieldLabel>
                            Reminder minutes before
                            <input
                              key={`${selectedEvent.id}:reminders`}
                              defaultValue={formatEventReminderMinutes(
                                selectedEvent.reminders,
                              )}
                              onBlur={event =>
                                updateSelectedEvent({
                                  reminders: parseEventReminderMinutes(
                                    event.target.value,
                                  ),
                                })
                              }
                              disabled={selectedEventReadOnly}
                            />
                          </FieldLabel>
                          <DetailsFullWidth>
                            <FieldLabel>
                              Description
                              <textarea
                                value={selectedEvent.description}
                                onChange={event =>
                                  updateSelectedEvent({
                                    description: event.target.value,
                                  })
                                }
                                disabled={selectedEventReadOnly}
                              />
                            </FieldLabel>
                          </DetailsFullWidth>
                        </DetailsFormGrid>
                      </div>
                      <DetailsSummaryPanel>
                        <Kicker>Summary</Kicker>
                        <DetailsBadgeRow>
                          <Badge tone="accent">{selectedCalendar.name}</Badge>
                          {selectedCalendar.readOnly && (
                            <Badge tone="neutral">read-only</Badge>
                          )}
                          <Badge tone="neutral">{selectedEvent.status}</Badge>
                          <Badge tone="neutral">
                            {selectedEvent.busyStatus}
                          </Badge>
                          {selectedEvent.syncState === 'failed' ||
                          selectedEvent.syncState === 'conflict' ? (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                padding: '2px 8px',
                                borderRadius: 'var(--platform-radius-sm)',
                                fontSize: 11,
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                letterSpacing: '0.04em',
                                color: 'var(--platform-colors-danger-text)',
                                background:
                                  'var(--platform-colors-danger-surface, rgb(from var(--platform-colors-danger-text) r g b / 12%))',
                              }}
                            >
                              {selectedEvent.syncState}
                            </span>
                          ) : (
                            <Badge tone="neutral">
                              {selectedEvent.syncState}
                            </Badge>
                          )}
                        </DetailsBadgeRow>
                        <DetailsMetaList>
                          <div>
                            {dayLabel(
                              new Date(selectedEvent.startsAt),
                              displayTimeZone,
                            )}
                            ,{' '}
                            {formatTime(
                              selectedEvent.startsAt,
                              displayTimeZone,
                            )}{' '}
                            to{' '}
                            {formatTime(selectedEvent.endsAt, displayTimeZone)}
                          </div>
                          {selectedEventOutsideAvailability && (
                            <div>Outside available hours.</div>
                          )}
                          {selectedEvent.attachments.length > 0 && (
                            <div>
                              Attachments:{' '}
                              {selectedEvent.attachments
                                .map(attachment => attachment.name)
                                .join(', ')}
                            </div>
                          )}
                          {selectedEvent.linkedItems.length > 0 && (
                            <div>
                              Links:{' '}
                              {selectedEvent.linkedItems
                                .map(item => item.label)
                                .join(', ')}
                            </div>
                          )}
                          {selectedEvent.sourceMessageId && (
                            <div>
                              Source email: {selectedEvent.sourceThreadId} /{' '}
                              {selectedEvent.sourceMessageId}
                            </div>
                          )}
                        </DetailsMetaList>
                        {(selectedEvent.syncState === 'failed' ||
                          selectedEvent.syncState === 'conflict') && (
                          <div>
                            <Kicker>Sync recovery</Kicker>
                            <p
                              style={{
                                color: 'var(--platform-colors-text-secondary)',
                              }}
                            >
                              This event has not cleanly synced. Retry queues
                              your local version again; mark resolved clears the
                              local warning.
                            </p>
                            <div
                              style={{
                                display: 'flex',
                                gap: 8,
                                flexWrap: 'wrap',
                              }}
                            >
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={retrySelectedEventSync}
                              >
                                Retry sync
                              </Button>
                              <Button
                                size="sm"
                                variant="subtle"
                                onClick={resolveSelectedEventSync}
                              >
                                Mark resolved
                              </Button>
                            </div>
                          </div>
                        )}
                      </DetailsSummaryPanel>
                    </DetailsEventGrid>
                    ) : (
                      <EventReadBody
                        event={selectedEvent}
                        calendar={selectedCalendar}
                        timeZone={displayTimeZone}
                        outsideAvailability={selectedEventOutsideAvailability}
                        rsvpAttendee={selectedEventRsvpAttendee}
                        readOnly={selectedEventReadOnly}
                        onRsvp={rsvpSelectedEvent}
                      />
                    )}
                    <DetailsActionRow>
                      {!selectedEventReadOnly && (
                        <Button
                          size="sm"
                          variant={eventEditing ? 'subtle' : 'primary'}
                          style={{ marginRight: 'auto' }}
                          onClick={() => setEventEditing(value => !value)}
                        >
                          {eventEditing ? 'Done' : 'Edit'}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        onClick={undoLastEventChange}
                        disabled={eventUndoStack.length === 0}
                      >
                        Undo
                      </Button>
                      <Button
                        size="sm"
                        onClick={moveSelectedTomorrow}
                        disabled={selectedEventReadOnly}
                      >
                        Move +1 day
                      </Button>
                      <Button
                        size="sm"
                        onClick={duplicateSelectedEvent}
                        disabled={writableCalendars.length === 0}
                      >
                        Duplicate
                      </Button>
                      <Button size="sm" onClick={downloadSelectedEvent}>
                        Download .ics
                      </Button>
                      {pendingEventDelete ? (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={deleteSelectedEvent}
                          disabled={selectedEventReadOnly}
                        >
                          Confirm delete
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => setPendingEventDelete(true)}
                          disabled={selectedEventReadOnly}
                        >
                          Delete
                        </Button>
                      )}
                    </DetailsActionRow>
                  </>
                ) : (
                  <EmptyState
                    tone="neutral"
                    title="No event selected"
                    message="Select an event, task block, or empty slot."
                  />
                )}
              </DetailsPanel>
              <DetailsPanel style={{ marginTop: 18 }}>
                <Kicker>Tasks</Kicker>
                {scheduledTasks.map(task => (
                  <CalendarRow
                    key={task.id}
                    onClick={() => openTaskDetail(task)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div>
                      <strong>{task.title}</strong>
                      <div
                        style={{
                          color: 'var(--platform-colors-text-secondary)',
                        }}
                      >
                        {task.sourceLabel}
                      </div>
                    </div>
                  </CalendarRow>
                ))}
              </DetailsPanel>
            </DetailsOverlayBody>
          </DetailsOverlay>
        </DetailsOverlayBackdrop>
      )}
    </Root>
  )
}
