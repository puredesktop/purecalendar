import { describe, expect, it } from 'vitest'
import { intentStoreWithoutKey } from './intentConsumption'

describe('intentStoreWithoutKey', () => {
  it('removes only the consumed key, keeping concurrent additions', () => {
    // Simulates the race: the consumer loaded intent "a", then mail added
    // "b" before the consumer wrote its removal. Re-reading fresh and
    // deleting only "a" preserves "b".
    const fresh = { intents: { a: 1, b: 2 } }
    expect(intentStoreWithoutKey(fresh, 'a')).toEqual({ intents: { b: 2 } })
    // Input is not mutated.
    expect(fresh.intents).toEqual({ a: 1, b: 2 })
  })

  it('returns the store unchanged when the key is already gone', () => {
    const store = { intents: { b: 2 } }
    expect(intentStoreWithoutKey(store, 'a')).toBe(store)
  })
})
