import type { CalendarStore } from '../types'

function addDays(iso: string, days: number): string {
  const date = new Date(iso)
  date.setDate(date.getDate() + days)
  return date.toISOString()
}

// Synthetic data used only by tests. The production workspace starts empty.
export function calendarFixture(): CalendarStore {
  const account = {
    id: 'acct_demo',
    provider: 'demo' as const,
    name: 'Alex Example',
    email: 'alex@example.com',
  }
  const source = {
    id: 'src_demo',
    accountId: account.id,
    name: 'Demo calendar source',
    syncState: 'online' as const,
  }
  const work = {
    id: 'cal_work',
    sourceId: source.id,
    name: 'Work',
    color: '#367f73',
    visible: true,
  }
  const focus = {
    id: 'cal_focus',
    sourceId: source.id,
    name: 'Focus',
    color: '#6f6aa8',
    visible: true,
  }
  const base = new Date()
  base.setHours(9, 0, 0, 0)
  const first = base.toISOString()
  return {
    accounts: [account],
    sources: [source],
    calendars: [work, focus],
    events: [
      {
        id: 'event_standup',
        calendarId: work.id,
        title: 'Team standup',
        description: 'Daily coordination and blockers.',
        startsAt: first,
        endsAt: new Date(Date.parse(first) + 30 * 60 * 1000).toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        allDay: false,
        status: 'confirmed',
        visibility: 'default',
        busyStatus: 'busy',
        attendees: [
          { name: 'Mira', email: 'mira@example.com', response: 'accepted' },
        ],
        reminders: [{ id: 'reminder_1', minutesBefore: 10 }],
        attachments: [],
        linkedItems: [
          {
            type: 'project',
            id: 'project_launch',
            label: 'Launch coordination',
          },
        ],
        recurrenceRule: { frequency: 'daily', interval: 1, count: 5 },
        source: 'demo',
        syncState: 'synced',
      },
      {
        id: 'event_review',
        calendarId: work.id,
        title: 'Design review',
        description: 'Review updated app surfaces.',
        startsAt: addDays(first, 1),
        endsAt: new Date(
          Date.parse(addDays(first, 1)) + 60 * 60 * 1000,
        ).toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        allDay: false,
        status: 'tentative',
        visibility: 'default',
        busyStatus: 'tentative',
        attendees: [],
        reminders: [],
        attachments: [
          {
            id: 'att_design',
            name: 'design-notes.md',
            mimeType: 'text/markdown',
            sizeLabel: '8 KB',
          },
        ],
        linkedItems: [
          { type: 'document', id: 'doc_design', label: 'Design review notes' },
        ],
        source: 'demo',
        syncState: 'synced',
      },
    ],
    tasks: [
      {
        id: 'task_brief',
        calendarId: 'cal_focus',
        title: 'Prepare launch brief',
        dueAt: addDays(first, 2).slice(0, 10),
        scheduledStart: addDays(first, 2),
        scheduledEnd: new Date(
          Date.parse(addDays(first, 2)) + 45 * 60 * 1000,
        ).toISOString(),
        sourceLabel: 'PureTasks',
        status: 'open',
        syncState: 'synced',
      },
    ],
    settings: {
      viewMode: 'week',
      workStart: 9,
      workEnd: 17,
      availableDays: [1, 2, 3, 4, 5],
      availableStartHour: 9,
      availableEndHour: 17,
    },
  }
}
