import { describe, expect, it } from 'vitest'
import { firstUrlIn, splitTextIntoLinks } from './eventLinks'

describe('splitTextIntoLinks', () => {
  it('leaves plain text as one text segment', () => {
    expect(splitTextIntoLinks('just a note')).toEqual([{ type: 'text', value: 'just a note' }])
    expect(splitTextIntoLinks('')).toEqual([])
  })

  it('pulls a URL out of surrounding text', () => {
    const segs = splitTextIntoLinks('Join Zoom Meeting: https://example.invalid/zoom.us/j/00000000000?pwd=example (ID: 824)')
    expect(segs.map(s => s.type)).toEqual(['text', 'link', 'text'])
    expect(segs[1]).toEqual({ type: 'link', value: 'https://example.invalid/zoom.us/j/00000000000?pwd=example', href: 'https://example.invalid/zoom.us/j/00000000000?pwd=example' })
  })

  it('does not swallow trailing punctuation into the link', () => {
    const segs = splitTextIntoLinks('see https://example.com/x.')
    expect(segs[1].value).toBe('https://example.com/x')
    expect(segs[2].value).toBe('.')
  })

  it('links a bare email as mailto', () => {
    const segs = splitTextIntoLinks('host: alex@business.example')
    expect(segs.at(-1)).toEqual({ type: 'link', value: 'alex@business.example', href: 'mailto:alex@business.example' })
  })

  it('handles several links in order', () => {
    const segs = splitTextIntoLinks('a https://one.test b https://two.test c')
    expect(segs.filter(s => s.type === 'link').map(s => s.value)).toEqual(['https://one.test', 'https://two.test'])
    expect(segs.map(s => s.value).join('')).toBe('a https://one.test b https://two.test c')
  })

  it('preserves the original text exactly across segments', () => {
    const text = 'Meet at https://x.test/a then mail me@x.test — thanks'
    expect(splitTextIntoLinks(text).map(s => s.value).join('')).toBe(text)
  })
})

describe('firstUrlIn', () => {
  it('finds the first http(s) link, or null', () => {
    expect(firstUrlIn('x https://a.test y https://b.test')).toBe('https://a.test')
    expect(firstUrlIn('no links here')).toBeNull()
    expect(firstUrlIn(null)).toBeNull()
  })
})
