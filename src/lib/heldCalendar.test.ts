import { describe, expect, it } from 'vitest'
import { describeQuickEvent, readHeldView } from './heldCalendar'
import type { CalendarEvent } from '../types'

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
