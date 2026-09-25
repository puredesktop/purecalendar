# Filesystem

Permission: `filesystem`

Filesystem helpers read, write, list, rename, delete, and preview files through
the shell.

Import from the generated app bridge:

```ts
import {
  createPlatformFolder,
  deletePlatformFile,
  listPlatformFiles,
  readPlatformTextFile,
  renamePlatformFile,
  writePlatformTextFile,
} from '../../src/bridge/platformBridge'
```

## listPlatformFiles

Lists a folder.

```ts
const listing = await listPlatformFiles('/absolute/folder')
```

Returns:

- `rootPath`: listed folder path.
- `parentPath`: parent folder path or `null`.
- `entries`: file and folder entries with `path`, `name`, `kind`, size,
  modified time, MIME type, extension, and directory flag.

## readPlatformTextFile

Reads a text file.

```ts
const content = await readPlatformTextFile('/absolute/file.md')
```

Returns the file contents as a string.

## writePlatformTextFile

Writes a text file.

```ts
await writePlatformTextFile('/absolute/file.md', '# Notes\n')
```

Returns `{ ok: true }`.

## createPlatformFolder

Creates a folder under a parent directory.

```ts
const folder = await createPlatformFolder('/absolute/parent', 'Project')
```

Returns `{ path }` for the created folder.

## renamePlatformFile

Renames a file or folder within its current parent directory.

```ts
const renamed = await renamePlatformFile('/absolute/file.md', 'renamed.md')
```

Returns `{ path }` for the renamed path.

## deletePlatformFile

Deletes a file or folder.

```ts
await deletePlatformFile('/absolute/file.md')
await deletePlatformFile('/absolute/folder', true)
```

Pass `true` for recursive folder deletion. Returns `{ ok: true }`.

## Preview And Binary Helpers

The same domain also exports:

- `readPlatformFilePreview(path, maxBytes?)`
- `readPlatformFilePreviewUrl(path)`
- `readPlatformFileBinary(path, maxBytes?)`
- `readPlatformFileBinaryDataUrl(path, maxBytes?)`
- `writePlatformFileBinary(path, base64)`
