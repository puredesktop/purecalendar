import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { styled } from 'styled-components'
import { searchTimeZones, timeZoneDisplayLabel, getTimeZoneSnapshot } from '../lib/timeZoneDirectory'
import { isValidTimeZone } from '../lib/calendarModel'

const Wrap = styled.div`
  position: relative;
  width: 100%;
  min-width: 0;
`

const Input = styled.input`
  width: 100%;
  min-width: 0;
  padding: 6px 9px;
  border: 1px solid var(--platform-colors-border);
  border-radius: var(--platform-radius-sm, 3px);
  background: var(--platform-colors-surface);
  color: var(--platform-colors-text);
  font: inherit;
  font-size: var(--platform-typography-font-size-sm);

  &:focus {
    outline: 2px solid var(--platform-colors-focus);
    outline-offset: -1px;
  }
`

const Menu = styled.div`
  position: absolute;
  top: calc(100% + 3px);
  left: 0;
  right: 0;
  z-index: 60;
  min-width: 260px;
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid var(--platform-colors-border);
  border-radius: var(--platform-radius-sm, 3px);
  background: var(--platform-colors-surface);
  box-shadow: var(--platform-shadow-md, 0 2px 8px rgb(0 0 0 / 0.14));
`

const OptionButton = styled.button<{ $active?: boolean }>`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-bottom: 1px solid var(--platform-colors-divider);
  background: ${props => (props.$active ? 'var(--platform-colors-surface-hover)' : 'var(--platform-colors-surface)')};
  color: var(--platform-colors-text);
  font: inherit;
  font-size: var(--platform-typography-font-size-xs);
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--platform-colors-surface-hover);
  }

  &:last-child {
    border-bottom: 0;
  }
`

const CityTitle = styled.div`
  display: grid;
  gap: 1px;
  min-width: 0;

  strong {
    font-weight: 600;
    color: var(--platform-colors-text);
  }
  span {
    color: var(--platform-colors-text-tertiary);
    font-family: var(--platform-typography-font-family-mono);
    font-size: 10.5px;
  }
`

const RightMeta = styled.div`
  display: grid;
  justify-items: end;
  white-space: nowrap;
  font-family: var(--platform-typography-font-family-mono);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  color: var(--platform-colors-text-secondary);

  small {
    color: var(--platform-colors-text-tertiary);
    font-size: 10px;
  }
`

export interface TimeZonePickerProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  /** When true, displays a friendly city + offset summary while unfocused. */
  friendlyDisplay?: boolean
}

export function TimeZonePicker({
  value,
  onChange,
  placeholder = 'City, airport (SFO, LHR) or timezone…',
  ariaLabel = 'Time zone',
  friendlyDisplay = false,
}: TimeZonePickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const blurTimer = useRef<number | null>(null)
  const listId = useId()

  useEffect(() => {
    return () => {
      if (blurTimer.current !== null) window.clearTimeout(blurTimer.current)
    }
  }, [])

  const matches = useMemo(() => searchTimeZones(open ? query : '', new Date(), 12), [open, query])

  const displayValue = useMemo(() => {
    if (open) return query
    if (!friendlyDisplay || !value || !isValidTimeZone(value)) return value
    const snap = getTimeZoneSnapshot(value)
    return `${timeZoneDisplayLabel(value)} (${snap.offsetLabel})`
  }, [open, query, friendlyDisplay, value])

  const select = (tz: string) => {
    onChange(tz)
    setQuery(tz)
    setOpen(false)
  }

  return (
    <Wrap>
      <Input
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        value={displayValue}
        placeholder={placeholder}
        onFocus={() => {
          if (blurTimer.current !== null) window.clearTimeout(blurTimer.current)
          setQuery(value)
          setActiveIndex(0)
          setOpen(true)
        }}
        onChange={event => {
          const next = event.target.value
          setQuery(next)
          setActiveIndex(0)
          setOpen(true)
          onChange(next)
        }}
        onKeyDown={event => {
          if (!open) return
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActiveIndex(i => Math.min(matches.length - 1, i + 1))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActiveIndex(i => Math.max(0, i - 1))
          } else if (event.key === 'Enter' && matches[activeIndex]) {
            event.preventDefault()
            select(matches[activeIndex]!.timeZone)
          } else if (event.key === 'Escape') {
            setOpen(false)
          }
        }}
        onBlur={() => {
          blurTimer.current = window.setTimeout(() => setOpen(false), 140)
        }}
      />
      {open && matches.length > 0 && (
        <Menu id={listId} role="listbox" aria-label="Time zone suggestions">
          {matches.map((entry, idx) => (
            <OptionButton
              key={entry.timeZone}
              type="button"
              role="option"
              aria-selected={entry.timeZone === value}
              $active={idx === activeIndex}
              onMouseDown={event => {
                event.preventDefault()
                select(entry.timeZone)
              }}
            >
              <CityTitle>
                <strong>{entry.city}</strong>
                <span>{entry.timeZone}</span>
              </CityTitle>
              <RightMeta>
                <span>{entry.timeLabel}</span>
                <small>{entry.shortCode} · {entry.offsetLabel}</small>
              </RightMeta>
            </OptionButton>
          ))}
        </Menu>
      )}
    </Wrap>
  )
}
