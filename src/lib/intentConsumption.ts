/**
 * Cross-app intent files (`calendar-invite-intents.json`) are one keyed map
 * written by mail and consumed here. Both sides read-modify-write, so a
 * consumer writing back a stale in-memory map can drop intents mail added in
 * the meantime. The consumer therefore re-reads the file immediately before
 * the removal write and deletes ONLY the consumed key from that fresh copy —
 * this helper is the pure "delete only that key" step.
 */
export function intentStoreWithoutKey<T>(
  store: { intents: Record<string, T> },
  key: string,
): { intents: Record<string, T> } {
  if (!(key in store.intents)) return store
  const intents = { ...store.intents }
  delete intents[key]
  return { intents }
}
