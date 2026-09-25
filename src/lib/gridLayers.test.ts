import { describe, expect, it } from 'vitest'
import {
  GRID_SCROLLING_LAYERS,
  GRID_Z_DRAGGING_EVENT,
  GRID_Z_EVENT,
  GRID_Z_STICKY_HEADER,
} from './gridLayers'

describe('the timed grid stack', () => {
  it('keeps the sticky day header above everything that scrolls under it', () => {
    for (const layer of GRID_SCROLLING_LAYERS) {
      expect(GRID_Z_STICKY_HEADER).toBeGreaterThan(layer)
    }
  })

  it('lifts a dragged event over its neighbours, and no further', () => {
    expect(GRID_Z_DRAGGING_EVENT).toBeGreaterThan(GRID_Z_EVENT)
    expect(GRID_Z_DRAGGING_EVENT).toBeLessThan(GRID_Z_STICKY_HEADER)
  })
})
