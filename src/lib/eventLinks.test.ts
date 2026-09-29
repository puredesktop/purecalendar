// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  firstUrlIn,
  splitTextIntoLinks,
  eventDescriptionSegments,
  meetingUrlIn,
} from './eventLinks'

describe('splitTextIntoLinks', () => {
  it('leaves plain text as one text segment', () => {
    expect(splitTextIntoLinks('just a note')).toEqual([
      { type: 'text', value: 'just a note' },
    ])
    expect(splitTextIntoLinks('')).toEqual([])
  })

  it('pulls a URL out of surrounding text', () => {
    const segs = splitTextIntoLinks(
      'Join Zoom Meeting: https://example.invalid/zoom.us/j/00000000000?pwd=example (ID: 824)',
    )
    expect(segs.map(s => s.type)).toEqual(['text', 'link', 'text'])
    expect(segs[1]).toEqual({
      type: 'link',
      value: 'https://example.invalid/zoom.us/j/00000000000?pwd=example',
      href: 'https://example.invalid/zoom.us/j/00000000000?pwd=example',
    })
  })

  it('does not swallow trailing punctuation into the link', () => {
    const segs = splitTextIntoLinks('see https://example.com/x.')
    expect(segs[1].value).toBe('https://example.com/x')
    expect(segs[2].value).toBe('.')
  })

  it('links a bare email as mailto', () => {
    const segs = splitTextIntoLinks('host: alex@business.example')
    expect(segs.at(-1)).toEqual({
      type: 'link',
      value: 'alex@business.example',
      href: 'mailto:alex@business.example',
    })
  })

  it('handles several links in order', () => {
    const segs = splitTextIntoLinks('a https://one.test b https://two.test c')
    expect(segs.filter(s => s.type === 'link').map(s => s.value)).toEqual([
      'https://one.test',
      'https://two.test',
    ])
    expect(segs.map(s => s.value).join('')).toBe(
      'a https://one.test b https://two.test c',
    )
  })

  it('preserves the original text exactly across segments', () => {
    const text = 'Meet at https://x.test/a then mail me@x.test — thanks'
    expect(
      splitTextIntoLinks(text)
        .map(s => s.value)
        .join(''),
    ).toBe(text)
  })
})

describe('firstUrlIn', () => {
  it('finds the first http(s) link, or null', () => {
    expect(firstUrlIn('x https://a.test y https://b.test')).toBe(
      'https://a.test',
    )
    expect(firstUrlIn('no links here')).toBeNull()
    expect(firstUrlIn(null)).toBeNull()
  })
})

describe('calendar descriptions', () => {
  it('renders mixed HTML and plaintext as readable text with named links', () => {
    const runs = eventDescriptionSegments(
      'Notes<br/><a href="https://example.com/help?a=1&amp;b=2" target="_blank">Meeting help</a><p>Next line &amp; details</p>',
    )
    expect(runs.map(r => r.value).join('')).toBe(
      'Notes\nMeeting help\nNext line & details\n',
    )
    expect(runs.find(r => r.type === 'link')?.href).toBe(
      'https://example.com/help?a=1&b=2',
    )
  })
  it('drops executable content, images and unsafe links', () => {
    const runs = eventDescriptionSegments(
      '<script>alert(1)</script><img src="x" onerror="bad()"><a href="javascript:bad()">Read</a><iframe src="x">hidden</iframe>',
    )
    expect(runs.map(r => r.value).join('')).toBe('Read')
    expect(runs.every(r => r.type === 'text')).toBe(true)
  })
  it('finds the meeting rather than the first help link', () => {
    expect(
      meetingUrlIn(
        'https://example.com/help <a href="https://meet.google.com/example-room">Join meeting</a>',
      ),
    ).toBe('https://meet.google.com/example-room')
    expect(meetingUrlIn('https://example.com/help')).toBeNull()
  })
})
