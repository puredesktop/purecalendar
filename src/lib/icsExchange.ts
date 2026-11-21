import ICAL from 'ical.js'
import type { CalendarEvent, CalendarStore } from '../types'
import {
  parseRfc5545Recurrence,
  recurrenceLinesForGoogle,
  toRfc5545Date,
  toRfc5545UtcBasic,
} from './googleRecurrence'
import {
  expandRecurringEvent,
  instantFromZonedWallTime,
  isValidTimeZone,
  parseEventBoundMs,
  systemTimeZone,
} from './calendarModel'

export interface IcsImportSummary {
  added: number
  updated: number
  skipped: number
  failed: number
  errors: string[]
}

function normalizeZone(tzid: string | null | undefined, fallback: string): string {
  if (tzid && tzid !== 'floating' && tzid !== 'UTC' && isValidTimeZone(tzid)) {
    return tzid
  }
  if (tzid === 'UTC') return 'UTC'
  return isValidTimeZone(fallback) ? fallback : systemTimeZone()
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
}

function quoteParam(value: string): string {
  const clean = value.replace(/["\r\n]/g, ' ').trim()
  return /[,;:]/.test(clean) ? `"${clean}"` : clean
}

function stripControlChars(value: string): string {
  return value.replace(/[\r\n\x00-\x1f\x7f]/g, '').trim()
}

function safeMailtoEmail(value: string): string | null {
  if (/[\r\n\x00-\x1f\x7f]/.test(value)) return null
  const clean = value.trim()
  if (!clean || /\s/.test(clean)) return null
  return clean
}

function safeHttpUrl(value: string): string | null {
  if (/[\r\n\x00-\x1f\x7f]/.test(value)) return null
  const clean = stripControlChars(value)
  if (!clean) return null
  try {
    const parsed = new URL(clean)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.href
  } catch {
    return null
  }
}

/**
 * Fold an iCalendar content line at 75 UTF-8 octets (RFC 5545 §3.1) without
 * ever splitting multi-byte UTF-8 sequences or UTF-16 surrogate pairs.
 */
export function foldIcsUtf8Line(line: string): string {
  const cleanLine = line.replace(/[\r\n]+/g, '')
  const encoder = new TextEncoder()
  if (encoder.encode(cleanLine).length <= 75) return cleanLine
  const parts: string[] = []
  let current = ''
  let bytes = 0
  let limit = 75
  for (const char of cleanLine) {
    const charBytes = encoder.encode(char).length
    if (bytes + charBytes > limit && current.length > 0) {
      parts.push(current)
      current = char
      bytes = charBytes
      limit = 74 // subsequent lines start with a 1-byte leading space
    } else {
      current += char
      bytes += charBytes
    }
  }
  if (current) parts.push(current)
  return parts.join('\r\n ')
}

/**
 * Import all VEVENT components from a raw `.ics` file into `calendarId`,
 * returning the updated store plus a structured summary of added, updated,
 * skipped (duplicate unchanged UID), and failed entries.
 */
export function importIcsIntoStore(
  store: CalendarStore,
  rawIcs: string,
  calendarId: string,
  defaultTimeZone: string = systemTimeZone(),
): { store: CalendarStore; summary: IcsImportSummary } {
  const summary: IcsImportSummary = {
    added: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  }
  let calendar: ICAL.Component
  try {
    calendar = new ICAL.Component(ICAL.parse(rawIcs))
  } catch (error) {
    summary.failed = 1
    summary.errors.push(
      error instanceof Error ? error.message : 'Invalid iCalendar file.',
    )
    return { store, summary }
  }

  const vevents = calendar.getAllSubcomponents('vevent')
  if (!vevents.length) {
    summary.errors.push('No events found in the .ics file.')
    return { store, summary }
  }

  let nextEvents = [...store.events]
  // Process master VEVENTs before RECURRENCE-ID overrides so overrides can
  // cleanly exclude their original timestamp on the master without clobbering it.
  const ordered = [
    ...vevents.filter(comp => !comp.hasProperty('recurrence-id')),
    ...vevents.filter(comp => comp.hasProperty('recurrence-id')),
  ]
  for (let idx = 0; idx < ordered.length; idx += 1) {
    const comp = ordered[idx]!
    try {
      const event = new ICAL.Event(comp)
      const isOverride = event.isRecurrenceException()
      const start = event.startDate
      if (!start) {
        summary.failed += 1
        summary.errors.push(`Event #${idx + 1}: missing DTSTART`)
        continue
      }
      const allDay = start.isDate === true
      const tz = normalizeZone(
        comp.getFirstProperty('dtstart')?.getParameter('tzid') as string | undefined ??
          start.zone?.tzid,
        defaultTimeZone,
      )
      const startsAt = allDay
        ? `${String(start.year).padStart(4, '0')}-${String(start.month).padStart(2, '0')}-${String(start.day).padStart(2, '0')}`
        : start.toJSDate().toISOString()

      let endsAt: string
      if (event.endDate) {
        endsAt = allDay
          ? `${String(event.endDate.year).padStart(4, '0')}-${String(event.endDate.month).padStart(2, '0')}-${String(event.endDate.day).padStart(2, '0')}`
          : event.endDate.toJSDate().toISOString()
      } else if (allDay) {
        const nextDay = new Date(`${startsAt}T00:00:00Z`)
        nextDay.setUTCDate(nextDay.getUTCDate() + 1)
        endsAt = nextDay.toISOString().slice(0, 10)
      } else {
        endsAt = new Date(start.toJSDate().getTime() + 60 * 60_000).toISOString()
      }

      const rawUid = event.uid?.trim() || ''
      const recurrenceIdTime = isOverride ? event.recurrenceId : null
      const recurrenceIdKey = recurrenceIdTime
        ? recurrenceIdTime.isDate
          ? `${String(recurrenceIdTime.year).padStart(4, '0')}-${String(recurrenceIdTime.month).padStart(2, '0')}-${String(recurrenceIdTime.day).padStart(2, '0')}`
          : recurrenceIdTime.toJSDate().toISOString()
        : null
      const uid =
        isOverride && rawUid && recurrenceIdKey
          ? `${rawUid}#${recurrenceIdKey}`
          : rawUid

      // If this is a RECURRENCE-ID override for a recurring master, exclude the
      // overridden occurrence from the master's recurrenceRule instead of
      // overwriting the master itself.
      if (isOverride && rawUid && recurrenceIdKey) {
        const masterIdx = nextEvents.findIndex(
          existing =>
            existing.calendarId === calendarId &&
            existing.externalUid === rawUid &&
            existing.recurrenceRule != null,
        )
        if (masterIdx >= 0) {
          const master = nextEvents[masterIdx]!
          const excluded = new Set(master.recurrenceRule?.excludedStartsAt ?? [])
          if (!excluded.has(recurrenceIdKey)) {
            excluded.add(recurrenceIdKey)
            nextEvents[masterIdx] = {
              ...master,
              recurrenceRule: {
                ...master.recurrenceRule!,
                excludedStartsAt: Array.from(excluded).sort(),
              },
              syncState: 'pending',
            }
          }
        }
      }

      const rruleProp = isOverride ? null : comp.getFirstPropertyValue('rrule')
      const exdates = isOverride
        ? []
        : comp.getAllProperties('exdate').map(p => p.toICALString())
      const recurrenceRule = parseRfc5545Recurrence([
        ...(rruleProp ? [`RRULE:${rruleProp.toString()}`] : []),
        ...exdates,
      ])

      const rawStatus = String(comp.getFirstPropertyValue('status') ?? '').toUpperCase()
      const status: CalendarEvent['status'] =
        rawStatus === 'CANCELLED'
          ? 'cancelled'
          : rawStatus === 'TENTATIVE'
            ? 'tentative'
            : 'confirmed'

      // Cancelled RECURRENCE-ID override already excluded the occurrence on the master.
      if (isOverride && status === 'cancelled') {
        summary.skipped += 1
        continue
      }

      const existingIdx = uid
        ? nextEvents.findIndex(
            existing =>
              existing.calendarId === calendarId && existing.externalUid === uid,
          )
        : -1

      const title = event.summary?.trim() || '(No title)'
      const description = event.description ?? ''
      const location = event.location?.trim() || undefined

      if (existingIdx >= 0) {
        const existing = nextEvents[existingIdx]!
        const unchanged =
          existing.title === title &&
          existing.startsAt === startsAt &&
          existing.endsAt === endsAt &&
          existing.allDay === allDay &&
          existing.description === description &&
          (existing.location ?? '') === (location ?? '') &&
          existing.status === status &&
          JSON.stringify(existing.recurrenceRule ?? null) ===
            JSON.stringify(recurrenceRule ?? null)
        if (unchanged) {
          summary.skipped += 1
          continue
        }
        nextEvents[existingIdx] = {
          ...existing,
          title,
          description,
          ...(location ? { location } : { location: undefined }),
          startsAt,
          endsAt,
          timeZone: tz,
          allDay,
          status,
          recurrenceRule,
          syncState: 'pending',
        }
        summary.updated += 1
        continue
      }

      const created: CalendarEvent = {
        id: `evt_ics_${Date.now().toString(36)}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
        calendarId,
        ...(uid ? { externalUid: uid } : {}),
        title,
        description,
        ...(location ? { location } : {}),
        startsAt,
        endsAt,
        timeZone: tz,
        allDay,
        status,
        lifecycle: 'active',
        visibility: 'default',
        busyStatus: status === 'cancelled' ? 'free' : 'busy',
        attendees: [],
        reminders: [],
        attachments: [],
        linkedItems: [],
        ...(recurrenceRule ? { recurrenceRule } : {}),
        source: 'provider',
        syncState: 'pending',
      }
      nextEvents.push(created)
      summary.added += 1
    } catch (error) {
      summary.failed += 1
      summary.errors.push(
        `Event #${idx + 1}: ${error instanceof Error ? error.message : 'parse error'}`,
      )
    }
  }

  return {
    store:
      summary.added > 0 || summary.updated > 0
        ? { ...store, events: nextEvents }
        : store,
    summary,
  }
}

export interface ScopedIcsExportOptions {
  /** Filter to a single calendar, or `'all'` for all visible calendars. */
  calendarId?: string
  /** Optional inclusive start date `YYYY-MM-DD`. */
  startDate?: string
  /** Optional inclusive end date `YYYY-MM-DD`. */
  endDate?: string
  timeZone: string
}

/**
 * Export events from `store` (filtered by calendar and optional date range)
 * to a standards-compliant RFC 5545 `.ics` string with UTF-8 octet folding,
 * accurate all-day dates, RRULE/EXDATE, attendees, and reminders.
 */
export function exportStoreToIcs(
  store: CalendarStore,
  options: ScopedIcsExportOptions,
): { ics: string; count: number; fileName: string } {
  const calendarFilter =
    options.calendarId && options.calendarId !== 'all' ? options.calendarId : null
  const visibleCalendarIds = new Set(
    store.calendars.filter(cal => cal.visible).map(cal => cal.id),
  )
  const exportTz = isValidTimeZone(options.timeZone)
    ? options.timeZone
    : systemTimeZone()
  const nextDateKey = (dateKey: string): string => {
    const [y, m, d] = dateKey.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
  }
  const rangeStartIso = options.startDate
    ? instantFromZonedWallTime(options.startDate, 0, 0, exportTz)
    : null
  const rangeEndIso = options.endDate
    ? instantFromZonedWallTime(nextDateKey(options.endDate), 0, 0, exportTz)
    : null
  const rangeStartMs = rangeStartIso ? Date.parse(rangeStartIso) : null
  const rangeEndMs = rangeEndIso ? Date.parse(rangeEndIso) : null

  const matching = store.events.filter(event => {
    if (calendarFilter) {
      if (event.calendarId !== calendarFilter) return false
    } else if (!visibleCalendarIds.has(event.calendarId)) {
      return false
    }
    if (rangeStartMs === null && rangeEndMs === null) return true
    if (event.recurrenceRule) {
      const probeStart = rangeStartIso ?? '1970-01-01T00:00:00.000Z'
      const probeEnd = rangeEndIso ?? '2100-01-01T00:00:00.000Z'
      return expandRecurringEvent(event, probeStart, probeEnd).length > 0
    }
    const tz = event.timeZone || exportTz
    const startMs = parseEventBoundMs(event.startsAt, tz)
    const endMs = parseEventBoundMs(event.endsAt, tz)
    if (
      rangeStartMs !== null &&
      Number.isFinite(endMs) &&
      (endMs > startMs ? endMs <= rangeStartMs : endMs < rangeStartMs)
    ) {
      return false
    }
    if (rangeEndMs !== null && Number.isFinite(startMs) && startMs >= rangeEndMs) {
      return false
    }
    return true
  })

  const dtstamp = toRfc5545UtcBasic(new Date().toISOString())
  const calendarName = calendarFilter
    ? store.calendars.find(cal => cal.id === calendarFilter)?.name ?? 'Calendar'
    : 'PureCalendar'
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PureDesktop//PureCalendar//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
  ]

  for (const event of matching) {
    const tz = event.timeZone || options.timeZone
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${escapeIcsText(event.externalUid || `${event.id}@purecalendar.local`)}`)
    lines.push(`DTSTAMP:${dtstamp}`)
    if (event.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${toRfc5545Date(event.startsAt, tz)}`)
      lines.push(`DTEND;VALUE=DATE:${toRfc5545Date(event.endsAt, tz)}`)
    } else {
      lines.push(`DTSTART:${toRfc5545UtcBasic(event.startsAt)}`)
      lines.push(`DTEND:${toRfc5545UtcBasic(event.endsAt)}`)
    }
    lines.push(`SUMMARY:${escapeIcsText(event.title || '(No title)')}`)
    if (event.description) {
      lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`)
    }
    if (event.location) {
      lines.push(`LOCATION:${escapeIcsText(event.location)}`)
    }
    if (event.conferenceLink) {
      const safeUrl = safeHttpUrl(event.conferenceLink)
      if (safeUrl) lines.push(`URL:${safeUrl}`)
    }
    lines.push(`STATUS:${event.status.toUpperCase()}`)
    if (event.recurrenceRule) {
      for (const recLine of recurrenceLinesForGoogle(event.recurrenceRule, event.allDay, tz)) {
        lines.push(recLine)
      }
    }
    if (event.organizer?.email) {
      const cleanEmail = safeMailtoEmail(event.organizer.email)
      if (cleanEmail) {
        const cn = event.organizer.name ? `;CN=${quoteParam(event.organizer.name)}` : ''
        lines.push(`ORGANIZER${cn}:mailto:${cleanEmail}`)
      }
    }
    for (const attendee of event.attendees) {
      const cleanEmail = safeMailtoEmail(attendee.email)
      if (!cleanEmail) continue
      const cn = attendee.name ? `;CN=${quoteParam(attendee.name)}` : ''
      const partstat =
        attendee.response === 'accepted'
          ? 'ACCEPTED'
          : attendee.response === 'declined'
            ? 'DECLINED'
            : attendee.response === 'tentative'
              ? 'TENTATIVE'
              : 'NEEDS-ACTION'
      lines.push(`ATTENDEE${cn};PARTSTAT=${partstat}:mailto:${cleanEmail}`)
    }
    for (const reminder of event.reminders) {
      lines.push('BEGIN:VALARM')
      lines.push('ACTION:DISPLAY')
      lines.push(`DESCRIPTION:${escapeIcsText(event.title || 'Reminder')}`)
      lines.push(`TRIGGER:-PT${Math.max(0, Math.floor(reminder.minutesBefore))}M`)
      lines.push('END:VALARM')
    }
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  const slug =
    calendarName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'calendar'
  return {
    ics: `${lines.map(foldIcsUtf8Line).join('\r\n')}\r\n`,
    count: matching.length,
    fileName: `${slug}.ics`,
  }
}
