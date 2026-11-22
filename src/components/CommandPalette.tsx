import { useEffect, useMemo, useRef, useState } from 'react'
import { styled } from 'styled-components'
import { searchTimeZones } from '../lib/timeZoneDirectory'
import type { CalendarView, SchedulingLink } from '../types'

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 120;
  background: rgb(0 0 0 / 0.28);
  display: grid;
  place-items: start center;
  padding-top: min(14vh, 110px);
`

const Dialog = styled.div`
  width: min(560px, 92vw);
  border: 1px solid var(--pure-chrome-line);
  border-radius: var(--platform-radius-md, 4px);
  background: var(--platform-colors-surface);
  box-shadow: 0 18px 42px rgb(0 0 0 / 0.22);
  overflow: hidden;
`

const SearchInput = styled.input`
  width: 100%;
  padding: 13px 16px;
  border: 0;
  border-bottom: 1px solid var(--pure-chrome-line);
  background: var(--platform-colors-surface);
  color: var(--platform-colors-text);
  font: inherit;
  font-size: 14px;

  &:focus {
    outline: none;
  }
`

const List = styled.div`
  max-height: 360px;
  overflow-y: auto;
`

const Item = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 9px 16px;
  border: 0;
  border-bottom: 1px solid var(--pure-chrome-fence);
  background: ${props => (props.$active ? 'var(--platform-colors-surface-selected)' : 'var(--platform-colors-surface)')};
  color: var(--platform-colors-text);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--platform-colors-surface-hover);
  }
`

const Hint = styled.span`
  font-family: var(--platform-typography-font-family-mono);
  font-size: 11px;
  color: var(--platform-colors-text-tertiary);
`

export interface CommandPaletteProps {
  open: boolean
  links: SchedulingLink[]
  timeFormat: '12h' | '24h'
  onClose: () => void
  onChangeView: (view: CalendarView) => void
  onGoToday: () => void
  onNewEvent: () => void
  onToggleShareAvailability: () => void
  onOpenTimeFinder: () => void
  onOpenSchedulingStudio: () => void
  onToggleLeftRail: () => void
  onToggleTimeFormat: () => void
  onPreviewTimeZone: (tz: string | null) => void
  onPinTimeZone: (tz: string) => void
  onCopyLink: (url: string) => void
}

interface PaletteCommand {
  id: string
  label: string
  hint: string
  keywords: string
  run: () => void
}

export function CommandPalette({
  open,
  links,
  timeFormat,
  onClose,
  onChangeView,
  onGoToday,
  onNewEvent,
  onToggleShareAvailability,
  onOpenTimeFinder,
  onOpenSchedulingStudio,
  onToggleLeftRail,
  onToggleTimeFormat,
  onPreviewTimeZone,
  onPinTimeZone,
  onCopyLink,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      window.setTimeout(() => inputRef.current?.focus(), 10)
    }
  }, [open])

  const commands = useMemo<PaletteCommand[]>(() => {
    const base: PaletteCommand[] = [
      { id: 'new', label: 'New calendar event', hint: 'N', keywords: 'create add event', run: onNewEvent },
      { id: 'share', label: 'Share availability on grid (pick slots)', hint: 'S', keywords: 'slots propose hold link', run: onToggleShareAvailability },
      { id: 'finder', label: 'Open multi-timezone overlap finder', hint: 'F', keywords: 'find time timezone matrix world time buddy', run: onOpenTimeFinder },
      { id: 'links', label: 'Open booking links & polls studio', hint: 'L', keywords: 'cal.com calendly booking links polls purecloud', run: onOpenSchedulingStudio },
      { id: 'today', label: 'Jump to Today', hint: 'T', keywords: 'today now', run: onGoToday },
      { id: 'v-day', label: 'Switch to Day view', hint: 'D', keywords: 'day view', run: () => onChangeView('day') },
      { id: 'v-3day', label: 'Switch to 3-Day view', hint: '3', keywords: '3 day three day view', run: () => onChangeView('threeDay') },
      { id: 'v-week', label: 'Switch to Week view', hint: 'W', keywords: 'week view', run: () => onChangeView('week') },
      { id: 'v-month', label: 'Switch to Month view', hint: 'M', keywords: 'month view', run: () => onChangeView('month') },
      { id: 'v-agenda', label: 'Switch to Agenda view', hint: 'A', keywords: 'agenda list view', run: () => onChangeView('agenda') },
      { id: 'rail', label: 'Toggle left desk navigator rail', hint: '[', keywords: 'sidebar mini month clocks', run: onToggleLeftRail },
      { id: 'clock', label: `Switch clock to ${timeFormat === '12h' ? '24-hour' : '12-hour'} format`, hint: '24h', keywords: '12h 24h clock format', run: onToggleTimeFormat },
      { id: 'home-tz', label: 'Return to home timezone', hint: 'Home TZ', keywords: 'timezone reset travel preview', run: () => onPreviewTimeZone(null) },
    ]
    for (const link of links.filter(l => l.active)) {
      base.push({
        id: `copy:${link.id}`,
        label: `Copy booking link: ${link.title}`,
        hint: link.kind === 'poll' ? 'Poll' : link.kind === 'oneoff' ? 'One-off' : 'Link',
        keywords: `copy link booking ${link.title} ${link.slug ?? ''}`,
        run: () => onCopyLink(link.url),
      })
    }
    const q = query.trim().toLowerCase()
    const filtered = q
      ? base.filter(c => `${c.label} ${c.keywords}`.toLowerCase().includes(q))
      : base

    if (q.length >= 2) {
      const tzMatches = searchTimeZones(q, new Date(), 4)
      for (const tz of tzMatches) {
        filtered.push({
          id: `pin:${tz.timeZone}`,
          label: `Pin timezone rail: ${tz.city} (${tz.timeLabel} · ${tz.offsetLabel})`,
          hint: 'Pin rail',
          keywords: tz.timeZone,
          run: () => onPinTimeZone(tz.timeZone),
        })
        filtered.push({
          id: `preview:${tz.timeZone}`,
          label: `Preview calendar in ${tz.city} (${tz.shortCode})`,
          hint: 'Travel preview',
          keywords: tz.timeZone,
          run: () => onPreviewTimeZone(tz.timeZone),
        })
      }
    }
    return filtered.slice(0, 14)
  }, [
    links,
    query,
    timeFormat,
    onChangeView,
    onCopyLink,
    onGoToday,
    onNewEvent,
    onOpenSchedulingStudio,
    onOpenTimeFinder,
    onPinTimeZone,
    onPreviewTimeZone,
    onToggleLeftRail,
    onToggleShareAvailability,
    onToggleTimeFormat,
  ])

  if (!open) return null

  return (
    <Backdrop onClick={onClose} role="dialog" aria-modal="true" aria-label="Command palette">
      <Dialog onClick={e => e.stopPropagation()}>
        <SearchInput
          ref={inputRef}
          value={query}
          onChange={e => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={e => {
            if (e.key === 'Escape') onClose()
            else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive(i => Math.min(commands.length - 1, i + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive(i => Math.max(0, i - 1))
            } else if (e.key === 'Enter' && commands[active]) {
              e.preventDefault()
              commands[active]!.run()
              onClose()
            }
          }}
          placeholder="Type a command, city/timezone (e.g. London, TYO), or booking link…"
          aria-label="Command search"
        />
        <List role="listbox">
          {commands.map((cmd, idx) => (
            <Item
              key={cmd.id}
              type="button"
              role="option"
              aria-selected={idx === active}
              $active={idx === active}
              onClick={() => {
                cmd.run()
                onClose()
              }}
            >
              <span>{cmd.label}</span>
              <Hint>{cmd.hint}</Hint>
            </Item>
          ))}
        </List>
      </Dialog>
    </Backdrop>
  )
}
