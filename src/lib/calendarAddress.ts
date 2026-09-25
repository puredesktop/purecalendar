/**
 * What the user has in hand when a calendar is shared with them is
 * Google's "add this calendar" link, not the bare calendar id:
 *
 *   https://calendar.google.com/calendar/r?cid=<base64 id>&ctok=…
 *
 * Asking them to decode base64 to use the app would be absurd, so the
 * address field takes whichever form they paste.
 */

function decodeBase64Url(value: string): string | null {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  try {
    const decoded = atob(padded)
    // A calendar id is ASCII; anything else means this was not base64.
    return /^[\x20-\x7e]+$/.test(decoded) ? decoded : null
  } catch {
    return null
  }
}

/**
 * The calendar id from a pasted address, Google link, or mailto:.
 * Returns null when nothing usable can be found.
 */
export function parseCalendarAddress(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null

  if (/^https?:\/\//i.test(raw)) {
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      return null
    }
    // Google's share/subscribe links carry the id in `cid`, base64url'd.
    // Some older links (and ICS feed URLs) carry it in the path instead.
    const cid = url.searchParams.get('cid')
    if (cid) {
      const decoded = decodeBase64Url(cid)
      // A cid is occasionally already a plain id rather than base64.
      const candidate = decoded ?? cid
      return candidate.includes('@') || candidate.includes('.')
        ? candidate
        : null
    }
    const fromPath = /\/calendar\/(?:ical|embed)\/([^/]+)/.exec(url.pathname)
    if (fromPath?.[1]) return decodeURIComponent(fromPath[1])
    const src = url.searchParams.get('src')
    if (src) return src
    return null
  }

  if (/^mailto:/i.test(raw)) return raw.slice('mailto:'.length).trim()
  return raw
}

/** A subscribable calendar feed URL (https .ics, or a webcal:// link). */
export function parseIcsFeedUrl(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  // webcal is just http(s) under a different scheme name.
  const normalized = /^webcal:\/\//i.test(raw)
    ? `https://${raw.slice('webcal://'.length)}`
    : raw
  if (!/^https?:\/\//i.test(normalized)) return null
  try {
    const url = new URL(normalized)
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : null
  } catch {
    return null
  }
}

/**
 * A readable label for a feed. Google's private address is
 * .../calendar/ical/<calendar id>/private-<secret>/basic.ics — the id
 * is the human part, and the secret must never become the label.
 */
export function labelForIcsFeedUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const ical = /\/calendar\/ical\/([^/]+)\//.exec(parsed.pathname)
    if (ical?.[1]) {
      const id = decodeURIComponent(ical[1])
      return id.replace(/@group\.calendar\.google\.com$/i, '')
    }
    const src = parsed.searchParams.get('src')
    if (src) return src
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return 'Calendar feed'
  }
}
