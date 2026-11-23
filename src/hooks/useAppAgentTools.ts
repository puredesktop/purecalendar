import { useMemo, useRef } from 'react'
import {
  usePlatformAgentTools,
  type AgentToolHandler,
} from '@purescience/platform-ui/bridge/react/usePlatformAgentTools'
import { APP_AGENT_LOG_LABEL, EXPOSED_TOOL_NAMES } from '../agents/catalog'
import { AgentCalendarToolError } from '../agents/handlers'
import { buildPureCalendarHandlers } from '../agents/operationsRegistry'

export function useAppAgentTools(ready: boolean): void {
  const registryHandlersRef = useRef<Record<string, AgentToolHandler> | null>(
    null,
  )
  if (!registryHandlersRef.current) {
    registryHandlersRef.current = buildPureCalendarHandlers()
  }

  const exposedHandlers = useMemo(
    () =>
      Object.fromEntries(
        EXPOSED_TOOL_NAMES.map(name => [
          name,
          async (invoke: Parameters<AgentToolHandler>[0]) =>
            registryHandlersRef.current![name]!(invoke),
        ]),
      ),
    [],
  )

  usePlatformAgentTools({
    ready,
    tools: EXPOSED_TOOL_NAMES,
    logLabel: APP_AGENT_LOG_LABEL,
    errorType: AgentCalendarToolError,
    handlers: exposedHandlers,
  })
}
