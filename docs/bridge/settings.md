# Settings

Permission: `settings`

Settings helpers read and update user preferences through the shell. App
settings are stored inside user preferences under the current app's slug.

Import from the generated app bridge:

```ts
import {
  getPlatformAppSettings,
  getPlatformPreferences,
  patchPlatformPreferences,
  updatePlatformAppSettings,
} from '../../src/bridge/platformBridge'
```

## getPlatformAppSettings

Reads settings for the current app slug.

```ts
const settings = await getPlatformAppSettings(APP_SLUG)
```

The shell allows plugin frames to access only their own app settings.

## updatePlatformAppSettings

Patches settings for the current app slug.

```ts
const next = await updatePlatformAppSettings({
  appSlug: APP_SLUG,
  patch: { workspacePath: '/absolute/folder' },
})
```

Returns the merged app settings object.

## getPlatformPreferences

Reads shell user preferences.

```ts
const prefs = await getPlatformPreferences()
```

Common fields include the working directory, theme, app settings, user profile,
and agent defaults.

## patchPlatformPreferences

Patches shell user preferences.

```ts
const next = await patchPlatformPreferences({
  theme: 'dark',
})
```

Returns the merged user preferences object.
