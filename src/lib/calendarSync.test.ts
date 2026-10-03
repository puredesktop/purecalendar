import { describe, expect, it } from 'vitest'
import { calendarFixture } from '../test/calendarFixtures'
import { mergeCalendarPushResult } from './calendarSync'

function pushFixture() {
  const store = calendarFixture()
  const event = { ...store.events[0]!, id: 'local-new', source: 'provider' as const, syncState: 'pending' as const }
  const pushed = { ...store, events: [event] }
  const confirmed = { ...event, id: 'g:cal_work:remote-new', syncState: 'synced' as const }
  return { pushed, confirmed, result: { ...pushed, events: [confirmed] } }
}

describe('push acknowledgements during local changes', () => {
  it('keeps a newer edit with the confirmed identity, so the next push updates instead of creates', () => {
    const { pushed, confirmed, result } = pushFixture()
    const current = { ...pushed, events: [{ ...pushed.events[0]!, title: 'Changed while creating' }] }
    const merged = mergeCalendarPushResult(current, pushed, result)
    expect(merged.events[0]).toMatchObject({ id: confirmed.id, title: 'Changed while creating', syncState: 'pending' })
  })

  it('queues deletion of a remote event created after its local copy was deleted', () => {
    const { pushed, confirmed, result } = pushFixture()
    const current = { ...pushed, events: [], removedEventIds: ['g:other:keep'] }
    const merged = mergeCalendarPushResult(current, pushed, result)
    expect(merged.events).toEqual([])
    expect(merged.removedEventIds).toEqual(['g:other:keep', confirmed.id])
  })

  it('removes only deletions confirmed by this push, retaining newer deletes', () => {
    const { pushed } = pushFixture()
    pushed.removedEventIds = ['g:cal:confirmed', 'g:cal:failed']
    const result = { ...pushed, removedEventIds: ['g:cal:failed'] }
    const current = { ...pushed, removedEventIds: [...pushed.removedEventIds, 'g:cal:new'] }
    expect(mergeCalendarPushResult(current, pushed, result).removedEventIds).toEqual(['g:cal:failed', 'g:cal:new'])
  })

  it('does not mark edits during a failed push synced, or overwrite them', () => {
    const { pushed } = pushFixture()
    const current = { ...pushed, events: [{ ...pushed.events[0]!, title: 'Newer' }] }
    const result = { ...pushed, events: [{ ...pushed.events[0]!, syncState: 'failed' as const }] }
    expect(mergeCalendarPushResult(current, pushed, result).events).toEqual(current.events)
  })
})
