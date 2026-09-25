/**
 * Splitting event text into plain runs and links, so a description shows
 * the way it reads in mail — a Zoom URL is a clickable link, not a line of
 * a form field. Pure and dependency-free: the caller renders each segment.
 */
export interface TextSegment {
  type: 'text' | 'link'
  value: string
  /** For a link: the href to open (the URL itself, or mailto: for an address). */
  href?: string
}

// Bare URLs and email addresses. Kept deliberately narrow — http(s) and
// mailto only — so nothing else is ever turned into an openable link.
const URL_RE = /\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/gi
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g

interface Hit {
  start: number
  end: number
  href: string
}

/** Split `text` into ordered text/link segments; URLs and emails become links. */
export function splitTextIntoLinks(text: string): TextSegment[] {
  if (!text) return []
  const hits: Hit[] = []
  for (const match of text.matchAll(URL_RE)) {
    hits.push({ start: match.index, end: match.index + match[0].length, href: match[0] })
  }
  for (const match of text.matchAll(EMAIL_RE)) {
    const start = match.index
    const end = start + match[0].length
    // An email inside an already-matched URL (a mailto-style tail) is not its own link.
    if (hits.some(h => start >= h.start && start < h.end)) continue
    hits.push({ start, end, href: `mailto:${match[0]}` })
  }
  if (hits.length === 0) return [{ type: 'text', value: text }]
  hits.sort((a, b) => a.start - b.start)
  const out: TextSegment[] = []
  let cursor = 0
  for (const hit of hits) {
    if (hit.start < cursor) continue // overlapping match, already covered
    if (hit.start > cursor) out.push({ type: 'text', value: text.slice(cursor, hit.start) })
    out.push({ type: 'link', value: text.slice(hit.start, hit.end), href: hit.href })
    cursor = hit.end
  }
  if (cursor < text.length) out.push({ type: 'text', value: text.slice(cursor) })
  return out
}

/** The first http(s) URL in a blob of text, if any — a fallback "join" target. */
export function firstUrlIn(text: string | undefined | null): string | null {
  if (!text) return null
  const match = new RegExp(URL_RE.source, 'i').exec(text)
  return match ? match[0] : null
}
