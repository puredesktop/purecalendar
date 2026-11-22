import { bridge } from '@purescience/platform-ui/bridge/client'
import { PLATFORM_BRIDGE_METHODS } from '@purescience/platform-ui/bridge/methods'
import type {
  CalendarStore,
  CandidateSlot,
  SchedulingAvailabilityConfig,
  SchedulingBooking,
  SchedulingLink,
  SchedulingLinkKind,
  SchedulingPollVote,
  SchedulingQuestion,
} from '../types'
import { isStandaloneDevMode, writeCalendarStoreFile } from '../bridge/platformBridge'
import { dateKeyInTimeZone, eventsInRange, instantFromZonedWallTime, normalizeAvailabilitySettings } from './calendarModel'

export const SCHEDULING_CATALOG_FILE = 'scheduling-catalog.json'

export interface SchedulingCloudStatus {
  connected: boolean
  publicUrl: string | null
  organisation: string | null
  host: { id: string; name: string; email: string | null } | null
  linkCount: number
  busyUpdatedAt: number | null
}

export interface SchedulingListResult {
  links: SchedulingLink[]
  bookings: SchedulingBooking[]
  pollVotes: Record<string, SchedulingPollVote[]>
}

export interface SchedulingCatalogSnapshot {
  updatedAt: string
  timeZone: string
  cloudConnected: boolean
  links: Array<{
    id: string
    kind: SchedulingLinkKind
    title: string
    url: string
    durations: number[]
    defaultDuration: number
    active: boolean
    localOnly?: boolean
  }>
  /** Upcoming 30-min open slots in the next 7 days for one-click insertion in PureMail. */
  upcomingFreeSlots: CandidateSlot[]
}

export interface MailComposeAttachment {
  id: string
  name: string
  mimeType: string
  sizeLabel: string
  contentBase64: string
}

export interface PureMailComposePayload {
  to?: Array<{ email: string; name?: string }>
  cc?: Array<{ email: string; name?: string }>
  subject?: string
  body?: string
  attachments?: MailComposeAttachment[]
}

export function cloudSchedulingOffered(): boolean {
  if (isStandaloneDevMode()) return false
  try {
    return bridge.getMethods().includes(PLATFORM_BRIDGE_METHODS.CLOUD_CALL)
  } catch {
    return false
  }
}

async function callScheduling<T>(action: string, input?: Record<string, unknown>): Promise<T> {
  return bridge.call<T>(PLATFORM_BRIDGE_METHODS.CLOUD_CALL, [
    { service: 'scheduling', action, ...(input ? { input } : {}) },
  ])
}

export const schedulingCloud = {
  async status(): Promise<SchedulingCloudStatus> {
    if (!cloudSchedulingOffered()) {
      return { connected: false, publicUrl: null, organisation: null, host: null, linkCount: 0, busyUpdatedAt: null }
    }
    try {
      return await callScheduling<SchedulingCloudStatus>('status')
    } catch {
      return { connected: false, publicUrl: null, organisation: null, host: null, linkCount: 0, busyUpdatedAt: null }
    }
  },
  list: () => callScheduling<SchedulingListResult>('list'),
  create: (input: {
    kind: SchedulingLinkKind
    title: string
    slug?: string
    description?: string
    location?: string
    hostTimeZone: string
    durations?: number[]
    defaultDuration?: number
    availability?: SchedulingAvailabilityConfig
    candidateSlots?: CandidateSlot[]
    questions?: SchedulingQuestion[]
    requireConfirmation?: boolean
  }) => callScheduling<{ link: SchedulingLink }>('create', input),
  update: (input: Record<string, unknown> & { id: string }) => callScheduling<{ link: SchedulingLink }>('update', input),
  remove: (id: string) => callScheduling<{ ok: true }>('remove', { id }),
  syncBusy: (intervals: Array<{ start: string; end: string }>) =>
    callScheduling<{ ok: true; count: number; updatedAt: number }>('syncBusy', { intervals }),
  confirmBooking: (id: string) => callScheduling<{ booking: SchedulingBooking }>('confirmBooking', { id }),
  cancelBooking: (id: string) => callScheduling<{ booking: SchedulingBooking }>('cancelBooking', { id }),
  finalizePoll: (linkId: string, startsAt: string, endsAt: string) =>
    callScheduling<{ booking: SchedulingBooking; participants: Array<{ name: string; email: string; timeZone: string; vote: string }> }>(
      'finalizePoll',
      { linkId, startsAt, endsAt },
    ),
}

export function defaultSchedulingAvailability(store: CalendarStore): SchedulingAvailabilityConfig {
  const norm = normalizeAvailabilitySettings(store.settings)
  const pad = (h: number) => `${String(h).padStart(2, '0')}:00`
  const weekdays: Record<string, Array<{ start: string; end: string }>> = {}
  for (const day of norm.availableDays) {
    weekdays[String(day)] = [{ start: pad(norm.availableStartHour), end: pad(norm.availableEndHour) }]
  }
  return {
    weekdays,
    dateOverrides: {},
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    minNoticeMinutes: 60,
    maxBookingsPerDay: null,
    rollingDays: 30,
    slotStepMinutes: 15,
  }
}

/**
 * Extract ONLY anonymized busy intervals ({ start, end }) from visible calendars.
 * Event titles, descriptions, attendees, and locations NEVER leave the user's calendar.
 */
export function buildAnonymizedBusyIntervals(
  store: CalendarStore,
  fromIso: string,
  toIso: string,
  timeZone: string,
): Array<{ start: string; end: string }> {
  const visible = new Set(store.calendars.filter(c => c.visible).map(c => c.id))
  const events = eventsInRange(
    store.events.filter(e => visible.has(e.calendarId)),
    fromIso,
    toIso,
  )
  const raw: Array<{ start: number; end: number }> = []
  for (const ev of events) {
    if (ev.status === 'cancelled' || ev.busyStatus === 'free') continue
    if (ev.allDay) {
      const startKey = /^\d{4}-\d{2}-\d{2}$/.test(ev.startsAt)
        ? ev.startsAt
        : dateKeyInTimeZone(ev.startsAt, timeZone)
      const s = Date.parse(instantFromZonedWallTime(startKey, 0, 0, timeZone))
      raw.push({ start: s, end: s + 86_400_000 })
    } else {
      const s = Date.parse(ev.startsAt)
      const e = Date.parse(ev.endsAt)
      if (Number.isFinite(s) && Number.isFinite(e) && e > s) raw.push({ start: s, end: e })
    }
  }
  raw.sort((a, b) => a.start - b.start)
  const merged: Array<{ start: number; end: number }> = []
  for (const item of raw) {
    const last = merged[merged.length - 1]
    if (last && item.start <= last.end) last.end = Math.max(last.end, item.end)
    else merged.push({ ...item })
  }
  return merged.map(i => ({ start: new Date(i.start).toISOString(), end: new Date(i.end).toISOString() }))
}

/** Compute upcoming 30-min open slots across the next 5 working days for PureMail's quick-insert composer. */
export function computeUpcomingOpenSlots(
  store: CalendarStore,
  timeZone: string,
  now: Date = new Date(),
  durationMinutes = 30,
  maxSlots = 18,
): CandidateSlot[] {
  const norm = normalizeAvailabilitySettings(store.settings)
  const fromIso = now.toISOString()
  const toIso = new Date(now.getTime() + 10 * 86_400_000).toISOString()
  const busy = buildAnonymizedBusyIntervals(store, fromIso, toIso, timeZone).map(b => ({
    start: Date.parse(b.start),
    end: Date.parse(b.end),
  }))
  const earliestMs = now.getTime() + 30 * 60_000
  const todayKey = dateKeyInTimeZone(now, timeZone)
  const slots: CandidateSlot[] = []
  const [ty, tm, td] = todayKey.split('-').map(Number)

  for (let offset = 0; offset < 10 && slots.length < maxSlots; offset++) {
    const dayDate = new Date(Date.UTC(ty!, tm! - 1, td! + offset))
    const dayKey = dayDate.toISOString().slice(0, 10)
    if (!norm.availableDays.includes(dayDate.getUTCDay())) continue
    let addedToday = 0
    for (let h = norm.availableStartHour; h < norm.availableEndHour && slots.length < maxSlots && addedToday < 4; h++) {
      const startIso = instantFromZonedWallTime(dayKey, h, 0, timeZone)
      const s = Date.parse(startIso)
      const e = s + durationMinutes * 60_000
      if (s < earliestMs) continue
      if (busy.some(b => b.start < e && b.end > s)) continue
      slots.push({ start: new Date(s).toISOString(), end: new Date(e).toISOString() })
      addedToday++
    }
  }
  return slots
}

/**
 * Publish PureCalendar's active booking links & upcoming free slots into shared storage
 * so PureMail's composer can insert links and multi-timezone availability in one click.
 */
export async function publishSchedulingCatalog(
  store: CalendarStore,
  links: SchedulingLink[],
  timeZone: string,
  cloudConnected: boolean,
): Promise<SchedulingCatalogSnapshot> {
  const snapshot: SchedulingCatalogSnapshot = {
    updatedAt: new Date().toISOString(),
    timeZone,
    cloudConnected,
    links: links
      .filter(l => l.active)
      .map(l => ({
        id: l.id,
        kind: l.kind,
        title: l.title,
        url: l.url,
        durations: l.durations,
        defaultDuration: l.defaultDuration,
        active: l.active,
        ...(l.localOnly ? { localOnly: true } : {}),
      })),
    upcomingFreeSlots: computeUpcomingOpenSlots(store, timeZone),
  }
  try {
    await writeCalendarStoreFile(SCHEDULING_CATALOG_FILE, snapshot)
  } catch {
    // Best-effort cross-app publishing.
  }
  return snapshot
}

/**
 * Hand off a pre-populated email (proposed multi-TZ slots, booking link, or .ics invite)
 * directly to PureMail via mail/compose-intents.json + WORKSPACE_OPEN_APP.
 */
export async function openPureMailCompose(payload: PureMailComposePayload): Promise<{ opened: boolean; fallbackText?: string }> {
  const id = `cal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const entry = {
    id,
    sourceAppSlug: 'calendar',
    to: payload.to ?? [],
    ...(payload.cc?.length ? { cc: payload.cc } : {}),
    ...(payload.subject ? { subject: payload.subject } : {}),
    ...(payload.body ? { body: payload.body } : {}),
    ...(payload.attachments?.length ? { attachments: payload.attachments } : {}),
    createdAt: new Date().toISOString(),
  }

  if (isStandaloneDevMode()) {
    try {
      const key = 'purescience:mail:compose-intents.json'
      const existing = JSON.parse(window.localStorage.getItem(key) ?? '{"entries":{}}') as { entries?: Record<string, unknown> }
      window.localStorage.setItem(key, JSON.stringify({ entries: { ...(existing.entries ?? {}), [id]: entry } }))
    } catch {}
    return { opened: false, fallbackText: payload.body }
  }

  const read = (await bridge.call(PLATFORM_BRIDGE_METHODS.STORAGE_READ_JSON, [
    { appSlug: 'mail', fileName: 'compose-intents.json' },
  ])) as { value?: { entries?: Record<string, unknown> } | null; version?: string | null } | null

  const entries = { ...((read?.value?.entries as Record<string, unknown> | undefined) ?? {}), [id]: entry }
  await bridge.call(PLATFORM_BRIDGE_METHODS.STORAGE_WRITE_JSON, [
    {
      appSlug: 'mail',
      fileName: 'compose-intents.json',
      value: { entries },
      ...(read?.version !== undefined ? { ifMatch: read.version } : {}),
    },
  ])
  await bridge.call(PLATFORM_BRIDGE_METHODS.WORKSPACE_OPEN_APP, [
    { appSlug: 'mail', resourceId: `purescience://mail/compose/${id}` },
  ])
  return { opened: true }
}

export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}
