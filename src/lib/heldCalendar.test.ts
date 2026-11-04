import { describe, expect, it } from 'vitest'
import { describeQuickEvent, joinKey, readHeldView, readJoin } from './heldCalendar'
import type { CalendarEvent, CalendarStore } from '../types'

describe('held calendar words', () => {
  it('reads today and week however they are written', () => {
    expect(readHeldView(' Today ')).toBe('today')
    expect(readHeldView('WEEK')).toBe('week')
    expect(readHeldView('month')).toBeNull()
    expect(readHeldView('')).toBeNull()
  })

  it('says what was understood and that it waits for a press', () => {
    const event = { title: 'Planning review', startsAt: '2026-11-05T14:30:00.000Z', allDay: false } as CalendarEvent
    const line = describeQuickEvent(event, 'UTC')
    expect(line).toContain('Planning review, Thu, Nov 5 at 2:30')
    expect(line).toContain('stays a draft until you choose Edit and set it to Active')
  })
})

describe('/join', () => {
  const NOW = Date.parse('2026-11-05T15:00:00.000Z')
  const minutes = (n: number): string => new Date(NOW + n * 60_000).toISOString()
  const event = (id: string, start: number, end: number, more: Partial<CalendarEvent> = {}): CalendarEvent => ({
    id, calendarId: 'c', title: id, description: '', startsAt: minutes(start), endsAt: minutes(end), timeZone: 'UTC', allDay: false, status: 'confirmed', attendees: [], conferenceLink: `https://meet.example.com/${id}`, ...more,
  } as CalendarEvent)
  const store = (...events: CalendarEvent[]): CalendarStore => ({ calendars: [{ id: 'c', visible: true }], events } as unknown as CalendarStore)

  it('takes the one starting within ten minutes', () => {
    expect(readJoin(store(event('soon', 9, 40)), NOW)).toEqual({ kind: 'open', url: 'https://meet.example.com/soon', title: 'soon' })
    expect(readJoin(store(event('edge', 10, 40)), NOW).kind).toBe('open')
  })
  it('not one eleven minutes off: that’s the next one', () => {
    expect(readJoin(store(event('later', 11, 40)), NOW)).toEqual({ kind: 'nothing', next: { title: 'later', startsAt: minutes(11) } })
  })
  it('takes one under way, however long ago it began', () => {
    expect(readJoin(store(event('long', -170, 5)), NOW).kind).toBe('open')
  })
  it('not one that has just ended', () => {
    expect(readJoin(store(event('over', -30, 0)), NOW)).toEqual({ kind: 'nothing', next: null })
    expect(readJoin(store(event('still', -30, 1)), NOW).kind).toBe('open')
  })
  it('two at once is a choice, soonest first, and picking one opens that one', () => {
    const answer = readJoin(store(event('b', 5, 40), event('a', -5, 40, { conferenceLink: '' })), NOW)
    expect(answer.kind).toBe('choose')
    if (answer.kind !== 'choose') return
    expect(answer.events.map(each => [each.title, each.hasLink])).toEqual([['a', false], ['b', true]])
    expect(readJoin(store(event('b', 5, 40), event('a', -5, 40)), NOW, answer.events[1]!.key)).toMatchObject({ kind: 'open', title: 'b' })
  })
  it('one with no link says so, by its title', () => {
    expect(readJoin(store(event('Budget', 2, 40, { conferenceLink: '' })), NOW)).toEqual({ kind: 'no-link', title: 'Budget' })
  })
  it('finds a link in the invitation’s words', () => {
    expect(readJoin(store(event('z', 2, 40, { conferenceLink: '', description: 'Join https://us02web.zoom.us/j/123 now' })), NOW)).toMatchObject({ kind: 'open', url: expect.stringContaining('zoom.us') })
  })
  it('nothing near names the next, and nothing at all says that', () => {
    expect(readJoin(store(event('Friday', 60 * 24, 60 * 25)), NOW)).toMatchObject({ kind: 'nothing', next: { title: 'Friday' } })
    expect(readJoin(store(), NOW)).toEqual({ kind: 'nothing', next: null })
  })
  it('skips cancelled events, drafts and all-day ones', () => {
    expect(readJoin(store(event('gone', 2, 40, { status: 'cancelled' })), NOW).kind).toBe('nothing')
    expect(readJoin(store(event('draft', 2, 40, { lifecycle: 'draft' })), NOW).kind).toBe('nothing')
    expect(readJoin(store(event('day', -60, 600, { allDay: true })), NOW).kind).toBe('nothing')
    expect(readJoin(store(event('invited', 2, 40, { lifecycle: 'draft', externalUid: 'x' })), NOW).kind).toBe('open')
  })
  it('a picked one that has since finished isn’t opened', () => {
    const gone = event('old', -30, -1)
    expect(readJoin(store(gone), NOW, joinKey(gone)).kind).toBe('nothing')
  })
  it('a repeating event counts by the time it happens today', () => {
    const answer = readJoin(store(event('weekly', 3 - 7 * 24 * 60, 33 - 7 * 24 * 60, { recurrence: { frequency: 'weekly', interval: 1 } } as Partial<CalendarEvent>)), NOW)
    expect(answer.kind === 'open' || answer.kind === 'nothing').toBe(true)
  })
})
