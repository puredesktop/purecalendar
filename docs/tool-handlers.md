# Tool Handlers

App agent tools have two halves:

- `plugin.json` declares the tool schema for the shell agent.
- app source registers a runtime handler after the iframe bridge is ready.

The names must match exactly.

For the exact edit checklist when adding a new tool, read
[Adding an app agent tool](./howtos/adding-agent-tool.md).

## Generated Structure

When the manifest includes `app.agents.tools`, the generator creates this
structure and wires `useAppAgentTools(ready)` into `src/App.tsx`:

```text
src/
  agents/
    catalog.ts
    handlers/
      index.ts
  hooks/
    useAppAgentTools.ts
```

## Catalog

Generated from manifest tool names:

```ts
export const APP_AGENT_TOOL_NAMES = ['listItems'] as const

export const APP_AGENT_LOG_LABEL = '{{APP_SLUG}}'
```

Keep this list in the same order as `plugin.json` `app.agents.tools`.

## Registration Hook

Generated when tools exist:

```ts
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

Call this hook from `src/App.tsx` after `usePlatformBridge()`:

```ts
useAppAgentTools(ready)
```

## Handler Shape

Generated handlers start as explicit not-implemented tool errors. Replace each
stub with app domain logic.

```ts
import {
  agentToolErrorContent,
  formatAgentToolJson,
  readAgentToolStringArg,
} from '@purescience/platform-ui/bridge/agentToolHelpers'
import type { AgentToolHandler } from '@purescience/platform-ui/bridge/react/usePlatformAgentTools'

const listItems: AgentToolHandler = async invoke => {
  const status = readAgentToolStringArg(invoke.arguments, 'status')

  return {
    content: formatAgentToolJson({
      items: [],
      status: status || null,
    }),
  }
}

export const appAgentHandlers = {
  listItems,
} satisfies Record<string, AgentToolHandler>
```

Return compact JSON for structured data. Return `agentToolErrorContent(message)`
for validation failures that the agent can correct.

## Read Tool Pattern

Read tools return current app state, ids, paths, and exact values needed before a
write. The agent needs stable ids and exact target names.

## Write Tool Pattern

Write tools validate precise targets. A write handler returns a short result
with the changed id/path and enough data for the agent to explain what changed.

Manifest write tools that mutate files, records, external services, or broad app
state set `requiresApproval: true` unless the action is intentionally safe.

## Validation

`npm run puredesktop:check` verifies declared tool names appear in source and in
the built output. For generated tool scaffolds, it also verifies:

- `src/agents/catalog.ts` exports `APP_AGENT_TOOL_NAMES`;
- every manifest tool name appears in the catalog;
- `src/agents/handlers/index.ts` exports `appAgentHandlers`;
- every manifest tool name appears in the handler map;
- `src/hooks/useAppAgentTools.ts` registers with `usePlatformAgentTools`;
- `src/App.tsx` calls `useAppAgentTools(ready)`.

Build before running it:

```bash
npm run build
npm run puredesktop:check
```
