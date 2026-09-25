import { usePlatformAgentTools } from '@purescience/platform-ui/bridge/react/usePlatformAgentTools'
import { APP_AGENT_LOG_LABEL, APP_AGENT_TOOL_NAMES } from '../agents/catalog'
import { appAgentHandlers } from '../agents/handlers'

export function useAppAgentTools(ready: boolean): void {
  usePlatformAgentTools({
    ready,
    tools: APP_AGENT_TOOL_NAMES,
    logLabel: APP_AGENT_LOG_LABEL,
    handlers: appAgentHandlers,
  })
}
