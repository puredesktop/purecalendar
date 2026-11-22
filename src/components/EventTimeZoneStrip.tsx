import { useMemo } from 'react'
import { styled } from 'styled-components'
import { AlertTriangle, Clock, Mail } from 'lucide-react'
import type { CalendarEvent, PinnedTimeZone, SavedTimeZoneContact } from '../types'
import { localTimeReadout, timeZoneDisplayLabel, upcomingDstTransition } from '../lib/timeZoneDirectory'
import { Button } from '../ui/Button'

const Box = styled.div`
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--pure-chrome-line);
  border-radius: var(--platform-radius-sm, 3px);
  background: var(--platform-colors-surface-subtle);
`

const Head = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`

const Kicker = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--pure-chrome-muted);
  font-family: var(--platform-typography-font-family-mono);
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
`

const ZoneList = styled.div`
  display: grid;
  gap: 5px;
`

const ZoneItem = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
`

const ZoneName = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--platform-colors-text-secondary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const BandDot = styled.span<{ $band: 'daytime' | 'stretch' | 'night' }>`
  width: 7px;
  height: 7px;
  flex-shrink: 0;
  background: ${props =>
    props.$band === 'daytime'
      ? 'var(--platform-colors-success)'
      : props.$band === 'stretch'
        ? 'var(--platform-colors-warning)'
        : 'var(--platform-colors-border-strong)'};
`

const ZoneTime = styled.span`
  font-family: var(--platform-typography-font-family-mono);
  font-size: 11.5px;
  color: var(--platform-colors-text);
  white-space: nowrap;
`

const Tag = styled.span`
  margin-left: 5px;
  padding: 0 4px;
  border: 1px solid var(--pure-chrome-line);
  font-size: 10px;
  color: var(--platform-colors-text-secondary);
`

const Pills = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
`

const Pill = styled.button<{ $active?: boolean }>`
  height: 22px;
  padding: 0 7px;
  border: 1px solid ${props => (props.$active ? 'var(--platform-colors-accent)' : 'var(--pure-chrome-line)')};
  border-radius: var(--platform-radius-sm, 3px);
  background: ${props => (props.$active ? 'var(--platform-colors-surface-selected)' : 'var(--platform-colors-surface)')};
  color: var(--platform-colors-text);
  font: inherit;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;

  &:hover {
    background: var(--platform-colors-surface-hover);
  }
`

const WarnLine = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--platform-colors-warning-text);
  font-size: 11.5px;
`

const DURATIONS = [15, 30, 45, 60, 90]

export interface EventTimeZoneStripProps {
  event: CalendarEvent
  displayTimeZone: string
  pinnedTimeZones: PinnedTimeZone[]
  savedContacts: SavedTimeZoneContact[]
  timeFormat: '12h' | '24h'
  conflictingEvents: CalendarEvent[]
  canEdit: boolean
  onSetDurationMinutes: (minutes: number) => void
  onSendViaPureMail: () => void
}

export function EventTimeZoneStrip({
  event,
  displayTimeZone,
  pinnedTimeZones,
  savedContacts,
  timeFormat,
  conflictingEvents,
  canEdit,
  onSetDurationMinutes,
  onSendViaPureMail,
}: EventTimeZoneStripProps) {
  const currentDuration = Math.max(
    5,
    Math.round((Date.parse(event.endsAt) - Date.parse(event.startsAt)) / 60_000),
  )

  const zones = useMemo(() => {
    const out: Array<{ key: string; label: string; timeZone: string }> = [
      { key: `primary:${displayTimeZone}`, label: `${timeZoneDisplayLabel(displayTimeZone)} (You)`, timeZone: displayTimeZone },
    ]
    const seen = new Set([displayTimeZone])
    for (const att of event.attendees) {
      const contact = savedContacts.find(c => c.email && c.email.toLowerCase() === att.email.toLowerCase())
      if (contact && !seen.has(contact.timeZone)) {
        seen.add(contact.timeZone)
        out.push({ key: `att:${att.email}`, label: `${att.name || att.email} (${timeZoneDisplayLabel(contact.timeZone)})`, timeZone: contact.timeZone })
      }
    }
    for (const pin of pinnedTimeZones) {
      if (!seen.has(pin.timeZone)) {
        seen.add(pin.timeZone)
        out.push({ key: `pin:${pin.id}`, label: pin.label || timeZoneDisplayLabel(pin.timeZone), timeZone: pin.timeZone })
      }
    }
    if (event.timeZone && !seen.has(event.timeZone)) {
      seen.add(event.timeZone)
      out.push({ key: `ev:${event.timeZone}`, label: `${timeZoneDisplayLabel(event.timeZone)} (Event)`, timeZone: event.timeZone })
    }
    return out
  }, [displayTimeZone, event.attendees, event.timeZone, pinnedTimeZones, savedContacts])

  const dstWarnings = useMemo(() => {
    const ms = Date.parse(event.startsAt)
    if (!Number.isFinite(ms)) return []
    return zones
      .map(z => upcomingDstTransition(z.timeZone, ms - 2 * 86_400_000, 7))
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
  }, [event.startsAt, zones])

  if (event.allDay) return null

  return (
    <Box aria-label="Event time across time zones">
      <Head>
        <Kicker>
          <Clock size={12} /> Across time zones
        </Kicker>
        <Button size="sm" variant="subtle" onClick={onSendViaPureMail} title="Open pre-filled invite email in PureMail">
          <Mail size={12} /> Email in PureMail
        </Button>
      </Head>

      <ZoneList>
        {zones.map(z => {
          const r = localTimeReadout(event.startsAt, event.endsAt, z.timeZone, displayTimeZone, timeFormat)
          return (
            <ZoneItem key={z.key}>
              <ZoneName>
                <BandDot $band={r.band} title={r.band === 'daytime' ? 'Working hours' : r.band === 'stretch' ? 'Early/evening' : 'Night'} />
                {z.label}
              </ZoneName>
              <ZoneTime>
                {r.startTime}–{r.endTime}
                {r.dayBadge && <Tag>{r.dayBadge}</Tag>}
                <Tag>{r.offsetLabel}</Tag>
              </ZoneTime>
            </ZoneItem>
          )
        })}
      </ZoneList>

      {canEdit && (
        <Pills aria-label="Quick duration">
          {DURATIONS.map(mins => (
            <Pill
              key={mins}
              type="button"
              $active={currentDuration === mins}
              onClick={() => onSetDurationMinutes(mins)}
            >
              {mins}m
            </Pill>
          ))}
        </Pills>
      )}

      {conflictingEvents.length > 0 && (
        <WarnLine role="status">
          <AlertTriangle size={13} />
          Conflicts with {conflictingEvents.slice(0, 2).map(e => `"${e.title}"`).join(', ')}
          {conflictingEvents.length > 2 ? ` +${conflictingEvents.length - 2} more` : ''}
        </WarnLine>
      )}

      {dstWarnings.map(w => (
        <WarnLine key={`${w.timeZone}:${w.dateKey}`}>
          <AlertTriangle size={13} />
          DST notice: {w.summary}
        </WarnLine>
      ))}
    </Box>
  )
}
