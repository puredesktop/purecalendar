// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const call = vi.hoisted(() => vi.fn())
vi.mock('../bridge/platformBridge', () => ({ bridge: { call } }))

const { useBackgroundWork } = await import('./useBackgroundWork')

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let allowed: boolean | undefined
function Probe() { allowed = useBackgroundWork(); return null }
const render = () => act(async () => root.render(<Probe />))
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
const shell = { postMessage: vi.fn() }
/** What this frame's window sees above it. */
function framed(parent: unknown, top: unknown): void {
  Object.defineProperty(window, 'parent', { value: parent, configurable: true })
  Object.defineProperty(window, 'top', { value: top, configurable: true })
}

beforeEach(() => {
  call.mockReset()
  allowed = undefined
  root = createRoot(document.createElement('div'))
})
afterEach(async () => {
  await act(async () => root.unmount())
  framed(window, window)
  vi.useRealTimers()
})

describe('useBackgroundWork', () => {
  it('runs in standalone dev, with nothing above the page', async () => {
    framed(window, window)
    await render()
    expect(allowed).toBe(true)
    expect(call).not.toHaveBeenCalled()
  })

  it('never runs in a copy nested in a room, even grown to the full app', async () => {
    framed({ holder: true }, shell)
    await render()
    await settle()
    expect(allowed).toBe(false)
    expect(call).not.toHaveBeenCalled()
  })

  it('waits for the answer in a normal tab, then runs', async () => {
    framed(shell, shell)
    let answer!: (value: unknown) => void
    call.mockReturnValue(new Promise(resolve => { answer = resolve }))
    await render()
    expect(allowed).toBe(false)
    await act(async () => answer(null))
    expect(allowed).toBe(true)
  })

  it('runs beside another app in split view', async () => {
    framed(shell, shell)
    call.mockResolvedValue({ tabId: 'tab-2', name: 'Executive' })
    await render()
    await settle()
    expect(allowed).toBe(true)
  })

  it('never runs when the shell says it is held in a page (the Personal agent\'s)', async () => {
    framed(shell, shell)
    call.mockResolvedValue({ tabId: 'held:1', name: 'the conversation', heldInRoom: true })
    await render()
    await settle()
    expect(allowed).toBe(false)
  })

  it('runs when the shell cannot answer, so the whole app keeps its work', async () => {
    framed(shell, shell)
    call.mockRejectedValue(new Error('unknown method'))
    await render()
    await settle()
    expect(allowed).toBe(true)
  })

  it('runs when the shell never answers', async () => {
    framed(shell, shell)
    vi.useFakeTimers()
    call.mockReturnValue(new Promise(() => undefined))
    await render()
    expect(allowed).toBe(false)
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })
    expect(allowed).toBe(true)
  })

  it('stops when told it is held after a slow answer', async () => {
    framed(shell, shell)
    call.mockResolvedValue(null)
    await render()
    await settle()
    expect(allowed).toBe(true)
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { source: shell as unknown as Window, data: { type: 'pure:adjacent-app', app: { tabId: 'held:1', name: 'x', heldInRoom: true } } }))
    })
    expect(allowed).toBe(false)
  })
})
