import { describe, expect, it, vi } from 'vitest'
import { dateKeyInTimeZone, instantFromZonedWallTime } from './calendarModel'

describe('repeated zoned calendar conversions', () => {
  it('reuses a formatter across many events while keeping zone-specific results', () => {
    const Original = Intl.DateTimeFormat
    const constructor = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation((locales, options) => new Original(locales, options))
    try {
      for (let i = 0; i < 100; i++) {
        expect(instantFromZonedWallTime('2026-10-03', 9, 0, 'Asia/Kathmandu')).toBe('2026-10-03T03:15:00.000Z')
        expect(dateKeyInTimeZone('2026-10-02T20:00:00Z', 'Asia/Kathmandu')).toBe('2026-10-03')
      }
      expect(constructor).toHaveBeenCalledTimes(1)
      expect(instantFromZonedWallTime('2026-10-03', 9, 0, 'UTC')).toBe('2026-10-03T09:00:00.000Z')
      expect(constructor).toHaveBeenCalledTimes(2)
    } finally {
      constructor.mockRestore()
    }
  })
})
