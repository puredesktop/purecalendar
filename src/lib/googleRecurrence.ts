import type { CalendarEvent, RecurrenceRule } from '../types'

/**
 * Recurrence (de)serialization helpers shared between the Google provider body
 * builder and its sync path. Kept separate so the EXDATE / exception-detection
 * logic is unit-testable without standing up the whole provider.
 */

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
 * Format an all-day exclusion as an RFC 5545 DATE value, e.g. `20260710`.
 * All-day series carry `date`-valued starts, so their EXDATE must be
 * DATE-valued (`EXDATE;VALUE=DATE:...`) — a DATE-TIME EXDATE would not match
 * the DATE-valued occurrence and Google would silently ignore it.
 */
export function toRfc5545Date(iso: string): string {
  // All-day starts are stored as `YYYY-MM-DD` (see calendarEventFromGoogle);
  // tolerate a full datetime too by slicing the date component.
  return iso.slice(0, 10).replace(/-/g, '')
}

/**
 * Build the Google `recurrence` array for an event that carries a base
 * RecurrenceRule. Emits the RRULE plus, when `excludedStartsAt` is non-empty,
 * a single EXDATE line with comma-joined values.
 *
 * Google accepts a single `EXDATE:` line with comma-separated values as well
 * as repeated `EXDATE:` lines; we emit one comma-joined line for compactness.
 * Timed series use DATE-TIME values in UTC basic form; all-day series use
 * `EXDATE;VALUE=DATE:` with DATE values.
 */
export function recurrenceLinesForGoogle(
  rule: RecurrenceRule,
  allDay: boolean,
): string[] {
  const rruleParts = [
    `FREQ=${rule.frequency.toUpperCase()}`,
    `INTERVAL=${rule.interval}`,
  ]
  if (rule.count) rruleParts.push(`COUNT=${rule.count}`)
  if (rule.until) {
    rruleParts.push(`UNTIL=${toRfc5545UtcBasic(rule.until)}`)
  }
  const lines = [`RRULE:${rruleParts.join(';')}`]

  const excluded = rule.excludedStartsAt ?? []
  if (excluded.length) {
    if (allDay) {
      const values = excluded.map(toRfc5545Date).join(',')
      lines.push(`EXDATE;VALUE=DATE:${values}`)
    } else {
      const values = excluded.map(toRfc5545UtcBasic).join(',')
      lines.push(`EXDATE:${values}`)
    }
  }
  return lines
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
