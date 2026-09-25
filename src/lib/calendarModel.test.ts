import { describe, expect, it } from 'vitest'
import {
  allDayEventsInRange,
  applyRecurringEventEdit,
  cancelEvent,
  calendarSyncSummary,
  canEditCalendarEvent,
  activateEvent,
  createDraftEvent,
  isDraftEvent,
  createEventFromCalendarDraftIntent,
  createEventFromCalendarInviteIntent,
  dateTimeLocalToIsoInTimeZone,
  dateTimeLocalValueInTimeZone,
  demoCalendarStore,
  clearDemoData,
  duplicateEvent,
  eventsInRange,
  expandRecurringEvent,
  firstEditableCalendarId,
  formatEventAttendeesText,
  formatEventReminderMinutes,
  instantFromZonedWallTime,
  isAvailableWallTime,
  moveEvent,
  normalizeAvailabilitySettings,
  parseEventAttendeesText,
  parseEventReminderMinutes,
  parseQuickCalendarEvent,
  quickAddCalendarEvent,
  recoverCalendarEventSync,
  recoverCalendarTaskSync,
  removeEventWithTombstone,
  resolveRsvpAttendee,
  resolveCalendarTimeZone,
  retryCalendarSyncFailures,
  rsvpEvent,
  searchCalendarStore,
  setCalendarVisibility,
  undoCalendarEventChange,
  updateCalendarTask,
  upsertInviteEvent,
  upsertMirroredInviteEvent,
  MAIL_INVITE_CALENDAR_ID,
  visibleCalendarEvents,
  visibleScheduledTasks,
  weekRange,
} from './calendarModel'

const inviteIntent = {
  id: 'calendar_invite_msg_1_invite-test',
  resourceId: 'calendar-invite:mail:acct_demo:msg_1:invite-test',
  sourceAppSlug: 'mail' as const,
  source: {
    type: 'email' as const,
    accountId: 'acct_demo',
    threadId: 'thread_invite',
    messageId: 'msg_1',
    label: 'Invitation: Review meeting',
    snippet: 'Kim invited you.',
  },
  uid: 'invite-test@example.com',
  method: 'REQUEST' as const,
  sequence: 1,
  status: 'confirmed' as const,
  title: 'Review meeting',
  description: 'Talk through the plan.',
  location: 'Zoom',
  startsAt: '2026-06-25T17:00:00.000Z',
  endsAt: '2026-06-25T17:30:00.000Z',
  timeZone: 'UTC',
  organizer: { name: 'Kim', email: 'kim@example.com' },
  attendees: [
    {
      name: 'Alex Example',
      email: 'alex@example.com',
      response: 'needsAction' as const,
    },
  ],
  createdAt: '2026-06-20T10:00:00.000Z',
}

describe('PureCalendar model', () => {
  it('creates a slot draft with a 30 minute duration', () => {
    const draft = createDraftEvent('cal_work', '2026-06-20T10:00:00.000Z')
    expect(draft.status).toBe('tentative')
    expect(Date.parse(draft.endsAt) - Date.parse(draft.startsAt)).toBe(
      30 * 60 * 1000,
    )
  })

  it('creates drafts in the draft lifecycle and activates them for sync', () => {
    const draft = createDraftEvent('cal_work', '2026-06-20T10:00:00.000Z')
    expect(draft.lifecycle).toBe('draft')
    expect(isDraftEvent(draft)).toBe(true)

    const activated = activateEvent({ ...draft, syncState: 'synced' })
    expect(activated.lifecycle).toBe('active')
    expect(activated.syncState).toBe('pending')
    expect(isDraftEvent(activated)).toBe(false)
  })

  it('creates drafts with source provider so they reach the push loop', () => {
    // 'demo' would be skipped by every provider push filter (that tag now
    // exclusively marks the first-run sample seed).
    const draft = createDraftEvent('cal_work', '2026-06-20T10:00:00.000Z')
    expect(draft.source).toBe('provider')
    expect(draft.syncState).toBe('pending')
  })

  it('removes events and tombstones provider-backed ids for the sync loop', () => {
    const base = demoCalendarStore()
    const googleEvent = {
      ...base.events[0],
      id: 'g:cal-1:evt-9',
      recurrenceRule: undefined,
    }
    const store = { ...base, events: [...base.events, googleEvent] }

    const localRemoved = removeEventWithTombstone(store, base.events[0].id)
    expect(
      localRemoved.events.some(event => event.id === base.events[0].id),
    ).toBe(false)
    // A local-only event never existed at a provider: no tombstone.
    expect(localRemoved.removedEventIds ?? []).toEqual([])

    const googleRemoved = removeEventWithTombstone(store, 'g:cal-1:evt-9')
    expect(
      googleRemoved.events.some(event => event.id === 'g:cal-1:evt-9'),
    ).toBe(false)
    expect(googleRemoved.removedEventIds).toEqual(['g:cal-1:evt-9'])

    // Unknown id: store unchanged (and same reference).
    expect(removeEventWithTombstone(store, 'missing')).toBe(store)
  })

  it('resolves the RSVP self attendee from connected account emails', () => {
    const event = {
      ...demoCalendarStore().events[0],
      attendees: [
        {
          name: 'Mira',
          email: 'mira@example.com',
          response: 'accepted' as const,
        },
        {
          name: 'User',
          email: 'Alex@Example.com',
          response: 'needsAction' as const,
        },
      ],
    }
    // Case-insensitive match against the account's address wins over index 0.
    expect(
      resolveRsvpAttendee(event, ['alex@example.com'])?.email,
    ).toBe('Alex@Example.com')
    // No account match: fall back to the first attendee.
    expect(resolveRsvpAttendee(event, ['other@example.com'])?.email).toBe(
      'mira@example.com',
    )
    expect(resolveRsvpAttendee(event, [])?.email).toBe('mira@example.com')
    expect(
      resolveRsvpAttendee({ ...event, attendees: [] }, ['alex@example.com']),
    ).toBeUndefined()
  })

  it('builds a quick-add draft on the first editable calendar', () => {
    const store = demoCalendarStore()
    const event = quickAddCalendarEvent(store, 'tomorrow 2:30pm Planning review', {
      now: new Date('2026-06-20T10:00:00.000Z'),
      timeZone: 'UTC',
    })
    expect(event).not.toBeNull()
    expect(event?.title).toBe('Planning review')
    expect(event?.startsAt).toBe('2026-06-21T14:30:00.000Z')
    expect(event?.calendarId).toBe(firstEditableCalendarId(store))
    expect(event?.lifecycle).toBe('draft')

    expect(quickAddCalendarEvent(store, '   ')).toBeNull()
    // No editable calendar: refuse rather than guess.
    const readOnly = {
      ...store,
      calendars: store.calendars.map(calendar => ({
        ...calendar,
        readOnly: true,
      })),
    }
    expect(quickAddCalendarEvent(readOnly, 'tomorrow standup')).toBeNull()
  })

  it('formats and parses editable event attendees', () => {
    const attendees = parseEventAttendeesText(
      'Mira Example <mira@example.com>\nalex@example.com; Mira Example <mira@example.com>',
    )

    expect(attendees).toEqual([
      { name: 'Mira Example', email: 'mira@example.com', response: 'needsAction' },
      {
        name: 'alex@example.com',
        email: 'alex@example.com',
        response: 'needsAction',
      },
    ])
    expect(formatEventAttendeesText(attendees)).toBe(
      'Mira Example <mira@example.com>\nalex@example.com',
    )
  })

  it('formats and parses editable event reminders', () => {
    const reminders = parseEventReminderMinutes('10, 0, 30, 10, -5, later')

    expect(reminders).toEqual([
      { id: 'reminder_0', minutesBefore: 0 },
      { id: 'reminder_10', minutesBefore: 10 },
      { id: 'reminder_30', minutesBefore: 30 },
    ])
    expect(formatEventReminderMinutes(reminders)).toBe('0, 10, 30')
  })

  it('defaults calendar timezone display to the system timezone', () => {
    const resolved = resolveCalendarTimeZone({})
    expect(resolved.mode).toBe('system')
    expect(resolved.timeZone).toBeTruthy()
    expect(resolved.fallback).toBe(false)
  })

  it('falls back to system timezone when fixed timezone config is invalid', () => {
    const resolved = resolveCalendarTimeZone({
      timeZoneMode: 'fixed',
      timeZone: 'Not/AZone',
    })
    expect(resolved.mode).toBe('system')
    expect(resolved.timeZone).toBe(resolved.systemTimeZone)
    expect(resolved.fallback).toBe(true)
  })

  it('changes displayed wall time without changing the stored instant', () => {
    const iso = '2026-06-20T16:00:00.000Z'
    expect(dateTimeLocalValueInTimeZone(iso, 'UTC')).toBe('2026-06-20T16:00')
    expect(dateTimeLocalValueInTimeZone(iso, 'America/Los_Angeles')).toBe(
      '2026-06-20T09:00',
    )
    expect(iso).toBe('2026-06-20T16:00:00.000Z')
  })

  it('converts fixed-timezone wall time to a canonical instant', () => {
    expect(
      instantFromZonedWallTime('2026-06-20', 9, 15, 'America/Los_Angeles'),
    ).toBe('2026-06-20T16:15:00.000Z')
    expect(
      dateTimeLocalToIsoInTimeZone('2026-06-20T09:15', 'America/Los_Angeles'),
    ).toBe('2026-06-20T16:15:00.000Z')
  })

  it('parses quick event text with relative dates and timezone-safe wall time', () => {
    const parsed = parseQuickCalendarEvent('tomorrow 2:30pm Planning review', {
      now: new Date('2026-06-22T16:00:00.000Z'),
      timeZone: 'America/Los_Angeles',
    })
    expect(parsed).toEqual({
      title: 'Planning review',
      startsAt: '2026-06-23T21:30:00.000Z',
      endsAt: '2026-06-23T22:00:00.000Z',
    })
  })

  it('parses weekday quick events and falls back to a useful title', () => {
    const parsed = parseQuickCalendarEvent('Friday at 09:15', {
      now: new Date('2026-06-22T16:00:00.000Z'),
      timeZone: 'UTC',
      defaultDurationMinutes: 45,
    })
    expect(parsed).toEqual({
      title: 'New event',
      startsAt: '2026-06-26T09:15:00.000Z',
      endsAt: '2026-06-26T10:00:00.000Z',
    })
  })

  it('creates pending calendar events from mail draft intents', () => {
    const event = createEventFromCalendarDraftIntent(
      {
        id: 'calendar_draft_thread_launch',
        resourceId: 'draft-event:mail:acct_demo:thread_launch',
        sourceAppSlug: 'mail',
        source: {
          type: 'email',
          accountId: 'acct_demo',
          threadId: 'thread_launch',
          label: 'Launch copy and rollout notes',
          snippet: 'Mira needs confirmation.',
        },
        title: 'Launch copy and rollout notes',
        description:
          'Mira needs confirmation.\n\nSource: Launch copy and rollout notes',
        attendees: [{ name: 'Mira', email: 'mira@example.com' }],
        linkedItems: [
          {
            type: 'email',
            id: 'thread_launch',
            label: 'Launch copy and rollout notes',
          },
        ],
        createdAt: '2026-06-20T10:00:00.000Z',
      },
      'cal_work',
      '2026-06-21T15:00:00.000Z',
      '2026-06-21T15:30:00.000Z',
      42,
    )
    // Ids carry a collision-proof counter suffix; assert the stable prefix.
    expect(event.id).toMatch(/^event_mail_thread_launch_42_\d+$/)
    expect(event.calendarId).toBe('cal_work')
    expect(event.status).toBe('tentative')
    expect(event.syncState).toBe('pending')
    expect(event.attendees).toEqual([
      { name: 'Mira', email: 'mira@example.com', response: 'needsAction' },
    ])
    expect(event.linkedItems).toEqual([
      {
        type: 'email',
        id: 'thread_launch',
        label: 'Launch copy and rollout notes',
      },
    ])
  })

  it('creates calendar events from email invite intents', () => {
    const event = createEventFromCalendarInviteIntent(
      inviteIntent,
      'cal_work',
      'accepted',
      42,
    )

    // Ids carry a collision-proof counter suffix; assert the stable prefix.
    expect(event.id).toMatch(/^event_invite_invite-test_example_com_42_\d+$/)
    expect(event.externalUid).toBe('invite-test@example.com')
    expect(event.externalSequence).toBe(1)
    expect(event.sourceMessageId).toBe('msg_1')
    expect(event.organizer?.email).toBe('kim@example.com')
    expect(event.attendees[0]?.response).toBe('accepted')
    expect(event.linkedItems).toEqual([
      {
        type: 'email',
        id: 'thread_invite',
        label: 'Invitation: Review meeting',
      },
    ])
  })

  it('updates attendee RSVP and local availability', () => {
    const event = createEventFromCalendarInviteIntent(
      inviteIntent,
      'cal_work',
      'needsAction',
      42,
    )
    const declined = rsvpEvent(event, 'declined', 'alex@example.com')
    const tentative = rsvpEvent(event, 'tentative', 'alex@example.com')

    expect(declined.attendees[0]?.response).toBe('declined')
    expect(declined.busyStatus).toBe('free')
    expect(declined.syncState).toBe('pending')
    expect(tentative.attendees[0]?.response).toBe('tentative')
    expect(tentative.status).toBe('tentative')
    expect(tentative.busyStatus).toBe('tentative')
  })

  it('keeps declined invite-created events free', () => {
    const event = createEventFromCalendarInviteIntent(
      inviteIntent,
      'cal_work',
      'declined',
      42,
    )

    expect(event.attendees[0]?.response).toBe('declined')
    expect(event.busyStatus).toBe('free')
  })

  it('mirrors a new invite onto the local Mail-invites calendar, never pushed', () => {
    const store = demoCalendarStore()
    const result = upsertMirroredInviteEvent(store, inviteIntent)
    expect(result.event.calendarId).toBe(MAIL_INVITE_CALENDAR_ID)
    const stored = result.store.events.find(e => e.id === result.event.id)!
    // 'feed' + 'synced' keeps the Google push loop (source 'provider' +
    // pending) from ever sending mirrored mail invites to Google's servers.
    expect(stored.source).toBe('feed')
    expect(stored.syncState).toBe('synced')
    const account = result.store.accounts.find(
      a => a.id === 'acct_mail_invites',
    )!
    expect(account.provider).toBe('local')
    // clearDemoData (runs when Google connects) must spare the mirror.
    const cleared = clearDemoData(result.store)
    expect(
      cleared.events.some(e => e.id === result.event.id),
    ).toBe(true)
    expect(
      cleared.calendars.some(c => c.id === MAIL_INVITE_CALENDAR_ID),
    ).toBe(true)
  })

  it('a mirrored update never relocates an event the user already has', () => {
    const store = demoCalendarStore()
    const manual = upsertInviteEvent(store, inviteIntent, 'cal_work', 'accepted')
    const mirrored = upsertMirroredInviteEvent(manual.store, {
      ...inviteIntent,
      sequence: inviteIntent.sequence + 1,
      title: 'Review meeting (moved)',
    })
    expect(mirrored.event.calendarId).toBe('cal_work')
    expect(mirrored.event.title).toBe('Review meeting (moved)')
    // The user's recorded RSVP survives the mirrored update.
    expect(mirrored.event.attendees[0]?.response).toBe('accepted')
    expect(
      mirrored.store.calendars.some(c => c.id === MAIL_INVITE_CALENDAR_ID),
    ).toBe(false)
  })

  it('reconciles invite updates by uid and sequence', () => {
    const store = demoCalendarStore()
    const first = upsertInviteEvent(store, inviteIntent, 'cal_work', 'accepted')
    const updated = upsertInviteEvent(
      first.store,
      {
        ...inviteIntent,
        sequence: 2,
        title: 'Review meeting moved',
        startsAt: '2026-06-25T18:00:00.000Z',
        endsAt: '2026-06-25T18:30:00.000Z',
      },
      'cal_work',
      'accepted',
    )

    const matches = updated.store.events.filter(
      event => event.externalUid === inviteIntent.uid,
    )
    expect(matches).toHaveLength(1)
    expect(updated.event.title).toBe('Review meeting moved')
    expect(updated.event.startsAt).toBe('2026-06-25T18:00:00.000Z')
    expect(updated.event.externalSequence).toBe(2)
  })

  it('applies invite cancellations to the matched event', () => {
    const store = demoCalendarStore()
    const first = upsertInviteEvent(store, inviteIntent, 'cal_work', 'accepted')
    const cancelled = upsertInviteEvent(
      first.store,
      {
        ...inviteIntent,
        method: 'CANCEL',
        sequence: 3,
        status: 'cancelled',
      },
      'cal_work',
      'declined',
    )

    expect(cancelled.event.status).toBe('cancelled')
    expect(cancelled.event.busyStatus).toBe('free')
    expect(
      cancelled.store.events.filter(
        event => event.externalUid === inviteIntent.uid,
      ),
    ).toHaveLength(1)
  })

  it('moves events optimistically, preserving duration', () => {
    const event = demoCalendarStore().events[0]
    const moved = moveEvent(event, '2026-06-21T12:00:00.000Z')
    expect(moved.startsAt).toBe('2026-06-21T12:00:00.000Z')
    expect(moved.syncState).toBe('pending')
    expect(Date.parse(moved.endsAt) - Date.parse(moved.startsAt)).toBe(
      Date.parse(event.endsAt) - Date.parse(event.startsAt),
    )
  })

  it('undoes prompt-created events by removing the created event', () => {
    const store = demoCalendarStore()
    const event = createDraftEvent(
      'cal_work',
      '2026-06-21T12:00:00.000Z',
      'Prompt event',
    )
    const created = { ...store, events: [...store.events, event] }
    const undone = undoCalendarEventChange(created, {
      id: 'calendar_undo_create_prompt',
      eventId: event.id,
      action: 'create',
      before: event,
      after: event,
      createdAt: '2026-06-20T10:00:00.000Z',
    })

    expect(undone.events.some(item => item.id === event.id)).toBe(false)
  })

  it('duplicates and cancels events as pending sync operations', () => {
    const event = demoCalendarStore().events[0]
    const duplicated = duplicateEvent(event, '2026-06-21T12:00:00.000Z')
    expect(duplicated.id).not.toBe(event.id)
    expect(duplicated.status).toBe('tentative')
    expect(duplicated.syncState).toBe('pending')
    const cancelled = cancelEvent(event)
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.syncState).toBe('pending')
  })

  it('expands recurring events into view ranges', () => {
    const event = demoCalendarStore().events[0]
    const expanded = expandRecurringEvent(
      event,
      event.startsAt,
      '2999-01-01T00:00:00.000Z',
    )
    expect(expanded).toHaveLength(5)
  })

  it('edits one recurring occurrence by excluding the original instance', () => {
    const store = demoCalendarStore()
    const base = store.events[0]
    const instance = expandRecurringEvent(
      base,
      base.startsAt,
      '2999-01-01T00:00:00.000Z',
    )[2]
    const events = applyRecurringEventEdit(
      store.events,
      instance,
      { title: 'One-off planning review' },
      'this',
    )
    const updatedBase = events.find(event => event.id === base.id)
    const exception = events.find(
      event => event.title === 'One-off planning review',
    )
    expect(updatedBase?.recurrenceRule?.excludedStartsAt).toContain(
      instance.startsAt,
    )
    expect(exception?.recurrenceRule).toBeUndefined()
    expect(
      eventsInRange(events, base.startsAt, '2999-01-01T00:00:00.000Z').filter(
        event =>
          event.id.startsWith(base.id) || event.id.includes(`${base.id}_only_`),
      ),
    ).toHaveLength(5)
  })

  it('edits this and following recurring occurrences by splitting the series', () => {
    const store = demoCalendarStore()
    const base = store.events[0]
    const instance = expandRecurringEvent(
      base,
      base.startsAt,
      '2999-01-01T00:00:00.000Z',
    )[2]
    const events = applyRecurringEventEdit(
      store.events,
      instance,
      { location: 'Studio B' },
      'following',
    )
    const updatedBase = events.find(event => event.id === base.id)
    const following = events.find(event => event.id.endsWith('_following_2'))
    expect(updatedBase?.recurrenceRule?.count).toBe(2)
    expect(following?.recurrenceRule?.count).toBe(3)
    expect(following?.location).toBe('Studio B')
    expect(
      eventsInRange(events, base.startsAt, '2999-01-01T00:00:00.000Z').filter(
        event =>
          event.id.startsWith(base.id) ||
          event.id.includes(`${base.id}_following_`),
      ),
    ).toHaveLength(5)
  })

  it('edits all recurring occurrences by updating the base event', () => {
    const store = demoCalendarStore()
    const base = store.events[0]
    const instance = expandRecurringEvent(
      base,
      base.startsAt,
      '2999-01-01T00:00:00.000Z',
    )[1]
    const events = applyRecurringEventEdit(
      store.events,
      instance,
      { busyStatus: 'tentative' },
      'all',
    )
    expect(events.find(event => event.id === base.id)?.busyStatus).toBe(
      'tentative',
    )
    expect(events.some(event => event.id.includes('_only_'))).toBe(false)
  })

  it('reschedules one recurring occurrence with explicit scope data', () => {
    const store = demoCalendarStore()
    const base = store.events[0]
    const instance = expandRecurringEvent(
      base,
      base.startsAt,
      '2999-01-01T00:00:00.000Z',
    )[1]
    const startsAt = new Date(
      Date.parse(instance.startsAt) + 2 * 60 * 60 * 1000,
    ).toISOString()
    const endsAt = new Date(Date.parse(startsAt) + 45 * 60 * 1000).toISOString()
    const events = applyRecurringEventEdit(
      store.events,
      instance,
      { startsAt, endsAt, timeZone: 'UTC' },
      'this',
    )

    const updatedBase = events.find(event => event.id === base.id)
    const exception = events.find(event => event.id.endsWith('_only_1'))
    expect(updatedBase?.recurrenceRule?.excludedStartsAt).toContain(
      instance.startsAt,
    )
    expect(exception?.startsAt).toBe(startsAt)
    expect(exception?.endsAt).toBe(endsAt)
    expect(exception?.timeZone).toBe('UTC')
  })

  it('renders the same events into a week range', () => {
    const store = demoCalendarStore()
    const range = weekRange(new Date(store.events[0].startsAt))
    expect(
      eventsInRange(store.events, range.start, range.end).length,
    ).toBeGreaterThan(0)
  })

  it('separates all-day events from timed events in date ranges', () => {
    const store = demoCalendarStore()
    const event = store.events[0]
    const timedEvent = {
      ...event,
      id: 'event_timed_same_day',
      startsAt: '2026-06-21T15:00:00.000Z',
      endsAt: '2026-06-21T16:00:00.000Z',
      allDay: false,
    }
    const allDayEvent = {
      ...event,
      id: 'event_all_day',
      title: 'Offsite day',
      startsAt: '2026-06-21T00:00:00.000Z',
      endsAt: '2026-06-22T00:00:00.000Z',
      allDay: true,
    }
    const events = [timedEvent, allDayEvent]
    const allDay = allDayEventsInRange(
      events,
      '2026-06-21T00:00:00.000Z',
      '2026-06-22T00:00:00.000Z',
    )

    expect(allDay.map(item => item.id)).toEqual(['event_all_day'])
    expect(
      eventsInRange(events, allDay[0].startsAt, allDay[0].endsAt).filter(
        item => !item.allDay,
      ),
    ).toHaveLength(1)
  })

  it('shows calendar tasks inside date ranges', () => {
    const store = demoCalendarStore()
    const task = store.tasks[0]
    expect(
      visibleScheduledTasks(
        store.tasks,
        task.scheduledStart!,
        task.scheduledEnd!,
      ),
    ).toHaveLength(1)
  })

  it('updates calendar task detail without converting it into an event', () => {
    const store = demoCalendarStore()
    const task = store.tasks[0]
    const updated = updateCalendarTask(task, {
      title: 'Finish revised launch brief',
      status: 'done',
      dueAt: '',
      scheduledStart: '2026-06-22T19:00:00.000Z',
      scheduledEnd: '2026-06-22T20:00:00.000Z',
    })

    expect(updated.title).toBe('Finish revised launch brief')
    expect(updated.status).toBe('done')
    expect(updated.dueAt).toBeUndefined()
    expect(updated.syncState).toBe('pending')
    expect(updated.sourceLabel).toBe(task.sourceLabel)
    expect(store.events.some(event => event.id === updated.id)).toBe(false)
    expect(
      visibleScheduledTasks(
        [updated],
        '2026-06-22T00:00:00.000Z',
        '2026-06-23T00:00:00.000Z',
      ),
    ).toEqual([updated])
  })

  it('summarizes and recovers failed calendar sync states', () => {
    const store = demoCalendarStore()
    const event = { ...store.events[0], syncState: 'conflict' as const }
    const task = { ...store.tasks[0], syncState: 'failed' as const }
    const conflicted = {
      ...store,
      events: [event, ...store.events.slice(1)],
      tasks: [task, ...store.tasks.slice(1)],
    }

    expect(calendarSyncSummary(conflicted)).toMatchObject({
      conflict: 1,
      failed: 1,
    })

    const eventRetried = recoverCalendarEventSync(conflicted, event.id, 'retry')
    expect(
      eventRetried.events.find(item => item.id === event.id)?.syncState,
    ).toBe('pending')

    const taskResolved = recoverCalendarTaskSync(conflicted, task.id, 'resolve')
    expect(
      taskResolved.tasks.find(item => item.id === task.id)?.syncState,
    ).toBe('synced')

    const retriedAll = retryCalendarSyncFailures(conflicted)
    expect(
      retriedAll.events.find(item => item.id === event.id)?.syncState,
    ).toBe('pending')
    expect(retriedAll.tasks.find(item => item.id === task.id)?.syncState).toBe(
      'pending',
    )
  })

  it('normalizes availability settings with work hour compatibility', () => {
    expect(normalizeAvailabilitySettings({}).availableDays).toEqual([
      1, 2, 3, 4, 5,
    ])
    expect(
      normalizeAvailabilitySettings({ workStart: 8, workEnd: 16 }),
    ).toMatchObject({
      availableStartHour: 8,
      availableEndHour: 16,
    })
    expect(
      normalizeAvailabilitySettings({
        availableDays: [0, 6],
        availableStartHour: 10,
        availableEndHour: 18,
      }),
    ).toEqual({
      availableDays: [0, 6],
      availableStartHour: 10,
      availableEndHour: 18,
    })
  })

  it('checks available wall time by selected timezone day and hour', () => {
    const settings = {
      availableDays: [1],
      availableStartHour: 9,
      availableEndHour: 17,
    }
    expect(
      isAvailableWallTime(
        settings,
        '2026-06-22T16:00:00.000Z',
        9,
        'America/Los_Angeles',
      ),
    ).toBe(true)
    expect(
      isAvailableWallTime(
        settings,
        '2026-06-22T15:00:00.000Z',
        8,
        'America/Los_Angeles',
      ),
    ).toBe(false)
    expect(
      isAvailableWallTime(
        settings,
        '2026-06-23T16:00:00.000Z',
        9,
        'America/Los_Angeles',
      ),
    ).toBe(false)
  })

  it('filters events by visible calendars', () => {
    const store = demoCalendarStore()
    const range = weekRange(new Date(store.events[0].startsAt))
    expect(
      visibleCalendarEvents(store, range.start, range.end).length,
    ).toBeGreaterThan(0)
    const hidden = setCalendarVisibility(store, 'cal_work', false)
    expect(
      visibleCalendarEvents(hidden, range.start, range.end).every(
        event => event.calendarId !== 'cal_work',
      ),
    ).toBe(true)
  })

  it('keeps read-only subscribed calendars visible but excludes them from edits and new event targets', () => {
    const store = demoCalendarStore()
    const readOnlyStore = {
      ...store,
      calendars: store.calendars.map(calendar =>
        calendar.id === 'cal_work' ? { ...calendar, readOnly: true } : calendar,
      ),
    }

    expect(firstEditableCalendarId(readOnlyStore)).toBe('cal_focus')
    expect(
      visibleCalendarEvents(
        readOnlyStore,
        weekRange(new Date(store.events[0].startsAt)).start,
        weekRange(new Date(store.events[0].startsAt)).end,
      ).length,
    ).toBeGreaterThan(0)
    expect(canEditCalendarEvent(readOnlyStore, store.events[0])).toBe(false)
    expect(
      canEditCalendarEvent(readOnlyStore, {
        ...store.events[0],
        id: 'event_focus',
        calendarId: 'cal_focus',
      }),
    ).toBe(true)
  })

  it('searches events, tasks, attendees, and locations with typed results', () => {
    const store = demoCalendarStore()
    const launch = searchCalendarStore(store, 'launch')
    const mira = searchCalendarStore(store, 'mira')
    const brief = searchCalendarStore(store, 'brief')

    expect(
      launch.some(
        result => result.type === 'event' && result.eventId === 'event_standup',
      ),
    ).toBe(true)
    expect(
      mira.some(
        result =>
          result.type === 'person' && result.eventId === 'event_standup',
      ),
    ).toBe(true)
    expect(
      brief.some(
        result => result.type === 'task' && result.taskId === 'task_brief',
      ),
    ).toBe(true)
  })
})
