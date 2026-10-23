import { bridge } from '@purescience/platform-ui/bridge/client'
import {
  readCredentialOAuthAccessToken,
  readCredentialStatus,
  type OAuthCredentialStatus,
} from '@purescience/platform-ui/bridge/credentials.mjs'
import { PLATFORM_BRIDGE_METHODS } from '@purescience/platform-ui/bridge/methods'
import { PLATFORM_BRIDGE_EVENTS } from '@purescience/platform-ui/bridge/events.mjs'
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

/**
 * Opens PureMeet on this event. The event's facts travel in the resource id
 * (URL-safe base64 of a small JSON), so PureMeet needs no access to the
 * calendar store: it finds or creates the meeting for the event itself.
 */
export async function openMeetingForEvent(event: {
  id: string
  title: string
  startsAt: string
  endsAt: string
  attendees: { name: string; email: string }[]
  projectId?: string
}): Promise<void> {
  const payload = JSON.stringify({
    v: 1,
    calendarEventId: event.id,
    title: event.title,
    start: event.startsAt,
    end: event.endsAt,
    attendees: event.attendees.map(person => ({ name: person.name, email: person.email })),
    ...(event.projectId ? { projectId: event.projectId } : {}),
  })
  const bytes = new TextEncoder().encode(payload)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  // PureMeet matches open requests by suffix, so the payload comes first and `.event` last.
  const resourceId = `${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.event`
  await bridge.call(PLATFORM_BRIDGE_METHODS.WORKSPACE_OPEN_APP, [{ appSlug: 'meet', resourceId }])
}

/**
 * The organisation's team calendar (PureServer, through the host): meetings
 * booked with teammates and the team's important dates. Only where the person
 * has joined an organisation; `available: false` anywhere else.
 */
export interface TeamCalendarEvent {
  id: string
  kind: 'meeting' | 'date'
  title: string
  start: string
  end: string
  allDay: boolean
  location: string | null
  notes: string | null
  team: { id: string; name: string } | null
  attendees: Array<{ id: string; name: string; response: 'invited' | 'yes' | 'no' | 'maybe' }>
  createdBy: { id: string; name: string }
  revision: number
  updatedAt: number
  mayEdit: boolean
}
export interface TeamCalendarListing {
  available: boolean
  organisation: string | null
  me: { id: string; name: string } | null
  events: TeamCalendarEvent[]
  people: Array<{ id: string; name: string }>
  teams: Array<{ id: string; name: string }>
}
export interface TeamCalendarInput {
  id?: string
  ifRevision?: number
  kind: 'meeting' | 'date'
  title: string
  start: string
  end: string
  allDay: boolean
  location: string | null
  notes: string | null
  teamId: string | null
  attendees: string[]
}
type Clash = { id: string; title: string; people: string[] }
export type TeamCalendarSaved = { event: TeamCalendarEvent; clashes?: Clash[] }

export function teamCalendarOffered(): boolean {
  try {
    return bridge.getMethods().includes(PLATFORM_BRIDGE_METHODS.TEAM_CALENDAR_LIST)
  } catch {
    return false
  }
}
export const teamCalendar = {
  list: (range: { from?: string; to?: string } = {}) =>
    bridge.call(PLATFORM_BRIDGE_METHODS.TEAM_CALENDAR_LIST, [range]) as Promise<TeamCalendarListing>,
  create: (input: TeamCalendarInput) =>
    bridge.call(PLATFORM_BRIDGE_METHODS.TEAM_CALENDAR_CREATE, [input]) as Promise<TeamCalendarSaved>,
  update: (input: TeamCalendarInput & { id: string }) =>
    bridge.call(PLATFORM_BRIDGE_METHODS.TEAM_CALENDAR_UPDATE, [input]) as Promise<TeamCalendarSaved>,
  respond: (id: string, response: 'yes' | 'no' | 'maybe') =>
    bridge.call(PLATFORM_BRIDGE_METHODS.TEAM_CALENDAR_RESPOND, [{ id, response }]) as Promise<{ event: TeamCalendarEvent }>,
  remove: (id: string) =>
    bridge.call(PLATFORM_BRIDGE_METHODS.TEAM_CALENDAR_REMOVE, [id]) as Promise<unknown>,
  busy: (people: string[], from: string, to: string) =>
    bridge.call(PLATFORM_BRIDGE_METHODS.TEAM_CALENDAR_BUSY, [{ people, from, to }]) as Promise<{
      busy: Array<{ id: string; name: string; times: Array<{ start: string; end: string }> }>
    }>,
}
/** The team calendar changed where this person sees it. Returns unsubscribe. */
export function onTeamCalendarChanged(listener: () => void): () => void {
  try {
    return bridge.onEvent(PLATFORM_BRIDGE_EVENTS.TEAM_CALENDAR_CHANGED, () => listener())
  } catch {
    return () => undefined
  }
}
