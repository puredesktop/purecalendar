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
  | 'view-week'
  | 'view-month'
  | 'view-agenda'

/**
 * Keyboard shortcut → command. This is the whole surface: the shell's keydown
 * handler is the only consumer (a richer command-metadata catalogue existed
 * here once, but nothing ever rendered it).
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
])

export function calendarCommandForKey(
  key: string,
  modifiers: { metaKey?: boolean; ctrlKey?: boolean } = {},
): CalendarCommandId | null {
  if ((modifiers.metaKey || modifiers.ctrlKey) && key.toLowerCase() === 'z') {
    return 'undo-last-change'
  }
  return COMMANDS_BY_SHORTCUT.get(key.toLowerCase()) ?? null
}
