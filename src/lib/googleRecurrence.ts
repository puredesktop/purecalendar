import type { CalendarEvent, RecurrenceRule } from '../types'

/**
 * Recurrence (de)serialization helpers shared between the Google provider body
 * builder, ICS import/export, and the UI summary formatter.
 */

function safeTimeZone(timeZone?: string): string | undefined {
  if (!timeZone) return undefined
  try {
    new Intl.DateTimeFormat(undefined, { timeZone }).format(new Date(0))
    return timeZone
  } catch {
    return undefined
  }
}

/**
 * Format an ISO instant into RFC 5545 UTC "basic" form, e.g.
 * `20260710T090000Z`. This matches how the RRULE `UNTIL` value is emitted
 * (`recurrenceToRrule`) so EXDATE and UNTIL stay consistent.
 */
export function toRfc5545UtcBasic(iso: string): string {
  // `Date` normalizes any offset to UTC; toISOString gives
  // `2026-07-10T09:00:00.000Z` which we strip to basic form.
  const normalized = new Date(iso).toISOString()
  return normalized.replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/**
 * Format an all-day date as `YYYY-MM-DD` in `timeZone` (or directly if already
 * a bare `YYYY-MM-DD`). Prevents east-of-UTC all-day instants (stored as
 * previous-day UTC timestamps, e.g. `2026-07-09T15:00:00.000Z` for July 10 in
 * Asia/Tokyo) from shifting one day early when serialized as a DATE value.
 */
export function allDayDateKey(iso: string, timeZone?: string): string {
  const trimmed = iso.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  const tz = safeTimeZone(timeZone)
  const parsed = new Date(trimmed)
  if (tz && !Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(parsed)
  }
  return trimmed.slice(0, 10)
}

/**
 * Format an all-day exclusion/until as an RFC 5545 DATE value, e.g. `20260710`.
 */
export function toRfc5545Date(iso: string, timeZone?: string): string {
  return allDayDateKey(iso, timeZone).replace(/-/g, '')
}

/**
 * Build the Google `recurrence` array for an event that carries a base
 * RecurrenceRule. Emits the RRULE plus, when `excludedStartsAt` is non-empty,
 * a single EXDATE line with comma-joined values.
 */
export function recurrenceLinesForGoogle(
  rule: RecurrenceRule,
  allDay: boolean,
  timeZone?: string,
): string[] {
  const interval = Math.max(1, Math.floor(rule.interval || 1))
  const rruleParts = [
    `FREQ=${rule.frequency.toUpperCase()}`,
    `INTERVAL=${interval}`,
  ]
  if (typeof rule.count === 'number' && Number.isFinite(rule.count) && rule.count > 0) {
    rruleParts.push(`COUNT=${Math.floor(rule.count)}`)
  }
  if (rule.until) {
    rruleParts.push(
      `UNTIL=${allDay ? toRfc5545Date(rule.until, timeZone) : toRfc5545UtcBasic(rule.until)}`,
    )
  }
  const lines = [`RRULE:${rruleParts.join(';')}`]

  const excluded = rule.excludedStartsAt ?? []
  if (excluded.length) {
    if (allDay) {
      const values = excluded.map(iso => toRfc5545Date(iso, timeZone)).join(',')
      lines.push(`EXDATE;VALUE=DATE:${values}`)
    } else {
      const values = excluded.map(toRfc5545UtcBasic).join(',')
      lines.push(`EXDATE:${values}`)
    }
  }
  return lines
}

function zonedWallTimeToIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  tzid: string,
): string | undefined {
  const safeTz = safeTimeZone(tzid)
  if (!safeTz) return undefined
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: safeTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    const offsetAt = (ms: number): number => {
      const parts = Object.fromEntries(
        formatter.formatToParts(new Date(ms)).map(p => [p.type, p.value]),
      )
      const asUtc = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute),
        Number(parts.second),
      )
      return asUtc - ms
    }
    const guessedUtc = Date.UTC(year, month - 1, day, hour, minute, second)
    const firstPass = guessedUtc - offsetAt(guessedUtc)
    const secondPass = guessedUtc - offsetAt(firstPass)
    return new Date(secondPass).toISOString()
  } catch {
    return undefined
  }
}

function parseRfc5545Timestamp(raw: string, tzid?: string): string | undefined {
  const value = raw.trim()
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
  }
  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/i,
  )
  if (!match) return undefined
  if (!match[7] && tzid) {
    const resolved = zonedWallTimeToIso(
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
      tzid,
    )
    if (resolved) return resolved
  }
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z`
}

/**
 * Parse RFC 5545 `RRULE` / `EXDATE` lines (from Google Calendar or `.ics`)
 * back into PureCalendar's `RecurrenceRule` shape so sync and imports do not
 * drop recurrence metadata.
 */
export function parseRfc5545Recurrence(
  input: string[] | string | undefined | null,
): RecurrenceRule | undefined {
  if (!input) return undefined
  const lines = Array.isArray(input) ? input : [input]
  let rruleBody: string | null = null
  const excluded: string[] = []

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    if (/^RRULE:/i.test(line)) {
      rruleBody = line.slice(6).trim()
    } else if (/^FREQ=/i.test(line)) {
      rruleBody = line
    } else if (/^EXDATE(?:;[^:]*)?:/i.test(line)) {
      const colon = line.indexOf(':')
      const header = line.slice(0, colon)
      const tzMatch = header.match(/;TZID=(?:"([^"]+)"|([^;]+))/i)
      const tzid = (tzMatch?.[1] ?? tzMatch?.[2])?.trim()
      const values = line.slice(colon + 1).split(',')
      for (const token of values) {
        const parsed = parseRfc5545Timestamp(token, tzid)
        if (parsed) excluded.push(parsed)
      }
    }
  }

  if (!rruleBody) return undefined
  const pairs = new Map<string, string>()
  for (const part of rruleBody.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    pairs.set(part.slice(0, eq).trim().toUpperCase(), part.slice(eq + 1).trim())
  }
  const freqRaw = pairs.get('FREQ')?.toUpperCase()
  const frequency: RecurrenceRule['frequency'] | null =
    freqRaw === 'DAILY'
      ? 'daily'
      : freqRaw === 'WEEKLY'
        ? 'weekly'
        : freqRaw === 'MONTHLY'
          ? 'monthly'
          : null
  if (!frequency) return undefined

  const rawInterval = Number(pairs.get('INTERVAL') ?? '1')
  const interval =
    Number.isFinite(rawInterval) && rawInterval >= 1
      ? Math.floor(rawInterval)
      : 1
  const rawCount = pairs.has('COUNT') ? Number(pairs.get('COUNT')) : undefined
  const count =
    rawCount !== undefined && Number.isFinite(rawCount) && rawCount > 0
      ? Math.floor(rawCount)
      : undefined
  const untilRaw = pairs.get('UNTIL')
  const until = untilRaw ? parseRfc5545Timestamp(untilRaw) : undefined

  return {
    frequency,
    interval,
    ...(count !== undefined ? { count } : {}),
    ...(until ? { until } : {}),
    ...(excluded.length ? { excludedStartsAt: Array.from(new Set(excluded)).sort() } : {}),
  }
}

/**
 * Render a RecurrenceRule as a plain English sentence for event read/edit views
 * (e.g. "Repeats every 2 weeks, 6 times", "Repeats daily until Dec 31, 2026").
 */
export function describeRecurrenceRule(
  rule: RecurrenceRule | null | undefined,
  options: { timeZone?: string } = {},
): string {
  if (!rule) return 'Does not repeat'
  const interval = Math.max(1, Math.floor(rule.interval || 1))
  let base: string
  if (interval === 1) {
    base =
      rule.frequency === 'daily'
        ? 'Repeats daily'
        : rule.frequency === 'weekly'
          ? 'Repeats weekly'
          : 'Repeats monthly'
  } else {
    const unit =
      rule.frequency === 'daily'
        ? 'days'
        : rule.frequency === 'weekly'
          ? 'weeks'
          : 'months'
    base = `Repeats every ${interval} ${unit}`
  }
  const parts = [base]
  if (typeof rule.count === 'number' && rule.count > 0) {
    parts.push(`${rule.count} ${rule.count === 1 ? 'time' : 'times'}`)
  } else if (rule.until) {
    const tz = safeTimeZone(options.timeZone)
    const untilDate = /^\d{4}-\d{2}-\d{2}$/.test(rule.until)
      ? new Date(`${rule.until}T12:00:00Z`)
      : new Date(rule.until)
    if (!Number.isNaN(untilDate.getTime())) {
      const formatted = new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        ...(tz ? { timeZone: tz } : {}),
      }).format(untilDate)
      parts.push(`until ${formatted}`)
    }
  }
  const skipped = rule.excludedStartsAt?.length ?? 0
  const summary = parts.join(', ')
  return skipped > 0
    ? `${summary} (${skipped} ${skipped === 1 ? 'date' : 'dates'} skipped)`
    : summary
}

/**
 * A scoped single-instance edit ("edit just this occurrence") is stored by the
 * local model (`applyRecurringEventEdit`, scope `'this'`) as a standalone event
 * whose id is `${baseId}_only_${index}` with `recurrenceRule` cleared. The
 * `_only_` marker is what distinguishes such an exception from an ordinary
 * standalone event — it is NOT a Google instance id.
 */
export function isScopedRecurrenceException(event: CalendarEvent): boolean {
  return /_only_\d+$/.test(event.id) && event.recurrenceRule === undefined
}
