import { describe, expect, it } from 'vitest'
import {
  addLocalCalendar,
  allDayInclusiveEndDateKey,
  allDayRangeFromInclusiveDates,
  applyRecurringEventEdit,
  computeEventReminders,
  dateKeyInTimeZone,
  expandRecurringEvent,
  parseEventBoundMs,
  parseQuickCalendarEvent,
  recurringEditResultId,
  removeRecurringEventOccurrence,
  resolveRecurringOccurrence,
  updateCalendarTask,
  weekRange,
} from './calendarModel'
import {
  normalizeCalendar,
  normalizeSettings,
} from './calendarStorePersistence'
import {
  allDayDateKey,
  describeRecurrenceRule,
  parseRfc5545Recurrence,
  recurrenceLinesForGoogle,
} from './googleRecurrence'
import { exportStoreToIcs, foldIcsUtf8Line, importIcsIntoStore } from './icsExchange'
import { parseIcsFeed } from './icsFeed'
import { eventDescriptionSegments, meetingUrlIn } from './eventLinks'
import { calendarCommandForKey } from './calendarCommands'
import { mergeGoogleSnapshot } from '../hooks/usePureCalendarBoot'
import { mergeTeamPushResult, teamEventsToSend } from './teamCalendar'
import { calendarFixture } from '../test/calendarFixtures'
import type { CalendarEvent, CalendarStore } from '../types'

function sampleRecurringEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt_standup',
    calendarId: 'cal_work',
    title: 'Daily Standup',
    description: '',
    startsAt: '2026-06-01T16:00:00.000Z',
    endsAt: '2026-06-01T16:30:00.000Z',
    timeZone: 'UTC',
    allDay: false,
    status: 'confirmed',
    lifecycle: 'active',
    visibility: 'default',
    busyStatus: 'busy',
    attendees: [],
    reminders: [{ id: 'r1', minutesBefore: 10 }],
    attachments: [],
    linkedItems: [],
    source: 'provider',
    syncState: 'synced',
    recurrenceRule: { frequency: 'daily', interval: 1 },
    ...overrides,
  }
}

describe('PureCalendar audit fixes', () => {
  describe('recurrence & RFC 5545 round-trip', () => {
    it('parses RRULE and EXDATE cleanly and formats human-readable descriptions', () => {
      const rule = parseRfc5545Recurrence([
        'RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=6',
        'EXDATE;TZID=UTC:20260608T160000Z',
      ])
      expect(rule).toMatchObject({
        frequency: 'weekly',
        interval: 2,
        count: 6,
      })
      expect(rule?.excludedStartsAt).toEqual(['2026-06-08T16:00:00.000Z'])
      expect(describeRecurrenceRule(rule, { timeZone: 'UTC' })).toBe(
        'Repeats every 2 weeks, 6 times (1 date skipped)',
      )
    })

    it('uses timezone-aware allDayDateKey and emits RFC 5545 all-day UNTIL without COUNT=0', () => {
      // 2026-06-01 00:00 in Asia/Tokyo is 2026-05-31T15:00:00Z — must stay 2026-06-01, not 2026-05-31!
      expect(allDayDateKey('2026-06-01T00:00:00+09:00', 'Asia/Tokyo')).toBe('2026-06-01')
      expect(allDayDateKey('2026-05-31T15:00:00.000Z', 'Asia/Tokyo')).toBe('2026-06-01')

      const lines = recurrenceLinesForGoogle(
        {
          frequency: 'weekly',
          interval: 1,
          until: '2026-07-01T00:00:00.000Z',
          count: 0,
        },
        true,
        'UTC',
      )
      expect(lines).toEqual(['RRULE:FREQ=WEEKLY;INTERVAL=1;UNTIL=20260701'])
    })

    it('expands recurring events more than 365 days ahead without clipping', () => {
      const base = sampleRecurringEvent({
        startsAt: '2025-01-01T09:00:00.000Z',
        endsAt: '2025-01-01T09:30:00.000Z',
        recurrenceRule: { frequency: 'daily', interval: 1 },
      })
      const instances = expandRecurringEvent(
        base,
        '2027-01-01T00:00:00.000Z',
        '2027-01-04T00:00:00.000Z',
      )
      expect(instances.length).toBe(3)
      expect(instances[0]!.startsAt).toBe('2027-01-01T09:00:00.000Z')
    })

    it('handles recurring following/this/all edits without zombies or stale g: ids', () => {
      const base = sampleRecurringEvent({
        id: 'g:cal_work:orig123',
        recurrenceRule: {
          frequency: 'daily',
          interval: 1,
          count: 5,
          excludedStartsAt: ['2026-06-04T16:00:00.000Z'],
        },
      })

      // Following on index 0 updates base in place (no 0-count zombie!)
      const follow0 = applyRecurringEventEdit(
        [base],
        base,
        { title: 'Updated Standup' },
        'following',
      )
      expect(follow0).toHaveLength(1)
      expect(follow0[0]!.id).toBe(base.id)
      expect(follow0[0]!.title).toBe('Updated Standup')
      expect(recurringEditResultId(base.id, 'following')).toBe(base.id)

      // Following on #2 drops g: prefix and carries future exclusion forward
      const instance2: CalendarEvent = {
        ...base,
        id: `${base.id}#2`,
        startsAt: '2026-06-03T16:00:00.000Z',
        endsAt: '2026-06-03T16:30:00.000Z',
      }
      const follow2 = applyRecurringEventEdit(
        [base],
        instance2,
        { title: 'New Series' },
        'following',
      )
      expect(follow2).toHaveLength(2)
      expect(follow2[0]!.recurrenceRule?.count).toBe(2)
      expect(follow2[0]!.recurrenceRule?.excludedStartsAt).toBeUndefined()
      expect(follow2[1]!.id.startsWith('g:')).toBe(false)
      expect(follow2[1]!.id).toBe(recurringEditResultId(instance2.id, 'following'))
      expect(follow2[1]!.recurrenceRule?.count).toBe(3)
      expect(follow2[1]!.recurrenceRule?.excludedStartsAt).toEqual([
        '2026-06-04T16:00:00.000Z',
      ])

      // Editing 'all' time from #2 preserves base start date and applies only the time shift
      const allShift = applyRecurringEventEdit(
        [base],
        instance2,
        {
          startsAt: '2026-06-03T17:00:00.000Z',
          endsAt: '2026-06-03T17:45:00.000Z',
        },
        'all',
      )
      expect(allShift).toHaveLength(1)
      expect(allShift[0]!.startsAt).toBe('2026-06-01T17:00:00.000Z')
      expect(allShift[0]!.endsAt).toBe('2026-06-01T17:45:00.000Z')
    })

    it('deletes recurring occurrences according to scope (this / following / all)', () => {
      const fixture = calendarFixture()
      const base = sampleRecurringEvent({ id: 'g:cal_work:rec1' })
      const store: CalendarStore = { ...fixture, events: [base] }
      const occ2: CalendarEvent = {
        ...base,
        id: `${base.id}#2`,
        startsAt: '2026-06-03T16:00:00.000Z',
        endsAt: '2026-06-03T16:30:00.000Z',
      }

      const afterThis = removeRecurringEventOccurrence(store, occ2, 'this')
      expect(afterThis.events).toHaveLength(1)
      expect(afterThis.events[0]!.recurrenceRule?.excludedStartsAt).toContain(
        occ2.startsAt,
      )

      const afterFollowing = removeRecurringEventOccurrence(store, occ2, 'following')
      expect(afterFollowing.events).toHaveLength(1)
      expect(afterFollowing.events[0]!.recurrenceRule?.until).toBeDefined()

      const afterAll = removeRecurringEventOccurrence(store, occ2, 'all')
      expect(afterAll.events).toHaveLength(0)
      expect(afterAll.removedEventIds).toContain(base.id)
    })
  })

  describe('all-day, timezone, reminders, quick-add & local store helpers', () => {
    it('resolves bare YYYY-MM-DD dates in local timezone and round-trips inclusive all-day ranges', () => {
      const laMs = parseEventBoundMs('2026-10-12', 'America/Los_Angeles')
      expect(dateKeyInTimeZone(new Date(laMs), 'America/Los_Angeles')).toBe('2026-10-12')

      const range = allDayRangeFromInclusiveDates('2026-10-12', '2026-10-14', 'America/Los_Angeles')
      expect(
        allDayInclusiveEndDateKey(
          { ...range, timeZone: 'America/Los_Angeles' },
          'America/Los_Angeles',
        ),
      ).toBe('2026-10-14')
    })

    it('computes weekRange in target timezone and fires reminders for recurring occurrences while skipping drafts', () => {
      // 2026-06-07T18:00:00Z is Monday 2026-06-08 03:00 in Asia/Tokyo
      const tokyoWeek = weekRange(new Date('2026-06-07T18:00:00.000Z'), 'Asia/Tokyo')
      expect(dateKeyInTimeZone(tokyoWeek.start, 'Asia/Tokyo')).toBe('2026-06-08')

      const recurring = sampleRecurringEvent({
        startsAt: '2026-06-01T10:00:00.000Z',
        endsAt: '2026-06-01T10:30:00.000Z',
        reminders: [{ id: 'r10', minutesBefore: 10 }],
      })
      const draft = sampleRecurringEvent({
        id: 'evt_draft',
        lifecycle: 'draft',
        startsAt: '2026-06-05T10:00:00.000Z',
        endsAt: '2026-06-05T10:30:00.000Z',
        recurrenceRule: undefined,
      })
      const reminders = computeEventReminders(
        [recurring, draft],
        Date.parse('2026-06-05T09:00:00.000Z'),
        2 * 60 * 60 * 1000,
      )
      expect(reminders.some(r => r.id.startsWith('reminder:evt_standup#4:'))).toBe(true)
      expect(reminders.some(r => r.id.includes('evt_draft'))).toBe(false)
    })

    it('does not misparse bare numbers in titles like 1-on-1 or Sprint 14 as times', () => {
      const now = new Date('2026-06-01T08:00:00.000Z')
      const oneOnOne = parseQuickCalendarEvent('1-on-1 with Sara', { now, timeZone: 'UTC' })
      expect(oneOnOne?.title).toBe('1-on-1 with Sara')
      const sprint = parseQuickCalendarEvent('Sprint 14 planning', { now, timeZone: 'UTC' })
      expect(sprint?.title).toBe('Sprint 14 planning')
      const timed = parseQuickCalendarEvent('tomorrow at 3pm Design review', { now, timeZone: 'UTC' })
      expect(timed?.title).toBe('Design review')
      expect(timed?.startsAt).toBe('2026-06-02T15:00:00.000Z')
    })

    it('sets LOCAL_SOURCE_ID on addLocalCalendar and allows clearing task dates', () => {
      const fixture = calendarFixture()
      const { store, calendar } = addLocalCalendar(fixture, {
        name: 'Personal',
        color: '#3F7F59',
      })
      expect(calendar.sourceId).toBe('src_local')
      expect(store.sources.some(s => s.id === 'src_local')).toBe(true)

      const cleared = updateCalendarTask(
        {
          id: 't1',
          title: 'Prep',
          sourceLabel: 'Mail',
          status: 'open',
          dueAt: '2026-06-01T10:00:00.000Z',
          scheduledStart: '2026-06-01T09:00:00.000Z',
          syncState: 'synced',
        },
        { dueAt: '', scheduledStart: '' },
      )
      expect(cleared.dueAt).toBeUndefined()
      expect(cleared.scheduledStart).toBeUndefined()
    })
  })

  describe('bulk ICS import & scoped export', () => {
    it('folds multibyte UTF-8 lines safely at <= 75 UTF-8 bytes without splitting characters', () => {
      const raw = `SUMMARY:${'🚀🎉日本語テスト'.repeat(12)}`
      const folded = foldIcsUtf8Line(raw)
      const lines = folded.split('\r\n')
      expect(lines.length).toBeGreaterThan(1)
      const encoder = new TextEncoder()
      for (const line of lines) {
        expect(encoder.encode(line).length).toBeLessThanOrEqual(75)
      }
      // Unfolding restores exact original string
      expect(folded.replace(/\r\n /g, '')).toBe(raw)
    })

    it('imports multi-event .ics with dedupe/update and exports scoped calendars cleanly', () => {
      const fixture = calendarFixture()
      const baseStore: CalendarStore = { ...fixture, events: [] }
      const sampleIcs = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:uid-1@example.com',
        'SUMMARY:Quarterly Planning',
        'DTSTART:20260710T140000Z',
        'DTEND:20260710T150000Z',
        'RRULE:FREQ=MONTHLY;INTERVAL=1',
        'LOCATION:Room 4B',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:uid-2@example.com',
        'SUMMARY:Company Offsite',
        'DTSTART;VALUE=DATE:20260715',
        'DTEND;VALUE=DATE:20260717',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:uid-bad@example.com',
        'SUMMARY:Broken event without start',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n')

      const first = importIcsIntoStore(baseStore, sampleIcs, 'cal_work', 'UTC')
      expect(first.summary.added).toBe(2)
      expect(first.summary.failed).toBe(1)
      expect(first.store.events).toHaveLength(2)

      // Re-importing identical file updates 0 / skips 2 (idempotent!)
      const second = importIcsIntoStore(first.store, sampleIcs, 'cal_work', 'UTC')
      expect(second.summary.added).toBe(0)
      expect(second.summary.skipped).toBe(2)
      expect(second.store.events).toHaveLength(2)

      // Scoped export keeps only matching calendar + range and includes RRULE
      const exported = exportStoreToIcs(first.store, {
        calendarId: 'cal_work',
        startDate: '2026-07-01',
        endDate: '2026-07-12',
        timeZone: 'UTC',
      })
      expect(exported.count).toBe(1)
      expect(exported.ics).toContain('SUMMARY:Quarterly Planning')
      expect(exported.ics).toContain('RRULE:FREQ=MONTHLY')
      expect(exported.ics).not.toContain('Company Offsite')
    })
  })

  describe('sync, ICS feed, links & keyboard guards', () => {
    it('preserves local reminders/linkedItems and out-of-window events in mergeGoogleSnapshot', () => {
      const fixture = calendarFixture()
      const outOfWindow = sampleRecurringEvent({
        id: 'g:cal_work:old_evt',
        startsAt: '2025-01-01T10:00:00.000Z',
        endsAt: '2025-01-01T11:00:00.000Z',
        recurrenceRule: undefined,
      })
      const inWindow = sampleRecurringEvent({
        id: 'g:cal_work:keep_evt',
        startsAt: '2026-06-10T10:00:00.000Z',
        endsAt: '2026-06-10T11:00:00.000Z',
        recurrenceRule: undefined,
        reminders: [{ id: 'custom', minutesBefore: 30 }],
        linkedItems: [{ type: 'email', id: 'm1', label: 'Thread' }],
      })
      const local: CalendarStore = {
        ...fixture,
        events: [outOfWindow, inWindow],
      }
      const remote: CalendarStore = {
        ...fixture,
        events: [{ ...inWindow, reminders: [], linkedItems: [] }],
        fetchedWindow: {
          start: '2026-05-01T00:00:00.000Z',
          end: '2026-12-01T00:00:00.000Z',
        },
      }
      const merged = mergeGoogleSnapshot(local, remote)
      expect(merged.events.some(e => e.id === outOfWindow.id)).toBe(true)
      const kept = merged.events.find(e => e.id === inWindow.id)
      expect(kept?.reminders).toEqual(inWindow.reminders)
      expect(kept?.linkedItems).toEqual(inWindow.linkedItems)
    })

    it('excludes draft team events from push and returns original store when outcomes is empty', () => {
      const fixture = calendarFixture()
      const teamDraft = sampleRecurringEvent({
        id: 'local_team_draft',
        calendarId: 'team:org',
        lifecycle: 'draft',
        syncState: 'pending',
        recurrenceRule: undefined,
      })
      const store: CalendarStore = { ...fixture, events: [teamDraft] }
      expect(teamEventsToSend(store)).toHaveLength(0)
      const unchanged = mergeTeamPushResult(store, [], 'me', 'UTC')
      expect(unchanged.store).toBe(store)
    })

    it('parses ICS feed with floating timezone, RECURRENCE-ID overrides, and long-running RRULEs', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:long-series@example.com',
        'SUMMARY:Daily Check',
        'DTSTART:20240101T090000',
        'DTEND:20240101T093000',
        'RRULE:FREQ=DAILY',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:long-series@example.com',
        'RECURRENCE-ID:20260602T090000',
        'SUMMARY:Daily Check (Moved)',
        'DTSTART:20260602T110000',
        'DTEND:20260602T113000',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n')
      const events = parseIcsFeed(
        ics,
        'feed1',
        Date.parse('2026-06-01T00:00:00Z'),
        Date.parse('2026-06-04T00:00:00Z'),
      )
      expect(events).not.toBeNull()
      expect(events!.some(e => e.title === 'Daily Check (Moved)')).toBe(true)
      expect(events!.every(e => e.timeZone !== 'floating')).toBe(true)
    })

    it('detects angle-bracketed links and broader video providers while rejecting Meet help URLs', () => {
      expect(meetingUrlIn('Join at <https://meet.google.com/abc-defg-hij>')).toBe(
        'https://meet.google.com/abc-defg-hij',
      )
      expect(meetingUrlIn('Docs: https://meet.google.com/help')).toBeNull()
      expect(meetingUrlIn('Join: https://acme.webex.com/meet/room1')).toBe(
        'https://acme.webex.com/meet/room1',
      )
      expect(meetingUrlIn('Join: https://meet.jit.si/PureRoom')).toBe(
        'https://meet.jit.si/PureRoom',
      )
      const segments = eventDescriptionSegments('See <https://example.com/agenda>')
      expect(segments.some(s => s.type === 'link' && s.href === 'https://example.com/agenda')).toBe(true)
    })

    it('guards keyboard shortcuts against unwanted modifier combos', () => {
      expect(calendarCommandForKey('d', { altKey: true })).toBeNull()
      expect(calendarCommandForKey('n', { ctrlKey: true })).toBeNull()
      expect(calendarCommandForKey('z', { metaKey: true, shiftKey: true })).toBeNull()
      expect(calendarCommandForKey('z', { metaKey: true })).toBe('undo-last-change')
      expect(calendarCommandForKey('n', {})).toBe('new-event')
    })

    it('guards ICS export against CRLF injection, handles RECURRENCE-ID overrides, TZID EXDATE, persistence, and occurrence resolution', () => {
      // 1. TZID-qualified EXDATE resolves in America/New_York (EDT = UTC-4 -> 13:00Z, not 09:00Z)
      const tzRule = parseRfc5545Recurrence([
        'RRULE:FREQ=DAILY;INTERVAL=1',
        'EXDATE;TZID=America/New_York:20260608T090000',
      ])
      expect(tzRule?.excludedStartsAt).toEqual(['2026-06-08T13:00:00.000Z'])

      // 2. CRLF injection in conferenceLink / organizer / attendee is stripped & non-http URLs rejected
      const fixture = calendarFixture()
      const hostileEvent = sampleRecurringEvent({
        id: 'evt_hostile',
        recurrenceRule: undefined,
        conferenceLink: 'javascript:alert(1)\r\nBEGIN:VEVENT\r\nSUMMARY:Injected',
        organizer: { name: 'Bad', email: 'bad@example.com\r\nSUMMARY:Injected', response: 'accepted' },
        attendees: [{ name: 'Att', email: 'att@example.com\r\nX-EVIL:1', response: 'accepted' }],
      })
      const exported = exportStoreToIcs(
        { ...fixture, events: [hostileEvent] },
        { calendarId: 'cal_work', timeZone: 'UTC' },
      )
      expect(exported.ics).not.toContain('SUMMARY:Injected')
      expect(exported.ics).not.toContain('X-EVIL:1')
      expect(exported.ics).not.toContain('javascript:')

      // 3. RECURRENCE-ID override during bulk import does not clobber master series
      const overrideIcs = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:series-1@example.com',
        'SUMMARY:Weekly Sync',
        'DTSTART:20260601T100000Z',
        'DTEND:20260601T103000Z',
        'RRULE:FREQ=WEEKLY',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:series-1@example.com',
        'RECURRENCE-ID:20260608T100000Z',
        'SUMMARY:Weekly Sync (Moved)',
        'DTSTART:20260608T140000Z',
        'DTEND:20260608T143000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n')
      const imported = importIcsIntoStore({ ...fixture, events: [] }, overrideIcs, 'cal_work', 'UTC')
      expect(imported.store.events).toHaveLength(2)
      const master = imported.store.events.find(e => e.externalUid === 'series-1@example.com')
      expect(master?.title).toBe('Weekly Sync')
      expect(master?.recurrenceRule?.excludedStartsAt).toContain('2026-06-08T10:00:00.000Z')

      // 4. resolveRecurringOccurrence resolves concrete #2 timestamps
      const base = sampleRecurringEvent()
      const occ2 = resolveRecurringOccurrence(base, `${base.id}#2`)
      expect(occ2.startsAt).toBe('2026-06-03T16:00:00.000Z')

      // 5. Persistence normalizers preserve secondaryTimeZone, lastSyncedAt, lastSyncError
      const normSettings = normalizeSettings({ secondaryTimeZone: 'Europe/London' })
      expect(normSettings.secondaryTimeZone).toBe('Europe/London')
      const normCal = normalizeCalendar({
        id: 'cal_1',
        sourceId: 'src_1',
        name: 'Work',
        lastSyncedAt: '2026-06-01T10:00:00.000Z',
        lastSyncError: 'HTTP 503',
      })
      expect(normCal?.lastSyncedAt).toBe('2026-06-01T10:00:00.000Z')
      expect(normCal?.lastSyncError).toBe('HTTP 503')
    })
  })
})
