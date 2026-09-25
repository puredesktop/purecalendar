// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { resolveAgentEventTime } from './calendarModel'

const LA = 'America/Los_Angeles'
const dayIn = (instant: string, zone: string): string =>
  new Date(instant).toLocaleDateString('en-CA', { timeZone: zone })

/**
 * The tool schema says "ISO 8601", and a bare date is valid ISO 8601. It was
 * being stored verbatim and read back by `new Date(...)` as UTC midnight —
 * the previous day anywhere west of Greenwich. That is the reported "it got
 * the day wrong", and it needed no unusual input.
 */
describe('resolving what an agent passed for a time', () => {
  it('keeps a plain date on the day that was asked for', () => {
    const resolved = resolveAgentEventTime('2026-08-27', LA)
    expect(resolved).not.toBeNull()
    expect(dayIn(resolved!.instant, LA)).toBe('2026-08-27')
    expect(resolved!.dateOnly).toBe(true)
  })

  it('reads a zoneless time in the event zone, not the machine zone', () => {
    // 09:00 in Berlin is 07:00 UTC, whatever the machine is set to.
    const resolved = resolveAgentEventTime('2026-08-27T09:00:00', 'Europe/Berlin')
    expect(resolved!.instant).toBe('2026-08-27T07:00:00.000Z')
    expect(resolved!.dateOnly).toBe(false)
  })

  it('respects an explicit offset over the event zone', () => {
    const resolved = resolveAgentEventTime('2026-08-27T09:00:00Z', 'Europe/Berlin')
    expect(resolved!.instant).toBe('2026-08-27T09:00:00.000Z')
  })

  it('lands on the right side of a daylight-saving change', () => {
    // US clocks go back on 2026-11-01; 09:00 local is 16:00 UTC after it.
    expect(resolveAgentEventTime('2026-11-02T09:00', LA)!.instant).toBe(
      '2026-11-02T17:00:00.000Z',
    )
    expect(resolveAgentEventTime('2026-10-30T09:00', LA)!.instant).toBe(
      '2026-10-30T16:00:00.000Z',
    )
  })

  it('refuses what is not a time, rather than storing it', () => {
    // Storing these is how an event ends up on no day at all.
    expect(resolveAgentEventTime('next tuesday', LA)).toBeNull()
    expect(resolveAgentEventTime('', LA)).toBeNull()
    expect(resolveAgentEventTime('   ', LA)).toBeNull()
  })
})
