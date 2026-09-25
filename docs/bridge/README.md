# Platform Bridge Helpers

The bridge is the app iframe's RPC channel to the PureDesktop shell.

The generated app runs in an iframe. It cannot call shell internals directly.
Instead, app code imports helpers from `src/bridge/platformBridge.ts`. That
local bridge module wraps the package bridge client from
`@purescience/platform-ui`.

## Runtime Boundary

```text
App iframe -> bridge helper -> postMessage -> shell renderer -> shell handler
```

The shell validates the app origin, method name, and `plugin.json` permissions
before running a handler.

## Ready Handshake

`src/App.tsx` uses `usePlatformBridge()` to wait for the shell:

```ts
const { ready, error, meta } = usePlatformBridge()
```

The shell ready payload includes:

- `pluginId`: plugin package identity.
- `appSlug`: app API scope.
- `methods`: bridge methods available in this shell.
- `theme`: injected theme CSS.
- `viewport`: optional tab resource opened into the app.

Call bridge helpers after `ready` is true. The template boot hook follows that
pattern.

## Local Bridge Module

`src/bridge/platformBridge.ts` is the app's bridge boundary. Components and
feature code import from that local file:

```ts
import { fetchAppSettings, networkFetch } from '../bridge/platformBridge'
```

Keep request-shape knowledge in this bridge folder. Component code calls
domain-named helpers.

`platformBridge.ts` is both the exported app bridge surface and the place for
app-owned bridge wrappers. Package bridge helpers are imported as local bindings
first, then re-exported for app code. App-specific wrappers in this file should
call those local bindings.

## Helper Domains

- [Dialog](./dialog.md)
- [Filesystem](./fs.md)
- [Network](./network.md)
- [Settings](./settings.md)
- [Storage](./storage.md)

## Permissions

Bridge calls are gated by top-level `plugin.json` `permissions`.

| Permission | Helper domains |
| --- | --- |
| `settings` | settings and preferences |
| `filesystem` | filesystem, dialogs, storage, file routing |
| `network` | network requests and OAuth-style flows |
| `render` | print and render helpers |
| `assets` | asset library helpers |
| `agents` | agent sessions, agent tools, credentials |

## Events

The bridge also delivers shell events into the iframe. Common app events include
theme changes, viewport resource opens, render progress, filesystem watch
changes, agent run events, and app tool invocations.

Use the package React hooks when they exist. For example,
`usePlatformViewportResource(ready, meta)` handles file opens without manual
event wiring.
