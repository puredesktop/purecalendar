import { Link2Off } from 'lucide-react'
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

export function EventSurfaceTitle({ event, draftPrefix = false }: { event: CalendarEvent; draftPrefix?: boolean }) {
  return <TitleRow>
    <strong>{draftPrefix ? 'Draft · ' : ''}{event.title}</strong>
    {!eventMeetingUrl(event) && <MissingLink role="img" aria-label="No meeting link" title="No meeting link">
      <Link2Off size={12} strokeWidth={1.6} aria-hidden="true" />
    </MissingLink>}
  </TitleRow>
}
