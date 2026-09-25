// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import type { CalendarStore } from '../types'

/**
 * The agent tools write through a dispatch. They used to build a whole new
 * store from their own snapshot and send it as a VALUE, so anything that
 * changed the store in between — an ICS feed refresh runs every five minutes
 * — was overwritten. The persist effect then saved the surviving version, so
 * the agent's event was gone after a reload as well.
 *
 * This models the two shapes against the same interleaving.
 */
describe('an agent write racing a feed refresh', () => {
  const base = { events: [{ id: 'existing' }] } as unknown as CalendarStore

  const runRace = (
    dispatchFromAgent: (
      snapshot: CalendarStore,
      apply: (store: CalendarStore) => void,
    ) => void,
  ): string[] => {
    let live = base
    const commit = (updater: unknown): void => {
      live =
        typeof updater === 'function'
          ? (updater as (prev: CalendarStore) => CalendarStore)(live)
          : (updater as CalendarStore)
    }
    // The agent reads the store…
    const snapshot = live
    // …a feed refresh lands before the agent's dispatch…
    commit((prev: CalendarStore) => ({
      ...prev,
      events: [...prev.events, { id: 'from-feed' }],
    }) as CalendarStore)
    // …then the agent writes.
    dispatchFromAgent(snapshot, commit)
    return live.events.map(event => event.id)
  }

  it('loses a write when the agent dispatches its own snapshot', () => {
    const ids = runRace((snapshot, apply) => {
      apply({
        ...snapshot,
        events: [...snapshot.events, { id: 'from-agent' }],
      } as CalendarStore)
    })
    // The feed's event is gone — and this is the version that gets persisted.
    expect(ids).toEqual(['existing', 'from-agent'])
    expect(ids).not.toContain('from-feed')
  })

  it('keeps both when the agent dispatches an updater', () => {
    const ids = runRace((_snapshot, apply) => {
      apply(((prev: CalendarStore) => ({
        ...prev,
        events: [...prev.events, { id: 'from-agent' }],
      })) as unknown as CalendarStore)
    })
    expect(ids).toEqual(['existing', 'from-feed', 'from-agent'])
  })
})
