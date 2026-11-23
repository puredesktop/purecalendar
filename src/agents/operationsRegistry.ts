import {
  createAppOperationsRegistry,
  defineAppTool,
  type AppAtomicToolDefinition,
  type BuildHandlersOptions,
} from '@purescience/platform-ui/bridge/appFunctions'
import type {
  AgentToolHandler,
  AgentToolHandlerResult,
  AgentToolInvokeContext,
} from '@purescience/platform-ui/bridge/react/usePlatformAgentTools'
import { PURECALENDAR_ATOMIC_TOOL_SCHEMAS } from './atomicToolSchemas'
import { PURECALENDAR_FUNCTIONS } from './functions'
import {
  AgentCalendarToolError,
  appAgentHandlers,
  getDefaultCalendarToolContext,
  type CalendarAgentToolContext,
} from './handlers'

type AtomicRunner = (
  ctx: CalendarAgentToolContext,
  args: Record<string, unknown>,
  invoke: AgentToolInvokeContext,
) => AgentToolHandlerResult | Promise<AgentToolHandlerResult>

const ATOMIC_RUNNERS: Record<string, AtomicRunner> = {
  listCalendarEvents: (_ctx, args, invoke) =>
    appAgentHandlers.listCalendarEvents({ ...invoke, arguments: args }),
  searchCalendar: (_ctx, args, invoke) =>
    appAgentHandlers.searchCalendar({ ...invoke, arguments: args }),
  getCalendarSettings: (_ctx, args, invoke) =>
    appAgentHandlers.getCalendarSettings({ ...invoke, arguments: args }),
  createCalendarDraft: (_ctx, args, invoke) =>
    appAgentHandlers.createCalendarDraft({ ...invoke, arguments: args }),
  updateCalendarEvent: (_ctx, args, invoke) =>
    appAgentHandlers.updateCalendarEvent({ ...invoke, arguments: args }),
  deleteCalendarEvent: (_ctx, args, invoke) =>
    appAgentHandlers.deleteCalendarEvent({ ...invoke, arguments: args }),
  rescheduleCalendarEvent: (_ctx, args, invoke) =>
    appAgentHandlers.rescheduleCalendarEvent({ ...invoke, arguments: args }),
  activateCalendarEvent: (_ctx, args, invoke) =>
    appAgentHandlers.activateCalendarEvent({ ...invoke, arguments: args }),
  findMeetingTimes: (_ctx, args, invoke) =>
    appAgentHandlers.findMeetingTimes({ ...invoke, arguments: args }),
  createMeetingDraft: (_ctx, args, invoke) =>
    appAgentHandlers.createMeetingDraft({ ...invoke, arguments: args }),
}

const atomicTools: AppAtomicToolDefinition<CalendarAgentToolContext>[] =
  PURECALENDAR_ATOMIC_TOOL_SCHEMAS.map(schema =>
    defineAppTool<CalendarAgentToolContext>({
      ...schema,
      run: async (ctx, args, invoke) => {
        const runner = ATOMIC_RUNNERS[schema.name]
        if (!runner) {
          throw new AgentCalendarToolError(
            `Missing atomic tool handler for "${schema.name}".`,
          )
        }
        return runner(ctx, args, invoke)
      },
    }),
  )

/**
 * PureCalendar's unified Operations Registry built on `@purescience/platform-ui/bridge/appFunctions`:
 *   - 4 composite `function` workflows (`fn_*`, always exposed)
 *   - 6 core & release-gated atomic tools (always exposed)
 *   - 3 universal escape-hatch meta-tools (always exposed)
 *   - 4 extended specialist atomic tools (hidden by default, 100% reachable on demand)
 */
export const PURECALENDAR_OPERATIONS_REGISTRY =
  createAppOperationsRegistry<CalendarAgentToolContext>({
    appSlug: 'calendar',
    appName: 'PureCalendar',
    functions: PURECALENDAR_FUNCTIONS,
    tools: atomicTools,
  })

export function buildPureCalendarHandlers(
  getCtx: () => CalendarAgentToolContext = getDefaultCalendarToolContext,
  options: BuildHandlersOptions<CalendarAgentToolContext> = {},
): Record<string, AgentToolHandler> {
  return PURECALENDAR_OPERATIONS_REGISTRY.buildHandlers(getCtx, {
    createError: message => new AgentCalendarToolError(message),
    recordOperation: (ctx, kind, summary) => {
      ctx.recordOperation(`calendar.${kind}`, summary)
    },
    ...options,
  })
}
