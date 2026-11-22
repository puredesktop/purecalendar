import { describe, expect, it } from 'vitest'
import {
  getTimeZoneSnapshot,
  localTimeReadout,
  railHourInfo,
  resolveTimeZoneInput,
  searchTimeZones,
  upcomingDstTransition,
} from './timeZoneDirectory'

describe('timeZoneDirectory', () => {
  it('resolves cities, IATA airport codes, abbreviations, and IANA identifiers', () => {
    expect(resolveTimeZoneInput('SFO')).toBe('America/Los_Angeles')
    expect(resolveTimeZoneInput('London')).toBe('Europe/London')
    expect(resolveTimeZoneInput('NRT')).toBe('Asia/Tokyo')
    expect(resolveTimeZoneInput('Auckland')).toBe('Pacific/Auckland')
    expect(resolveTimeZoneInput('Europe/Berlin')).toBe('Europe/Berlin')
    expect(resolveTimeZoneInput('UTC')).toBe('UTC')
  })

  it('searches by city, country, airport code, and UTC offset', () => {
    const india = searchTimeZones('bengaluru', new Date('2026-11-22T12:00:00Z'))
    expect(india[0]?.timeZone).toBe('Asia/Kolkata')

    const tokyo = searchTimeZones('tokyo', new Date('2026-11-22T12:00:00Z'))
    expect(tokyo[0]?.timeZone).toBe('Asia/Tokyo')
    expect(tokyo[0]?.offsetLabel).toBe('UTC+9')

    const offsetSearch = searchTimeZones('+9', new Date('2026-11-22T12:00:00Z'))
    expect(offsetSearch.some(e => e.timeZone === 'Asia/Tokyo')).toBe(true)
  })

  it('computes multi-timezone rail hour labels with day rollover badges', () => {
    // 2026-11-23 17:00 in America/Los_Angeles (UTC-8) = 2026-11-24 10:00 in Asia/Tokyo (UTC+9) -> +1d
    const tokyo = railHourInfo('2026-11-23', 17, 'America/Los_Angeles', 'Asia/Tokyo', '12h')
    expect(tokyo.hour).toBe(10)
    expect(tokyo.dayDiff).toBe(1)
    expect(tokyo.dayBadge).toBe('+1d')
    expect(tokyo.band).toBe('daytime')
  })

  it('detects upcoming DST transitions accurately', () => {
    // US spring forward in 2026 is Sunday March 8
    const info = upcomingDstTransition('America/New_York', Date.parse('2026-03-01T12:00:00Z'), 14)
    expect(info).not.toBeNull()
    expect(info?.direction).toBe('forward')
    expect(info?.deltaMinutes).toBe(60)
    expect(info?.dateKey).toBe('2026-03-08')
  })

  it('formats local time readouts with cross-date indicator and offset', () => {
    const snap = getTimeZoneSnapshot('Europe/London', new Date('2026-11-23T15:00:00Z'), '24h')
    expect(snap.shortCode).toBe('LDN')
    expect(snap.hour).toBe(15)

    const readout = localTimeReadout(
      '2026-11-23T23:30:00Z',
      '2026-11-24T00:30:00Z',
      'Europe/London',
      'America/Los_Angeles',
      '24h',
    )
    expect(readout.crossesDate).toBe(true)
    expect(readout.dayBadge).toBe('')
  })
})
