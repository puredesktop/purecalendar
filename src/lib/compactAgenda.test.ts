import { describe, expect, it } from 'vitest'
import { calendarFixture } from '../test/calendarFixtures'
import type { CalendarEvent, CalendarTask } from '../types'
import {
  COMPACT_AGENDA_DAYS,
  compactAgendaDays,
  compactAgendaItems,
  compactAgendaRange,
  compactAgendaTitle,
  compactDayHeading,
  compactIgnoresCommand,
} from './compactAgenda'

const base = calendarFixture().events[0]!
const event = (patch: Partial<CalendarEvent>): CalendarEvent => ({ ...base, recurrenceRule: undefined, ...patch } as CalendarEvent)
const task = (patch: Partial<CalendarTask>): CalendarTask => ({
  id: 'task', title: 'Task', sourceLabel: 'Tasks', status: 'open', syncState: 'synced', ...patch,
})

describe('compactAgendaDays', () => {
  it('runs seven whole days from the anchor day in the display zone', () => {
    const days = compactAgendaDays(new Date('2026-11-02T23:30:00Z'), 'Pacific/Auckland')
    expect(days).toHaveLength(COMPACT_AGENDA_DAYS)
    expect(days[0]!.key).toBe('2026-11-03')
    expect(days[6]!.key).toBe('2026-11-09')
    expect(compactAgendaRange(days)).toEqual({ start: days[0]!.start, end: days[6]!.end })
  })

  it('neither skips nor repeats a day across a clock change', () => {
    const days = compactAgendaDays(new Date('2026-10-30T12:00:00Z'), 'America/New_York')
    expect(days.map(day => day.key)).toEqual([
      '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05',
    ])
    const longDay = days.find(day => day.key === '2026-11-01')!
    expect(Date.parse(longDay.end) - Date.parse(longDay.start)).toBe(25 * 3_600_000)
  })
})

describe('compactAgendaItems', () => {
  const [day, nextDay] = compactAgendaDays(new Date('2026-11-02T12:00:00Z'), 'UTC')

  it('puts all-day first, then by start, with tasks among them', () => {
    const items = compactAgendaItems(
      day!,
      [
        event({ id: 'late', startsAt: '2026-11-02T15:00:00Z', endsAt: '2026-11-02T16:00:00Z' }),
        event({ id: 'allday', allDay: true, startsAt: '2026-11-02T00:00:00Z', endsAt: '2026-11-03T00:00:00Z' }),
        event({ id: 'early', startsAt: '2026-11-02T09:00:00Z', endsAt: '2026-11-02T10:00:00Z' }),
      ],
      [task({ id: 'noon', scheduledStart: '2026-11-02T12:00:00Z' })],
      'UTC',
    )
    expect(items.map(item => item.id)).toEqual(['allday', 'early', 'noon', 'late'])
  })

  it('keeps an event ending at midnight off the next day, and shows one running over onto it', () => {
    const endsAtMidnight = event({ id: 'a', startsAt: '2026-11-02T22:00:00Z', endsAt: '2026-11-03T00:00:00Z' })
    const runsOver = event({ id: 'b', startsAt: '2026-11-02T23:00:00Z', endsAt: '2026-11-03T01:00:00Z' })
    expect(compactAgendaItems(nextDay!, [endsAtMidnight, runsOver], [], 'UTC').map(item => item.id)).toEqual(['b'])
  })

  it('keeps an event with no length on its day', () => {
    const instant = event({ id: 'a', startsAt: '2026-11-02T09:00:00Z', endsAt: '2026-11-02T09:00:00Z' })
    expect(compactAgendaItems(day!, [instant], [], 'UTC')).toHaveLength(1)
    expect(compactAgendaItems(nextDay!, [instant], [], 'UTC')).toHaveLength(0)
  })

  it('leaves out tasks on other days or with no time', () => {
    const tasks = [task({ id: 'other', dueAt: '2026-11-03T09:00:00Z' }), task({ id: 'none' })]
    expect(compactAgendaItems(day!, [], tasks, 'UTC')).toHaveLength(0)
  })
})

describe('headings', () => {
  const days = compactAgendaDays(new Date('2026-11-02T12:00:00Z'), 'UTC')
  const now = new Date('2026-11-02T08:00:00Z')

  it('names today and tomorrow, then the weekday', () => {
    expect(compactDayHeading(days[0]!, now, 'UTC')).toMatchObject({ title: 'Today', today: true })
    expect(compactDayHeading(days[1]!, now, 'UTC')).toMatchObject({ title: 'Tomorrow', today: false })
    expect(compactDayHeading(days[2]!, now, 'UTC').title).toBe(
      new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'long' }).format(new Date('2026-11-04T12:00:00Z')),
    )
  })

  it('titles the range with its year', () => {
    expect(compactAgendaTitle(days, 'UTC').year).toBe(new Intl.DateTimeFormat(undefined, { year: 'numeric', timeZone: 'UTC' }).format(new Date('2026-11-02T12:00:00Z')))
    expect(compactAgendaTitle(days, 'UTC').title).toContain(' - ')
  })
})

describe('compactIgnoresCommand', () => {
  it('ignores view keys and search, which have nothing on screen to act on', () => {
    for (const command of ['view-day', 'view-week', 'view-month', 'view-agenda', 'search'] as const) {
      expect(compactIgnoresCommand(command, false)).toBe(true)
      expect(compactIgnoresCommand(command, true)).toBe(true)
    }
  })

  it('lets Delete act only on an event that is open', () => {
    expect(compactIgnoresCommand('delete-selected-event', false)).toBe(true)
    expect(compactIgnoresCommand('delete-selected-event', true)).toBe(false)
  })

  it('leaves the rest alone', () => {
    for (const command of ['new-event', 'today', 'previous-range', 'next-range', 'close-inspector', 'undo-last-change'] as const) {
      expect(compactIgnoresCommand(command, false)).toBe(false)
    }
  })
})
