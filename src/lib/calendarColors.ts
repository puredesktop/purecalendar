/**
 * Per-calendar colour. A calendar carries the colour its provider gave
 * it (Google's palette), which is what lets the user tell one calendar's
 * events from another at a glance. Those colours are picked for Google's
 * white-on-colour chips though, and several are far too pale to read as
 * a 3px accent on this UI's paper background — so a colour is kept but
 * pulled down to a legible weight rather than replaced.
 */

const MAX_ACCENT_LUMINANCE = 0.46

export function parseHexColor(
  value: string,
): { r: number; g: number; b: number } | null {
  const hex = value.trim().replace(/^#/, '')
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map(char => char + char)
          .join('')
      : hex
  if (!/^[0-9a-f]{6}$/i.test(full)) return null
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  }
}

function toHex({ r, g, b }: { r: number; g: number; b: number }): string {
  const part = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

/** Relative luminance (sRGB, 0 = black, 1 = white). */
export function colorLuminance(value: string): number {
  const rgb = parseHexColor(value)
  if (!rgb) return 1
  const channel = (raw: number): number => {
    const c = raw / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return (
    0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
  )
}

/**
 * The calendar's own colour, darkened just enough to read as an accent
 * on a light background. Hue is preserved — a pale cyan calendar still
 * reads as cyan, only deeper.
 */
export function readableAccentColor(value: string): string | null {
  const rgb = parseHexColor(value)
  if (!rgb) return null
  let current = rgb
  // Scale toward black in small steps; 24 steps at 0.92 reaches ~0.13x,
  // far past the threshold for any input, and stops as soon as it fits.
  for (let step = 0; step < 24; step++) {
    if (colorLuminance(toHex(current)) <= MAX_ACCENT_LUMINANCE) break
    current = { r: current.r * 0.92, g: current.g * 0.92, b: current.b * 0.92 }
  }
  return toHex(current)
}
