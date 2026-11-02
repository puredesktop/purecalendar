import type { MeetingParticipant, ParticipantAvailability } from './meetingTimes'
import { teammateId } from './teamCalendar'

/** The team calendar's busy reader (bridge `teamCalendar.busy`), or null where it is not offered. */
export type TeamBusyReader = (
  people: string[],
  from: string,
  to: string,
) => Promise<Array<{ id: string; name: string; times: Array<{ start: string; end: string }> }>>

export const TEAM_SOURCE = 'team calendar'

/** Whether this participant is a teammate: the one kind of person a supported connection (the team calendar) covers. */
export function isTeammateParticipant(participant: Pick<MeetingParticipant, 'email'>): boolean {
  return !!participant.email && teammateId(participant.email.toLowerCase()) !== null
}

/**
 * What a supported connection says about each participant. The only one is
 * the organisation's team calendar, and only for teammates (their address is
 * `<person id>@team.invalid`); it knows their team meetings. Everyone else is
 * 'none' — unknown, whatever their time zone. A failed read is 'unavailable'
 * for each teammate it covered, never an empty (free) calendar.
 */
export async function readParticipantAvailability(
  participants: MeetingParticipant[],
  from: string,
  to: string,
  reader: TeamBusyReader | null,
  now: Date = new Date(),
): Promise<ParticipantAvailability[]> {
  const ids = participants.map(participant => (participant.email ? teammateId(participant.email.toLowerCase()) : null))
  const wanted = [...new Set(ids.filter((id): id is string => !!id))]
  if (!wanted.length) return participants.map(() => ({ status: 'none' }))
  if (!reader) {
    return ids.map(id => (id ? { status: 'unavailable', reason: 'the team calendar is not connected here', source: TEAM_SOURCE } : { status: 'none' }))
  }
  try {
    const busy = await reader(wanted, from, to)
    const byId = new Map(busy.map(person => [person.id, person.times]))
    const checkedAt = now.toISOString()
    return ids.map(id => {
      if (!id) return { status: 'none' }
      const times = byId.get(id)
      return times
        ? { status: 'supplied', busy: times, checkedAt, source: TEAM_SOURCE }
        : { status: 'unavailable', reason: 'the team calendar did not answer for them', source: TEAM_SOURCE }
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return ids.map(id => (id ? { status: 'unavailable', reason, source: TEAM_SOURCE } : { status: 'none' }))
  }
}
