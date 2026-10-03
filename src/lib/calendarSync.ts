import type { CalendarEvent, CalendarStore } from '../types'

/** Provider.sync preserves event order. Keep confirmed remote identities even
 * when the user edits or deletes a newly created event while the push runs. */
export function mergeCalendarPushResult(
  current: CalendarStore,
  pushed: CalendarStore,
  result: CalendarStore,
): CalendarStore {
  const replacements = new Map<string, { original: CalendarEvent; next: CalendarEvent }>()
  pushed.events.forEach((original, index) => {
    const next = result.events[index]
    if (next && next !== original) replacements.set(original.id, { original, next })
  })
  const remaining = new Set(result.removedEventIds ?? [])
  const confirmedDeletes = new Set((pushed.removedEventIds ?? []).filter(id => !remaining.has(id)))
  const tombstones = new Set((current.removedEventIds ?? []).filter(id => !confirmedDeletes.has(id)))
  const currentIds = new Set(current.events.map(event => event.id))
  for (const [id, { next }] of replacements) {
    if (!currentIds.has(id) && next.syncState === 'synced') tombstones.add(next.id)
  }
  const events = current.events.map(event => {
    const replacement = replacements.get(event.id)
    if (!replacement) return event
    const { original, next } = replacement
    if (JSON.stringify(event) === JSON.stringify(original)) return next
    if (next.syncState !== 'synced') return event
    // Moving to another calendar cannot be represented as a PATCH of the
    // confirmed identity. Keep the edit visibly conflicted for review.
    return {
      ...event,
      id: next.id,
      syncState: event.calendarId === original.calendarId ? 'pending' as const : 'conflict' as const,
    }
  })
  if (replacements.size === 0 && confirmedDeletes.size === 0) return current
  return { ...current, events, removedEventIds: [...tombstones] }
}
