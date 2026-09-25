# Adding An App Agent Tool

App agent tools are a three-file contract. A tool is not available until the
manifest, registration catalog, and runtime handler all contain the same name.

## Edit Sequence

1. Add the tool declaration to `plugin.json` under `app.agents.tools`.
   Include a clear `description`, an `inputSchema`, and `requiresApproval`.
   Set `requiresApproval: true` for writes that mutate app data, files,
   external services, or broad app state.

2. Add the same tool name to `src/agents/catalog.ts`.
   `APP_AGENT_TOOL_NAMES` is the list registered with the shell at runtime. Keep
   it in the same order as `plugin.json` `app.agents.tools`.

3. Add the same tool name to `src/agents/handlers/index.ts`.
   Implement the handler with app-owned state or domain helpers. Return compact
   JSON for reads and a short result for writes. Return
   `agentToolErrorContent(message)` for invalid input the assistant can correct.

4. Update `agents.md` when the app assistant needs to know when or how to use
   the tool.

5. Run checks:

   ```bash
   npm run typecheck
   npm run build
   npm run puredesktop:check
   ```

During dev mode, `npm run typecheck` is enough to catch TypeScript errors, but
`npm run puredesktop:check` only proves the final package after `npm run build`
refreshes `dist`.

## Existing Tool Scaffold

For apps that already have tools, these files already exist:

```text
src/
  agents/
    catalog.ts
    handlers/
      index.ts
  hooks/
    useAppAgentTools.ts
```

Only edit `plugin.json`, `src/agents/catalog.ts`,
`src/agents/handlers/index.ts`, and optionally `agents.md`.

## First Tool In An App

If `src/agents/` does not exist, create the scaffold:

```ts
// src/agents/catalog.ts
export const APP_AGENT_TOOL_NAMES = ['listItems'] as const

export const APP_AGENT_LOG_LABEL = '{{APP_SLUG}}'
```

```ts
// src/agents/handlers/index.ts
import { agentToolErrorContent } from '@purescience/platform-ui/bridge/agentToolHelpers'
import type { AgentToolHandler } from '@purescience/platform-ui/bridge/react/usePlatformAgentTools'

const listItems: AgentToolHandler = async () => {
  return agentToolErrorContent('listItems is not implemented yet.')
}

export const appAgentHandlers = {
  listItems,
} satisfies Record<string, AgentToolHandler>
```

```ts
// src/hooks/useAppAgentTools.ts
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
```

Then wire the hook in `src/App.tsx` immediately after `usePlatformBridge()`:

```ts
const { error: bridgeError, ready } = usePlatformBridge()
useAppAgentTools(ready)
```

## Common Failure

Do not update only `plugin.json` and the handler. If `APP_AGENT_TOOL_NAMES`
does not include the new tool, the iframe never registers it with the shell. The
assistant will see a declared tool that the running app cannot handle.
