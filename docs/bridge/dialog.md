# Dialog

Permission: `filesystem`

Dialog helpers open shell-native file and folder pickers.

Import from the generated app bridge:

```ts
import {
  openPlatformFileDialog,
  openPlatformFolderDialog,
  openPlatformImageDialog,
  savePlatformFolderDialog,
} from '../../src/bridge/platformBridge'
```

## openPlatformFolderDialog

Opens a folder picker.

```ts
const folderPath = await openPlatformFolderDialog()
```

Returns the selected absolute folder path, or `null` when cancelled.

## savePlatformFolderDialog

Opens a folder picker configured for choosing a parent directory.

```ts
const parentPath = await savePlatformFolderDialog()
```

Returns the selected absolute folder path, or `null` when cancelled.

## openPlatformImageDialog

Opens an image file picker.

```ts
const imagePath = await openPlatformImageDialog()
```

Returns the selected absolute image path, or `null` when cancelled.

## openPlatformFileDialog

Opens a text/document file picker.

```ts
const filePath = await openPlatformFileDialog()
```

Returns the selected absolute file path, or `null` when cancelled.
