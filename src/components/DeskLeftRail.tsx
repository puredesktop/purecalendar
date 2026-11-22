import { useMemo, useState } from 'react'
import { styled } from 'styled-components'
import { ChevronLeft, ChevronRight, Copy, Globe, Link2, Plus, X } from 'lucide-react'
import type { Calendar, CalendarEvent, PinnedTimeZone, SchedulingLink } from '../types'
import { dateKeyInTimeZone, isValidTimeZone } from '../lib/calendarModel'
import { getTimeZoneSnapshot, timeZoneDisplayLabel } from '../lib/timeZoneDirectory'
import { TimeZonePicker } from './TimeZonePicker'

const Rail = styled.aside`
  display: flex;
  flex-direction: column;
  width: 248px;
  min-width: 248px;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  border-right: 1px solid var(--pure-chrome-line);
  background: var(--platform-colors-surface-subtle);
  color: var(--platform-colors-text);
`

const Section = styled.section`
  display: grid;
  gap: 8px;
  padding: 12px 12px 14px;
  border-bottom: 1px solid var(--pure-chrome-fence);
`

const SectionHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
`

const Kicker = styled.div`
  color: var(--pure-chrome-muted);
  font-family: var(--platform-typography-font-family-mono);
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
`

const SmallBtn = styled.button<{ $active?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 6px;
  border: 1px solid ${props => (props.$active ? 'var(--platform-colors-accent)' : 'transparent')};
  border-radius: var(--platform-radius-sm, 3px);
  background: ${props => (props.$active ? 'var(--platform-colors-surface-selected)' : 'transparent')};
  color: var(--platform-colors-text-secondary);
  font: inherit;
  font-size: 11px;
  cursor: pointer;

  &:hover {
    background: var(--platform-colors-surface-hover);
    color: var(--platform-colors-text);
  }
`

const MiniHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12.5px;
  font-weight: 650;
`

const MiniGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
`

const MiniDow = styled.div`
  text-align: center;
  font-family: var(--platform-typography-font-family-mono);
  font-size: 10px;
  color: var(--platform-colors-text-tertiary);
  padding-bottom: 2px;
`

const MiniDay = styled.button<{ $muted?: boolean; $today?: boolean; $selected?: boolean }>`
  position: relative;
  height: 26px;
  padding: 0;
  border: 1px solid ${props => (props.$selected ? 'var(--platform-colors-accent)' : 'transparent')};
  border-radius: var(--platform-radius-sm, 3px);
  background: ${props =>
    props.$today
      ? 'var(--platform-colors-accent)'
      : props.$selected
        ? 'var(--platform-colors-surface-selected)'
        : 'transparent'};
  color: ${props =>
    props.$today
      ? 'var(--platform-colors-text-on-accent)'
      : props.$muted
        ? 'var(--platform-colors-text-disabled)'
        : 'var(--platform-colors-text)'};
  font: inherit;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  font-weight: ${props => (props.$today || props.$selected ? 650 : 400)};
  cursor: pointer;

  &:hover {
    background: ${props => (props.$today ? 'var(--platform-colors-accent-hover)' : 'var(--platform-colors-surface-hover)')};
  }
`

const BusyDot = styled.span<{ $today?: boolean }>`
  position: absolute;
  bottom: 2px;
  left: 50%;
  transform: translateX(-50%);
  width: 3px;
  height: 3px;
  background: ${props => (props.$today ? 'var(--platform-colors-text-on-accent)' : 'var(--platform-colors-accent)')};
`

const ClockRow = styled.div<{ $preview?: boolean }>`
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 4px;
  align-items: center;
  padding: 6px 7px;
  border: 1px solid ${props => (props.$preview ? 'var(--platform-colors-accent)' : 'var(--pure-chrome-fence)')};
  border-radius: var(--platform-radius-sm, 3px);
  background: var(--platform-colors-surface);
`

const ClockMeta = styled.button`
  display: grid;
  gap: 1px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  min-width: 0;

  strong {
    font-size: 12px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  small {
    font-family: var(--platform-typography-font-family-mono);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
    color: var(--platform-colors-text-secondary);
  }
`

const ClockActions = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 2px;
`

const BandDot = styled.span<{ $band: 'daytime' | 'stretch' | 'night' }>`
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 5px;
  vertical-align: 1px;
  background: ${props =>
    props.$band === 'daytime'
      ? 'var(--platform-colors-success)'
      : props.$band === 'stretch'
        ? 'var(--platform-colors-warning)'
        : 'var(--platform-colors-border-strong)'};
`

const CalRow = styled.label`
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 5px;
  border-radius: var(--platform-radius-sm, 3px);
  font-size: 12.5px;
  cursor: pointer;

  &:hover {
    background: var(--platform-colors-surface-hover);
  }

  input {
    margin: 0;
  }
`

const Swatch = styled.span<{ $color: string }>`
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  background: ${props => props.$color};
`

const LinkRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 5px 7px;
  border: 1px solid var(--pure-chrome-fence);
  border-radius: var(--platform-radius-sm, 3px);
  background: var(--platform-colors-surface);
  font-size: 12px;

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

export interface DeskLeftRailProps {
  anchorDate: Date
  now: Date
  homeTimeZone: string
  activeTimeZone: string
  previewTimeZone: string | null
  timeFormat: '12h' | '24h'
  pinnedTimeZones: PinnedTimeZone[]
  calendars: Calendar[]
  events: CalendarEvent[]
  schedulingLinks: SchedulingLink[]
  cloudConnected: boolean
  onSelectDate: (date: Date) => void
  onToggleCalendar: (calendarId: string) => void
  onOpenCalendarsManager: () => void
  onAddPinnedTimeZone: (timeZone: string) => void
  onRemovePinnedTimeZone: (id: string) => void
  onTogglePinnedOnGrid: (id: string) => void
  onPreviewTimeZone: (timeZone: string | null) => void
  onOpenSchedulingStudio: () => void
  onCopyLink: (url: string) => void
}

export function DeskLeftRail({
  anchorDate,
  now,
  homeTimeZone,
  activeTimeZone,
  previewTimeZone,
  timeFormat,
  pinnedTimeZones,
  calendars,
  events,
  schedulingLinks,
  cloudConnected,
  onSelectDate,
  onToggleCalendar,
  onOpenCalendarsManager,
  onAddPinnedTimeZone,
  onRemovePinnedTimeZone,
  onTogglePinnedOnGrid,
  onPreviewTimeZone,
  onOpenSchedulingStudio,
  onCopyLink,
}: DeskLeftRailProps) {
  const [monthOffset, setMonthOffset] = useState(0)
  const [addingTz, setAddingTz] = useState(false)
  const [tzDraft, setTzDraft] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const displayMonth = useMemo(() => {
    const d = new Date(Date.UTC(anchorDate.getFullYear(), anchorDate.getMonth() + monthOffset, 1))
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() }
  }, [anchorDate, monthOffset])

  const monthTitle = useMemo(
    () =>
      new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
        new Date(Date.UTC(displayMonth.year, displayMonth.month, 1)),
      ),
    [displayMonth],
  )

  const busyDayKeys = useMemo(() => {
    const visible = new Set(calendars.filter(c => c.visible).map(c => c.id))
    const keys = new Set<string>()
    for (const ev of events) {
      if (ev.status === 'cancelled' || !visible.has(ev.calendarId)) continue
      keys.add(dateKeyInTimeZone(ev.startsAt, activeTimeZone))
    }
    return keys
  }, [calendars, events, activeTimeZone])

  const todayKey = dateKeyInTimeZone(now, activeTimeZone)
  const selectedKey = dateKeyInTimeZone(anchorDate, activeTimeZone)

  const miniDays = useMemo(() => {
    const firstDow = new Date(Date.UTC(displayMonth.year, displayMonth.month, 1)).getUTCDay()
    const start = new Date(Date.UTC(displayMonth.year, displayMonth.month, 1 - firstDow))
    return Array.from({ length: 42 }, (_, idx) => {
      const d = new Date(start.getTime() + idx * 86_400_000)
      const key = d.toISOString().slice(0, 10)
      return {
        date: new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12),
        key,
        day: d.getUTCDate(),
        inMonth: d.getUTCMonth() === displayMonth.month,
      }
    })
  }, [displayMonth])

  const homeSnap = getTimeZoneSnapshot(homeTimeZone, now, timeFormat)

  return (
    <Rail aria-label="Calendar navigator">
      <Section aria-label="Mini month">
        <MiniHeader>
          <span>{monthTitle}</span>
          <div>
            <SmallBtn type="button" aria-label="Previous month" onClick={() => setMonthOffset(v => v - 1)}>
              <ChevronLeft size={13} />
            </SmallBtn>
            <SmallBtn type="button" aria-label="Next month" onClick={() => setMonthOffset(v => v + 1)}>
              <ChevronRight size={13} />
            </SmallBtn>
          </div>
        </MiniHeader>
        <MiniGrid>
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((dow, i) => (
            <MiniDow key={i}>{dow}</MiniDow>
          ))}
          {miniDays.map(cell => (
            <MiniDay
              key={cell.key}
              type="button"
              $muted={!cell.inMonth}
              $today={cell.key === todayKey}
              $selected={cell.key === selectedKey}
              onClick={() => onSelectDate(cell.date)}
            >
              {cell.day}
              {busyDayKeys.has(cell.key) && <BusyDot $today={cell.key === todayKey} />}
            </MiniDay>
          ))}
        </MiniGrid>
      </Section>

      <Section aria-label="World clocks and time zones">
        <SectionHead>
          <Kicker>Time zones</Kicker>
          <SmallBtn type="button" onClick={() => setAddingTz(v => !v)} title="Add a city or timezone">
            <Plus size={12} /> Add
          </SmallBtn>
        </SectionHead>
        <ClockRow $preview={!previewTimeZone}>
          <ClockMeta
            type="button"
            title="Home timezone — click to return here"
            onClick={() => onPreviewTimeZone(null)}
          >
            <strong>
              <BandDot $band={homeSnap.band} />
              {homeSnap.label} · Home
            </strong>
            <small>
              {homeSnap.timeLabel} · {homeSnap.shortCode} ({homeSnap.offsetLabel})
            </small>
          </ClockMeta>
          <Globe size={12} />
        </ClockRow>
        {pinnedTimeZones.map(pin => {
          const snap = getTimeZoneSnapshot(pin.timeZone, now, timeFormat, pin.workStart, pin.workEnd)
          const isPreview = previewTimeZone === pin.timeZone
          return (
            <ClockRow key={pin.id} $preview={isPreview}>
              <ClockMeta
                type="button"
                title={isPreview ? 'Click to return to home timezone' : `Click to preview calendar in ${pin.label}`}
                onClick={() => onPreviewTimeZone(isPreview ? null : pin.timeZone)}
              >
                <strong>
                  <BandDot $band={snap.band} />
                  {pin.label || timeZoneDisplayLabel(pin.timeZone)}
                </strong>
                <small>
                  {snap.timeLabel} · {snap.shortCode} ({snap.offsetLabel})
                </small>
              </ClockMeta>
              <ClockActions>
                <SmallBtn
                  type="button"
                  $active={pin.showOnGrid}
                  title={pin.showOnGrid ? 'Hide rail on grid' : 'Show rail on grid'}
                  onClick={() => onTogglePinnedOnGrid(pin.id)}
                >
                  Rail
                </SmallBtn>
                <SmallBtn
                  type="button"
                  aria-label={`Remove ${pin.label}`}
                  onClick={() => onRemovePinnedTimeZone(pin.id)}
                >
                  <X size={11} />
                </SmallBtn>
              </ClockActions>
            </ClockRow>
          )
        })}
        {addingTz && (
          <TimeZonePicker
            value={tzDraft}
            ariaLabel="Add pinned timezone"
            placeholder="City, airport (SFO, LDN, TYO)…"
            onChange={val => {
              setTzDraft(val)
              if (isValidTimeZone(val) && (val.includes('/') || val === 'UTC')) {
                onAddPinnedTimeZone(val)
                setTzDraft('')
                setAddingTz(false)
              }
            }}
          />
        )}
      </Section>

      <Section aria-label="Calendars list">
        <SectionHead>
          <Kicker>Calendars</Kicker>
          <SmallBtn type="button" onClick={onOpenCalendarsManager}>
            Manage
          </SmallBtn>
        </SectionHead>
        {calendars.map(cal => (
          <CalRow key={cal.id}>
            <input
              type="checkbox"
              checked={cal.visible}
              onChange={() => onToggleCalendar(cal.id)}
            />
            <Swatch $color={cal.color || '#1d57b8'} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cal.name}</span>
          </CalRow>
        ))}
      </Section>

      <Section aria-label="Booking links">
        <SectionHead>
          <Kicker>{cloudConnected ? 'Booking links · Live' : 'Booking links'}</Kicker>
          <SmallBtn type="button" onClick={onOpenSchedulingStudio}>
            <Link2 size={12} /> Open
          </SmallBtn>
        </SectionHead>
        {schedulingLinks.filter(l => l.active).slice(0, 4).map(link => (
          <LinkRow key={link.id}>
            <span title={link.url}>{link.title}</span>
            <SmallBtn
              type="button"
              title="Copy link"
              onClick={() => {
                onCopyLink(link.url)
                setCopiedId(link.id)
                window.setTimeout(() => setCopiedId(c => (c === link.id ? null : c)), 1400)
              }}
            >
              <Copy size={11} />
              {copiedId === link.id ? 'Copied' : 'Copy'}
            </SmallBtn>
          </LinkRow>
        ))}
        {schedulingLinks.filter(l => l.active).length === 0 && (
          <SmallBtn type="button" onClick={onOpenSchedulingStudio}>
            <Plus size={12} /> Create booking link
          </SmallBtn>
        )}
      </Section>
    </Rail>
  )
}
