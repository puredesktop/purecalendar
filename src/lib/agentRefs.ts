/**
 * Tags for the shell's agent activity layer (AgentActivityLayer, mounted by AppFrame). An element whose
 * `data-agent-ref` holds a ref a tool call names (an argument value, plain or as `key:value`, or an id in a read's
 * answer) is marked while the agent reads or writes it. Markup only: nothing here changes behaviour.
 */
export type AgentRefProps = { 'data-agent-ref': string; 'data-agent-label'?: string }

function agentRefs(values: Record<string, string>, label: string): AgentRefProps {
  const refs = new Set<string>()
  for (const [key, value] of Object.entries(values)) {
    if (!value || /\s/.test(value)) continue
    refs.add(value)
    refs.add(`${key}:${value}`)
  }
  return label ? { 'data-agent-ref': [...refs].join(' '), 'data-agent-label': label } : { 'data-agent-ref': [...refs].join(' ') }
}

/**
 * An event: `eventId` in update/delete/reschedule/activate, `id` in listCalendarEvents / searchCalendar /
 * createCalendarDraft answers. Not its calendar: a list answer names every event's calendarId, and that should
 * mark the calendar, not every event in it.
 */
export const eventRefs = (event: { id: string; title?: string }): AgentRefProps =>
  agentRefs({ eventId: event.id, id: event.id }, event.title?.trim() || 'Event')

/** A calendar: `calendarId` (listCalendarEvents filter, createCalendarDraft, updateCalendarEvent, answers), `id` in getCalendarSettings. */
export const calendarRefs = (calendar: { id: string; name: string }): AgentRefProps =>
  agentRefs({ calendarId: calendar.id, id: calendar.id }, calendar.name)
