import ICAL from 'ical.js'
import type {
  CalendarInviteContact,
  CalendarInviteIntent,
  CalendarInviteMethod,
  CalendarInviteResponse,
} from '@purescience/platform-ui/bridge/calendarInviteIntent'
import { CALENDAR_INVITE_INTENT_PREFIX } from '@purescience/platform-ui/bridge/calendarInviteIntent'

/**
 * Invite parsed from an opened `.ics` file — the subset of iCalendar data the
 * pendingInvite review flow needs. Modeled on PureMail's
 * `parseCalendarInvite` (apps/puremail/src/lib/mailCalendarInvite.ts).
 */
export interface IcsFileInvite {
  uid: string
  method: CalendarInviteMethod
  sequence: number
  status: 'confirmed' | 'tentative' | 'cancelled'
  title: string
  description: string
  location?: string
  startsAt: string
  endsAt: string
  timeZone: string
  organizer?: CalendarInviteContact
  attendees: Array<CalendarInviteContact & { response: CalendarInviteResponse }>
  recurrenceRule?: string
}

function normalizeMailto(value: unknown): string {
  return String(value ?? '')
    .replace(/^mailto:/i, '')
    .trim()
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim()
}

function normalizeMethod(value: unknown): CalendarInviteMethod {
  const method = normalizeText(value).toUpperCase()
  if (method === 'REPLY' || method === 'CANCEL' || method === 'PUBLISH')
    return method
  return 'REQUEST'
}

function normalizeStatus(
  value: unknown,
  method: CalendarInviteMethod,
): IcsFileInvite['status'] {
  if (method === 'CANCEL') return 'cancelled'
  const status = normalizeText(value).toUpperCase()
  if (status === 'CANCELLED') return 'cancelled'
  if (status === 'TENTATIVE') return 'tentative'
  return 'confirmed'
}

function normalizePartstat(value: unknown): CalendarInviteResponse {
  const partstat = normalizeText(value).toUpperCase()
  if (partstat === 'ACCEPTED') return 'accepted'
  if (partstat === 'DECLINED') return 'declined'
  if (partstat === 'TENTATIVE') return 'tentative'
  return 'needsAction'
}

function contactFromProperty(
  property: ICAL.Property | null,
): CalendarInviteContact | undefined {
  if (!property) return undefined
  const email = normalizeMailto(property.getFirstValue())
  if (!email) return undefined
  const name = normalizeText(property.getParameter('cn')) || email
  return { name, email }
}

function isoFromTime(value: ICAL.Time | null): string {
  return value?.toJSDate().toISOString() ?? new Date().toISOString()
}

/** Parses raw `.ics` file content. Returns `null` when it is not a usable invite. */
export function parseIcsFileInvite(rawSource: string): IcsFileInvite | null {
  try {
    const calendar = new ICAL.Component(ICAL.parse(rawSource))
    const eventComponent = calendar.getFirstSubcomponent('vevent')
    if (!eventComponent) return null
    const event = new ICAL.Event(eventComponent)
    const method = normalizeMethod(calendar.getFirstPropertyValue('method'))
    const organizer = contactFromProperty(
      eventComponent.getFirstProperty('organizer'),
    )
    const attendees = eventComponent
      .getAllProperties('attendee')
      .map(property => ({
        name:
          normalizeText(property.getParameter('cn')) ||
          normalizeMailto(property.getFirstValue()),
        email: normalizeMailto(property.getFirstValue()),
        response: normalizePartstat(property.getParameter('partstat')),
      }))
      .filter(attendee => attendee.email.length > 0)

    return {
      uid: event.uid || `invite_${Date.now()}`,
      method,
      sequence: Number(
        event.sequence ?? eventComponent.getFirstPropertyValue('sequence') ?? 0,
      ),
      status: normalizeStatus(
        eventComponent.getFirstPropertyValue('status'),
        method,
      ),
      title: event.summary || 'Calendar invite',
      description: event.description || '',
      ...(event.location ? { location: event.location } : {}),
      startsAt: isoFromTime(event.startDate),
      endsAt: isoFromTime(event.endDate),
      timeZone:
        event.startDate?.zone?.tzid ??
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(organizer ? { organizer } : {}),
      attendees,
      ...(eventComponent.getFirstPropertyValue('rrule')
        ? {
            recurrenceRule: eventComponent
              .getFirstPropertyValue('rrule')
              ?.toString(),
          }
        : {}),
    }
  } catch (error) {
    // Null is the documented "not a usable invite" contract for callers,
    // but keep the parse failure in the log (message only — the raw ics
    // may contain private event details).
    console.warn(
      '[purecalendar] failed to parse .ics file:',
      error instanceof Error ? error.message : error,
    )
    return null
  }
}

/**
 * Adapts a parsed `.ics` file into the `CalendarInviteIntent` shape consumed
 * by the pendingInvite review flow, so `.ics` opens reuse `upsertInviteEvent`
 * (UID dedup, SEQUENCE checks) unchanged. The `source` block is synthesized:
 * intents were designed for the mail handoff, so a file open records the file
 * path/name in the email-shaped slots.
 */
export function calendarInviteIntentFromIcsFile(
  invite: IcsFileInvite,
  file: { path: string; name?: string },
  createdAt = new Date().toISOString(),
): CalendarInviteIntent {
  const fileName = file.name?.trim() || file.path.split('/').pop() || file.path
  return {
    id: `invite_file_${invite.uid.replace(/[^a-z0-9_-]/gi, '_')}`,
    resourceId: `${CALENDAR_INVITE_INTENT_PREFIX}${encodeURIComponent(
      'ics-file',
    )}:${encodeURIComponent(file.path)}:${encodeURIComponent(invite.uid)}`,
    sourceAppSlug: 'mail',
    source: {
      type: 'email',
      accountId: 'ics-file',
      threadId: file.path,
      messageId: file.path,
      label: fileName,
      snippet: '',
    },
    uid: invite.uid,
    method: invite.method,
    sequence: invite.sequence,
    status: invite.status,
    title: invite.title,
    description: invite.description,
    ...(invite.location ? { location: invite.location } : {}),
    startsAt: invite.startsAt,
    endsAt: invite.endsAt,
    timeZone: invite.timeZone,
    ...(invite.organizer ? { organizer: invite.organizer } : {}),
    attendees: invite.attendees,
    ...(invite.recurrenceRule
      ? { recurrenceRule: invite.recurrenceRule }
      : {}),
    createdAt,
  }
}

/** True when an opened resource path points at an iCalendar file. */
export function isIcsFilePath(path: string): boolean {
  return path.trim().toLowerCase().endsWith('.ics')
}
