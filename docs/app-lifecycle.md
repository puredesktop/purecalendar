# App Lifecycle

A PureDesktop app is loaded into an iframe by the shell. The shell discovers the
app from `plugin.json`, opens a workspace tab, loads the entrypoint URL or built
static bundle, then establishes the bridge handshake with the iframe.

## Registration To Render

1. The shell scans installed app folders for `plugin.json`.
2. The catalog creates one app entry from `plugin.json` `app.slug`.
3. Opening the app creates a workspace tab.
4. The tab renders the app entrypoint in an iframe.
5. The iframe starts React from `src/main.tsx`.
6. `src/App.tsx` calls `usePlatformBridge()`.
7. The bridge client sends a handshake to the shell parent window.
8. The shell replies with `ready` metadata, including `pluginId`, `appSlug`,
   allowed method names, theme CSS, and optional viewport resource.
9. The app boot hook loads app settings and other startup data.
10. The app renders inside `AppFrame`.

## App.tsx Contract

`src/App.tsx` is the orchestration boundary. Keep it thin:

- call `usePlatformBridge()`;
- allow standalone browser dev mode when needed;
- call the app boot hook after the bridge is ready;
- render loading and error states inside `AppFrame`;
- render the app shell inside `AppFrame` after boot succeeds.

The template already follows this shape.

## Viewport Resources

When the shell opens a file or app resource into a tab, the bridge ready metadata
can include:

```ts
{
  viewport: {
    tabId: string
    resource: { path: string; name: string; kind: string } | null
  }
}
```

File-centric apps use `usePlatformViewportResource(ready, meta)` from the bridge
React helpers. This handles cold opens and warm `resource.open` events without
duplicating event wiring in screens.

## Standalone Dev

The template supports browser-only development with:

```ts
window.parent === window
```

Standalone mode is for UI iteration. Production app behavior runs inside the
shell iframe and uses shell bridge permissions.
