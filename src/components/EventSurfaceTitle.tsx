import { Laptop, Link2Off } from 'lucide-react'
import { styled } from 'styled-components'
import { eventMeetingUrl } from '../lib/eventLinks'
import type { CalendarEvent } from '../types'

const TitleRow = styled.span`
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`

const MissingLink = styled.span`
  display: inline-flex;
  flex: none;
  color: var(--calendar-ink-faint);
`

/** On a calendar on this computer only: a small computer, so it is plain at a glance it is on no networked calendar. */
const OnThisComputer = styled.span`
  display: inline-flex;
  flex: none;
  color: var(--calendar-ink-faint);
`

export function EventSurfaceTitle({ event, draftPrefix = false, local = false }: { event: CalendarEvent; draftPrefix?: boolean; local?: boolean }) {
  return <TitleRow>
    <strong>{draftPrefix ? 'Draft · ' : ''}{event.title}</strong>
    {local && <OnThisComputer role="img" aria-label="On this computer only" title="On this computer only — not on a networked calendar">
      <Laptop size={12} strokeWidth={1.6} aria-hidden="true" />
    </OnThisComputer>}
    {!eventMeetingUrl(event) && <MissingLink role="img" aria-label="No meeting link" title="No meeting link">
      <Link2Off size={12} strokeWidth={1.6} aria-hidden="true" />
    </MissingLink>}
  </TitleRow>
}
