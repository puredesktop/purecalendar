import { useEffect, useState } from 'react'
import { bridge } from '../bridge/platformBridge'
import { PLATFORM_BRIDGE_METHODS } from '@purescience/platform-ui/bridge/methods'

/** A shell that never answers must not leave the whole app without its background work. */
const ANSWER_WAIT_MS = 3_000

const heldInMessage = (app: unknown): boolean => (app as { heldInRoom?: unknown } | null)?.heldInRoom === true

/**
 * May this copy run the app's background work (syncing Google, feeds and the team calendar, reminders, taking in invites)?
 *
 * A copy held in a page runs beside any normal tab of the same app, so only the normal tab does it. Inside a room the
 * frame is nested, which is known at once, and stays true when it grows to the full app: it is still a second copy. On the
 * Personal agent's page the shell hosts it directly, so that answer has to be asked for: nothing starts until it is
 * known, because work started in those first moments is exactly what would double up.
 */
export function useBackgroundWork(): boolean {
  const [allowed, setAllowed] = useState(() => window.parent === window)
  useEffect(() => {
    if (window.parent === window || window.parent !== window.top) return
    let disposed = false
    let held = false
    const settle = (app: unknown): void => {
      if (disposed || held) return
      if (heldInMessage(app)) held = true
      else setAllowed(true)
    }
    const receive = (event: MessageEvent): void => {
      if (event.source !== window.parent || event.data?.type !== 'pure:adjacent-app' || !heldInMessage(event.data.app)) return
      held = true
      setAllowed(false)
    }
    window.addEventListener('message', receive)
    const timer = window.setTimeout(() => settle(null), ANSWER_WAIT_MS)
    void bridge.call(PLATFORM_BRIDGE_METHODS.WORKSPACE_ADJACENT_APP).then(settle, () => settle(null))
    return () => {
      disposed = true
      window.clearTimeout(timer)
      window.removeEventListener('message', receive)
    }
  }, [])
  return allowed
}
