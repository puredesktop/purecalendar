// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PureCalendarShell } from './PureCalendarShell'
import { calendarFixture } from '../test/calendarFixtures'

vi.mock('@purescience/platform-ui/bridge/client', async importOriginal => ({
  ...(await importOriginal<object>()),
  bridge: {
    call: vi.fn(async () => null),
    on: vi.fn(() => () => undefined),
    onEvent: vi.fn(() => () => undefined),
    subscribe: vi.fn(() => () => undefined),
    getMethods: vi.fn(() => []),
  },
}))
vi.mock('../bridge/platformBridge', async importOriginal => ({
  ...(await importOriginal<object>()),
  fetchGoogleCredentialStatus: vi.fn(async () => null),
  saveCalendarSettings: vi.fn(async () => undefined),
  writeCalendarStoreFile: vi.fn(async () => undefined),
}))
vi.mock('@purescience/platform-bridge/components/settings/AppSettings', () => ({
  AppSettingsPages: () => null,
  useAppSettings: () => ({ isOpen: false, open: () => undefined, close: () => undefined }),
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

async function clickButton(label: string) {
  const btn = [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === label)
  if (!btn) {
    throw new Error(
      `Button "${label}" not found. Available: ${[...container.querySelectorAll('button')]
        .map(b => b.textContent?.trim())
        .filter(Boolean)
        .slice(0, 30)
        .join(' | ')}`,
    )
  }
  await act(async () => {
    btn.click()
  })
}

describe('PureCalendar Next UX: multi-timezone rails, navigator, 3-day view, share availability, booking links & palette', () => {
  it('renders multi-timezone rails, travel preview banner, 3-day view, share bar, booking links studio, and command palette', async () => {
    const initial = calendarFixture()
    initial.settings = {
      ...initial.settings,
      timeZoneMode: 'fixed',
      timeZone: 'America/Los_Angeles',
      showLeftRail: true,
      pinnedTimeZones: [
        { id: 'pin-ldn', timeZone: 'Europe/London', label: 'London', showOnGrid: true },
        { id: 'pin-tyo', timeZone: 'Asia/Tokyo', label: 'Tokyo', showOnGrid: true },
      ],
    }

    await act(async () => {
      root.render(<PureCalendarShell initialStore={initial} />)
    })

    // Left desk navigator rail is visible with mini-month & world clocks
    expect(container.querySelector('[aria-label="Calendar navigator"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Mini month"]')).not.toBeNull()

    // Multi-timezone grid rails render side-by-side for London, Tokyo, and primary LA
    expect(container.querySelector('[aria-label="London time rail"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Tokyo time rail"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="America/Los_Angeles primary time rail"]')).not.toBeNull()

    // Click London rail header to enter Travel Preview mode
    const londonHeader = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('LDN'))
    expect(londonHeader).toBeTruthy()
    await act(async () => {
      londonHeader!.click()
    })
    expect(container.textContent).toContain('Viewing calendar in London')

    // Return to home timezone
    await clickButton('Return to SFO')
    expect(container.textContent).not.toContain('Viewing calendar in London')

    // Switch to 3-Day view
    await clickButton('3-Day')
    expect(container.querySelectorAll('section[aria-label^="Schedule for "]').length).toBe(3)

    // Open Share Availability mode
    await clickButton('Share times')
    expect(container.querySelector('[aria-label="Share availability mode"]')).not.toBeNull()

    // Open Booking links studio and create a local booking link
    await clickButton('Booking links')
    expect(container.querySelector('[aria-label="Booking links and scheduling studio"]')).not.toBeNull()
    await clickButton('New booking page')
    await clickButton('Create link')
    expect(container.textContent).toContain('30 min Intro')

    // Open Command Palette
    await clickButton('⌘K')
    expect(container.querySelector('[aria-label="Command palette"]')).not.toBeNull()
  })
})
