export type CalendarCommandId =
  | 'new-event'
  | 'search'
  | 'undo-last-change'
  | 'today'
  | 'previous-range'
  | 'next-range'
  | 'close-inspector'
  | 'delete-selected-event'
  | 'view-day'
  | 'view-three-day'
  | 'view-week'
  | 'view-month'
  | 'view-agenda'
  | 'share-availability'
  | 'find-time'
  | 'booking-links'
  | 'toggle-left-rail'
  | 'command-palette'

/**
 * Keyboard shortcut → command. This is the whole surface: the shell's keydown
 * handler is the only consumer.
 */
const COMMANDS_BY_SHORTCUT = new Map<string, CalendarCommandId>([
  ['n', 'new-event'],
  ['/', 'search'],
  ['t', 'today'],
  ['arrowleft', 'previous-range'],
  ['arrowright', 'next-range'],
  ['escape', 'close-inspector'],
  ['delete', 'delete-selected-event'],
  ['1', 'view-day'],
  ['2', 'view-week'],
  ['3', 'view-month'],
  ['4', 'view-agenda'],
  ['5', 'view-three-day'],
  ['d', 'view-day'],
  ['w', 'view-week'],
  ['m', 'view-month'],
  ['a', 'view-agenda'],
  ['s', 'share-availability'],
  ['f', 'find-time'],
  ['l', 'booking-links'],
  ['[', 'toggle-left-rail'],
])

export function calendarCommandForKey(
  key: string,
  modifiers: {
    metaKey?: boolean
    ctrlKey?: boolean
    altKey?: boolean
    shiftKey?: boolean
  } = {},
): CalendarCommandId | null {
  const lower = key.toLowerCase()
  if ((modifiers.metaKey || modifiers.ctrlKey) && !modifiers.altKey) {
    if (lower === 'z' && !modifiers.shiftKey) {
      return 'undo-last-change'
    }
    if (lower === 'k' && !modifiers.shiftKey) {
      return 'command-palette'
    }
    return null
  }
  if (modifiers.altKey) return null
  return COMMANDS_BY_SHORTCUT.get(lower) ?? null
}
