/**
 * The timed grid's paint order.
 *
 * Everything in the week/day grid — the sticky day headers, event blocks,
 * the now marker, resize handles — is a sibling in one stacking context,
 * so the header stays on top only while its z-index is the highest here.
 * It was 1, under the event blocks' 2, and events scrolled straight over
 * the day and date. Add a layer here rather than writing a bare number at
 * a styled-component, and keep the sticky header the highest.
 */
export const GRID_Z_EVENT = 2
export const GRID_Z_NOW_MARKER = 3
export const GRID_Z_RESIZE_HANDLE = 4
export const GRID_Z_DRAGGING_EVENT = 5
/** The sticky header row: above every layer that scrolls beneath it. */
export const GRID_Z_STICKY_HEADER = 6

/** Every layer that scrolls under the sticky header row. */
export const GRID_SCROLLING_LAYERS = [
  GRID_Z_EVENT,
  GRID_Z_NOW_MARKER,
  GRID_Z_RESIZE_HANDLE,
  GRID_Z_DRAGGING_EVENT,
] as const
