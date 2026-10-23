import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { onTeamCalendarChanged, teamCalendar, teamCalendarOffered } from '../bridge/platformBridge'
import {
  calendarEventFromTeam,
  mergeTeamPushResult,
  mergeTeamSnapshot,
  teamEventsToSend,
  teamInputFromEvent,
  teamServerId,
  teamTombstones,
  type TeamPushOutcome,
} from '../lib/teamCalendar'
import type { CalendarStore } from '../types'

export interface TeamCalendarMeta {
  organisation: string
  me: { id: string; name: string }
  people: Array<{ id: string; name: string }>
  teams: Array<{ id: string; name: string }>
}

/** A refusal worth saying (the server's words), or a connection that will come back (null: try again later). */
const refusal = (error: unknown): string | null => {
  const message = error instanceof Error ? error.message : String(error)
  return /could not be reached|offline|failed to fetch|network|timed? ?out|aborted/i.test(message) ? null : message
}

/**
 * The team calendar, kept in the store as one more account (lib/teamCalendar.ts):
 * looked at on opening, whenever the server says it changed, every five
 * minutes and on coming back to the window; what is changed here is sent a
 * moment later, one event at a time, and answering a meeting is sent at once.
 */
export function useTeamCalendar({
  store,
  setStore,
  timeZone,
  onRenamed,
  onNotice,
  holdId,
}: {
  store: CalendarStore
  setStore: Dispatch<SetStateAction<CalendarStore>>
  timeZone: string
  /** An event sent for the first time has the server's id now. */
  onRenamed: (from: string, to: string) => void
  onNotice: (text: string) => void
  /** The event open for editing: sent once the person is done with it, not while they are still writing it. */
  holdId?: string | null
}) {
  const [meta, setMeta] = useState<TeamCalendarMeta | null>(null)
  const metaRef = useRef(meta)
  metaRef.current = meta
  const zone = useRef(timeZone)
  zone.current = timeZone
  const callbacks = useRef({ onRenamed, onNotice })
  callbacks.current = { onRenamed, onNotice }
  const busyRef = useRef(false)
  const [retry, setRetry] = useState(0)

  const refresh = useCallback(async (): Promise<void> => {
    if (!teamCalendarOffered()) return
    try {
      const day = 86_400_000
      const listing = await teamCalendar.list({ from: new Date(Date.now() - 62 * day).toISOString(), to: new Date(Date.now() + 400 * day).toISOString() })
      setStore(current => mergeTeamSnapshot(current, listing, zone.current))
      setMeta(
        listing.available && listing.me
          ? { organisation: listing.organisation ?? 'Organisation', me: listing.me, people: listing.people, teams: listing.teams }
          : null,
      )
    } catch (error) {
      console.warn('[purecalendar] team calendar could not be read:', error instanceof Error ? error.message : error)
    }
  }, [setStore])

  useEffect(() => {
    void refresh()
    let soon: number | undefined
    const later = () => {
      window.clearTimeout(soon)
      soon = window.setTimeout(() => void refresh(), 300)
    }
    const stop = onTeamCalendarChanged(later)
    const interval = window.setInterval(() => void refresh(), 5 * 60_000)
    const back = () => { if (document.visibilityState === 'visible') later() }
    document.addEventListener('visibilitychange', back)
    return () => {
      stop()
      window.clearTimeout(soon)
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', back)
    }
  }, [refresh])

  // Send what changed here: new and changed events, then removals.
  useEffect(() => {
    if (!meta || busyRef.current) return
    const toSend = teamEventsToSend(store).filter(event => event.id !== holdId)
    const tombstones = teamTombstones(store)
    if (!toSend.length && !tombstones.length) return
    const timer = window.setTimeout(async () => {
      if (busyRef.current) return
      busyRef.current = true
      const outcomes: TeamPushOutcome[] = []
      let transient = false
      for (const sent of toSend) {
        try {
          const input = teamInputFromEvent(sent)
          const saved = input.id ? await teamCalendar.update({ ...input, id: input.id }) : await teamCalendar.create(input)
          outcomes.push({ kind: 'saved', sent, event: saved.event, clashes: saved.clashes ?? [] })
        } catch (error) {
          const problem = refusal(error)
          if (problem === null) transient = true
          else outcomes.push({ kind: 'refused', sent, problem, conflict: /changed since you opened it/i.test(problem) })
        }
      }
      for (const id of tombstones) {
        try {
          await teamCalendar.remove(teamServerId(id)!)
          outcomes.push({ kind: 'removed', id })
        } catch (error) {
          const problem = refusal(error)
          if (problem === null) transient = true
          // Already gone, or not this person's to remove: either way it is not coming back here.
          else {
            outcomes.push({ kind: 'removed', id })
            if (!/not found|no such/i.test(problem)) callbacks.current.onNotice(problem)
          }
        }
      }
      const me = metaRef.current?.me.id ?? null
      setStore(current => mergeTeamPushResult(current, outcomes, me, zone.current).store)
      busyRef.current = false
      // A new event has the server's id now: the open one follows it.
      for (const outcome of outcomes) {
        if (outcome.kind === 'saved' && outcome.sent.id !== `t:${outcome.event.id}`) callbacks.current.onRenamed(outcome.sent.id, `t:${outcome.event.id}`)
      }
      for (const outcome of outcomes) {
        if (outcome.kind === 'refused') callbacks.current.onNotice(`${outcome.sent.title || 'The event'} was not saved to the team calendar: ${outcome.problem}`)
        if (outcome.kind === 'saved' && outcome.clashes.length) {
          const who = [...new Set(outcome.clashes.flatMap(clash => clash.people))]
          callbacks.current.onNotice(`${who.join(', ')} ${who.length === 1 ? 'is' : 'are'} already booked then (${outcome.clashes.map(clash => clash.title).join(', ')}).`)
        }
      }
      if (transient) window.setTimeout(() => setRetry(value => value + 1), 30_000)
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [store, meta, retry, setStore, holdId])

  /** This person's answer to a team meeting, sent at once. */
  const respond = useCallback(
    async (eventId: string, response: 'yes' | 'no' | 'maybe'): Promise<void> => {
      const id = teamServerId(eventId)
      if (!id) throw new Error('This meeting has not reached the team calendar yet.')
      const answered = await teamCalendar.respond(id, response)
      const next = calendarEventFromTeam(answered.event, metaRef.current?.me.id ?? null, zone.current)
      setStore(current => ({
        ...current,
        events: current.events.map(event => (event.id === eventId ? { ...next, reminders: event.reminders } : event)),
      }))
    },
    [setStore],
  )

  /** When these teammates are taken (their team meetings), between `from` and `to`. */
  const busy = useCallback(
    async (people: string[], from: string, to: string) => (await teamCalendar.busy(people, from, to)).busy,
    [],
  )

  return { meta, refresh, respond, busy }
}
