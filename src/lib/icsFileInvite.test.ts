import { describe, expect, it } from 'vitest'
import {
  calendarInviteIntentFromIcsFile,
  isIcsFilePath,
  parseIcsFileInvite,
} from './icsFileInvite'

const REQUEST_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Pure Science//PureCalendar//EN',
  'METHOD:REQUEST',
  'BEGIN:VEVENT',
  'UID:uid-42@business.example',
  'SEQUENCE:3',
  'STATUS:CONFIRMED',
  'SUMMARY:Quarterly planning',
  'DESCRIPTION:Bring the roadmap',
  'LOCATION:Room 4',
  'DTSTART:20260710T090000Z',
  'DTEND:20260710T100000Z',
  'RRULE:FREQ=WEEKLY;COUNT=4',
  'ORGANIZER;CN=Boss:mailto:boss@business.example',
  'ATTENDEE;CN=User;PARTSTAT=NEEDS-ACTION:mailto:alex@business.example',
  'ATTENDEE;PARTSTAT=ACCEPTED:mailto:boss@business.example',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

describe('parseIcsFileInvite', () => {
  it('parses a METHOD:REQUEST invite with attendees', () => {
    const invite = parseIcsFileInvite(REQUEST_ICS)
    expect(invite).not.toBeNull()
    expect(invite?.uid).toBe('uid-42@business.example')
    expect(invite?.method).toBe('REQUEST')
    expect(invite?.sequence).toBe(3)
    expect(invite?.status).toBe('confirmed')
    expect(invite?.title).toBe('Quarterly planning')
    expect(invite?.description).toBe('Bring the roadmap')
    expect(invite?.location).toBe('Room 4')
    expect(invite?.startsAt).toBe('2026-07-10T09:00:00.000Z')
    expect(invite?.endsAt).toBe('2026-07-10T10:00:00.000Z')
    expect(invite?.organizer).toEqual({
      name: 'Boss',
      email: 'boss@business.example',
    })
    expect(invite?.attendees).toEqual([
      { name: 'User', email: 'alex@business.example', response: 'needsAction' },
      { name: 'boss@business.example', email: 'boss@business.example', response: 'accepted' },
    ])
    expect(invite?.recurrenceRule).toContain('FREQ=WEEKLY')
  })

  it('returns null for malformed input', () => {
    expect(parseIcsFileInvite('not an ics file at all')).toBeNull()
    // Valid iCalendar container but no VEVENT to review.
    expect(
      parseIcsFileInvite('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR'),
    ).toBeNull()
  })
})

describe('calendarInviteIntentFromIcsFile', () => {
  it('adapts a parsed invite to the pendingInvite intent shape', () => {
    const invite = parseIcsFileInvite(REQUEST_ICS)
    expect(invite).not.toBeNull()
    if (!invite) return
    const intent = calendarInviteIntentFromIcsFile(
      invite,
      { path: '/Users/developer/Downloads/planning.ics', name: 'planning.ics' },
      '2026-07-04T00:00:00.000Z',
    )
    expect(intent.uid).toBe('uid-42@business.example')
    expect(intent.method).toBe('REQUEST')
    expect(intent.sequence).toBe(3)
    expect(intent.title).toBe('Quarterly planning')
    expect(intent.source.label).toBe('planning.ics')
    expect(intent.source.accountId).toBe('ics-file')
    expect(intent.attendees).toHaveLength(2)
    expect(intent.createdAt).toBe('2026-07-04T00:00:00.000Z')
  })
})

describe('isIcsFilePath', () => {
  it('matches .ics paths case-insensitively and nothing else', () => {
    expect(isIcsFilePath('/tmp/invite.ics')).toBe(true)
    expect(isIcsFilePath('/tmp/INVITE.ICS')).toBe(true)
    expect(isIcsFilePath('/tmp/invite.ics.txt')).toBe(false)
    expect(isIcsFilePath('calendar-invite:mail:a:b:c')).toBe(false)
  })
})
