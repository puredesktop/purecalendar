import { describe, expect, it } from 'vitest'
import { demoCalendarStore, ensureLocalCalendar, firstEditableCalendarId, isLocalCalendar, LOCAL_CALENDAR_ID } from './calendarModel'

describe('the calendar on this computer', () => {
  it('is there to write to when nothing else is, and is marked as local', () => {
    const empty = demoCalendarStore()
    expect(firstEditableCalendarId(empty)).toBe('')
    const { store, calendarId } = ensureLocalCalendar(empty)
    expect(calendarId).toBe(LOCAL_CALENDAR_ID)
    expect(firstEditableCalendarId(store)).toBe(LOCAL_CALENDAR_ID)
    expect(isLocalCalendar(store, LOCAL_CALENDAR_ID)).toBe(true)
    expect(ensureLocalCalendar(store).store).toBe(store)
  })

  it('gives way to a connected calendar as the default', () => {
    const { store } = ensureLocalCalendar(demoCalendarStore())
    const withGoogle = {
      ...store,
      accounts: [...store.accounts, { id: 'g', provider: 'google', name: 'Work', email: 'a@b.c' }],
      sources: [...store.sources, { id: 'gs', accountId: 'g', name: 'Work', syncState: 'online' }],
      calendars: [...store.calendars, { id: 'work', sourceId: 'gs', name: 'Work', color: '#000', visible: true }],
    } as typeof store
    expect(firstEditableCalendarId(withGoogle)).toBe('work')
    expect(isLocalCalendar(withGoogle, 'work')).toBe(false)
  })
})
