# UI And Components

The generated app starts with a small starter workspace so the iframe has a
useful screen while the first builder task runs. Treat the starter as temporary
scaffold, not product UI.

`src/App.tsx` owns bridge readiness and `AppFrame`. `src/components/AppShell.tsx`
is the thin composition root after boot succeeds. Do not turn either file into
the product implementation.

## AppFrame

Every render path in `src/App.tsx` uses `AppFrame`. This gives the iframe the
PureDesktop reset, theme CSS variables, and shell-compatible surface styling.

## App Structure

Use the first real product task to replace the starter workspace with app-owned
surfaces. Keep responsibilities split:

- `src/App.tsx`: bridge readiness, boot loading, error states, and `AppFrame`.
- `src/components/AppShell.tsx`: thin composition root that wires boot data into
  product surfaces.
- `src/components/*`: product screens, panels, lists, editors, dialogs, and
  controls.
- `src/hooks/*`: reusable workflow state, effects, synchronization, and bridge
  orchestration.
- `src/lib/*`: domain types, reducers, rules, transforms, fixtures, and tests.

Start with controlled, simple modules:

```text
src/
  components/
    AppShell.tsx
    StarterWorkspace.tsx       # replace when the first product surface exists
    ProjectBoard.tsx
    ProjectDetail.tsx
  hooks/
    useProjects.ts
  lib/
    projects.ts
    projects.test.ts
```

Keep state local only while it is display-only. When state drives multiple
components, persistence, agent tools, bridge calls, or domain rules, move it into
an app hook or `src/lib` module before adding more screens.

## Platform Components

Import shared UI by exact exported package paths before creating custom
primitives. Use existing app folders before creating new ones.

Useful starting points:

- `AppFrame` from `@purescience/platform-ui/components/common/containers/AppFrame`
- `EmptyState` from `@purescience/platform-ui/components/common/feedback/EmptyState`
- `Heading` from `@purescience/platform-ui/components/common/typography/Heading`
- `Text` from `@purescience/platform-ui/components/common/typography/Text`
- `Button` from `@purescience/platform-ui/components/common/buttons/Button`
- `DocumentEditor` from `@purescience/platform-ui/editor`

For rich writing surfaces, review workflows, markdown/HTML documents, and
document-specific toolbar controls, see
[Using the document editor](./howtos/using-document-editor.md).

## Styling

Use styled-components and platform CSS variables:

```ts
const Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--platform-spacing-md);
  color: var(--platform-colors-text);
  background: var(--platform-colors-bg);
`
```

Use app-local CSS variables only for app-specific meaning, for example
`--{{APP_SLUG}}-accent`.

See [Theme CSS variables](./theme-vars.md) for the generated list of available
platform variables by domain.

Avoid inline styles except for tiny dynamic values that cannot be represented as
props on a styled component.
