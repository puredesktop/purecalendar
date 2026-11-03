import { Plus } from 'lucide-react'
import { styled } from 'styled-components'
import { PlatformIcon } from '@purescience/platform-ui/components/chrome/PlatformIcon'
import { EventSurfaceTitle } from './EventSurfaceTitle'
import { eventRefs } from '../lib/agentRefs'
import { formatTimeInTimeZone, isDraftEvent } from '../lib/calendarModel'
import {
  compactAgendaItems,
  compactDayHeading,
  type CompactAgendaDay,
} from '../lib/compactAgenda'
import type { CalendarEvent, CalendarTask } from '../types'

/** The calendar held in a page: the coming days, one reading column wide. */
const Sheet = styled.div`
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  padding: 4px var(--pure-chrome-inset) 28px;
  background: var(--calendar-page);
`

const Day = styled.section`
  padding: 14px 0 10px;

  & + & {
    border-top: 1px solid var(--calendar-grid-line);
  }
`

const DayHead = styled.header`
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-height: 24px;
`

const DayTitle = styled.h2<{ $today: boolean }>`
  margin: 0;
  color: ${({ $today }) => ($today ? 'var(--calendar-today-text)' : 'var(--calendar-ink)')};
  font-size: 13px;
  font-weight: 600;
`

const DayDate = styled.span`
  color: var(--platform-colors-text-secondary);
  font-size: 12px;
`

const AddOnDay = styled.button`
  display: inline-flex;
  align-items: center;
  align-self: center;
  gap: 4px;
  margin-left: auto;
  padding: 2px 6px;
  border: 0;
  border-radius: var(--platform-radius-sm);
  background: transparent;
  color: var(--platform-colors-text-secondary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;

  &:hover {
    background: var(--calendar-surface-muted);
    color: var(--calendar-ink);
  }
`

const Quiet = styled.p`
  margin: 4px 0 2px;
  color: var(--calendar-ink-faint);
  font-size: 12px;
`

const Row = styled.button`
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr);
  column-gap: 10px;
  align-items: baseline;
  box-sizing: border-box;
  width: calc(100% + 16px);
  margin: 2px -8px 0;
  padding: 7px 8px;
  border: 0;
  border-radius: var(--platform-radius-sm);
  background: transparent;
  color: var(--calendar-ink);
  font: inherit;
  text-align: left;
  cursor: pointer;

  strong {
    font-size: 13px;
    font-weight: 500;
  }

  &:hover {
    background: var(--calendar-surface-muted);
  }
`

const Dot = styled.span<{ $color: string; $draft: boolean }>`
  align-self: center;
  grid-row: 1;
  box-sizing: border-box;
  width: 8px;
  height: 8px;
  border: 1.5px solid ${({ $color }) => $color};
  border-radius: 50%;
  background: ${({ $color, $draft }) => ($draft ? 'transparent' : $color)};
`

const Meta = styled.div`
  grid-column: 2;
  margin-top: 1px;
  color: var(--platform-colors-text-secondary);
  font-size: 12px;
`

function eventTimeLabel(event: CalendarEvent, day: CompactAgendaDay, timeZone: string): string {
  const startedBefore = Date.parse(event.startsAt) < Date.parse(day.start)
  const endsAfter = Date.parse(event.endsAt) > Date.parse(day.end)
  if (event.allDay || (startedBefore && endsAfter)) return 'All day'
  const end = formatTimeInTimeZone(event.endsAt, timeZone)
  if (startedBefore) return `Until ${end}`
  return `${formatTimeInTimeZone(event.startsAt, timeZone)} to ${end}`
}

export function CompactAgenda({
  days,
  events,
  tasks,
  timeZone,
  now,
  isLocal,
  eventColor,
  taskColor,
  onOpenEvent,
  onOpenTask,
  onAddOnDay,
}: {
  days: CompactAgendaDay[]
  events: CalendarEvent[]
  tasks: CalendarTask[]
  timeZone: string
  now: Date
  isLocal: (event: CalendarEvent) => boolean
  eventColor: (event: CalendarEvent) => string
  taskColor: string
  onOpenEvent: (event: CalendarEvent) => void
  onOpenTask: (task: CalendarTask) => void
  onAddOnDay: (date: Date) => void
}): React.ReactElement {
  return (
    <Sheet data-compact-agenda>
      {days.map(day => {
        const heading = compactDayHeading(day, now, timeZone)
        const items = compactAgendaItems(day, events, tasks, timeZone)
        return (
          <Day key={day.key} aria-label={`${heading.title}, ${heading.date}`}>
            <DayHead>
              <DayTitle $today={heading.today}>{heading.title}</DayTitle>
              <DayDate>{heading.date}</DayDate>
              <AddOnDay
                type="button"
                aria-label={`New event on ${heading.title}, ${heading.date}`}
                onClick={() => onAddOnDay(day.date)}
              >
                <PlatformIcon icon={Plus} size={12} strokeWidth={1.75} />
                Add
              </AddOnDay>
            </DayHead>
            {items.length === 0 && <Quiet>Nothing scheduled</Quiet>}
            {items.map(item =>
              item.type === 'event' ? (
                <Row
                  key={item.id}
                  type="button"
                  {...eventRefs(item.event)}
                  onClick={() => onOpenEvent(item.event)}
                >
                  <Dot $color={eventColor(item.event)} $draft={isDraftEvent(item.event)} />
                  <EventSurfaceTitle event={item.event} local={isLocal(item.event)} />
                  <Meta>
                    {isDraftEvent(item.event) ? 'Draft · ' : ''}
                    {eventTimeLabel(item.event, day, timeZone)}
                  </Meta>
                </Row>
              ) : (
                <Row key={item.id} type="button" onClick={() => onOpenTask(item.task)}>
                  <Dot $color={taskColor} $draft={false} />
                  <strong>{item.task.title}</strong>
                  <Meta>Task · {item.task.sourceLabel}</Meta>
                </Row>
              ),
            )}
          </Day>
        )
      })}
    </Sheet>
  )
}
