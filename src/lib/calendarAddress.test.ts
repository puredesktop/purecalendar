import { describe, expect, it } from 'vitest'
import { parseCalendarAddress } from './calendarAddress'

describe('parseCalendarAddress', () => {
  it("takes Google's share link and returns the calendar id", () => {
    expect(
      parseCalendarAddress(
        'https://calendar.google.com/calendar/r?cid=YWxleEBhbHRlcm5hdGUuZXhhbXBsZQ&ctok=YWxleEBidXNpbmVzcy5leGFtcGxl&es=3',
      ),
    ).toBe('alex@alternate.example')
  })

  it('handles a group calendar link and base64url padding', () => {
    // "team@group.calendar.google.com"
    expect(
      parseCalendarAddress(
        'https://calendar.google.com/calendar/u/0?cid=dGVhbUBncm91cC5jYWxlbmRhci5nb29nbGUuY29t',
      ),
    ).toBe('team@group.calendar.google.com')
  })

  it('accepts a plain address, trimmed, and a mailto:', () => {
    expect(parseCalendarAddress('  alex@alternate.example ')).toBe(
      'alex@alternate.example',
    )
    expect(parseCalendarAddress('mailto:alex@alternate.example')).toBe(
      'alex@alternate.example',
    )
  })

  it('reads an ical feed url and an embed src', () => {
    expect(
      parseCalendarAddress(
        'https://calendar.google.com/calendar/ical/team%40group.calendar.google.com/public/basic.ics',
      ),
    ).toBe('team@group.calendar.google.com')
    expect(
      parseCalendarAddress(
        'https://calendar.google.com/calendar/embed?src=team%40group.calendar.google.com',
      ),
    ).toBe('team@group.calendar.google.com')
  })

  it('returns null for empty input and unusable urls', () => {
    expect(parseCalendarAddress('   ')).toBeNull()
    expect(parseCalendarAddress('https://example.com/nothing-here')).toBeNull()
  })
})

describe('ICS feed urls', () => {
  const secret =
    'https://calendar.google.com/calendar/ical/alex%40alternate.example/private-abc123secret/basic.ics'

  it('accepts https and webcal, rejects anything else', async () => {
    const { parseIcsFeedUrl } = await import('./calendarAddress')
    expect(parseIcsFeedUrl(secret)).toBe(secret)
    expect(parseIcsFeedUrl('webcal://example.com/cal.ics')).toBe(
      'https://example.com/cal.ics',
    )
    expect(parseIcsFeedUrl('alex@alternate.example')).toBeNull()
    expect(parseIcsFeedUrl('  ')).toBeNull()
  })

  it('labels a Google private address by calendar, never by secret', async () => {
    const { labelForIcsFeedUrl } = await import('./calendarAddress')
    const label = labelForIcsFeedUrl(secret)
    expect(label).toBe('alex@alternate.example')
    expect(label).not.toContain('private-')
    expect(label).not.toContain('abc123secret')
  })
})
