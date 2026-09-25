import { bridge } from '@purescience/platform-ui/bridge/client'
import {
  readCredentialOAuthAccessToken,
  readCredentialStatus,
  type OAuthCredentialStatus,
} from '@purescience/platform-ui/bridge/credentials.mjs'
import { PLATFORM_BRIDGE_METHODS } from '@purescience/platform-ui/bridge/methods'
import type { CalendarSettings } from '../types'

export { bridge }
export type { OAuthCredentialStatus }

const CALENDAR_APP_SLUG = 'calendar'
export const GOOGLE_CREDENTIAL_ID = 'google.oauth'

export function isStandaloneDevMode(): boolean {
  return import.meta.env.DEV && window.parent === window
}

export interface PlatformNetworkFetchRequest {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
}

export interface PlatformNetworkFetchResponse {
  status: number
  ok: boolean
  headers: Record<string, string>
  body: string
}

export async function fetchAppSettings<T extends object>(
  appSlug: string,
): Promise<T> {
  if (isStandaloneDevMode()) {
    const raw = window.localStorage.getItem(`purescience:${appSlug}:settings`)
    return raw ? (JSON.parse(raw) as T) : ({} as T)
  }
  return bridge.call<T>(PLATFORM_BRIDGE_METHODS.SETTINGS_APP_GET, [appSlug])
}

export async function updateAppSettings(
  appSlug: string,
  patch: Record<string, unknown>,
): Promise<void> {
  if (isStandaloneDevMode()) {
    const current = await fetchAppSettings(appSlug)
    window.localStorage.setItem(
      `purescience:${appSlug}:settings`,
      JSON.stringify({ ...current, ...patch }),
    )
    return
  }
  await bridge.call(PLATFORM_BRIDGE_METHODS.SETTINGS_APP_UPDATE, [
    { appSlug, patch },
  ])
}

export async function fetchCalendarSettings(): Promise<
  Partial<CalendarSettings>
> {
  return fetchAppSettings<Partial<CalendarSettings>>(CALENDAR_APP_SLUG)
}

/**
 * Persist the full settings object as one write. There is no read step, so
 * two rapid saves cannot interleave a stale read and silently drop each
 * other's fields — the in-memory store.settings is the canonical copy and
 * this simply flushes it.
 */
export async function saveCalendarSettings(
  settings: Partial<CalendarSettings>,
): Promise<void> {
  await updateAppSettings(CALENDAR_APP_SLUG, settings as Record<string, unknown>)
}

// Calendar store persistence: shell-owned JSON files via the storage bridge
// (durable, disk-backed). Standalone dev mode falls back to localStorage so
// the app still round-trips edits without the shell.
export async function readCalendarStoreFile(
  fileName: string,
): Promise<unknown | null> {
  if (isStandaloneDevMode()) {
    const raw = window.localStorage.getItem(
      `purescience:${CALENDAR_APP_SLUG}:${fileName}`,
    )
    return raw ? (JSON.parse(raw) as unknown) : null
  }
  const result = (await bridge.call(PLATFORM_BRIDGE_METHODS.STORAGE_READ_JSON, [
    { appSlug: CALENDAR_APP_SLUG, fileName },
  ])) as { value?: unknown } | null
  return result?.value ?? null
}

export async function writeCalendarStoreFile(
  fileName: string,
  value: unknown,
): Promise<void> {
  if (isStandaloneDevMode()) {
    window.localStorage.setItem(
      `purescience:${CALENDAR_APP_SLUG}:${fileName}`,
      JSON.stringify(value),
    )
    return
  }
  await bridge.call(PLATFORM_BRIDGE_METHODS.STORAGE_WRITE_JSON, [
    { appSlug: CALENDAR_APP_SLUG, fileName, value },
  ])
}

export async function networkFetch(
  request: PlatformNetworkFetchRequest,
): Promise<PlatformNetworkFetchResponse> {
  if (isStandaloneDevMode()) {
    const response = await fetch(request.url, {
      method: request.method ?? 'GET',
      headers: request.headers,
      body: request.body,
    })
    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })
    return {
      status: response.status,
      ok: response.ok,
      headers,
      body: await response.text(),
    }
  }
  return bridge.call<PlatformNetworkFetchResponse>(
    PLATFORM_BRIDGE_METHODS.NETWORK_FETCH,
    [request],
  )
}

export interface PlatformSaveFileOptions {
  defaultName?: string
  filters?: Array<{ name: string; extensions: string[] }>
}

/**
 * Save text to a user-chosen path via the native picker. In standalone dev
 * mode (no shell) it falls back to a browser download and returns true. Returns
 * false only when the user cancels the native picker.
 */
export async function saveTextFile(
  content: string,
  options: PlatformSaveFileOptions,
): Promise<boolean> {
  if (isStandaloneDevMode()) {
    const blob = new Blob([content], { type: 'text/calendar' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = options.defaultName ?? 'event.ics'
    anchor.click()
    URL.revokeObjectURL(url)
    return true
  }
  const result = await bridge.call<{ path: string | null }>(
    PLATFORM_BRIDGE_METHODS.DIALOG_SAVE_FILE,
    [options],
  )
  if (!result.path) return false
  await bridge.call(PLATFORM_BRIDGE_METHODS.FS_WRITE, [result.path, content])
  return true
}

/**
 * Shell-owned Google credential (shared with PureMail). Renderers only ever
 * see the redacted status and short-lived access tokens.
 */
export async function fetchGoogleCredentialStatus(): Promise<OAuthCredentialStatus> {
  if (isStandaloneDevMode()) {
    return {
      id: GOOGLE_CREDENTIAL_ID,
      kind: 'oauth',
      provider: 'google',
      configured: false,
      connected: false,
      scopes: [],
      needsReconnect: false,
    }
  }
  return readCredentialStatus({ id: GOOGLE_CREDENTIAL_ID })
}

export async function fetchGoogleAccessToken(): Promise<{
  accessToken: string
  expiresAt: number
}> {
  if (isStandaloneDevMode()) {
    throw new Error(
      'Google access tokens need the PureDesktop shell (standalone dev mode has no vault)',
    )
  }
  return readCredentialOAuthAccessToken({ id: GOOGLE_CREDENTIAL_ID })
}


// ---- Platform operations ledger ---------------------------------------------
// Suite-wide record of user/agent interactions in two lanes ('user'|'agent'),
// stored by the shell and rendered live by the PureAssistant tab. Building
// rule (see AGENTS.md "Operations ledger"): record every meaningful user or
// agent interaction this app performs, and when you find legacy activity/feed
// code duplicating this, tag it `DEPRECATED(operations-ledger)` for cleanup.
import {
  listPlatformOperations as listPlatformOperationsBridge,
  onPlatformOperationRecorded as onPlatformOperationRecordedBridge,
  recordPlatformOperation as recordPlatformOperationBridge,
} from '@purescience/platform-ui/bridge/operations'
import type {
  PlatformOperation,
  PlatformOperationInput,
  PlatformOperationsListQuery,
  PlatformOperationsListResult,
} from '@purescience/platform-ui/bridge/operations'

export type {
  PlatformOperation,
  PlatformOperationInput,
  PlatformOperationsListQuery,
  PlatformOperationsListResult,
}

function operationsBridgeAvailable(): boolean {
  return !(import.meta.env.DEV && window.parent === window)
}

/** Record one interaction into the ledger (the shell pins appSlug to this app). */
export async function recordOperation(
  input: PlatformOperationInput,
): Promise<PlatformOperation | null> {
  if (!operationsBridgeAvailable()) return null
  return recordPlatformOperationBridge(input)
}

/** List recorded operations, newest first. */
export async function listOperations(
  query?: PlatformOperationsListQuery,
): Promise<PlatformOperationsListResult> {
  if (!operationsBridgeAvailable()) return { operations: [] }
  return listPlatformOperationsBridge(query)
}

/** Subscribe to live ledger appends. Returns unsubscribe. */
export function onOperationRecorded(
  listener: (operation: PlatformOperation) => void,
): () => void {
  if (!operationsBridgeAvailable()) return () => undefined
  return onPlatformOperationRecordedBridge(listener)
}
