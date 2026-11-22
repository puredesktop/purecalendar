import { styled } from 'styled-components'
import type { PinnedTimeZone } from '../types'
import { railHourInfo, timeZoneShortCode, formatOffsetMinutes, offsetMinutesAt } from '../lib/timeZoneDirectory'
import { GRID_Z_STICKY_HEADER } from '../lib/gridLayers'

export const PRIMARY_RAIL_WIDTH = 64
export const SECONDARY_RAIL_WIDTH = 54

export function totalTimeRailWidth(secondaryCount: number): number {
  return PRIMARY_RAIL_WIDTH + secondaryCount * SECONDARY_RAIL_WIDTH
}

const HeaderStrip = styled.div<{ $cols: number }>`
  position: sticky;
  top: 0;
  z-index: ${GRID_Z_STICKY_HEADER};
  display: grid;
  grid-template-columns: ${({ $cols }) =>
    $cols > 0 ? `${Array($cols).fill(`${SECONDARY_RAIL_WIDTH}px`).join(' ')} ${PRIMARY_RAIL_WIDTH}px` : `${PRIMARY_RAIL_WIDTH}px`};
  align-items: end;
  border-right: 1px solid var(--calendar-grid-line);
  border-bottom: 1px solid var(--calendar-grid-line);
  background: var(--calendar-surface);
`

const ZoneHeaderBtn = styled.button<{ $primary?: boolean }>`
  display: grid;
  justify-items: end;
  gap: 1px;
  padding: 5px 6px 5px 2px;
  border: 0;
  border-right: ${props => (props.$primary ? '0' : '1px solid var(--pure-chrome-fence)')};
  background: transparent;
  color: ${props => (props.$primary ? 'var(--calendar-ink)' : 'var(--calendar-ink-faint)')};
  font-family: var(--platform-typography-font-family-mono);
  font-size: 10px;
  line-height: 1.15;
  cursor: pointer;

  &:hover {
    background: var(--platform-colors-surface-hover);
    color: var(--calendar-ink);
  }

  strong {
    font-weight: 650;
    letter-spacing: 0.04em;
  }
  small {
    font-size: 9px;
    opacity: 0.8;
  }
`

const RailGroup = styled.div<{ $cols: number }>`
  display: grid;
  grid-template-columns: ${({ $cols }) =>
    $cols > 0 ? `${Array($cols).fill(`${SECONDARY_RAIL_WIDTH}px`).join(' ')} ${PRIMARY_RAIL_WIDTH}px` : `${PRIMARY_RAIL_WIDTH}px`};
  min-height: 100%;
  border-right: 1px solid var(--calendar-grid-line);
  background: var(--calendar-surface);
`

const RailCol = styled.div<{ $secondary?: boolean }>`
  position: relative;
  min-height: 100%;
  border-right: ${props => (props.$secondary ? '1px solid var(--pure-chrome-fence)' : '0')};
`

const HourCell = styled.div<{ $top: number; $band?: 'daytime' | 'stretch' | 'night'; $secondary?: boolean }>`
  position: absolute;
  top: ${props => props.$top}px;
  right: 0;
  transform: translateY(-50%);
  width: 100%;
  padding: 0 6px 0 2px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  color: ${props =>
    props.$secondary && props.$band === 'daytime'
      ? 'var(--calendar-ink)'
      : 'var(--calendar-ink-faint)'};
  font-size: ${props => (props.$secondary ? '10.5px' : 'var(--platform-typography-font-size-xs)')};
  font-family: var(--platform-typography-font-family-mono);
  font-variant-numeric: tabular-nums;
  line-height: 1;
`

const RollTag = styled.span`
  font-size: 8.5px;
  padding: 0 2px;
  border: 1px solid var(--pure-chrome-line);
  color: var(--calendar-ink-faint);
`

export function MultiZoneHeaderSpacer({
  primaryTimeZone,
  secondaryZones,
  anchorDate,
  onSelectPreviewZone,
}: {
  primaryTimeZone: string
  secondaryZones: PinnedTimeZone[]
  anchorDate: Date
  onSelectPreviewZone?: (tz: string) => void
}) {
  const ms = anchorDate.getTime()
  const primaryCode = timeZoneShortCode(primaryTimeZone)
  const primaryOffset = formatOffsetMinutes(offsetMinutesAt(primaryTimeZone, ms))

  return (
    <HeaderStrip $cols={secondaryZones.length}>
      {secondaryZones.map(z => {
        const code = timeZoneShortCode(z.timeZone)
        const off = formatOffsetMinutes(offsetMinutesAt(z.timeZone, ms))
        return (
          <ZoneHeaderBtn
            key={z.id}
            type="button"
            title={`${z.label} (${z.timeZone}) — click to view calendar in this timezone`}
            onClick={() => onSelectPreviewZone?.(z.timeZone)}
          >
            <strong>{code}</strong>
            <small>{off.replace('UTC', '') || '0'}</small>
          </ZoneHeaderBtn>
        )
      })}
      <ZoneHeaderBtn
        type="button"
        $primary
        title={`Active timezone: ${primaryTimeZone} (${primaryOffset})`}
      >
        <strong>{primaryCode}</strong>
        <small>{primaryOffset.replace('UTC', '') || '0'}</small>
      </ZoneHeaderBtn>
    </HeaderStrip>
  )
}

export function MultiZoneTimeRail({
  dayKey,
  hours,
  hourHeight,
  primaryTimeZone,
  secondaryZones,
  timeFormat,
  formatPrimaryHour,
}: {
  dayKey: string
  hours: number[]
  hourHeight: number
  primaryTimeZone: string
  secondaryZones: PinnedTimeZone[]
  timeFormat: '12h' | '24h'
  formatPrimaryHour: (hour: number) => string
}) {
  return (
    <RailGroup $cols={secondaryZones.length} aria-label="Time zones rail">
      {secondaryZones.map(z => (
        <RailCol key={z.id} $secondary aria-label={`${z.label} time rail`}>
          {hours.map(hour => {
            if (hour === 0) return null
            const info = railHourInfo(dayKey, hour, primaryTimeZone, z.timeZone, timeFormat, z.workStart, z.workEnd)
            return (
              <HourCell key={hour} $top={hour * hourHeight} $band={info.band} $secondary>
                {info.hour === 0 && info.dayBadge && <RollTag>{info.dayBadge}</RollTag>}
                <span>{info.label}</span>
              </HourCell>
            )
          })}
        </RailCol>
      ))}
      <RailCol aria-label={`${primaryTimeZone} primary time rail`}>
        {hours.map(hour => (
          <HourCell key={hour} $top={hour * hourHeight}>
            {hour === 0 ? '' : formatPrimaryHour(hour)}
          </HourCell>
        ))}
      </RailCol>
    </RailGroup>
  )
}
