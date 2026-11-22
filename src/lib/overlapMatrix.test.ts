import { describe, expect, it } from 'vitest'
import { buildOverlapMatrix, formatProposedSlotsText } from './overlapMatrix'
import { buildAnonymizedBusyIntervals, computeUpcomingOpenSlots } from './schedulingClient'
import type { CalendarStore } from '../types'

function makeStore(): CalendarStore {
  return {
    accounts: [{ id: 'acc1', provider: 'local', name: 'Local', email: 'me@example.com' }],
    sources: [{ id: 'src1', accountId: 'acc1', name: 'Local', syncState: 'online' }],
    calendars: [
      { id: 'cal1', sourceId: 'src1', name: 'Work', color: '#1d57b8', visible: true },
      { id: 'calHidden', sourceId: 'src1', name: 'Hidden', color: '#888', visible: false },
    ],
    events: [
      {
        id: 'ev1',
        calendarId: 'cal1',
        title: 'Secret Board Meeting',
        description: 'Confidential',
        startsAt: '2026-11-24T17:00:00.000Z', // 09:00 LA
        endsAt: '2026-11-24T18:00:00.000Z', // 10:00 LA
        timeZone: 'America/Los_Angeles',
        allDay: false,
        status: 'confirmed',
        visibility: 'private',
        busyStatus: 'busy',
        attendees: [],
        reminders: [],
        attachments: [],
        linkedItems: [],
        source: 'provider',
        syncState: 'synced',
      },
      {
        id: 'evHidden',
        calendarId: 'calHidden',
        title: 'Hidden Event',
        description: '',
        startsAt: '2026-11-24T18:00:00.000Z',
        endsAt: '2026-11-24T19:00:00.000Z',
        timeZone: 'America/Los_Angeles',
        allDay: false,
        status: 'confirmed',
        visibility: 'default',
        busyStatus: 'busy',
        attendees: [],
        reminders: [],
        attachments: [],
        linkedItems: [],
        source: 'provider',
        syncState: 'synced',
      },
    ],
    tasks: [],
    settings: {
      availableDays: [1, 2, 3, 4, 5],
      availableStartHour: 9,
      availableEndHour: 17,
      timeZoneMode: 'fixed',
      timeZone: 'America/Los_Angeles',
    },
  }
}

describe('overlapMatrix & schedulingClient', () => {
  it('marks owner busy slots, teammate busy slots, and golden multi-TZ overlap hours', () => {
    const store = makeStore()
    const matrix = buildOverlapMatrix({
      store,
      ownerTimeZone: 'America/Los_Angeles',
      fromDateKey: '2026-11-24',
      toDateKey: '2026-11-24',
      durationMinutes: 60,
      stepMinutes: 60,
      participants: [{ label: 'Clara', timeZone: 'Europe/London' }],
      now: new Date('2026-11-24T00:00:00Z'),
    })
    const day = matrix.days[0]!
    // 09:00 LA = 17:00Z -> owner busy
    expect(day.cells[9]?.quality).toBe('owner-busy')
    // 08:00 LA = 16:00 London (daytime London, stretch LA -> good)
    expect(day.cells[8]?.quality).toBe('good')
    // 09:00 LA is busy, 10:00 LA = 18:00 London (stretch London -> good)
    expect(day.cells[10]?.quality).toBe('good')
  })

  it('produces fairness note when there is no 9-5 overlap across far-flung zones (SF + London + Auckland)', () => {
    const store = makeStore()
    const matrix = buildOverlapMatrix({
      store,
      ownerTimeZone: 'America/Los_Angeles',
      fromDateKey: '2026-11-24',
      toDateKey: '2026-11-24',
      durationMinutes: 30,
      stepMinutes: 60,
      participants: [
        { label: 'London', timeZone: 'Europe/London' },
        { label: 'Auckland', timeZone: 'Pacific/Auckland' },
      ],
      now: new Date('2026-11-24T00:00:00Z'),
    })
    expect(matrix.fairnessNote).toBeTruthy()
  })

  it('formats crisp multi-timezone proposed slot text with booking link', () => {
    const text = formatProposedSlotsText(
      [{ start: '2026-11-24T18:00:00.000Z', end: '2026-11-24T18:30:00.000Z' }],
      [
        { label: 'SF', timeZone: 'America/Los_Angeles' },
        { label: 'London', timeZone: 'Europe/London' },
        { label: 'Tokyo', timeZone: 'Asia/Tokyo' },
      ],
      {
        title: 'Architecture Sync',
        bookingUrl: 'https://cloud.pure.test/book/i/abc',
        timeFormat: '24h',
        referenceTimeZone: 'America/Los_Angeles',
      },
    )
    expect(text).toContain('Architecture Sync')
    expect(text).toContain('10:00–10:30 SF')
    expect(text).toContain('18:00–18:30 London')
    expect(text).toContain('03:00–03:30 Tokyo (+1d)')
    expect(text).toContain('https://cloud.pure.test/book/i/abc')
  })

  it('extracts ONLY anonymized busy intervals from visible calendars', () => {
    const store = makeStore()
    const busy = buildAnonymizedBusyIntervals(
      store,
      '2026-11-24T00:00:00Z',
      '2026-11-25T00:00:00Z',
      'America/Los_Angeles',
    )
    expect(busy).toEqual([{ start: '2026-11-24T17:00:00.000Z', end: '2026-11-24T18:00:00.000Z' }])
    expect(JSON.stringify(busy)).not.toContain('Secret Board Meeting')
  })

  it('computes upcoming open slots skipping busy intervals', () => {
    const store = makeStore()
    const slots = computeUpcomingOpenSlots(store, 'America/Los_Angeles', new Date('2026-11-24T15:00:00Z'), 30, 6)
    expect(slots.length).toBeGreaterThan(0)
    expect(slots.some(s => s.start === '2026-11-24T17:00:00.000Z')).toBe(false)
  })
})
