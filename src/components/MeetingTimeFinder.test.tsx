// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { meetingDraftFlow } from '../lib/meetingTimes'
import type { CalendarEvent, CalendarStore } from '../types'
import { MeetingTimeFinder, type MeetingTimeFinderProps } from './MeetingTimeFinder'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const NOW = new Date('2026-11-01T00:00:00.000Z')

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'evt',
    calendarId: 'cal_work',
    title: 'Private dentist',
    description: 'Root canal',
    startsAt: '2026-11-02T10:00:00.000Z',
    endsAt: '2026-11-02T11:00:00.000Z',
    timeZone: 'Europe/London',
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

function store(events: CalendarEvent[] = []): CalendarStore {
  return {
    accounts: [],
    sources: [{ id: 'src', accountId: 'acct', name: 'Work', syncState: 'online' }],
    calendars: [{ id: 'cal_work', sourceId: 'src', name: 'Work', color: '#111', visible: true }],
    events,
    tasks: [],
    settings: { availableDays: [1, 2, 3, 4, 5], availableStartHour: 9, availableEndHour: 17 },
  }
}

let container: HTMLDivElement
let root: Root
let owner: CalendarStore
let saveDraft: ReturnType<typeof vi.fn>

async function render(props: Partial<MeetingTimeFinderProps> = {}) {
  await act(async () => {
    root.render(
      <MeetingTimeFinder
        defaultFrom="2026-11-02"
        defaultTo="2026-11-06"
        readOwner={async () => ({ store: owner, timeZone: 'Europe/London' })}
        busyReader={null}
        saveDraft={saveDraft as unknown as MeetingTimeFinderProps['saveDraft']}
        onOpenDraft={() => undefined}
        onClose={() => undefined}
        now={() => NOW}
        {...props}
      />,
    )
  })
}

const field = (label: string): HTMLInputElement => {
  const found = [...container.querySelectorAll('label')].find(item => item.textContent?.trim().startsWith(label))
  if (!found) throw new Error(`No field ${label}`)
  return found.querySelector('input')!
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent?.trim() === text)
  if (!button) throw new Error(`No button ${text}; buttons: ${[...container.querySelectorAll('button')].map(item => item.textContent).join(' | ')}`)
  await act(async () => {
    button.click()
  })
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  owner = store()
  saveDraft = vi.fn((draft: CalendarEvent) => {
    owner = { ...owner, events: [...owner.events, draft] }
  })
  meetingDraftFlow.forget()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('Find a time panel', () => {
  it('shows validation errors and searches nothing', async () => {
    const readOwner = vi.fn(async () => ({ store: owner, timeZone: 'Europe/London' }))
    await render({ readOwner })
    await type(field('Minutes'), '0')
    await type(field('Gap before'), '-10')
    await click('Add person')
    await type(field('Time zone'), 'Atlantis/Lost')
    await click('Find times')
    const alert = container.querySelector('[role="alert"]')!.textContent!
    expect(alert).toContain('Duration must be more than 0 minutes')
    expect(alert).toContain('cannot be negative')
    expect(alert).toContain('"Atlantis/Lost" for Participant 1 is not a recognised time zone')
    expect(readOwner).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('Option 1')
    expect(saveDraft).not.toHaveBeenCalled()
  })

  it('says when no time is suitable and why', async () => {
    owner = store([event({ allDay: true, startsAt: '2026-11-02', endsAt: '2026-11-07' })])
    await render()
    await click('Find times')
    expect(container.textContent).toContain('No suitable times')
    expect(container.textContent).toContain('No time qualifies for a 30-minute meeting')
    expect(container.querySelector('textarea')!.value).toContain('Could you suggest a few times')
  })

  it('shows each person\'s local time and labels their availability unknown', async () => {
    owner = store([event({})])
    await render()
    await click('Add person')
    await type(field('Name'), 'Mere')
    await type(field('Time zone'), 'Pacific/Auckland')
    await click('Find times')
    const options = container.querySelectorAll('article')
    expect(options).toHaveLength(3)
    expect(options[0]!.textContent).toContain('Mere')
    expect(options[0]!.textContent).toContain('Pacific/Auckland (GMT+13:00)')
    expect(options[0]!.textContent).toContain('Availability unknown')
    expect(container.textContent).toContain('Mere: availability unknown')
    const proposal = container.querySelector('textarea')!.value
    expect(proposal).toContain("I can't see Mere's calendar")
    expect(proposal).not.toContain('dentist')
    expect(proposal).not.toContain('Root canal')
  })

  it('creates no draft when the chosen time has since been taken', async () => {
    await render()
    await click('Find times')
    const first = container.querySelector('article')!
    expect(first.textContent).toContain('Mon 2 Nov 2026, 09:00–09:30')
    owner = store([event({ id: 'new', startsAt: '2026-11-02T09:00:00.000Z', endsAt: '2026-11-02T09:30:00.000Z' })])
    await click('Draft this time')
    expect(container.querySelector('article [role="alert"]')!.textContent).toContain('No draft was made — search again')
    expect(saveDraft).not.toHaveBeenCalled()
  })

  it('retires suggestions when the request changes, so drafting needs a fresh search', async () => {
    await render()
    await click('Find times')
    expect(container.querySelectorAll('article')).toHaveLength(3)
    await type(field('Minutes'), '60')
    expect(container.querySelectorAll('article')).toHaveLength(0)
    expect(container.querySelector('textarea')).toBeNull()
    expect([...container.querySelectorAll('button')].some(button => button.textContent === 'Draft this time')).toBe(false)
    await click('Find times')
    await click('Draft this time')
    const draft = saveDraft.mock.calls[0]![0] as CalendarEvent
    expect(Date.parse(draft.endsAt) - Date.parse(draft.startsAt)).toBe(60 * 60_000)
  })

  it('discards a search that returns after the request changed', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    await render({
      readOwner: async () => {
        await gate
        return { store: owner, timeZone: 'Europe/London' }
      },
    })
    await click('Find times')
    await type(field('Meeting'), 'Renamed')
    await act(async () => {
      release()
      await gate
    })
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(container.querySelectorAll('article')).toHaveLength(0)
  })

  it('creates one private draft for the chosen time', async () => {
    const onOpenDraft = vi.fn()
    await render({ onOpenDraft })
    await type(field('Meeting'), 'Planning')
    await click('Find times')
    await click('Draft this time')
    expect(saveDraft).toHaveBeenCalledTimes(1)
    const draft = saveDraft.mock.calls[0]![0] as CalendarEvent
    expect(draft).toMatchObject({ title: 'Planning', lifecycle: 'draft', startsAt: '2026-11-02T09:00:00.000Z', endsAt: '2026-11-02T09:30:00.000Z' })
    expect(container.textContent).toContain('Nobody has been told')
    await click('Open draft')
    expect(onOpenDraft).toHaveBeenCalledWith(draft.id)
    // Choosing another option runs the same flow; the first one is not drafted again.
    await click('Draft this time')
    expect(saveDraft).toHaveBeenCalledTimes(2)
    expect(new Set(saveDraft.mock.calls.map(call => (call[0] as CalendarEvent).startsAt)).size).toBe(2)
  })
})
