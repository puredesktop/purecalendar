import { useEffect, useRef } from 'react'
import { AppFrame } from '@purescience/platform-bridge/components/AppFrame'
import { EmptyState } from '@purescience/platform-ui/components/common/feedback/EmptyState'
import { usePlatformBridge } from '@purescience/platform-ui/bridge/react/usePlatformBridge'
import { usePlatformViewportResource } from '@purescience/platform-ui/bridge/react/usePlatformViewportResource'
import { PureCalendarShell } from './components/PureCalendarShell'
import { useAppAgentTools } from './hooks/useAppAgentTools'
import { usePureCalendarBoot } from './hooks/usePureCalendarBoot'
import { setAgentStore } from './agents/handlers'
import type { CalendarStore } from './types'

function isStandaloneDevMode(): boolean {
  return import.meta.env.DEV && window.parent === window
}

export function App(): React.ReactElement {
  const { error: bridgeError, ready, meta } = usePlatformBridge()
  useAppAgentTools(ready)
  const standalone = isStandaloneDevMode()
  const appReady = ready || standalone
  const { store, calendarProvider, notice, bootError } =
    usePureCalendarBoot(appReady)
  const storeRef = useRef<CalendarStore | null>(null)
  useEffect(() => {
    storeRef.current = store
    setAgentStore(storeRef)
    return () => {
      storeRef.current = null
      setAgentStore(null)
    }
  }, [store])
  const { resource, clearResource } = usePlatformViewportResource(
    ready && !standalone,
    meta,
  )

  if (bridgeError && !standalone) {
    return (
      <AppFrame>
        <EmptyState
          tone="error"
          title="Bridge unavailable"
          message={bridgeError.message}
        />
      </AppFrame>
    )
  }

  if (bootError) {
    return (
      <AppFrame>
        <EmptyState
          tone="error"
          title="PureCalendar boot failed"
          message={bootError.message}
        />
      </AppFrame>
    )
  }

  if (!appReady || !store) {
    return (
      <AppFrame>
        <EmptyState
          tone="neutral"
          title="PureCalendar"
          message="Loading calendar workspace..."
        />
      </AppFrame>
    )
  }

  return (
    <AppFrame>
      <PureCalendarShell
        initialStore={store}
        calendarProvider={calendarProvider}
        {...(notice ? { bootNotice: notice } : {})}
        resource={resource}
        onResourceHandled={clearResource}
      />
    </AppFrame>
  )
}
