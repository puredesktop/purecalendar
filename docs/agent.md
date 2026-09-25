# App Agent

Every generated app has an app-scoped assistant that runs in the shell agent
drawer. The app does not render its own agent chat UI by default.

## Source Files

- `agents.md`: app-scoped assistant prompt.
- `plugin.json` `app.agents.tools`: tool schemas exposed to the agent.
- `src/agents/*`: generated app-owned tool catalog and handlers when tools
  exist.
- `src/hooks/useAppAgentTools.ts`: generated runtime registration hook when
  tools exist.

## How The Agent Uses App Tools

1. The shell reads `plugin.json` and includes declared app tools in the app
   agent's available tools.
2. The app iframe loads and registers runtime handlers with
   `usePlatformAgentTools`.
3. The agent calls a declared tool during a shell-managed session.
4. The shell routes the invocation to the app iframe.
5. The app handler returns compact text or JSON.
6. The bridge helper completes the tool call back to the shell.
7. The shell resumes the agent session.

The app owns the handler implementation. The shell owns session state,
approvals, routing, and completion.

When `plugin.json` contains `app.agents.tools`, the create-app generator writes
the initial catalog, handler map, and registration hook. The generated handlers
return explicit not-implemented tool errors until the app replaces them with real
domain behavior.

## agents.md

Keep `agents.md` grounded in the app's real UI and data. Mention the app's work
objects, read-first workflow, write safety rules, and expected concise output.

Example:

```md
# {{APP_TITLE}} Agent

You are the app-scoped assistant for {{APP_TITLE}}.

Help the user understand, review, and act on the work inside this app. Stay
grounded in the app UI and data. Prefer concise answers, concrete next actions,
and safe tool use.
```

## Approval Policy

Set `requiresApproval` on each manifest tool. Read-only inspection tools usually
set `false`. Destructive, external-effect, or broad write tools set `true`.

The shell drawer displays approvals and resumes the same session after the user
approves or rejects.
