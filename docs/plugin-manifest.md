# Plugin Manifest

`plugin.json` is the shell contract for discovery, permissions, routing, and app
agent tools.

## Required Shape

```json
{
  "schemaVersion": 1,
  "id": "{{PLUGIN_ID}}",
  "name": "{{APP_TITLE}}",
  "permissions": ["network", "settings", "filesystem", "agents"],
  "entrypoint": {
    "kind": "dev-url",
    "url": "http://localhost:{{APP_PORT}}"
  },
  "app": {
    "id": "plugin.{{APP_SLUG}}",
    "slug": "{{APP_SLUG}}",
    "name": "{{APP_TITLE}}",
    "navigationLabel": "{{APP_TITLE}}",
    "productName": "pure.{{APP_SLUG}}",
    "kind": "{{APP_SLUG}}",
    "description": "{{APP_TITLE}} - built with PureDesktop.",
    "usePureDesktopAiPanel": true
  }
}
```

`app.slug` is the API scope for settings, storage, app agent sessions, and tab
routing. `src/constants.ts` `APP_SLUG` must match `plugin.json` `app.slug`.

## Entrypoint

Development apps use:

```json
{
  "entrypoint": {
    "kind": "dev-url",
    "url": "http://localhost:{{APP_PORT}}"
  }
}
```

Built apps use a static bundle registered from `dist/`. The validator checks the
build output before registration.

## Permissions

Declare every shell capability used by bridge helpers:

| Permission | Enables |
| --- | --- |
| `settings` | `settings.*`, app settings, user preferences |
| `filesystem` | `fs.*`, `dialog.*`, `storage.*`, file open routing |
| `network` | `network.fetch`, hosted entrypoints, OAuth helpers |
| `render` | document render and print helpers |
| `assets` | asset library helpers |
| `agents` | app agent sessions and runtime tool handlers |

## App Agent Tools

Declare app-owned tools under `app.agents.tools`:

```json
{
  "app": {
    "agents": {
      "tools": [
        {
          "name": "listItems",
          "description": "List the current items with ids, titles, status, and next action.",
          "inputSchema": {
            "type": "object",
            "properties": {
              "status": {
                "type": "string",
                "description": "Optional status filter."
              }
            },
            "additionalProperties": false
          },
          "requiresApproval": false
        }
      ]
    }
  }
}
```

The manifest declaration exposes the tool to the shell agent. Runtime handler
registration in the iframe executes the tool.

## Validation

Run:

```bash
npm run typecheck
npm run build
npm run puredesktop:check
```

The validator checks manifest identity, required scripts and dependencies,
`agents.md`, `app.usePureDesktopAiPanel`, permissions, built output, and declared
agent tool presence in source and dist.
