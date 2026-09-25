# Persisting App State

PureDesktop apps persist non-document state through UI bridge helpers. This
state is app-owned: the app defines the TypeScript type, default value, parser,
and update commands.

## State Surfaces

| State | Helper | Permission |
| --- | --- | --- |
| Small app preferences | `usePlatformAppSettings` | `settings` |
| Internal JSON records | `usePlatformJsonStore` | `filesystem` |

Use document lifecycle APIs for user-visible documents, drafts, recents, rename,
duplicate, and open/save workflows.

## Generated App Wiring

The generated app already has the bridge readiness boundary:

- `src/App.tsx` calls `usePlatformBridge()` and receives `ready`.
- `src/App.tsx` calls `useAppBoot(ready || standaloneDev)`.
- `src/hooks/useAppBoot.ts` loads startup settings through the app bridge.
- `src/components/AppShell.tsx` receives boot data as props.

Use that structure instead of adding bridge calls inside components.

When state is read once at startup, `useAppBoot` can load it and pass it down.
When state can change while the app is open, create a dedicated hook in
`src/hooks/` that calls the platform helper and exposes typed commands.

## Add Editable App Settings

1. Create or reuse the domain folder under `src/lib/<domain>/`.
2. Define the settings type, default value, and parser in that domain folder.
3. Create `src/hooks/use<Domain>Settings.ts`.
4. Inside that hook, call `usePlatformAppSettings`.
5. Pass `APP_SLUG` and the bridge `ready` value to the hook.
6. Return typed settings plus app-specific command functions.
7. Components call those command functions; they do not build settings patches.

Hook shape:

```text
use real domain settings type
call usePlatformAppSettings with APP_SLUG, ready, default settings, parser
return settings, loading, error
return field-specific commands that call patchSettings
```

Field-specific commands own the settings patch. Components call the command; they
do not assemble the patch object.

## Add An Internal JSON Store

1. Add `filesystem` to `plugin.json`.
2. Create or reuse the domain folder under `src/lib/<domain>/`.
3. Define the store type, empty value, parser, and pure update helpers in that
   domain folder.
4. Create `src/hooks/use<Domain>Store.ts`.
5. Inside that hook, call `usePlatformJsonStore`.
6. Use a file name that includes `APP_SLUG` and the real persisted record name.
7. Return typed store state plus app-specific command functions.
8. Components call those command functions; they do not edit raw JSON objects.

Hook shape:

```text
use real domain store type
call usePlatformJsonStore with APP_SLUG, ready, file name, empty store, parser
return store, loading, saving, error
return domain commands that call updateValue with pure update functions
```

Domain commands own the store update. Components call the command; they do not
edit raw JSON objects. Store update functions must return new store objects.

## App Settings

Import:

```ts
import { usePlatformAppSettings } from '@purescience/platform-ui/bridge/react/usePlatformAppSettings'
```

Use for small app preferences such as current mode, sorting, filtering, and
lightweight options.

Options:

```ts
{
  appSlug: string | null
  enabled?: boolean
  initialSettings?: TSettings
  parse?: (value: Record<string, unknown>) => TSettings
}
```

Returns:

```ts
{
  settings: TSettings
  loading: boolean
  error: Error | null
  patchSettings: (patch: Record<string, unknown>) => Promise<TSettings>
  reload: () => void
}
```

Behavior:

- loads through `settings.app.get`;
- saves through `settings.app.update`;
- `patchSettings` shallow-merges the patch in shell preferences;
- the shell stores app settings under the current app slug;
- the app parser converts persisted `Record<string, unknown>` into the app's
  typed settings object.

App ownership:

- keep the settings type in app code;
- keep defaults and parsing in app code;
- expose typed settings and typed commands to components;
- use app settings for preferences, not large record collections.

## JSON Store

Import:

```ts
import { usePlatformJsonStore } from '@purescience/platform-ui/bridge/react/usePlatformJsonStore'
```

Use for internal app records that are larger than settings and are not
user-visible documents.

Options:

```ts
{
  appSlug: string | null
  fileName: `${string}.json` | null
  initialValue: TValue
  enabled?: boolean
  parse?: (value: unknown) => TValue
}
```

Returns:

```ts
{
  value: TValue
  path: string | null
  loading: boolean
  saving: boolean
  error: Error | null
  saveValue: (next: TValue) => Promise<TValue>
  updateValue: (updater: (current: TValue) => TValue) => Promise<TValue>
  reload: () => void
}
```

Behavior:

- loads through `storage.readJson`;
- saves through `storage.writeJson`;
- missing files load as `initialValue`;
- saved values replace the full JSON value;
- `updateValue` queues writes and applies each updater to the latest in-memory
  value;
- `fileName` must be a single `.json` file name;
- the JSON file is stored in the shell-managed appdata folder.

App ownership:

- include `filesystem` in `plugin.json`;
- keep the store type in app code;
- keep defaults, parsing, and pure update functions in app code;
- use an app-prefixed file name with the real persisted record name;
- expose typed state and typed commands to components;
- never mutate the current store object in place.

## File Shape

Use one `src/lib/<domain>/` folder per persisted domain. Do not put types,
defaults, parsing, pure updates, platform hooks, and UI in one file.

```text
src/
  hooks/
    use<Domain>Settings.ts
    use<Domain>Store.ts
  lib/
    <domain>/
      types.ts
      defaults.ts
      parse.ts
      updates.ts
      index.ts
  components/
```

Responsibilities:

- `types.ts` exports the persisted domain types.
- `defaults.ts` exports default settings or empty store values.
- `parse.ts` converts unknown persisted values into valid domain state.
- `updates.ts` contains pure functions that return new state objects.
- `index.ts` re-exports the domain pieces used outside the folder.
- `src/hooks/use<Domain>Settings.ts` calls `usePlatformAppSettings`.
- `src/hooks/use<Domain>Store.ts` calls `usePlatformJsonStore`.
- components import the app-owned hooks and render state.

Split a file when it starts owning more than one responsibility. The hook should
not define the domain model. Components should not parse persisted data. Pure
update functions should not call platform helpers.

## Verification

Run:

```bash
npm run typecheck
npm run build
npm run puredesktop:check
```

Source checks:

- app settings state has a domain settings type, default value, parser, and
  hook;
- JSON store state has a domain store type, empty value, parser, pure update
  helpers, and hook;
- components import the app-owned hooks instead of platform persistence helpers;
- `usePlatformJsonStore` is only imported from app-owned hooks;
- apps using `usePlatformJsonStore` include `filesystem` in `plugin.json`;
- JSON store file names include `APP_SLUG` and the real persisted record name;
- JSON store update functions return new objects instead of mutating existing
  state.
