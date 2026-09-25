import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from '../types'
import {
  allDayEventPatch,
  dateKeyInTimeZone,
  dateTimeLocalToIsoInTimeZone,
  dateTimeLocalValueInTimeZone,
  expandRecurringEvent,
  instantFromZonedWallTime,
  moveEvent,
} from './calendarModel'

/**
 * DST + timezone correctness pass (feature-plan item C7).
 *
 * 2026 transition dates used throughout:
 * - America/New_York: spring forward Sun Mar 8 (02:00→03:00, 23h day),
 *   fall back Sun Nov 1 (02:00→01:00, 25h day).
 * - Pacific/Auckland: DST ends Sun Apr 5 (03:00→02:00, 25h day),
 *   DST begins Sun Sep 27 (02:00→03:00, 23h day).
 *
 * All assertions go through the zone-aware helpers, so the tests are
 * independent of the machine's own timezone.
 */

const NY = 'America/New_York'
const AKL = 'Pacific/Auckland'

/** Wall time of an instant in a zone, as 'YYYY-MM-DDTHH:mm'. */
function wall(iso: string, timeZone: string): string {
  return dateTimeLocalValueInTimeZone(iso, timeZone)
}

function makeEvent(patch: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'event_dst',
    calendarId: 'cal_work',
    title: 'DST event',
    description: '',
    startsAt: '',
    endsAt: '',
    timeZone: 'UTC',
    allDay: false,
    status: 'confirmed',
    visibility: 'default',
    busyStatus: 'busy',
    attendees: [],
    reminders: [],
    attachments: [],
    linkedItems: [],
    source: 'demo',
    syncState: 'synced',
    ...patch,
  }
}

describe('recurring events across DST transitions', () => {
  it('keeps a daily 09:00 New York event at 09:00 wall time across spring-forward', () => {
    const startsAt = instantFromZonedWallTime('2026-03-06', 9, 0, NY)
    const event = makeEvent({
      startsAt,
      endsAt: new Date(Date.parse(startsAt) + 60 * 60 * 1000).toISOString(),
      timeZone: NY,
      recurrenceRule: { frequency: 'daily', interval: 1, count: 5 },
    })
    const instances = expandRecurringEvent(
      event,
      '2026-03-01T00:00:00.000Z',
      '2026-03-15T00:00:00.000Z',
    )
    expect(instances.map(i => wall(i.startsAt, NY))).toEqual([
      '2026-03-06T09:00',
      '2026-03-07T09:00',
      '2026-03-08T09:00', // transition day — the classic corruption point
      '2026-03-09T09:00',
      '2026-03-10T09:00',
    ])
    // The UTC instant must shift by the DST hour (EST 14:00Z → EDT 13:00Z);
    // a constant UTC time would mean the wall time drifted instead.
    expect(instances[1]?.startsAt).toBe('2026-03-07T14:00:00.000Z')
    expect(instances[3]?.startsAt).toBe('2026-03-09T13:00:00.000Z')
  })

  it('keeps a daily 09:00 New York event at 09:00 wall time across fall-back', () => {
    const startsAt = instantFromZonedWallTime('2026-10-30', 9, 0, NY)
    const event = makeEvent({
      startsAt,
      endsAt: new Date(Date.parse(startsAt) + 60 * 60 * 1000).toISOString(),
      timeZone: NY,
      recurrenceRule: { frequency: 'daily', interval: 1, count: 5 },
    })
    const instances = expandRecurringEvent(
      event,
      '2026-10-25T00:00:00.000Z',
      '2026-11-08T00:00:00.000Z',
    )
    expect(instances.map(i => wall(i.startsAt, NY))).toEqual([
      '2026-10-30T09:00',
      '2026-10-31T09:00',
      '2026-11-01T09:00', // transition day
      '2026-11-02T09:00',
      '2026-11-03T09:00',
    ])
    expect(instances[1]?.startsAt).toBe('2026-10-31T13:00:00.000Z') // EDT
    expect(instances[3]?.startsAt).toBe('2026-11-02T14:00:00.000Z') // EST
  })

  it('keeps a daily 09:00 Auckland event at 09:00 wall time across both NZ transitions', () => {
    // NZ spring-forward (Sep 27).
    const springStart = instantFromZonedWallTime('2026-09-25', 9, 0, AKL)
    const spring = expandRecurringEvent(
      makeEvent({
        startsAt: springStart,
        endsAt: new Date(
          Date.parse(springStart) + 30 * 60 * 1000,
        ).toISOString(),
        timeZone: AKL,
        recurrenceRule: { frequency: 'daily', interval: 1, count: 4 },
      }),
      '2026-09-20T00:00:00.000Z',
      '2026-10-05T00:00:00.000Z',
    )
    expect(spring.map(i => wall(i.startsAt, AKL))).toEqual([
      '2026-09-25T09:00',
      '2026-09-26T09:00',
      '2026-09-27T09:00', // NZDT begins
      '2026-09-28T09:00',
    ])

    // NZ fall-back (Apr 5).
    const fallStart = instantFromZonedWallTime('2026-04-03', 9, 0, AKL)
    const fall = expandRecurringEvent(
      makeEvent({
        startsAt: fallStart,
        endsAt: new Date(Date.parse(fallStart) + 30 * 60 * 1000).toISOString(),
        timeZone: AKL,
        recurrenceRule: { frequency: 'daily', interval: 1, count: 4 },
      }),
      '2026-03-29T00:00:00.000Z',
      '2026-04-12T00:00:00.000Z',
    )
    expect(fall.map(i => wall(i.startsAt, AKL))).toEqual([
      '2026-04-03T09:00',
      '2026-04-04T09:00',
      '2026-04-05T09:00', // NZDT ends
      '2026-04-06T09:00',
    ])
  })

  it('recovers the wall time after an occurrence lands in the spring-forward gap', () => {
    // Daily 02:30 NY: 02:30 does not exist on Mar 8. That single occurrence
    // resolves to a nearby real instant (see the gap-semantics test below),
    // but the series must return to 02:30 from Mar 9 on — no permanent drift.
    const startsAt = instantFromZonedWallTime('2026-03-07', 2, 30, NY)
    const event = makeEvent({
      startsAt,
      endsAt: new Date(Date.parse(startsAt) + 30 * 60 * 1000).toISOString(),
      timeZone: NY,
      recurrenceRule: { frequency: 'daily', interval: 1, count: 3 },
    })
    const instances = expandRecurringEvent(
      event,
      '2026-03-01T00:00:00.000Z',
      '2026-03-15T00:00:00.000Z',
    )
    expect(wall(instances[0]?.startsAt ?? '', NY)).toBe('2026-03-07T02:30')
    // Gap day: resolved deterministically to 01:30 EST (an hour early).
    expect(instances[1]?.startsAt).toBe('2026-03-08T06:30:00.000Z')
    expect(wall(instances[1]?.startsAt ?? '', NY)).toBe('2026-03-08T01:30')
    // Back on the requested wall time the next day.
    expect(wall(instances[2]?.startsAt ?? '', NY)).toBe('2026-03-09T02:30')
  })
})

describe('instantFromZonedWallTime at the transition itself', () => {
  // Chosen semantics (locked in, not designed): the two-pass offset
  // iteration always yields a real, deterministic instant — never NaN and
  // never off by a full day.
  // - Non-existent wall times (spring-forward gap) resolve to a real
  //   instant within one hour of the requested time, on the SAME local
  //   date. The direction depends on which side's offset the second pass
  //   lands on (NY 02:30 → 01:30 EST; Auckland 02:30 → 03:30 NZDT).
  // - Ambiguous wall times (fall-back repeat) resolve to exactly one of
  //   the two real instants: the one matching the zone's offset at the
  //   wall-time-read-as-UTC instant (NY 01:30 → first/EDT occurrence;
  //   Auckland 02:30 → second/NZST occurrence).

  it('resolves the New York spring-forward gap to a real instant on the same date', () => {
    const iso = instantFromZonedWallTime('2026-03-08', 2, 30, NY)
    expect(Number.isNaN(Date.parse(iso))).toBe(false)
    expect(iso).toBe('2026-03-08T06:30:00.000Z') // = 01:30 EST
    expect(wall(iso, NY)).toBe('2026-03-08T01:30')
    expect(dateKeyInTimeZone(iso, NY)).toBe('2026-03-08')
  })

  it('resolves the ambiguous New York fall-back hour to the first (EDT) occurrence', () => {
    const iso = instantFromZonedWallTime('2026-11-01', 1, 30, NY)
    // Candidates: 05:30Z (01:30 EDT) and 06:30Z (01:30 EST).
    expect(iso).toBe('2026-11-01T05:30:00.000Z')
    expect(wall(iso, NY)).toBe('2026-11-01T01:30')
  })

  it('resolves the Auckland spring-forward gap to a real instant on the same date', () => {
    const iso = instantFromZonedWallTime('2026-09-27', 2, 30, AKL)
    expect(Number.isNaN(Date.parse(iso))).toBe(false)
    expect(iso).toBe('2026-09-26T14:30:00.000Z') // = 03:30 NZDT
    expect(wall(iso, AKL)).toBe('2026-09-27T03:30')
    expect(dateKeyInTimeZone(iso, AKL)).toBe('2026-09-27')
  })

  it('resolves the ambiguous Auckland fall-back hour to the second (NZST) occurrence', () => {
    const iso = instantFromZonedWallTime('2026-04-05', 2, 30, AKL)
    // Candidates: 13:30Z Apr 4 (02:30 NZDT) and 14:30Z Apr 4 (02:30 NZST).
    expect(iso).toBe('2026-04-04T14:30:00.000Z')
    expect(wall(iso, AKL)).toBe('2026-04-05T02:30')
  })

  it('round-trips normal wall times through the form-input helpers on transition days', () => {
    // dateTimeLocalToIsoInTimeZone is the editor's write path; outside the
    // gap/ambiguous hour a transition-day time must round-trip exactly.
    for (const [value, timeZone] of [
      ['2026-03-08T09:00', NY],
      ['2026-11-01T09:00', NY],
      ['2026-09-27T09:00', AKL],
      ['2026-04-05T09:00', AKL],
    ] as const) {
      const iso = dateTimeLocalToIsoInTimeZone(value, timeZone)
      expect(iso).not.toBeNull()
      expect(wall(iso ?? '', timeZone)).toBe(value)
    }
  })
})

describe('dragging events across a DST boundary', () => {
  it('keeps the duration when moved across New York spring-forward', () => {
    const event = makeEvent({
      startsAt: instantFromZonedWallTime('2026-03-07', 9, 0, NY),
      endsAt: instantFromZonedWallTime('2026-03-07', 10, 30, NY),
      timeZone: NY,
    })
    const target = dateTimeLocalToIsoInTimeZone('2026-03-08T09:00', NY)
    expect(target).not.toBeNull()
    const moved = moveEvent(event, target ?? '')
    expect(Date.parse(moved.endsAt) - Date.parse(moved.startsAt)).toBe(
      90 * 60 * 1000,
    )
    expect(wall(moved.startsAt, NY)).toBe('2026-03-08T09:00')
    expect(wall(moved.endsAt, NY)).toBe('2026-03-08T10:30')
  })

  it('keeps the duration when moved across Auckland fall-back', () => {
    const event = makeEvent({
      startsAt: instantFromZonedWallTime('2026-04-04', 14, 0, AKL),
      endsAt: instantFromZonedWallTime('2026-04-04', 15, 0, AKL),
      timeZone: AKL,
    })
    const target = dateTimeLocalToIsoInTimeZone('2026-04-05T14:00', AKL)
    const moved = moveEvent(event, target ?? '')
    expect(Date.parse(moved.endsAt) - Date.parse(moved.startsAt)).toBe(
      60 * 60 * 1000,
    )
    expect(wall(moved.startsAt, AKL)).toBe('2026-04-05T14:00')
    expect(wall(moved.endsAt, AKL)).toBe('2026-04-05T15:00')
  })

  it('keeps the duration when an event SPANS the transition hour', () => {
    // 01:00–04:00 on the NY spring-forward night is 3h of absolute time but
    // only shows 01:00→04:00 with the 02:00 hour skipped. Duration in ms is
    // the invariant the model preserves.
    const event = makeEvent({
      startsAt: instantFromZonedWallTime('2026-03-07', 1, 0, NY),
      endsAt: instantFromZonedWallTime('2026-03-07', 4, 0, NY),
      timeZone: NY,
    })
    const target = dateTimeLocalToIsoInTimeZone('2026-03-08T01:00', NY)
    const moved = moveEvent(event, target ?? '')
    expect(Date.parse(moved.endsAt) - Date.parse(moved.startsAt)).toBe(
      3 * 60 * 60 * 1000,
    )
    expect(wall(moved.startsAt, NY)).toBe('2026-03-08T01:00')
    // 01:00 EST + 3h = 05:00 wall (the 02:00 hour does not exist).
    expect(wall(moved.endsAt, NY)).toBe('2026-03-08T05:00')
  })
})

describe('dateKeyInTimeZone around midnight on transition days', () => {
  it('assigns the 25 hours of the New York fall-back day to one date key', () => {
    expect(dateKeyInTimeZone('2026-11-01T03:59:00.000Z', NY)).toBe('2026-10-31') // 23:59 EDT
    expect(dateKeyInTimeZone('2026-11-01T04:00:00.000Z', NY)).toBe('2026-11-01') // 00:00 EDT
    expect(dateKeyInTimeZone('2026-11-01T05:30:00.000Z', NY)).toBe('2026-11-01') // 01:30 EDT
    expect(dateKeyInTimeZone('2026-11-01T06:30:00.000Z', NY)).toBe('2026-11-01') // 01:30 EST (repeat)
    expect(dateKeyInTimeZone('2026-11-02T04:59:00.000Z', NY)).toBe('2026-11-01') // 23:59 EST
    expect(dateKeyInTimeZone('2026-11-02T05:00:00.000Z', NY)).toBe('2026-11-02') // 00:00 EST
  })

  it('assigns the 23 hours of the New York spring-forward day to one date key', () => {
    expect(dateKeyInTimeZone('2026-03-08T04:59:00.000Z', NY)).toBe('2026-03-07') // 23:59 EST
    expect(dateKeyInTimeZone('2026-03-08T05:00:00.000Z', NY)).toBe('2026-03-08') // 00:00 EST
    expect(dateKeyInTimeZone('2026-03-08T07:00:00.000Z', NY)).toBe('2026-03-08') // 03:00 EDT (after gap)
    expect(dateKeyInTimeZone('2026-03-09T03:59:00.000Z', NY)).toBe('2026-03-08') // 23:59 EDT
    expect(dateKeyInTimeZone('2026-03-09T04:00:00.000Z', NY)).toBe('2026-03-09') // 00:00 EDT
  })

  it('handles Auckland transition-day midnights', () => {
    // NZ spring-forward day (Sep 27, 23h): 00:00 NZST = Sep 26 12:00Z,
    // 23:59 NZDT = Sep 27 10:59Z.
    expect(dateKeyInTimeZone('2026-09-26T11:59:00.000Z', AKL)).toBe('2026-09-26')
    expect(dateKeyInTimeZone('2026-09-26T12:00:00.000Z', AKL)).toBe('2026-09-27')
    expect(dateKeyInTimeZone('2026-09-27T10:59:00.000Z', AKL)).toBe('2026-09-27')
    expect(dateKeyInTimeZone('2026-09-27T11:00:00.000Z', AKL)).toBe('2026-09-28')
    // NZ fall-back day (Apr 5, 25h): 00:00 NZDT = Apr 4 11:00Z,
    // 23:59 NZST = Apr 5 11:59Z.
    expect(dateKeyInTimeZone('2026-04-04T11:00:00.000Z', AKL)).toBe('2026-04-05')
    expect(dateKeyInTimeZone('2026-04-05T11:59:00.000Z', AKL)).toBe('2026-04-05')
    expect(dateKeyInTimeZone('2026-04-05T12:00:00.000Z', AKL)).toBe('2026-04-06')
  })
})

describe('all-day events on transition days', () => {
  it('snaps to local midnights on the spring-forward day (date stays the date)', () => {
    const event = makeEvent({
      startsAt: instantFromZonedWallTime('2026-03-08', 10, 0, NY),
      endsAt: instantFromZonedWallTime('2026-03-08', 11, 0, NY),
      timeZone: NY,
    })
    const patch = allDayEventPatch(event, true, NY)
    expect(patch.allDay).toBe(true)
    // Midnight-to-midnight in NY; the day itself is only 23h long.
    expect(patch.startsAt).toBe('2026-03-08T05:00:00.000Z') // 00:00 EST Mar 8
    expect(patch.endsAt).toBe('2026-03-09T04:00:00.000Z') // 00:00 EDT Mar 9
    expect(dateKeyInTimeZone(patch.startsAt ?? '', NY)).toBe('2026-03-08')
    expect(dateKeyInTimeZone(patch.endsAt ?? '', NY)).toBe('2026-03-09')
  })

  it('snaps to local midnights on the fall-back day (25h day)', () => {
    const event = makeEvent({
      startsAt: instantFromZonedWallTime('2026-11-01', 10, 0, NY),
      endsAt: instantFromZonedWallTime('2026-11-01', 11, 0, NY),
      timeZone: NY,
    })
    const patch = allDayEventPatch(event, true, NY)
    expect(patch.startsAt).toBe('2026-11-01T04:00:00.000Z') // 00:00 EDT Nov 1
    expect(patch.endsAt).toBe('2026-11-02T05:00:00.000Z') // 00:00 EST Nov 2
    expect(dateKeyInTimeZone(patch.startsAt ?? '', NY)).toBe('2026-11-01')
    expect(dateKeyInTimeZone(patch.endsAt ?? '', NY)).toBe('2026-11-02')
  })

  it('keeps a recurring all-day event on consecutive dates across the transition', () => {
    const startsAt = instantFromZonedWallTime('2026-03-07', 0, 0, NY)
    const event = makeEvent({
      startsAt,
      endsAt: instantFromZonedWallTime('2026-03-08', 0, 0, NY),
      timeZone: NY,
      allDay: true,
      recurrenceRule: { frequency: 'daily', interval: 1, count: 3 },
    })
    const instances = expandRecurringEvent(
      event,
      '2026-03-01T00:00:00.000Z',
      '2026-03-15T00:00:00.000Z',
    )
    // Each occurrence starts at local midnight of the next calendar date —
    // the date is the identity of an all-day event, DST notwithstanding.
    expect(instances.map(i => dateKeyInTimeZone(i.startsAt, NY))).toEqual([
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
    ])
    expect(instances.map(i => wall(i.startsAt, NY).slice(11))).toEqual([
      '00:00',
      '00:00',
      '00:00',
    ])
  })
})
