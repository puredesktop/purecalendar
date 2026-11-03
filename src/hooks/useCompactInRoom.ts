import { useAdjacentApp } from '@purescience/platform-ui/bridge/react/useAdjacentApp'

/**
 * True only while this copy is held inside a page (a room, the Personal agent's
 * page), where it shows the compact agenda. Beside an app in split view, or grown
 * to the full app over the room, it is the whole app.
 */
export function useCompactInRoom(): boolean {
  return useAdjacentApp()?.heldInRoom === true
}
