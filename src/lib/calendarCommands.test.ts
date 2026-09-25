import { describe, expect, it } from 'vitest'
import { calendarCommandForKey } from './calendarCommands'

describe('PureCalendar commands', () => {
  it('resolves shortcut keys', () => {
    expect(calendarCommandForKey('N')).toBe('new-event')
    expect(calendarCommandForKey('/')).toBe('search')
    expect(calendarCommandForKey('T')).toBe('today')
    expect(calendarCommandForKey('ArrowLeft')).toBe('previous-range')
    expect(calendarCommandForKey('ArrowRight')).toBe('next-range')
    expect(calendarCommandForKey('1')).toBe('view-day')
    expect(calendarCommandForKey('2')).toBe('view-week')
    expect(calendarCommandForKey('3')).toBe('view-month')
    // Agenda is a real, reachable view with its own shortcut.
    expect(calendarCommandForKey('4')).toBe('view-agenda')
    expect(calendarCommandForKey('6')).toBeNull()
    expect(calendarCommandForKey('Escape')).toBe('close-inspector')
    expect(calendarCommandForKey('Delete')).toBe('delete-selected-event')
  })

  it('resolves the undo chord with either modifier', () => {
    expect(calendarCommandForKey('z', { metaKey: true })).toBe(
      'undo-last-change',
    )
    expect(calendarCommandForKey('Z', { ctrlKey: true })).toBe(
      'undo-last-change',
    )
    expect(calendarCommandForKey('z')).toBeNull()
  })
})
