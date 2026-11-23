import {
  defineAppFunction,
  type AppFunctionDefinition,
} from '@purescience/platform-ui/bridge/appFunctions'
import {
  allDayEventPatch,
  calendarSyncSummary,
  canEditCalendarEvent,
  createDraftEvent,
  dateKeyInTimeZone,
  ensureLocalCalendar,
  eventsInRange,
  firstEditableCalendarId,
  instantFromZonedWallTime,
  isDraftEvent,
  isValidTimeZone,
  normalizeAvailabilitySettings,
  parseEventBoundMs,
  removeEventWithTombstone,
  resolveAgentEventTime,
  resolveCalendarTimeZone,
  searchCalendarStore,
  visibleCalendarEvents,
  visibleScheduledTasks,
} from '../lib/calendarModel'
import {
  isTeammateParticipant,
  readParticipantAvailability,
  TEAM_SOURCE,
} from '../lib/meetingAvailability'
import {
  findMeetingTimes as searchMeetingTimes,
  localTimes,
  meetingDraftFlow,
  meetingProposalText,
  meetingRequestKey,
  validateMeetingRequest,
  withMeetingDraft,
  type MeetingParticipantInput,
  type MeetingRequestInput,
  type OwnerCalendarRead,
  type ParticipantAvailability,
} from '../lib/meetingTimes'
import { enumerateDateKeys } from '../lib/overlapMatrix'
import type { CalendarEvent, CalendarStore, EventAttendee } from '../types'
import {
  AgentCalendarToolError,
  readAttendeesArg,
  type CalendarAgentToolContext,
} from './handlers'

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_WINDOW_DAYS = 62
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const HOLD_TITLE_RE = /^hold\b/i

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return Math.max(min, Math.min(max, value))
  }
  return fallback
}

function isRealDateKey(value: string): boolean {
  if (!DATE_KEY_RE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const check = new Date(Date.UTC(y!, m! - 1, d!))
  return check.toISOString().slice(0, 10) === value
}

function addDaysToKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10)
}

function weekdayOfDateKey(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()
}

function resolveDateKeyInput(
  raw: unknown,
  fallbackKey: string,
  timeZone: string,
  label: string,
): string {
  const value = trimmedString(raw)
  if (!value) return fallbackKey
  if (DATE_KEY_RE.test(value)) {
    if (!isRealDateKey(value)) {
      throw new AgentCalendarToolError(
        `"${label}" is not a valid calendar date ("${value}"). Use YYYY-MM-DD.`,
      )
    }
    return value
  }
  const resolved = resolveAgentEventTime(value, timeZone)
  if (!resolved) {
    throw new AgentCalendarToolError(
      `"${label}" ("${value}") must be YYYY-MM-DD or an ISO 8601 date-time string.`,
    )
  }
  return dateKeyInTimeZone(resolved.instant, timeZone)
}

function resolveDayWindow(
  args: Record<string, unknown>,
  timeZone: string,
  now: Date,
  defaultDays: number,
): {
  fromKey: string
  toKey: string
  dateKeys: string[]
  rangeStartIso: string
  rangeEndIso: string
} {
  const todayKey = dateKeyInTimeZone(now, timeZone)
  const fromKey = resolveDateKeyInput(args.from, todayKey, timeZone, 'from')
  const requestedDays = clampInt(args.days, defaultDays, 1, MAX_WINDOW_DAYS)
  const defaultToKey = addDaysToKey(fromKey, requestedDays - 1)
  const toKey = resolveDateKeyInput(args.to, defaultToKey, timeZone, 'to')
  if (toKey < fromKey) {
    throw new AgentCalendarToolError(
      `"to" (${toKey}) cannot be earlier than "from" (${fromKey}).`,
    )
  }
  const daySpan =
    Math.round(
      (Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) /
        DAY_MS,
    ) + 1
  if (daySpan > MAX_WINDOW_DAYS) {
    throw new AgentCalendarToolError(
      `Date window (${daySpan} days) exceeds the ${MAX_WINDOW_DAYS}-day limit. Narrow "from" and "to".`,
    )
  }
  const dateKeys = enumerateDateKeys(fromKey, toKey, MAX_WINDOW_DAYS)
  const rangeStartIso = instantFromZonedWallTime(fromKey, 0, 0, timeZone)
  const rangeEndIso = instantFromZonedWallTime(
    addDaysToKey(toKey, 1),
    0,
    0,
    timeZone,
  )
  return { fromKey, toKey, dateKeys, rangeStartIso, rangeEndIso }
}

function isBusyEvent(event: CalendarEvent): boolean {
  return event.status !== 'cancelled' && event.busyStatus !== 'free'
}

function isHoldEvent(event: CalendarEvent): boolean {
  return Boolean(event.holdGroupId) || HOLD_TITLE_RE.test(event.title.trim())
}

interface TimedEventBounds {
  event: CalendarEvent
  startMs: number
  endMs: number
}

function timedBusyEvents(
  events: readonly CalendarEvent[],
  timeZone: string,
): TimedEventBounds[] {
  const out: TimedEventBounds[] = []
  for (const event of events) {
    if (event.allDay || !isBusyEvent(event)) continue
    const startMs = parseEventBoundMs(event.startsAt, event.timeZone || timeZone)
    const endMs = parseEventBoundMs(event.endsAt, event.timeZone || timeZone)
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      continue
    }
    out.push({ event, startMs, endMs })
  }
  out.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
  return out
}

interface EventConflict {
  date: string
  overlapMinutes: number
  overlapStart: string
  overlapEnd: string
  hasActiveGuests: boolean
  events: Array<{
    id: string
    title: string
    startsAt: string
    endsAt: string
    calendarId: string
    lifecycle: 'draft' | 'active'
    attendeeCount: number
  }>
}

function detectConflicts(
  timed: readonly TimedEventBounds[],
  timeZone: string,
): EventConflict[] {
  const conflicts: EventConflict[] = []
  for (let i = 0; i < timed.length; i++) {
    const a = timed[i]!
    for (let j = i + 1; j < timed.length; j++) {
      const b = timed[j]!
      if (b.startMs >= a.endMs) break
      const overlapStartMs = Math.max(a.startMs, b.startMs)
      const overlapEndMs = Math.min(a.endMs, b.endMs)
      const overlapMinutes = Math.round((overlapEndMs - overlapStartMs) / MINUTE_MS)
      if (overlapMinutes <= 0) continue
      const overlapStart = new Date(overlapStartMs).toISOString()
      const overlapEnd = new Date(overlapEndMs).toISOString()
      const aActiveGuests = !isDraftEvent(a.event) && a.event.attendees.length > 0
      const bActiveGuests = !isDraftEvent(b.event) && b.event.attendees.length > 0
      conflicts.push({
        date: dateKeyInTimeZone(overlapStart, timeZone),
        overlapMinutes,
        overlapStart,
        overlapEnd,
        hasActiveGuests: aActiveGuests || bActiveGuests,
        events: [a.event, b.event].map(ev => ({
          id: ev.id,
          title: ev.title,
          startsAt: ev.startsAt,
          endsAt: ev.endsAt,
          calendarId: ev.calendarId,
          lifecycle: isDraftEvent(ev) ? 'draft' : 'active',
          attendeeCount: ev.attendees.length,
        })),
      })
    }
  }
  return conflicts
}

interface FreeBlock {
  date: string
  startsAt: string
  endsAt: string
  localStart: string
  localEnd: string
  durationMinutes: number
}

function computeDayFreeBlocks(
  dateKey: string,
  events: readonly CalendarEvent[],
  timeZone: string,
  availableDays: readonly number[],
  workStartHour: number,
  workEndHour: number,
  minFreeBlockMinutes: number,
): { blocks: FreeBlock[]; busyMinutesInWorkHours: number; availableDay: boolean } {
  const weekday = weekdayOfDateKey(dateKey)
  if (!availableDays.includes(weekday)) {
    return { blocks: [], busyMinutesInWorkHours: 0, availableDay: false }
  }
  const dayWorkStartMs = Date.parse(
    instantFromZonedWallTime(dateKey, workStartHour, 0, timeZone),
  )
  const dayWorkEndMs =
    workEndHour >= 24
      ? Date.parse(
          instantFromZonedWallTime(addDaysToKey(dateKey, 1), 0, 0, timeZone),
        )
      : Date.parse(instantFromZonedWallTime(dateKey, workEndHour, 0, timeZone))

  if (!Number.isFinite(dayWorkStartMs) || !Number.isFinite(dayWorkEndMs) || dayWorkEndMs <= dayWorkStartMs) {
    return { blocks: [], busyMinutesInWorkHours: 0, availableDay: true }
  }

  const busyIntervals: Array<[number, number]> = []
  for (const ev of events) {
    if (!isBusyEvent(ev)) continue
    const startMs = parseEventBoundMs(ev.startsAt, ev.timeZone || timeZone)
    const endMs = parseEventBoundMs(ev.endsAt, ev.timeZone || timeZone)
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      continue
    }
    const clampedStart = Math.max(dayWorkStartMs, startMs)
    const clampedEnd = Math.min(dayWorkEndMs, endMs)
    if (clampedEnd > clampedStart) {
      busyIntervals.push([clampedStart, clampedEnd])
    }
  }

  busyIntervals.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged: Array<[number, number]> = []
  for (const [s, e] of busyIntervals) {
    const prev = merged[merged.length - 1]
    if (prev && s <= prev[1]) {
      prev[1] = Math.max(prev[1], e)
    } else {
      merged.push([s, e])
    }
  }

  let busyMinutesInWorkHours = 0
  for (const [s, e] of merged) {
    busyMinutesInWorkHours += Math.round((e - s) / MINUTE_MS)
  }

  const blocks: FreeBlock[] = []
  let cursor = dayWorkStartMs
  for (const [s, e] of merged) {
    if (s > cursor) {
      const durationMinutes = Math.round((s - cursor) / MINUTE_MS)
      if (durationMinutes >= minFreeBlockMinutes) {
        const startsAt = new Date(cursor).toISOString()
        const endsAt = new Date(s).toISOString()
        const lt = localTimes(startsAt, endsAt, timeZone)
        blocks.push({
          date: dateKey,
          startsAt,
          endsAt,
          localStart: lt.start,
          localEnd: lt.end,
          durationMinutes,
        })
      }
    }
    cursor = Math.max(cursor, e)
  }
  if (dayWorkEndMs > cursor) {
    const durationMinutes = Math.round((dayWorkEndMs - cursor) / MINUTE_MS)
    if (durationMinutes >= minFreeBlockMinutes) {
      const startsAt = new Date(cursor).toISOString()
      const endsAt = new Date(dayWorkEndMs).toISOString()
      const lt = localTimes(startsAt, endsAt, timeZone)
      blocks.push({
        date: dateKey,
        startsAt,
        endsAt,
        localStart: lt.start,
        localEnd: lt.end,
        durationMinutes,
      })
    }
  }

  return { blocks, busyMinutesInWorkHours, availableDay: true }
}

function summarizeEventForBriefing(event: CalendarEvent, timeZone: string) {
  const lt = localTimes(event.startsAt, event.endsAt, timeZone)
  return {
    id: event.id,
    title: event.title,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    localDate: lt.date,
    localStart: event.allDay ? 'all-day' : lt.start,
    localEnd: event.allDay ? 'all-day' : lt.end,
    allDay: event.allDay,
    calendarId: event.calendarId,
    status: event.status,
    busyStatus: event.busyStatus,
    lifecycle: isDraftEvent(event) ? ('draft' as const) : ('active' as const),
    isHold: isHoldEvent(event),
    holdGroupId: event.holdGroupId ?? null,
    attendeeCount: event.attendees.length,
    location: event.location ?? null,
    recurring: Boolean(event.recurrenceRule),
  }
}

function safeDefaultCalendarId(store: CalendarStore): string | null {
  try {
    return firstEditableCalendarId(store)
  } catch {
    return null
  }
}

function ownerSettingsSnapshot(store: CalendarStore) {
  const tzInfo = resolveCalendarTimeZone(store.settings)
  const availability = normalizeAvailabilitySettings(store.settings)
  return {
    timeZone: tzInfo.timeZone,
    timeZoneMode: tzInfo.mode,
    availableDays: availability.availableDays,
    availableStartHour: availability.availableStartHour,
    availableEndHour: availability.availableEndHour,
    defaultCalendarId: safeDefaultCalendarId(store),
    calendars: store.calendars.map(c => ({
      id: c.id,
      name: c.name,
      visible: c.visible,
      readOnly: c.readOnly === true,
    })),
  }
}

function localMinutesFromIso(iso: string, timeZone: string): number {
  const lt = localTimes(iso, iso, timeZone)
  const [h, m] = lt.start.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

function findSavedContactTimeZone(
  store: CalendarStore,
  email?: string,
  name?: string,
): { timeZone: string; matchedName: string } | null {
  const contacts = store.settings.savedContacts ?? []
  const normEmail = email?.trim().toLowerCase()
  const normName = name?.trim().toLowerCase()
  for (const contact of contacts) {
    if (!isValidTimeZone(contact.timeZone)) continue
    if (normEmail && contact.email?.trim().toLowerCase() === normEmail) {
      return { timeZone: contact.timeZone, matchedName: contact.name }
    }
  }
  if (normName) {
    const matches = contacts.filter(
      contact =>
        isValidTimeZone(contact.timeZone) &&
        contact.name.trim().toLowerCase() === normName,
    )
    if (matches.length === 1) {
      return {
        timeZone: matches[0]!.timeZone,
        matchedName: matches[0]!.name,
      }
    }
  }
  return null
}

/**
 * PureCalendar's 4 high-value composite App Functions (`fn_*`).
 */
export const PURECALENDAR_FUNCTIONS: readonly AppFunctionDefinition<CalendarAgentToolContext>[] =
  [
    defineAppFunction<CalendarAgentToolContext>({
      name: 'fn_scheduleBriefing',
      category: 'agenda',
      risk: 'read',
      requiresApproval: false,
      replaces: ['getCalendarSettings', 'listCalendarEvents', 'searchCalendar'],
      description:
        'Compile a complete schedule briefing for a date window in one read-only call: resolved calendar settings, daily agenda with local times, overlapping busy conflicts, open working-hour focus blocks, pending drafts and tentative holds, visible scheduled tasks, sync health, and optional keyword search results.',
      inputSchema: {
        type: 'object',
        properties: {
          from: {
            type: 'string',
            description: 'Start day (YYYY-MM-DD or ISO 8601). Defaults to today.',
          },
          to: {
            type: 'string',
            description: 'Inclusive end day (YYYY-MM-DD or ISO 8601, max 62-day window).',
          },
          days: {
            type: 'integer',
            minimum: 1,
            maximum: 62,
            description: 'Days to include when "to" is omitted (default 7).',
          },
          calendarId: {
            type: 'string',
            description: 'Optional calendar id filter.',
          },
          query: {
            type: 'string',
            description: 'Optional keyword search included alongside the briefing.',
          },
          includeTasks: {
            type: 'boolean',
            description: 'Include visible scheduled tasks (default true).',
          },
          includeFreeBlocks: {
            type: 'boolean',
            description: 'Compute open working-hour blocks per day (default true).',
          },
          minFreeBlockMinutes: {
            type: 'integer',
            minimum: 15,
            maximum: 480,
            description: 'Minimum free block minutes to report (default 30).',
          },
        },
        additionalProperties: false,
      },
      run: async (ctx, args) => {
        const store = ctx.getStore()
        const now = ctx.now ? ctx.now() : new Date()
        const settings = ownerSettingsSnapshot(store)
        const timeZone = settings.timeZone
        const { fromKey, toKey, dateKeys, rangeStartIso, rangeEndIso } =
          resolveDayWindow(args, timeZone, now, 7)

        const calendarId = trimmedString(args.calendarId) || undefined
        if (calendarId && !store.calendars.some(c => c.id === calendarId)) {
          throw new AgentCalendarToolError(
            `Calendar "${calendarId}" not found.`,
          )
        }

        const events = calendarId
          ? eventsInRange(
              store.events.filter(e => e.calendarId === calendarId),
              rangeStartIso,
              rangeEndIso,
            )
          : visibleCalendarEvents(store, rangeStartIso, rangeEndIso)

        const includeTasks = args.includeTasks !== false
        const includeFreeBlocks = args.includeFreeBlocks !== false
        const minFreeBlockMinutes = clampInt(
          args.minFreeBlockMinutes,
          30,
          15,
          480,
        )

        const timed = timedBusyEvents(events, timeZone)
        const conflicts = detectConflicts(timed, timeZone)

        const byDate = new Map<string, CalendarEvent[]>()
        for (const key of dateKeys) byDate.set(key, [])
        for (const ev of events) {
          const evStartKey = dateKeyInTimeZone(ev.startsAt, timeZone)
          const evEndMs = parseEventBoundMs(ev.endsAt, ev.timeZone || timeZone)
          const evLastKey = Number.isFinite(evEndMs)
            ? dateKeyInTimeZone(new Date(Math.max(0, evEndMs - 1)), timeZone)
            : evStartKey
          for (const key of dateKeys) {
            if (key >= evStartKey && key <= evLastKey) {
              byDate.get(key)!.push(ev)
            }
          }
        }

        let totalFreeMinutes = 0
        let totalFreeBlocks = 0
        const days = dateKeys.map(dateKey => {
          const dayEvents = (byDate.get(dateKey) ?? []).sort(
            (a, b) =>
              parseEventBoundMs(a.startsAt, a.timeZone || timeZone) -
              parseEventBoundMs(b.startsAt, b.timeZone || timeZone),
          )
          const freeInfo = includeFreeBlocks
            ? computeDayFreeBlocks(
                dateKey,
                dayEvents,
                timeZone,
                settings.availableDays,
                settings.availableStartHour,
                settings.availableEndHour,
                minFreeBlockMinutes,
              )
            : {
                blocks: [],
                busyMinutesInWorkHours: 0,
                availableDay: settings.availableDays.includes(
                  weekdayOfDateKey(dateKey),
                ),
              }
          for (const block of freeInfo.blocks) {
            totalFreeMinutes += block.durationMinutes
            totalFreeBlocks += 1
          }
          return {
            date: dateKey,
            availableDay: freeInfo.availableDay,
            eventCount: dayEvents.length,
            busyMinutesInWorkHours: freeInfo.busyMinutesInWorkHours,
            events: dayEvents.map(ev => summarizeEventForBriefing(ev, timeZone)),
            ...(includeFreeBlocks ? { freeBlocks: freeInfo.blocks } : {}),
          }
        })

        const drafts = events
          .filter(isDraftEvent)
          .map(ev => summarizeEventForBriefing(ev, timeZone))
        const holds = events
          .filter(isHoldEvent)
          .map(ev => summarizeEventForBriefing(ev, timeZone))

        const tasks = includeTasks
          ? visibleScheduledTasks(
              store.tasks,
              rangeStartIso,
              rangeEndIso,
              store.calendars,
            ).map(task => ({
              id: task.id,
              title: task.title,
              status: task.status,
              scheduledStart: task.scheduledStart ?? null,
              scheduledEnd: task.scheduledEnd ?? null,
              dueAt: task.dueAt ?? null,
              calendarId: task.calendarId ?? null,
            }))
          : []

        const query = trimmedString(args.query)
        const searchResults = query ? searchCalendarStore(store, query) : null
        const syncSummary = calendarSyncSummary(store)
        const failedCalendarIds = store.failedCalendarIds ?? []

        const freeHours = Math.round((totalFreeMinutes / 60) * 10) / 10
        const summary = `${fromKey}..${toKey} (${timeZone}): ${events.length} event${events.length === 1 ? '' : 's'}, ${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}, ${drafts.length} draft${drafts.length === 1 ? '' : 's'}${includeFreeBlocks ? `, ${totalFreeBlocks} open block${totalFreeBlocks === 1 ? '' : 's'} (${freeHours}h free)` : ''}.`

        return {
          summary,
          mutated: false,
          data: {
            window: { from: fromKey, to: toKey, days: dateKeys.length, timeZone },
            settings,
            totals: {
              events: events.length,
              conflicts: conflicts.length,
              drafts: drafts.length,
              holds: holds.length,
              tasks: tasks.length,
              freeBlocks: totalFreeBlocks,
              freeMinutes: totalFreeMinutes,
            },
            days,
            conflicts,
            drafts,
            holds,
            ...(includeTasks ? { tasks } : {}),
            ...(searchResults !== null
              ? { search: { query, results: searchResults } }
              : {}),
            sync: {
              summary: syncSummary,
              failedCalendarIds,
            },
          },
        }
      },
    }),

    defineAppFunction<CalendarAgentToolContext>({
      name: 'fn_planMeetingSlots',
      category: 'scheduling',
      risk: 'read',
      requiresApproval: false,
      replaces: ['getCalendarSettings', 'listCalendarEvents', 'findMeetingTimes'],
      description:
        "Plan up to three ranked meeting times across time zones in one read-only call without needing getCalendarSettings first. Re-reads the user's visible calendars and any teammate team-calendar free/busy, resolves omitted participant time zones from saved contacts when available (never guessing), returns ranked slots with local times, benefits, trade-offs, availability caveats, copyable proposal text, and owner settings. Show options to the user before drafting.",
      inputSchema: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Meeting title (defaults to "Meeting").',
          },
          durationMinutes: {
            type: 'integer',
            minimum: 1,
            maximum: 720,
            description: 'Meeting length in whole minutes (1..720).',
          },
          from: {
            type: 'string',
            description: 'First day (YYYY-MM-DD in owner zone). Defaults to tomorrow.',
          },
          to: {
            type: 'string',
            description: 'Last day inclusive (YYYY-MM-DD, <62 days after from). Defaults to from + 6 days.',
          },
          participants: {
            type: 'array',
            description:
              'Participants ({name?, email?, timeZone?}). Uses IANA timeZone if given or resolves from saved contacts (never guessed); teammates (<id>@team.invalid) have team busy checked.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                email: { type: 'string' },
                timeZone: { type: 'string' },
              },
            },
          },
          bufferBeforeMinutes: {
            type: 'integer',
            minimum: 0,
            maximum: 240,
            description: 'Clear minutes required before the meeting (0..240).',
          },
          bufferAfterMinutes: {
            type: 'integer',
            minimum: 0,
            maximum: 240,
            description: 'Clear minutes required after the meeting (0..240).',
          },
        },
        required: ['durationMinutes'],
        additionalProperties: false,
      },
      run: async (ctx, args) => {
        let owner: OwnerCalendarRead
        try {
          owner = await ctx.readOwnerNow()
        } catch (error) {
          throw new AgentCalendarToolError(
            `Your calendar could not be read (${error instanceof Error ? error.message : String(error)}), so no times are suggested. Try again.`,
          )
        }

        const now = ctx.now ? ctx.now() : new Date()
        const ownerZone = owner.timeZone
        const tomorrowKey = addDaysToKey(dateKeyInTimeZone(now, ownerZone), 1)
        const fromKey = resolveDateKeyInput(args.from, tomorrowKey, ownerZone, 'from')
        const defaultToKey = addDaysToKey(fromKey, 6)
        const toKey = resolveDateKeyInput(args.to, defaultToKey, ownerZone, 'to')

        const rawParticipants = Array.isArray(args.participants)
          ? args.participants
          : []
        const resolvedParticipants: MeetingParticipantInput[] = []
        const participantSources: Array<{
          label: string
          timeZone: string
          timeZoneSource: 'provided' | 'savedContact'
        }> = []

        for (let i = 0; i < rawParticipants.length; i++) {
          const item = rawParticipants[i]
          if (!item || typeof item !== 'object') {
            throw new AgentCalendarToolError(
              `Participant #${i + 1} must be an object with at least a timeZone (or match a saved contact).`,
            )
          }
          const rec = item as Record<string, unknown>
          const name = trimmedString(rec.name) || undefined
          const email = trimmedString(rec.email) || undefined
          const explicitZone = trimmedString(rec.timeZone)
          if (explicitZone) {
            resolvedParticipants.push({ name, email, timeZone: explicitZone })
            participantSources.push({
              label: name || email || `Participant ${i + 1}`,
              timeZone: explicitZone,
              timeZoneSource: 'provided',
            })
            continue
          }
          const saved = findSavedContactTimeZone(owner.store, email, name)
          if (saved) {
            resolvedParticipants.push({
              name: name || saved.matchedName,
              email,
              timeZone: saved.timeZone,
            })
            participantSources.push({
              label: name || saved.matchedName || email || `Participant ${i + 1}`,
              timeZone: saved.timeZone,
              timeZoneSource: 'savedContact',
            })
            continue
          }
          throw new AgentCalendarToolError(
            `Participant "${name || email || `#${i + 1}`}" has no timeZone and was not found in saved contacts. Ask for their IANA time zone (e.g. Europe/Berlin) rather than guessing.`,
          )
        }

        const input: Partial<MeetingRequestInput> = {
          title: trimmedString(args.title) || undefined,
          durationMinutes: args.durationMinutes as number,
          from: fromKey,
          to: toKey,
          participants: resolvedParticipants,
          bufferBeforeMinutes: args.bufferBeforeMinutes as number | undefined,
          bufferAfterMinutes: args.bufferAfterMinutes as number | undefined,
        }

        const validation = validateMeetingRequest(input)
        if (!validation.ok) {
          throw new AgentCalendarToolError(
            `Not searched: ${validation.errors.join(' ')}`,
          )
        }

        const request = validation.request
        const availability = await readParticipantAvailability(
          request.participants,
          new Date(Date.parse(`${request.from}T00:00:00Z`) - DAY_MS).toISOString(),
          new Date(Date.parse(`${request.to}T00:00:00Z`) + 2 * DAY_MS).toISOString(),
          ctx.getBusyReader(),
          now,
        )

        const result = searchMeetingTimes(input, { ...owner, now }, availability)
        if (!result.ok) {
          throw new AgentCalendarToolError(result.errors.join(' '))
        }

        ctx.searchQualification.set(
          meetingRequestKey(result.request),
          result.availability,
        )

        const options = result.options.map(option => ({
          rank: option.rank,
          startsAt: option.startsAt,
          endsAt: option.endsAt,
          yourTime: option.owner.text,
          participants: option.participants.map(slot => ({
            name: slot.label,
            localTime: slot.local.text,
            availability: slot.availability,
            note: slot.availabilityNote,
          })),
          benefits: option.benefits,
          tradeOffs: option.tradeOffs,
        }))

        const summary = options.length
          ? `Found ${options.length} ranked ${request.durationMinutes}m slot${options.length === 1 ? '' : 's'} for "${request.title}" (${request.from}..${request.to}, ${result.ownerTimeZone}); top option ${options[0]!.yourTime}.`
          : `No qualifying ${request.durationMinutes}m slots found for "${request.title}" (${request.from}..${request.to}, ${result.ownerTimeZone}).`

        return {
          summary,
          mutated: false,
          data: {
            request: {
              title: request.title,
              durationMinutes: request.durationMinutes,
              from: request.from,
              to: request.to,
              bufferBeforeMinutes: request.bufferBeforeMinutes,
              bufferAfterMinutes: request.bufferAfterMinutes,
            },
            ownerSettings: ownerSettingsSnapshot(owner.store),
            resolvedParticipants: participantSources,
            options,
            shortfall: result.shortfall,
            basis: result.basis,
            availability: result.availabilityCaveats,
            proposalText: meetingProposalText(result),
            next: options.length
              ? 'Show the person these options. After they choose one (or ask to hold options), call fn_stageMeetingDrafts to confirm the chosen slot or stage private draft holds.'
              : 'Tell the person why nothing qualified and suggest widening the date range or duration.',
          },
        }
      },
    }),

    defineAppFunction<CalendarAgentToolContext>({
      name: 'fn_auditScheduleHealth',
      category: 'audit',
      risk: 'read',
      requiresApproval: false,
      replaces: ['getCalendarSettings', 'listCalendarEvents', 'searchCalendar'],
      description:
        'Audit a calendar window in one read-only call for double-booked conflicts, back-to-back meeting marathons without buffers, pending or stale drafts, grouped tentative holds, events outside working hours, and calendar sync errors, returning concrete event IDs and next-step recommendations.',
      inputSchema: {
        type: 'object',
        properties: {
          from: {
            type: 'string',
            description: 'Start day (YYYY-MM-DD). Defaults to today.',
          },
          to: {
            type: 'string',
            description: 'Inclusive end day (YYYY-MM-DD, max 62 days). Defaults to from + 13 days.',
          },
          minBufferMinutes: {
            type: 'integer',
            minimum: 0,
            maximum: 120,
            description: 'Gap threshold in minutes for back-to-back detection (default 15).',
          },
          backToBackChainLength: {
            type: 'integer',
            minimum: 2,
            maximum: 10,
            description: 'Consecutive meetings without buffer to flag (default 3).',
          },
        },
        additionalProperties: false,
      },
      run: async (ctx, args) => {
        const store = ctx.getStore()
        const now = ctx.now ? ctx.now() : new Date()
        const nowMs = now.getTime()
        const settings = ownerSettingsSnapshot(store)
        const timeZone = settings.timeZone
        const { fromKey, toKey, rangeStartIso, rangeEndIso } = resolveDayWindow(
          args,
          timeZone,
          now,
          14,
        )
        const minBufferMinutes = clampInt(args.minBufferMinutes, 15, 0, 120)
        const chainThreshold = clampInt(args.backToBackChainLength, 3, 2, 10)

        const events = visibleCalendarEvents(store, rangeStartIso, rangeEndIso)
        const timed = timedBusyEvents(events, timeZone)
        const conflicts = detectConflicts(timed, timeZone)

        // Back-to-back chains per local date
        const timedByDay = new Map<string, TimedEventBounds[]>()
        for (const item of timed) {
          const day = dateKeyInTimeZone(item.event.startsAt, timeZone)
          const list = timedByDay.get(day) ?? []
          list.push(item)
          timedByDay.set(day, list)
        }
        const backToBackChains: Array<{
          date: string
          count: number
          startsAt: string
          endsAt: string
          totalMinutes: number
          eventIds: string[]
          titles: string[]
        }> = []

        for (const [date, items] of timedByDay.entries()) {
          let chain: TimedEventBounds[] = []
          const flushChain = () => {
            if (chain.length >= chainThreshold) {
              const first = chain[0]!
              const lastEnd = Math.max(...chain.map(c => c.endMs))
              backToBackChains.push({
                date,
                count: chain.length,
                startsAt: first.event.startsAt,
                endsAt: new Date(lastEnd).toISOString(),
                totalMinutes: Math.round((lastEnd - first.startMs) / MINUTE_MS),
                eventIds: chain.map(c => c.event.id),
                titles: chain.map(c => c.event.title),
              })
            }
          }
          for (const item of items) {
            if (chain.length === 0) {
              chain = [item]
              continue
            }
            const prevEnd = Math.max(...chain.map(c => c.endMs))
            const gapMinutes = (item.startMs - prevEnd) / MINUTE_MS
            if (gapMinutes < minBufferMinutes) {
              chain.push(item)
            } else {
              flushChain()
              chain = [item]
            }
          }
          flushChain()
        }

        // Outside working hours (timed non-cancelled events)
        const workStartMin = settings.availableStartHour * 60
        const workEndMin = settings.availableEndHour * 60
        const outsideWorkingHours: Array<{
          id: string
          title: string
          date: string
          localStart: string
          localEnd: string
          reason: string
        }> = []
        for (const item of timed) {
          const ev = item.event
          const date = dateKeyInTimeZone(ev.startsAt, timeZone)
          const weekday = weekdayOfDateKey(date)
          const lt = localTimes(ev.startsAt, ev.endsAt, timeZone)
          if (!settings.availableDays.includes(weekday)) {
            outsideWorkingHours.push({
              id: ev.id,
              title: ev.title,
              date,
              localStart: lt.start,
              localEnd: lt.end,
              reason: 'Scheduled on a non-working day.',
            })
            continue
          }
          const startMin = localMinutesFromIso(ev.startsAt, timeZone)
          const endMin = localMinutesFromIso(ev.endsAt, timeZone)
          const spansNextDay =
            dateKeyInTimeZone(new Date(Math.max(0, item.endMs - 1)), timeZone) !==
            date
          if (startMin < workStartMin || spansNextDay || endMin > workEndMin) {
            outsideWorkingHours.push({
              id: ev.id,
              title: ev.title,
              date,
              localStart: lt.start,
              localEnd: lt.end,
              reason: `Extends outside working hours (${String(settings.availableStartHour).padStart(2, '0')}:00–${String(settings.availableEndHour).padStart(2, '0')}:00).`,
            })
          }
        }

        // Pending drafts (including stale past drafts across entire store)
        const allDrafts = store.events.filter(isDraftEvent)
        const pendingDrafts = allDrafts.map(ev => {
          const endMs = parseEventBoundMs(ev.endsAt, ev.timeZone || timeZone)
          const stale = Number.isFinite(endMs) && endMs < nowMs
          return {
            ...summarizeEventForBriefing(ev, timeZone),
            stale,
            canEdit: canEditCalendarEvent(store, ev),
          }
        })
        const staleDraftCount = pendingDrafts.filter(d => d.stale).length

        // Hold groups
        const holdMap = new Map<
          string,
          Array<ReturnType<typeof summarizeEventForBriefing> & { stale: boolean }>
        >()
        for (const ev of store.events.filter(isHoldEvent)) {
          const key = ev.holdGroupId || `ungrouped:${ev.id}`
          const endMs = parseEventBoundMs(ev.endsAt, ev.timeZone || timeZone)
          const list = holdMap.get(key) ?? []
          list.push({
            ...summarizeEventForBriefing(ev, timeZone),
            stale: Number.isFinite(endMs) && endMs < nowMs,
          })
          holdMap.set(key, list)
        }
        const holdGroups = [...holdMap.entries()].map(([groupKey, items]) => ({
          holdGroupId: groupKey.startsWith('ungrouped:') ? null : groupKey,
          count: items.length,
          staleCount: items.filter(i => i.stale).length,
          events: items,
        }))

        const syncSummary = calendarSyncSummary(store)
        const calendarsWithErrors = store.calendars
          .filter(c => Boolean(c.lastSyncError))
          .map(c => ({ id: c.id, name: c.name, error: c.lastSyncError! }))
        const failedCalendarIds = store.failedCalendarIds ?? []

        const recommendations: string[] = []
        if (conflicts.length > 0) {
          recommendations.push(
            `Resolve ${conflicts.length} overlapping conflict${conflicts.length === 1 ? '' : 's'} (events: ${conflicts.slice(0, 3).map(c => c.events.map(e => e.id).join(' vs ')).join('; ')}).`,
          )
        }
        if (backToBackChains.length > 0) {
          recommendations.push(
            `Add recovery buffers around ${backToBackChains.length} back-to-back meeting chain${backToBackChains.length === 1 ? '' : 's'} (${backToBackChains.map(c => `${c.date}: ${c.count} meetings`).join(', ')}).`,
          )
        }
        if (staleDraftCount > 0) {
          recommendations.push(
            `Clean up ${staleDraftCount} past draft${staleDraftCount === 1 ? '' : 's'} using fn_stageMeetingDrafts (releaseHoldIds).`,
          )
        }
        if (holdGroups.length > 0) {
          recommendations.push(
            `Review ${holdGroups.length} tentative hold group${holdGroups.length === 1 ? '' : 's'} and release unused options once confirmed.`,
          )
        }
        if (failedCalendarIds.length > 0 || calendarsWithErrors.length > 0 || syncSummary.failed > 0) {
          recommendations.push(
            'Inspect calendar sync errors before relying on availability for scheduling.',
          )
        }

        const summary = `Audit ${fromKey}..${toKey} (${timeZone}): ${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}, ${backToBackChains.length} back-to-back chain${backToBackChains.length === 1 ? '' : 's'}, ${pendingDrafts.length} pending draft${pendingDrafts.length === 1 ? '' : 's'} (${staleDraftCount} stale), ${outsideWorkingHours.length} outside working hours.`

        return {
          summary,
          mutated: false,
          data: {
            window: { from: fromKey, to: toKey, timeZone },
            conflicts,
            backToBackChains,
            outsideWorkingHours,
            pendingDrafts,
            holdGroups,
            syncIssues: {
              summary: syncSummary,
              failedCalendarIds,
              calendarsWithErrors,
            },
            recommendations,
          },
        }
      },
    }),

    defineAppFunction<CalendarAgentToolContext>({
      name: 'fn_stageMeetingDrafts',
      category: 'scheduling',
      risk: 'write',
      requiresApproval: true,
      replaces: [
        'createCalendarDraft',
        'createMeetingDraft',
        'deleteCalendarEvent',
      ],
      description:
        'Stage private calendar drafts in one write call: place 1–5 conflict-checked tentative draft holds linked by a holdGroupId, confirm a searched meeting option via live recheck (idempotent), and/or release unused private draft holds. Strictly draft-only: never activates events, never emails guests, and strictly refuses to delete any active event.',
      inputSchema: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Default base title for staged holds.',
          },
          calendarId: {
            type: 'string',
            description: 'Default editable calendar id for holds.',
          },
          timeZone: {
            type: 'string',
            description: 'Default IANA time zone for holds.',
          },
          attendees: {
            type: 'array',
            description: 'Default uninvited draft attendees ({email, name?}).',
            items: {
              type: 'object',
              properties: {
                email: { type: 'string' },
                name: { type: 'string' },
              },
              required: ['email'],
            },
          },
          holdGroupId: {
            type: 'string',
            description: 'Optional group id linking staged holds (auto-generated for 2+ holds).',
          },
          allowOverlap: {
            type: 'boolean',
            description: 'Allow holds overlapping busy events (default false: conflicts are skipped).',
          },
          holds: {
            type: 'array',
            maxItems: 5,
            description:
              '1–5 tentative draft holds ({startsAt, endsAt? or durationMinutes?, title?, calendarId?, timeZone?, attendees?}).',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                startsAt: { type: 'string' },
                endsAt: { type: 'string' },
                durationMinutes: { type: 'integer', minimum: 1, maximum: 720 },
                calendarId: { type: 'string' },
                timeZone: { type: 'string' },
                attendees: { type: 'array', items: { type: 'object' } },
              },
              required: ['startsAt'],
            },
          },
          confirmMeetingDraft: {
            type: 'object',
            description:
              'Chosen slot from fn_planMeetingSlots ({durationMinutes, from, to, startsAt, title?, participants?, bufferBeforeMinutes?, bufferAfterMinutes?}) to recheck live and draft idempotently.',
            properties: {
              title: { type: 'string' },
              durationMinutes: { type: 'integer', minimum: 1, maximum: 720 },
              from: { type: 'string' },
              to: { type: 'string' },
              startsAt: { type: 'string' },
              participants: { type: 'array', items: { type: 'object' } },
              bufferBeforeMinutes: { type: 'integer', minimum: 0, maximum: 240 },
              bufferAfterMinutes: { type: 'integer', minimum: 0, maximum: 240 },
            },
            required: ['durationMinutes', 'from', 'to', 'startsAt'],
          },
          releaseHoldIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Draft event IDs to remove (refuses active or read-only events).',
          },
          releaseHoldGroupId: {
            type: 'string',
            description: 'Group id whose remaining private draft holds should be removed.',
          },
          keepEventId: {
            type: 'string',
            description: 'Event id to preserve when releasing releaseHoldGroupId.',
          },
        },
        additionalProperties: false,
      },
      run: async (ctx, args) => {
        const holdsArg = Array.isArray(args.holds) ? args.holds : []
        const confirmArg =
          args.confirmMeetingDraft &&
          typeof args.confirmMeetingDraft === 'object' &&
          !Array.isArray(args.confirmMeetingDraft)
            ? (args.confirmMeetingDraft as Record<string, unknown>)
            : null
        const releaseHoldIdsArg = Array.isArray(args.releaseHoldIds)
          ? args.releaseHoldIds.filter(
              (id): id is string => typeof id === 'string' && id.trim().length > 0,
            )
          : []
        const releaseHoldGroupId = trimmedString(args.releaseHoldGroupId) || undefined
        const keepEventId = trimmedString(args.keepEventId) || undefined

        if (
          holdsArg.length === 0 &&
          !confirmArg &&
          releaseHoldIdsArg.length === 0 &&
          !releaseHoldGroupId
        ) {
          throw new AgentCalendarToolError(
            'Provide at least one of "holds", "confirmMeetingDraft", "releaseHoldIds", or "releaseHoldGroupId".',
          )
        }
        if (holdsArg.length > 5) {
          throw new AgentCalendarToolError(
            'At most 5 tentative holds may be staged in a single call.',
          )
        }

        const allowOverlap = args.allowOverlap === true
        const defaultTitle = trimmedString(args.title) || 'Meeting'
        const defaultCalendarIdArg = trimmedString(args.calendarId) || undefined
        const defaultTimeZoneArg = trimmedString(args.timeZone) || undefined
        if (defaultTimeZoneArg && !isValidTimeZone(defaultTimeZoneArg)) {
          throw new AgentCalendarToolError(
            `timeZone "${defaultTimeZoneArg}" is not a valid IANA time zone (e.g. America/Los_Angeles).`,
          )
        }
        const defaultAttendees = readAttendeesArg(args)

        const createdHolds: Array<{
          id: string
          title: string
          startsAt: string
          endsAt: string
          calendarId: string
          holdGroupId: string | null
          lifecycle: 'draft'
          attendeesListed: string[]
        }> = []
        const skippedConflicts: Array<{
          index: number
          startsAt: string
          endsAt: string
          conflictingEventIds: string[]
          reason: string
        }> = []
        let confirmedDraft: {
          id: string
          created: boolean
          title: string
          startsAt: string
          endsAt: string
          calendarId: string
          lifecycle: 'draft'
          attendeesListed: string[]
          summary: string
        } | null = null
        const releasedHolds: Array<{ id: string; title: string }> = []
        const refusedReleases: Array<{ id: string; reason: string }> = []

        const now = ctx.now ? ctx.now() : new Date()
        let activeHoldGroupId =
          trimmedString(args.holdGroupId) ||
          (holdsArg.length > 1
            ? `hold_${now.getTime().toString(36)}`
            : undefined)

        // 1. Optional confirmed meeting draft (exact meetingDraftFlow recheck)
        if (confirmArg) {
          const startsAt = trimmedString(confirmArg.startsAt)
          if (!startsAt) {
            throw new AgentCalendarToolError(
              'confirmMeetingDraft.startsAt is required.',
            )
          }
          const meetingInput: Partial<MeetingRequestInput> = {
            title: trimmedString(confirmArg.title) || undefined,
            durationMinutes: confirmArg.durationMinutes as number,
            from: trimmedString(confirmArg.from),
            to: trimmedString(confirmArg.to),
            participants: confirmArg.participants as
              | MeetingRequestInput['participants']
              | undefined,
            bufferBeforeMinutes: confirmArg.bufferBeforeMinutes as
              | number
              | undefined,
            bufferAfterMinutes: confirmArg.bufferAfterMinutes as
              | number
              | undefined,
          }
          const validation = validateMeetingRequest(meetingInput)
          if (!validation.ok) {
            throw new AgentCalendarToolError(
              `No meeting draft made: ${validation.errors.join(' ')}`,
            )
          }
          const reader = ctx.getBusyReader()
          const qualifiedBy: ParticipantAvailability[] =
            ctx.searchQualification.get(meetingRequestKey(validation.request)) ??
            validation.request.participants.map(participant =>
              isTeammateParticipant(participant)
                ? {
                    status: 'supplied',
                    busy: [],
                    checkedAt: now.toISOString(),
                    source: TEAM_SOURCE,
                  }
                : { status: 'none' },
            )
          const outcome = await meetingDraftFlow.run(
            meetingInput,
            startsAt,
            qualifiedBy,
            {
              readOwner: ctx.readOwnerNow,
              readParticipants: (participants, from, to) =>
                readParticipantAvailability(participants, from, to, reader),
              saveDraft: (event, base) =>
                ctx.commitStore(base, current =>
                  withMeetingDraft(current, event, base),
                ),
            },
          )
          if (outcome.kind === 'invalid') {
            throw new AgentCalendarToolError(
              `No meeting draft made: ${outcome.errors.join(' ')}`,
            )
          }
          if (
            outcome.kind === 'conflict' ||
            outcome.kind === 'recheck-failed' ||
            outcome.kind === 'draft-changed'
          ) {
            throw new AgentCalendarToolError(outcome.reason)
          }
          confirmedDraft = {
            id: outcome.event.id,
            created: outcome.kind === 'created',
            title: outcome.event.title,
            startsAt: outcome.event.startsAt,
            endsAt: outcome.event.endsAt,
            calendarId: outcome.event.calendarId,
            lifecycle: 'draft',
            attendeesListed: outcome.event.attendees.map(a => a.email),
            summary: outcome.summary,
          }
        }

        // 2. Stage tentative draft holds
        if (holdsArg.length > 0) {
          let store = ctx.getStore()
          const resolvedOwnerZone = resolveCalendarTimeZone(store.settings).timeZone
          const preparedDrafts: CalendarEvent[] = []

          for (let i = 0; i < holdsArg.length; i++) {
            const raw = holdsArg[i]
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
              throw new AgentCalendarToolError(
                `holds[${i}] must be an object with startsAt.`,
              )
            }
            const item = raw as Record<string, unknown>
            const startsAtRaw = trimmedString(item.startsAt)
            if (!startsAtRaw) {
              throw new AgentCalendarToolError(
                `holds[${i}].startsAt is required.`,
              )
            }
            const itemTimeZone =
              trimmedString(item.timeZone) || defaultTimeZoneArg || undefined
            if (itemTimeZone && !isValidTimeZone(itemTimeZone)) {
              throw new AgentCalendarToolError(
                `holds[${i}].timeZone "${itemTimeZone}" is not a valid IANA time zone.`,
              )
            }
            const zone = itemTimeZone || resolvedOwnerZone
            const start = resolveAgentEventTime(startsAtRaw, zone)
            if (!start) {
              throw new AgentCalendarToolError(
                `holds[${i}].startsAt "${startsAtRaw}" is not a valid date/time.`,
              )
            }

            let endInstant: string
            const endsAtRaw = trimmedString(item.endsAt)
            if (endsAtRaw) {
              const end = resolveAgentEventTime(endsAtRaw, zone)
              if (!end) {
                throw new AgentCalendarToolError(
                  `holds[${i}].endsAt "${endsAtRaw}" is not a valid date/time.`,
                )
              }
              endInstant = end.instant
            } else if (
              typeof item.durationMinutes === 'number' &&
              Number.isInteger(item.durationMinutes) &&
              item.durationMinutes >= 1 &&
              item.durationMinutes <= 720
            ) {
              endInstant = new Date(
                Date.parse(start.instant) + item.durationMinutes * MINUTE_MS,
              ).toISOString()
            } else {
              throw new AgentCalendarToolError(
                `holds[${i}] requires either "endsAt" or "durationMinutes" (1..720).`,
              )
            }

            const requestedCalendarId =
              trimmedString(item.calendarId) || defaultCalendarIdArg
            let calendarId = requestedCalendarId || safeDefaultCalendarId(store)
            if (requestedCalendarId) {
              const cal = store.calendars.find(c => c.id === requestedCalendarId)
              if (!cal) {
                throw new AgentCalendarToolError(
                  `Calendar "${requestedCalendarId}" not found.`,
                )
              }
              if (cal.readOnly) {
                throw new AgentCalendarToolError(
                  `Calendar "${cal.name}" is read-only.`,
                )
              }
            }
            if (!calendarId) {
              const ensured = ensureLocalCalendar(store)
              ctx.commitStore(store, current => ensureLocalCalendar(current).store)
              store = ensured.store
              calendarId = ensured.calendarId
            }

            const holdTitle =
              trimmedString(item.title) ||
              (holdsArg.length > 1
                ? `HOLD: ${defaultTitle} (option ${i + 1})`
                : `HOLD: ${defaultTitle}`)

            const event = createDraftEvent(
              calendarId,
              start.instant,
              holdTitle,
              itemTimeZone || zone,
            )
            event.endsAt = endInstant
            if (start.dateOnly) {
              Object.assign(
                event,
                allDayEventPatch(
                  { startsAt: start.instant, endsAt: endInstant },
                  true,
                  zone,
                ),
              )
            }
            if (Date.parse(event.endsAt) <= Date.parse(event.startsAt)) {
              throw new AgentCalendarToolError(
                `holds[${i}].endsAt (${event.endsAt}) must be after startsAt (${event.startsAt}).`,
              )
            }

            // Check against visible busy events + already-prepared holds
            if (!allowOverlap) {
              const existingInSlot = visibleCalendarEvents(
                store,
                event.startsAt,
                event.endsAt,
              ).filter(isBusyEvent)
              const overlappingPrepared = preparedDrafts.filter(
                draft =>
                  Date.parse(draft.startsAt) < Date.parse(event.endsAt) &&
                  Date.parse(event.startsAt) < Date.parse(draft.endsAt),
              )
              const conflicting = [...existingInSlot, ...overlappingPrepared]
              if (conflicting.length > 0) {
                skippedConflicts.push({
                  index: i,
                  startsAt: event.startsAt,
                  endsAt: event.endsAt,
                  conflictingEventIds: conflicting.map(c => c.id),
                  reason: `Overlaps ${conflicting.map(c => `"${c.title}" (${c.id})`).join(', ')}.`,
                })
                continue
              }
            }

            const attendees: EventAttendee[] | undefined =
              readAttendeesArg(item) ?? defaultAttendees
            if (attendees) {
              event.attendees = attendees.map(a => ({ ...a }))
            }
            if (activeHoldGroupId) {
              event.holdGroupId = activeHoldGroupId
            }
            preparedDrafts.push(event)
          }

          if (preparedDrafts.length > 0) {
            ctx.commitEvents(store, events => [...events, ...preparedDrafts])
            for (const draft of preparedDrafts) {
              createdHolds.push({
                id: draft.id,
                title: draft.title,
                startsAt: draft.startsAt,
                endsAt: draft.endsAt,
                calendarId: draft.calendarId,
                holdGroupId: draft.holdGroupId ?? null,
                lifecycle: 'draft',
                attendeesListed: draft.attendees.map(a => a.email),
              })
            }
          }
        }

        // 3. Release unused private draft holds (strictly draft-only!)
        const idsToRelease = new Set<string>(releaseHoldIdsArg)
        const protectedId = keepEventId || confirmedDraft?.id
        if (releaseHoldGroupId) {
          const currentStore = ctx.getStore()
          for (const ev of currentStore.events) {
            if (ev.holdGroupId !== releaseHoldGroupId) continue
            if (protectedId && ev.id === protectedId) continue
            idsToRelease.add(ev.id)
          }
        }

        if (idsToRelease.size > 0) {
          const currentStore = ctx.getStore()
          const approvedIds: string[] = []
          for (const id of idsToRelease) {
            const ev = currentStore.events.find(e => e.id === id)
            if (!ev) {
              refusedReleases.push({ id, reason: 'Event not found.' })
              continue
            }
            if (!isDraftEvent(ev)) {
              refusedReleases.push({
                id,
                reason:
                  'Refused: event is active, not a private draft. Use deleteCalendarEvent directly for active events.',
              })
              continue
            }
            if (!canEditCalendarEvent(currentStore, ev)) {
              refusedReleases.push({
                id,
                reason: 'Refused: event belongs to a read-only calendar.',
              })
              continue
            }
            approvedIds.push(ev.id)
            releasedHolds.push({ id: ev.id, title: ev.title })
          }
          if (approvedIds.length > 0) {
            ctx.commitStore(currentStore, prev => {
              let next = prev
              for (const id of approvedIds) {
                next = removeEventWithTombstone(next, id)
              }
              return next
            })
          }
        }

        const mutated =
          createdHolds.length > 0 ||
          Boolean(confirmedDraft?.created) ||
          releasedHolds.length > 0

        const parts: string[] = []
        if (confirmedDraft) {
          parts.push(
            confirmedDraft.created
              ? `confirmed draft "${confirmedDraft.title}" (${confirmedDraft.id})`
              : `reused existing draft "${confirmedDraft.title}" (${confirmedDraft.id})`,
          )
        }
        if (createdHolds.length > 0) {
          parts.push(
            `staged ${createdHolds.length} private hold${createdHolds.length === 1 ? '' : 's'}`,
          )
        }
        if (skippedConflicts.length > 0) {
          parts.push(
            `skipped ${skippedConflicts.length} conflicting slot${skippedConflicts.length === 1 ? '' : 's'}`,
          )
        }
        if (releasedHolds.length > 0) {
          parts.push(
            `released ${releasedHolds.length} unused draft hold${releasedHolds.length === 1 ? '' : 's'}`,
          )
        }
        if (refusedReleases.length > 0) {
          parts.push(
            `refused ${refusedReleases.length} non-draft/uneditable release${refusedReleases.length === 1 ? '' : 's'}`,
          )
        }

        const summary =
          parts.length > 0
            ? `Staged drafts: ${parts.join(', ')}.`
            : 'No draft changes were applied.'

        return {
          summary,
          mutated,
          data: {
            holdGroupId: activeHoldGroupId ?? null,
            createdHolds,
            skippedConflicts,
            confirmedDraft,
            releasedHolds,
            refusedReleases,
            nextStep:
              'Drafts remain private until the person sets Stage to Make active in PureCalendar (no invitations were sent).',
          },
        }
      },
    }),
  ]
