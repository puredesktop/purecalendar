/**
 * Calendar-list preferences the Google provider needs at FETCH time.
 *
 * The provider is constructed once at boot, but the user can add a
 * shared calendar or remove one at any time afterwards. Rather than
 * rebuilding the provider on every settings change (which would
 * interrupt in-flight syncs), it reads these two lists through getters
 * and the shell keeps them in step with the store.
 */

let extraIds: string[] = []
let removedIds: string[] = []

export function setGoogleCalendarPreferences(next: {
  extraCalendarIds?: string[]
  removedCalendarIds?: string[]
}): void {
  extraIds = [...(next.extraCalendarIds ?? [])]
  removedIds = [...(next.removedCalendarIds ?? [])]
}

export function googleExtraCalendarIds(): string[] {
  return extraIds
}

export function googleRemovedCalendarIds(): string[] {
  return removedIds
}
