import { describe, expect, it } from 'vitest'
import {
  colorLuminance,
  parseHexColor,
  readableAccentColor,
} from './calendarColors'

describe('calendar colours', () => {
  it('parses hex forms and rejects junk', () => {
    expect(parseHexColor('#fa573c')).toEqual({ r: 250, g: 87, b: 60 })
    expect(parseHexColor('0f0')).toEqual({ r: 0, g: 255, b: 0 })
    expect(parseHexColor('rgb(1,2,3)')).toBeNull()
    expect(parseHexColor('')).toBeNull()
  })

  it('darkens pale provider colours to a readable accent', () => {
    // Google's "peacock" pale cyan — unreadable as a thin accent.
    const pale = '#9fe1e7'
    expect(colorLuminance(pale)).toBeGreaterThan(0.6)
    const accent = readableAccentColor(pale)!
    expect(colorLuminance(accent)).toBeLessThanOrEqual(0.46)
    // hue survives: still cyan-ish (blue and green above red)
    const rgb = parseHexColor(accent)!
    expect(rgb.g).toBeGreaterThan(rgb.r)
    expect(rgb.b).toBeGreaterThan(rgb.r)
  })

  it('leaves an already-dark colour alone', () => {
    const dark = '#16a765'
    expect(readableAccentColor(dark)).toBe(dark)
  })

  it('returns null for an unusable value so callers can fall back', () => {
    expect(readableAccentColor('not-a-colour')).toBeNull()
  })
})
