# PureDesktop App Builder Docs

This folder is the builder-facing contract for generated PureDesktop apps.

A generated app is a Vite + React application rendered by PureDesktop inside a
workspace iframe. The app owns its UI, state, domain logic, and optional tool
handlers. The shell owns discovery, tabs, bridge permissions, filesystem and OS
services, agent sessions, and app registration.

Read these in order when building or repairing an app:

1. [App lifecycle](./app-lifecycle.md)
2. [Plugin manifest](./plugin-manifest.md)
3. [Bridge helpers](./bridge/README.md)
4. [App agent](./agent.md)
5. [Tool handlers](./tool-handlers.md)
6. [Adding an app agent tool](./howtos/adding-agent-tool.md)
7. [UI and components](./ui-and-components.md)
8. [Using the document editor](./howtos/using-document-editor.md)
9. [Theme CSS variables](./theme-vars.md)

Key files in this scaffold:

- `plugin.json`: app identity, entrypoint, permissions, file routing, and agent
  tool declarations.
- `agents.md`: app-scoped assistant instructions used by shell agent sessions.
- `src/App.tsx`: bridge readiness, boot loading, and `AppFrame` wrapper.
- `src/bridge/platformBridge.ts`: local app bridge surface.
- `src/hooks/useAppBoot.ts`: app boot data loading after the bridge is ready.
- `src/components/AppShell.tsx`: thin app-owned composition root.
- `src/components/StarterWorkspace.tsx`: temporary starter screen to replace
  when the first product surface exists.
- `src/lib/starterWorkspace.ts`: starter data/helper example showing where
  reusable non-rendering logic belongs.
- `scripts/validate-puredesktop-app.mjs`: registration and tool scaffold check.

Use `npm run puredesktop:check` after `npm run build` before registration.
