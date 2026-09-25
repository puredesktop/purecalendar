# Storage

Permission: `filesystem`

Storage helpers read and write JSON files in the shell-managed PureDesktop data
folder. These helpers use the same bridge path as the exposed
`storage.readJson` and `storage.writeJson` methods.

Import from the generated app bridge:

```ts
import {
  readPlatformStorageJson,
  writePlatformStorageJson,
} from '../../src/bridge/platformBridge'
```

## readPlatformStorageJson

Reads an app JSON store file.

```ts
const result = await readPlatformStorageJson({
  appSlug: APP_SLUG,
  fileName: 'items.json',
})
```

Returns:

- `path`: resolved storage path.
- `value`: parsed JSON value, or `null` when the file is absent.

## writePlatformStorageJson

Writes an app JSON store file.

```ts
await writePlatformStorageJson({
  appSlug: APP_SLUG,
  fileName: 'items.json',
  value: { items: [] },
})
```

Returns `{ path, ok: true }`.

Storage file names must be file names ending with `.json`.
