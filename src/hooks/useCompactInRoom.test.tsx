// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCompactInRoom } from './useCompactInRoom'

let neighbour: { tabId: string; name: string } | null = null
vi.mock('@purescience/platform-ui/bridge/react/useAdjacentApp', () => ({ useAdjacentApp: () => neighbour }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

async function compactWith(name: string | null): Promise<boolean> {
  neighbour = name === null ? null : { tabId: 'tab-2', name, ...(name === 'Executive' ? { heldInRoom: true } : {}) }
  let value = false
  function Probe() {
    value = useCompactInRoom()
    return null
  }
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(<Probe />))
  await act(async () => root.unmount())
  return value
}

afterEach(() => { neighbour = null })

describe('useCompactInRoom', () => {
  it('is on beside the Executive app', async () => {
    expect(await compactWith('Executive')).toBe(true)
  })

  it.each([null, 'Mail', 'Writer', 'Calendar', 'executive', 'Executive team', ' Executive', ''])(
    'is off beside %j',
    async name => {
      expect(await compactWith(name)).toBe(false)
    },
  )
})
