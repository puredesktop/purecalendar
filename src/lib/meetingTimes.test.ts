import { describe, expect, it, vi } from 'vitest'
import type { CalendarEvent, CalendarSettings, CalendarStore } from '../types'
import { applyRecurringEventEdit, expandRecurringEvent } from './calendarModel'
import { readParticipantAvailability } from './meetingAvailability'
import {
  createMeetingDraftFlow,
  eligibleMeetingStarts,
  findMeetingTimes,
  localTimes,
  meetingProposalText,
  validateMeetingRequest,
  withMeetingDraft,
  type MeetingRequestInput,
  type MeetingSearch,
  type ParticipantAvailability,
} from './meetingTimes'

const LONDON = 'Europe/London'
// Sunday 1 Nov 2026, midnight in London (GMT): the week searched is Mon 2 – Fri 6 Nov.
const NOW = new Date('2026-11-01T00:00:00.000Z')

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'evt',
    calendarId: 'cal_work',
    title: 'Busy',
    description: '',
    startsAt: '2026-11-02T10:00:00.000Z',
    endsAt: '2026-11-02T11:00:00.000Z',
    timeZone: LONDON,
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
    ...overrides,
  }
}

function store(events: CalendarEvent[] = [], settings: CalendarSettings = {}): CalendarStore {
  return {
    accounts: [{ id: 'acct', provider: 'google', name: 'Work', email: 'me@example.com' }],
    sources: [{ id: 'src', accountId: 'acct', name: 'Work', syncState: 'online' }],
    calendars: [
      { id: 'cal_work', sourceId: 'src', name: 'Work', color: '#111', visible: true },
      { id: 'cal_hidden', sourceId: 'src', name: 'Hidden', color: '#222', visible: false },
    ],
    events,
    tasks: [],
    settings: { availableDays: [1, 2, 3, 4, 5], availableStartHour: 9, availableEndHour: 17, ...settings },
  }
}

const owner = (calendar: CalendarStore | null, timeZone = LONDON, now = NOW) => ({ store: calendar, timeZone, now })

const week: MeetingRequestInput = { title: 'Project sync', durationMinutes: 60, from: '2026-11-02', to: '2026-11-06' }
const monday: MeetingRequestInput = { title: 'Project sync', durationMinutes: 60, from: '2026-11-02', to: '2026-11-02' }

function search(input: MeetingRequestInput, calendar: CalendarStore | null, availability: ParticipantAvailability[] = [], timeZone = LONDON, now = NOW): MeetingSearch {
  const result = findMeetingTimes(input, owner(calendar, timeZone, now), availability)
  if (!result.ok) throw new Error(result.errors.join(' '))
  return result
}

const londonClock = (iso: string) => localTimes(iso, iso, LONDON).start

describe('validating a request', () => {
  it('accepts duration, dates, explicit participant zones and nonnegative gaps', () => {
    const result = validateMeetingRequest({
      ...week,
      participants: [{ name: 'Ana', timeZone: 'America/New_York' }, { email: 'kenji@example.com', timeZone: 'Asia/Tokyo' }],
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 15,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.request.participants.map(participant => [participant.label, participant.timeZone])).toEqual([
      ['Ana', 'America/New_York'],
      ['kenji@example.com', 'Asia/Tokyo'],
    ])
    expect(result.request.bufferAfterMinutes).toBe(15)
  })

  it.each([
    [{ participants: [{ name: 'Ana', timeZone: 'Mars/Olympus' }] }, 'not a recognised time zone'],
    [{ participants: [{ name: 'Ana', timeZone: '+05:00' }] }, 'not a recognised time zone'],
    [{ participants: [{ name: 'Ana', timeZone: '' }] }, 'needs a time zone'],
    [{ durationMinutes: 0 }, 'more than 0 minutes'],
    [{ durationMinutes: -30 }, 'more than 0 minutes'],
    [{ from: '2026-11-06', to: '2026-11-02' }, 'before the first day'],
    [{ bufferBeforeMinutes: -5 }, 'cannot be negative'],
    [{ bufferAfterMinutes: -1 }, 'cannot be negative'],
    [{ from: '2026-02-30' }, 'YYYY-MM-DD'],
  ])('refuses %j with no suggestions and no writes', async (patch, message) => {
    const input = { ...week, ...patch } as MeetingRequestInput
    const validation = validateMeetingRequest(input)
    expect(validation.ok).toBe(false)
    if (!validation.ok) expect(validation.errors.join(' ')).toContain(message)
    const result = findMeetingTimes(input, owner(store()))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.kind).toBe('validation')
    expect('options' in result).toBe(false)
    const saveDraft = vi.fn()
    const outcome = await createMeetingDraftFlow().run(input, '2026-11-02T09:00:00.000Z', [], {
      readOwner: async () => ({ store: store(), timeZone: LONDON }),
      saveDraft,
      now: () => NOW,
    })
    expect(outcome.kind).toBe('invalid')
    expect(saveDraft).not.toHaveBeenCalled()
  })
})

describe('ranking three options', () => {
  it('returns exactly three distinct, deterministic options with reasons from the inputs', () => {
    const calendar = store([event({ id: 'a', startsAt: '2026-11-03T10:00:00.000Z', endsAt: '2026-11-03T11:00:00.000Z' })])
    const first = search(week, calendar)
    const second = search(week, calendar)
    expect(first.options).toHaveLength(3)
    expect(new Set(first.options.map(option => option.startsAt)).size).toBe(3)
    expect(first.options).toEqual(second.options)
    expect(first.options.map(option => option.rank)).toEqual([1, 2, 3])
    expect(first.shortfall).toBeNull()
    // Spread over different days.
    expect(new Set(first.options.map(option => option.owner.date)).size).toBe(3)
    for (const option of first.options) expect(option.benefits.length + option.tradeOffs.length).toBeGreaterThan(0)
    // Next to the existing Tuesday 10:00 commitment ranks first; then the day's edge, earliest first.
    expect(first.options.map(option => option.startsAt)).toEqual([
      '2026-11-03T09:00:00.000Z',
      '2026-11-02T09:00:00.000Z',
      '2026-11-04T09:00:00.000Z',
    ])
    expect(first.options[0]!.benefits.join(' ')).toContain('Next to something already on your calendar')
    expect(first.options[1]!.benefits).toEqual([
      'The earliest time that qualifies.',
      'At the edge of your working day, so the middle of the day stays open.',
    ])
  })

  it('ranks against the participant\'s local daytime and says so', () => {
    const result = search({ ...week, participants: [{ name: 'Kenji', timeZone: 'Asia/Tokyo' }] }, store())
    // 09:00 London is 18:00 Tokyo; nothing in London working hours is Tokyo daytime, so each option names the trade-off.
    for (const option of result.options) {
      expect(option.tradeOffs.some(text => text.includes('for Kenji (Asia/Tokyo) — outside weekday 08:00–18:00 there'))).toBe(true)
    }
    const ny = search({ ...week, participants: [{ name: 'Ana', timeZone: 'America/New_York' }] }, store())
    // 13:00 London is 08:00 New York: the first times that are daytime for Ana rank first.
    for (const option of ny.options) {
      expect(Date.parse(option.startsAt)).toBeGreaterThanOrEqual(Date.parse(`${option.owner.date}T13:00:00Z`))
      expect(option.benefits.join(' ')).toContain('Weekday daytime (08:00–18:00) for Ana')
    }
  })

  it('returns none, one or two when that is all that qualifies, and says why', () => {
    const blocked = search(monday, store([event({ id: 'day', allDay: true, startsAt: '2026-11-02', endsAt: '2026-11-03' })]))
    expect(blocked.options).toHaveLength(0)
    expect(blocked.shortfall).toContain('No time qualifies')
    expect(blocked.shortfall).toContain('would overlap something on your calendar')

    const one = search(monday, store([], { availableStartHour: 9, availableEndHour: 10 }))
    expect(one.options.map(option => londonClock(option.startsAt))).toEqual(['09:00'])
    expect(one.shortfall).toContain('Only 1 time qualifies (3 were asked for)')
    expect(one.shortfall).toContain('outside your working hours (Mon, Tue, Wed, Thu, Fri 09:00–10:00, Europe/London)')

    const two = search(monday, store([event({ id: 'long', startsAt: '2026-11-02T09:00:00.000Z', endsAt: '2026-11-02T15:45:00.000Z' })]))
    expect(two.options.map(option => londonClock(option.startsAt))).toEqual(['15:45', '16:00'])
    expect(two.options).toHaveLength(2)
    expect(two.shortfall).toContain('Only 2 times qualify')
    expect(two.options[1]!.tradeOffs.join(' ')).toContain('Overlaps a higher-ranked option')
  })

  it('says when nothing in the range is a working day', () => {
    const weekend = search({ ...week, from: '2026-11-07', to: '2026-11-08' }, store())
    expect(weekend.options).toHaveLength(0)
    expect(weekend.shortfall).toContain('outside your working hours')
  })
})

describe('fitting the owner\'s calendar', () => {
  const day = { ...monday, durationMinutes: 60 }
  const starts = (input: MeetingRequestInput, calendar: CalendarStore) => eligibleMeetingStarts(input, owner(calendar)).map(londonClock)

  it('keeps every option inside the range, the working days and hours', () => {
    const result = search(week, store([], { availableDays: [2, 4], availableStartHour: 10, availableEndHour: 12 }))
    for (const option of result.options) {
      expect(['2026-11-03', '2026-11-05']).toContain(option.owner.date)
      expect(option.owner.start >= '10:00').toBe(true)
      expect(option.owner.end <= '12:00').toBe(true)
      expect(Date.parse(option.endsAt) - Date.parse(option.startsAt)).toBe(60 * 60_000)
    }
  })

  it('allows a meeting that only touches an event, and keeps the gaps clear', () => {
    const calendar = store([event({ startsAt: '2026-11-02T10:00:00.000Z', endsAt: '2026-11-02T11:00:00.000Z' })], { availableEndHour: 13 })
    expect(starts(day, calendar)).toEqual(['09:00', '11:00', '11:15', '11:30', '11:45', '12:00'])
    // 12:00–13:00 keeps its 15-minute gap after working hours: gaps only need to be clear of events.
    expect(starts({ ...day, bufferAfterMinutes: 15 }, calendar)).toEqual(['11:00', '11:15', '11:30', '11:45', '12:00'])
    expect(starts({ ...day, bufferBeforeMinutes: 15 }, calendar)).toEqual(['09:00', '11:15', '11:30', '11:45', '12:00'])
  })

  it('blocks whole days for all-day events (dates or midnight instants), unless marked free', () => {
    const calendar = store(
      [
        event({ id: 'dated', allDay: true, startsAt: '2026-11-03', endsAt: '2026-11-04' }),
        event({ id: 'instant', allDay: true, startsAt: '2026-11-04T00:00:00.000Z', endsAt: '2026-11-05T00:00:00.000Z' }),
        event({ id: 'free', allDay: true, busyStatus: 'free', startsAt: '2026-11-05', endsAt: '2026-11-06' }),
      ],
    )
    const days = new Set(eligibleMeetingStarts(week, owner(calendar)).map(start => start.slice(0, 10)))
    expect([...days]).toEqual(['2026-11-02', '2026-11-05', '2026-11-06'])
  })

  it('treats overlapping busy intervals as one block', () => {
    const calendar = store(
      [
        event({ id: 'a', startsAt: '2026-11-02T10:00:00.000Z', endsAt: '2026-11-02T11:30:00.000Z' }),
        event({ id: 'b', startsAt: '2026-11-02T11:00:00.000Z', endsAt: '2026-11-02T12:00:00.000Z' }),
      ],
      { availableEndHour: 13 },
    )
    expect(starts({ ...day, durationMinutes: 30 }, calendar)).toEqual(['09:00', '09:15', '09:30', '12:00', '12:15', '12:30'])
  })

  it('reads only visible calendars and ignores cancelled and free events', () => {
    const calendar = store(
      [
        event({ id: 'hidden', calendarId: 'cal_hidden' }),
        event({ id: 'cancelled', status: 'cancelled' }),
        event({ id: 'free', busyStatus: 'free' }),
      ],
      { availableEndHour: 12 },
    )
    expect(starts(day, calendar)).toEqual(['09:00', '09:15', '09:30', '09:45', '10:00', '10:15', '10:30', '10:45', '11:00'])
  })

  it('counts drafts as held time', () => {
    const calendar = store([event({ lifecycle: 'draft', startsAt: '2026-11-02T09:00:00.000Z', endsAt: '2026-11-02T16:00:00.000Z' })])
    expect(starts(day, calendar)).toEqual(['16:00'])
  })

  it('never suggests a time already past', () => {
    const later = new Date('2026-11-02T14:05:00.000Z')
    expect(eligibleMeetingStarts(day, owner(store(), LONDON, later)).map(londonClock)).toEqual(['14:15', '14:30', '14:45', '15:00', '15:15', '15:30', '15:45', '16:00'])
  })
})

describe('recurring events', () => {
  // A daily 09:00–10:00 series from the Monday before, five occurrences: Oct 26 – Oct 30 ... then a longer one.
  const series = event({
    id: 'standup',
    startsAt: '2026-10-26T09:00:00.000Z',
    endsAt: '2026-10-26T10:00:00.000Z',
    recurrenceRule: { frequency: 'daily', interval: 1 },
  })
  const nineOClock = (calendar: CalendarStore) =>
    eligibleMeetingStarts(week, owner(calendar))
      .filter(start => londonClock(start) === '09:00')
      .map(start => start.slice(0, 10))

  it('blocks each occurrence inside the search range', () => {
    expect(nineOClock(store([series]))).toEqual([])
    // A series that ended before the range blocks nothing.
    expect(nineOClock(store([{ ...series, recurrenceRule: { frequency: 'daily', interval: 1, count: 5 } }]))).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
    ])
  })

  it('follows moved and cancelled instances the way the calendar does', () => {
    const occurrences = expandRecurringEvent(series, '2026-11-02T00:00:00.000Z', '2026-11-07T00:00:00.000Z')
    const wednesday = occurrences.find(item => item.startsAt.startsWith('2026-11-04'))!
    const thursday = occurrences.find(item => item.startsAt.startsWith('2026-11-05'))!
    let events = applyRecurringEventEdit([series], wednesday, { startsAt: '2026-11-04T14:00:00.000Z', endsAt: '2026-11-04T15:00:00.000Z' }, 'this')
    events = applyRecurringEventEdit(events, thursday, { status: 'cancelled' }, 'this')
    const calendar = store(events)
    // The moved Wednesday instance frees 09:00 and takes 14:00; the cancelled Thursday instance frees 09:00.
    expect(nineOClock(calendar)).toEqual(['2026-11-04', '2026-11-05'])
    const wednesdayStarts = eligibleMeetingStarts({ ...week, from: '2026-11-04', to: '2026-11-04' }, owner(calendar)).map(londonClock)
    expect(wednesdayStarts).not.toContain('14:00')
    expect(wednesdayStarts).not.toContain('13:15')
    expect(wednesdayStarts).toContain('13:00')
    expect(wednesdayStarts).toContain('15:00')
  })
})

describe('time zones', () => {
  const roundTrips = (local: { startIso: string; endIso: string }, startsAt: string, endsAt: string) => {
    expect(Date.parse(local.startIso)).toBe(Date.parse(startsAt))
    expect(Date.parse(local.endIso)).toBe(Date.parse(endsAt))
  }

  it('skips the spring-forward gap and keeps the elapsed duration', () => {
    // Sun 29 Mar 2026, London: 01:00 GMT jumps to 02:00 BST.
    const calendar = store([], { availableDays: [0], availableStartHour: 0, availableEndHour: 6 })
    const input = { durationMinutes: 60, from: '2026-03-29', to: '2026-03-29' }
    const starts = eligibleMeetingStarts(input, owner(calendar, LONDON, new Date('2026-03-01T00:00:00Z')))
    const walls = starts.map(londonClock)
    expect(walls.some(wall => wall.startsWith('01:'))).toBe(false)
    const across = '2026-03-29T00:30:00.000Z'
    expect(starts).toContain(across)
    const local = localTimes(across, '2026-03-29T01:30:00.000Z', LONDON)
    expect([local.start, local.end, local.offset, local.endOffset]).toEqual(['00:30', '02:30', 'GMT+00:00', 'GMT+01:00'])
    roundTrips(local, across, '2026-03-29T01:30:00.000Z')
    const result = search(input, calendar, [], LONDON, new Date('2026-03-01T00:00:00Z'))
    for (const option of result.options) expect(Date.parse(option.endsAt) - Date.parse(option.startsAt)).toBe(60 * 60_000)
  })

  it('offers both repeated fall-back hours, told apart by offset', () => {
    // Sun 1 Nov 2026, New York: 02:00 EDT falls back to 01:00 EST.
    const zone = 'America/New_York'
    const calendar = store([], { availableDays: [0], availableStartHour: 0, availableEndHour: 4 })
    const input = { durationMinutes: 30, from: '2026-11-01', to: '2026-11-01' }
    const starts = eligibleMeetingStarts(input, owner(calendar, zone, new Date('2026-10-01T00:00:00Z')))
    expect(starts).toContain('2026-11-01T05:00:00.000Z')
    expect(starts).toContain('2026-11-01T06:00:00.000Z')
    const first = localTimes('2026-11-01T05:00:00.000Z', '2026-11-01T05:30:00.000Z', zone)
    const second = localTimes('2026-11-01T06:00:00.000Z', '2026-11-01T06:30:00.000Z', zone)
    expect(first.start).toBe('01:00')
    expect(second.start).toBe('01:00')
    expect(first.offset).toBe('GMT-04:00')
    expect(second.offset).toBe('GMT-05:00')
    expect(first.text).not.toBe(second.text)
    roundTrips(first, '2026-11-01T05:00:00.000Z', '2026-11-01T05:30:00.000Z')
    roundTrips(second, '2026-11-01T06:00:00.000Z', '2026-11-01T06:30:00.000Z')
  })

  it('shows participants on different local dates, resolving to the same instants', () => {
    const result = search(
      { ...monday, participants: [{ name: 'Mere', timeZone: 'Pacific/Auckland' }, { name: 'Sam', timeZone: 'America/Los_Angeles' }] },
      store([], { availableStartHour: 14, availableEndHour: 16 }),
    )
    const option = result.options[0]!
    expect(option.owner.dateLabel).toBe('Mon 2 Nov 2026')
    const [mere, sam] = option.participants
    expect(mere!.local.dateLabel).toBe('Tue 3 Nov 2026')
    expect(sam!.local.dateLabel).toBe('Mon 2 Nov 2026')
    for (const local of [option.owner, mere!.local, sam!.local]) {
      roundTrips(local, option.startsAt, option.endsAt)
      expect(Date.parse(local.endIso) - Date.parse(local.startIso)).toBe(60 * 60_000)
    }
    expect(mere!.local.text).toBe('Tue 3 Nov 2026, 03:00–04:00 Pacific/Auckland (GMT+13:00)')
  })

  it('names the end date when the meeting crosses midnight for someone', () => {
    const local = localTimes('2026-11-02T10:30:00.000Z', '2026-11-02T11:30:00.000Z', 'Pacific/Auckland')
    expect(local.text).toBe('Mon 2 Nov 2026, 23:30–Tue 3 Nov 2026, 00:30 Pacific/Auckland (GMT+13:00)')
  })
})

describe('other people\'s availability', () => {
  const teammate = { name: 'Ben', email: 'p-ben@team.invalid', timeZone: LONDON }
  const outsider = { name: 'Ana', email: 'ana@example.com', timeZone: 'America/New_York' }
  const benBusyMorning: ParticipantAvailability = {
    status: 'supplied',
    busy: [{ start: '2026-11-02T00:00:00.000Z', end: '2026-11-06T13:00:00.000Z' }],
    checkedAt: NOW.toISOString(),
    source: 'team calendar',
  }

  it('uses supplied free/busy, and labels everyone else unknown', () => {
    const result = search({ ...week, participants: [teammate, outsider] }, store(), [benBusyMorning, { status: 'none' }])
    for (const option of result.options) {
      expect(Date.parse(option.startsAt)).toBeGreaterThanOrEqual(Date.parse('2026-11-06T13:00:00.000Z'))
      expect(option.participants[0]!.availability).toBe('free')
      expect(option.participants[1]!.availability).toBe('unknown')
      expect(option.participants[1]!.availabilityNote).toBe('Availability unknown')
    }
    expect(result.availabilityCaveats[1]).toContain('Ana: availability unknown')
    expect(result.availabilityCaveats[1]).toContain('not whether they are free')
  })

  it('does not trust stale or unavailable free/busy, and says so', () => {
    const stale: ParticipantAvailability = { ...benBusyMorning, checkedAt: new Date(NOW.getTime() - 60 * 60_000).toISOString() } as ParticipantAvailability
    const staleResult = search({ ...monday, participants: [teammate] }, store(), [stale])
    // The stale reading said busy all Monday; it is not used, so Monday still has times — labelled unknown.
    expect(staleResult.options).toHaveLength(3)
    expect(staleResult.options.every(option => option.participants[0]!.availability === 'unknown')).toBe(true)
    expect(staleResult.availabilityCaveats[0]).toContain('too long ago to rely on')
    const failed = search({ ...monday, participants: [teammate] }, store(), [{ status: 'unavailable', reason: 'offline', source: 'team calendar' }])
    expect(failed.options[0]!.participants[0]!.availability).toBe('unknown')
    expect(failed.availabilityCaveats[0]).toContain('could not be read (offline)')
    expect(meetingProposalText(failed)).toContain("I can't see Ben's calendar")
  })

  it('never claims mutual availability from a time zone alone', () => {
    const result = search({ ...week, participants: [outsider] }, store())
    const text = meetingProposalText(result)
    expect(result.options.every(option => option.participants.every(slot => slot.availability === 'unknown'))).toBe(true)
    expect(text).not.toMatch(/look(s)? free/)
    expect(text).toContain("I can't see Ana's calendar, so I don't know whether these suit")
  })

  it('reads the team calendar only for teammates, and a failed read is unknown, not free', async () => {
    const participants = [
      { label: 'Ben', email: 'p-ben@team.invalid', timeZone: LONDON },
      { label: 'Ana', email: 'ana@example.com', timeZone: LONDON },
    ]
    const reader = vi.fn(async () => [{ id: 'p-ben', name: 'Ben', times: [{ start: '2026-11-02T09:00:00Z', end: '2026-11-02T10:00:00Z' }] }])
    const read = await readParticipantAvailability(participants, 'a', 'b', reader, NOW)
    expect(reader).toHaveBeenCalledWith(['p-ben'], 'a', 'b')
    expect(read[0]).toMatchObject({ status: 'supplied', checkedAt: NOW.toISOString() })
    expect(read[1]).toEqual({ status: 'none' })
    const failing = await readParticipantAvailability(participants, 'a', 'b', async () => { throw new Error('server down') }, NOW)
    expect(failing[0]).toEqual({ status: 'unavailable', reason: 'server down', source: 'team calendar' })
    const absent = await readParticipantAvailability(participants, 'a', 'b', null, NOW)
    expect(absent[0]!.status).toBe('unavailable')
    expect(absent[1]).toEqual({ status: 'none' })
  })
})

describe('proposal wording', () => {
  it('lists every participant\'s local times with the zone and caveats, and nothing from other events', () => {
    const calendar = store([event({ title: 'Secret board review', description: 'Acquisition of Foo Ltd', location: 'Room 4' })])
    const result = search(
      { ...week, participants: [{ name: 'Mere', timeZone: 'Pacific/Auckland' }, { name: 'Ana', timeZone: 'America/New_York' }] },
      calendar,
    )
    const text = meetingProposalText(result)
    for (const option of result.options) {
      expect(text).toContain(`Option ${option.rank}: ${option.owner.text}`)
      for (const slot of option.participants) {
        expect(text).toContain(`${slot.label}: ${slot.local.text}`)
        expect(slot.local.text).toContain(slot.timeZone)
        expect(slot.local.text).toContain(slot.local.dateLabel)
      }
    }
    expect(text).toContain("I can't see Mere, Ana's calendars")
    expect(text).toContain('Nothing is booked until we agree on a time.')
    expect(text).not.toContain('Secret')
    expect(text).not.toContain('Acquisition')
    expect(text).not.toContain('Room 4')
    for (const option of result.options) {
      expect([...option.benefits, ...option.tradeOffs].join(' ')).not.toContain('Secret')
    }
  })

  it('asks for times when none qualify', () => {
    const result = search(monday, store([event({ allDay: true, startsAt: '2026-11-02', endsAt: '2026-11-03' })]))
    expect(meetingProposalText(result)).toContain('Could you suggest a few times that work for you?')
  })
})

describe('the owner\'s calendar could not be read', () => {
  it('refuses rather than treating a failed calendar as empty', () => {
    const failed = { ...store(), failedCalendarIds: ['cal_work'] }
    const result = findMeetingTimes(week, owner(failed))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('owner-calendar')
      expect(result.errors[0]).toContain('Work could not be read')
    }
    const errored = store()
    errored.sources[0]!.syncState = 'error'
    expect(findMeetingTimes(week, owner(errored)).ok).toBe(false)
    expect(findMeetingTimes(week, owner(null)).ok).toBe(false)
    expect(eligibleMeetingStarts(week, owner(failed))).toEqual([])
  })

  it('still searches when only a hidden calendar failed', () => {
    expect(findMeetingTimes(week, owner({ ...store(), failedCalendarIds: ['cal_hidden'] })).ok).toBe(true)
  })
})

describe('saving a draft into the app (the panel\'s save path)', () => {
  it('brings in the draft\'s calendar from the refreshed copy, keeping changes made meanwhile', () => {
    const current = store([event({ id: 'meanwhile' })])
    const refreshed: CalendarStore = {
      ...store(),
      accounts: [{ id: 'google-account', provider: 'google', name: 'Google', email: 'me@gmail.com' }],
      sources: [...store().sources, { id: 'google-source', accountId: 'google-account', name: 'Google', syncState: 'online' }],
      calendars: [...store().calendars, { id: 'new-primary', sourceId: 'google-source', name: 'Primary', color: '#4285f4', visible: true }],
    }
    const draft = event({ id: 'draft', calendarId: 'new-primary', lifecycle: 'draft' })
    const saved = withMeetingDraft(current, draft, refreshed)
    expect(saved.calendars.map(calendar => calendar.id)).toEqual(['cal_work', 'cal_hidden', 'new-primary'])
    expect(saved.sources.map(source => source.id)).toEqual(['src', 'google-source'])
    expect(saved.accounts.map(account => account.id)).toEqual(['acct', 'google-account'])
    expect(saved.events.map(item => item.id)).toEqual(['meanwhile', 'draft'])
    // Already known: nothing duplicated.
    expect(withMeetingDraft(saved, event({ id: 'second', calendarId: 'new-primary' }), refreshed).calendars).toHaveLength(3)
  })
})

describe('choosing an option', () => {
  const participants = [
    { name: 'Ben', email: 'p-ben@team.invalid', timeZone: LONDON },
    { name: 'Ana', email: 'ana@example.com', timeZone: 'America/New_York' },
  ]
  const input = { ...week, participants, bufferAfterMinutes: 15 }
  const benFree: ParticipantAvailability = { status: 'supplied', busy: [], checkedAt: NOW.toISOString(), source: 'team calendar' }

  function harness(initial: CalendarStore) {
    let live = initial
    const saveDraft = vi.fn((draft: CalendarEvent, base: CalendarStore) => {
      live = { ...base, events: [...live.events, draft] }
    })
    const readParticipants = vi.fn(async () => [benFree])
    return {
      saveDraft,
      readParticipants,
      deps: { readOwner: async () => ({ store: live, timeZone: LONDON }), readParticipants, saveDraft, now: () => NOW },
      live: () => live,
      set: (next: CalendarStore) => {
        live = next
      },
    }
  }

  it('creates one private draft at the chosen instant and duration, once', async () => {
    const existing = event({ id: 'keep', startsAt: '2026-11-03T10:00:00.000Z', endsAt: '2026-11-03T11:00:00.000Z' })
    const h = harness(store([existing]))
    const found = search(input, h.live(), [benFree, { status: 'none' }])
    const chosen = found.options[1]!
    const flow = createMeetingDraftFlow()
    const [first, again] = await Promise.all([
      flow.run(input, chosen.startsAt, found.availability, h.deps),
      flow.run(input, chosen.startsAt, found.availability, h.deps),
    ])
    const third = await flow.run(input, chosen.startsAt, found.availability, h.deps)
    expect(first.kind).toBe('created')
    expect(again.kind).toBe('already-created')
    expect(third.kind).toBe('already-created')
    expect(h.saveDraft).toHaveBeenCalledTimes(1)
    const drafts = h.live().events.filter(item => item.id !== 'keep')
    expect(drafts).toHaveLength(1)
    const draft = drafts[0]!
    expect(draft.lifecycle).toBe('draft')
    expect(draft.startsAt).toBe(chosen.startsAt)
    expect(Date.parse(draft.endsAt) - Date.parse(draft.startsAt)).toBe(60 * 60_000)
    expect(draft.title).toBe('Project sync')
    expect(draft.attendees.map(attendee => attendee.email)).toEqual(['p-ben@team.invalid', 'ana@example.com'])
    expect(h.live().events.find(item => item.id === 'keep')).toEqual(existing)
    expect(h.readParticipants).toHaveBeenCalledTimes(1)
    if (first.kind === 'created') expect(first.summary).toContain('Nobody has been told')
    // An identical draft already on the calendar (made in an earlier session) is not drafted again either.
    const fresh = await createMeetingDraftFlow().run(input, chosen.startsAt, found.availability, h.deps)
    expect(fresh.kind).toBe('already-created')
    expect(h.saveDraft).toHaveBeenCalledTimes(1)
  })

  it('makes no draft when the time now conflicts', async () => {
    const h = harness(store())
    const found = search(input, h.live(), [benFree, { status: 'none' }])
    const chosen = found.options[0]!
    h.set(store([event({ id: 'new', startsAt: chosen.endsAt, endsAt: new Date(Date.parse(chosen.endsAt) + 30 * 60_000).toISOString() })]))
    const outcome = await createMeetingDraftFlow().run(input, chosen.startsAt, found.availability, h.deps)
    expect(outcome.kind).toBe('conflict')
    if (outcome.kind === 'conflict') expect(outcome.reason).toContain('search again')
    expect(h.saveDraft).not.toHaveBeenCalled()
  })

  it('makes no draft when a participant is now busy', async () => {
    const h = harness(store())
    const found = search(input, h.live(), [benFree, { status: 'none' }])
    const chosen = found.options[0]!
    h.readParticipants.mockResolvedValueOnce([{ ...benFree, busy: [{ start: chosen.startsAt, end: chosen.endsAt }] }])
    const outcome = await createMeetingDraftFlow().run(input, chosen.startsAt, found.availability, h.deps)
    expect(outcome).toEqual({ kind: 'conflict', reason: 'Ben is now busy then. No draft was made — search again for fresh options.' })
    expect(h.saveDraft).not.toHaveBeenCalled()
  })

  it('makes no draft when a required recheck fails, and says what to do', async () => {
    const h = harness(store())
    const found = search(input, h.live(), [benFree, { status: 'none' }])
    const chosen = found.options[0]!
    h.readParticipants.mockRejectedValueOnce(new Error('team server unreachable'))
    const failed = await createMeetingDraftFlow().run(input, chosen.startsAt, found.availability, h.deps)
    expect(failed.kind).toBe('recheck-failed')
    if (failed.kind === 'recheck-failed') expect(failed.reason).toContain('team server unreachable')
    h.readParticipants.mockResolvedValueOnce([{ status: 'unavailable', reason: 'offline', source: 'team calendar' }])
    const unavailable = await createMeetingDraftFlow().run(input, chosen.startsAt, found.availability, h.deps)
    expect(unavailable.kind).toBe('recheck-failed')
    const ownerFails = await createMeetingDraftFlow().run(input, chosen.startsAt, found.availability, {
      ...h.deps,
      readOwner: async () => ({ store: { ...store(), failedCalendarIds: ['cal_work'] }, timeZone: LONDON }),
    })
    expect(ownerFails.kind).toBe('recheck-failed')
    const ownerThrows = await createMeetingDraftFlow().run(input, chosen.startsAt, found.availability, {
      ...h.deps,
      readOwner: async () => {
        throw new Error('disk busy')
      },
    })
    expect(ownerThrows.kind).toBe('recheck-failed')
    expect(h.saveDraft).not.toHaveBeenCalled()
  })

  it('drafts again for different people at the same title and time', async () => {
    const h = harness(store())
    const forAna = { ...week, participants: [participants[1]!] }
    const found = search(forAna, h.live())
    const chosen = found.options[0]!
    const anaDraft = await createMeetingDraftFlow().run(forAna, chosen.startsAt, found.availability, h.deps)
    expect(anaDraft.kind).toBe('created')
    const forBen = { ...week, participants: [{ name: 'Ben', email: 'ben@example.com', timeZone: LONDON }] }
    // Ana's draft holds the time now, so Ben's is refused as a conflict — never answered with Ana's draft.
    const benDraft = await createMeetingDraftFlow().run(forBen, chosen.startsAt, [], h.deps)
    expect(benDraft.kind).toBe('conflict')
    expect(h.saveDraft).toHaveBeenCalledTimes(1)
    const again = await createMeetingDraftFlow().run(forAna, chosen.startsAt, found.availability, h.deps)
    expect(again.kind).toBe('already-created')
    if (again.kind === 'already-created') expect(again.event.attendees.map(attendee => attendee.email)).toEqual(['ana@example.com'])
  })

  it('makes no draft when a required recheck comes back out of date', async () => {
    const h = harness(store())
    const found = search(input, h.live(), [benFree, { status: 'none' }])
    const chosen = found.options[0]!
    h.readParticipants.mockResolvedValueOnce([
      { ...benFree, checkedAt: new Date(NOW.getTime() - 60 * 60_000).toISOString(), busy: [{ start: chosen.startsAt, end: chosen.endsAt }] },
    ])
    const outcome = await createMeetingDraftFlow().run(input, chosen.startsAt, found.availability, h.deps)
    expect(outcome.kind).toBe('recheck-failed')
    if (outcome.kind === 'recheck-failed') expect(outcome.reason).toContain('Ben (their free/busy came back out of date)')
    expect(h.saveDraft).not.toHaveBeenCalled()
  })

  it('refuses times past how far ahead the calendars were read', async () => {
    const h = harness(store())
    const result = findMeetingTimes(week, { ...owner(store()), coveredUntil: '2026-11-04T00:00:00.000Z' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]).toContain('only read up to Tue 3 Nov 2026')
    const outcome = await createMeetingDraftFlow().run(week, '2026-11-02T09:00:00.000Z', [], {
      ...h.deps,
      readOwner: async () => ({ store: h.live(), timeZone: LONDON, coveredUntil: '2026-11-04T00:00:00.000Z' }),
    })
    expect(outcome.kind).toBe('recheck-failed')
    expect(h.saveDraft).not.toHaveBeenCalled()
  })

  it.each([
    ['moved and shortened', { startsAt: '2026-11-02T14:00:00.000Z', endsAt: '2026-11-02T14:30:00.000Z' }, 'Mon 2 Nov 2026, 14:00–14:30'],
    ['given other people', { attendees: [{ name: 'Ben', email: 'ben@example.com', response: 'needsAction' as const }] }, 'with Ben'],
    ['activated', { lifecycle: 'active' as const }, 'no longer a draft'],
  ])('does not pass off an earlier draft that has since been %s as the choice', async (_, edit, says) => {
    const h = harness(store())
    const forAna = { ...week, participants: [participants[1]!] }
    const found = search(forAna, h.live())
    const chosen = found.options[0]!
    expect(chosen.startsAt).not.toBe('2026-11-02T14:00:00.000Z')
    const flow = createMeetingDraftFlow()
    const first = await flow.run(forAna, chosen.startsAt, found.availability, h.deps)
    if (first.kind !== 'created') throw new Error(first.kind)
    const edited = { ...h.live().events.find(item => item.id === first.event.id)!, ...edit }
    h.set({ ...h.live(), events: h.live().events.map(item => (item.id === edited.id ? edited : item)) })
    const again = await flow.run(forAna, chosen.startsAt, found.availability, h.deps)
    expect(again.kind).toBe('draft-changed')
    if (again.kind === 'draft-changed') {
      expect(again.reason).toContain(says)
      expect(again.reason).toContain('It was left as it is and no new draft was made')
    }
    // The edited event is left exactly as the person made it, and nothing more was written.
    expect(h.live().events.find(item => item.id === edited.id)).toEqual(edited)
    expect(h.saveDraft).toHaveBeenCalledTimes(1)
    // Choosing the time again is no longer answered with the edited event.
    const third = await flow.run(forAna, chosen.startsAt, found.availability, h.deps)
    expect(third.kind).not.toBe('already-created')
  })

  it('does not need a participant recheck when none qualified the time', async () => {
    const h = harness(store())
    const outsiderOnly = { ...week, participants: [participants[1]!] }
    const found = search(outsiderOnly, h.live())
    const outcome = await createMeetingDraftFlow().run(outsiderOnly, found.options[0]!.startsAt, found.availability, h.deps)
    expect(outcome.kind).toBe('created')
    expect(h.readParticipants).not.toHaveBeenCalled()
  })
})
