import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CalendarStore,
  CandidateSlot,
  SchedulingBooking,
  SchedulingLink,
  SchedulingLinkKind,
  SchedulingPollVote,
  SchedulingQuestion,
} from '../types'
import {
  buildAnonymizedBusyIntervals,
  cloudSchedulingOffered,
  defaultSchedulingAvailability,
  publishSchedulingCatalog,
  schedulingCloud,
  type SchedulingCloudStatus,
} from '../lib/schedulingClient'
import { firstEditableCalendarId } from '../lib/calendarModel'

export function useSchedulingLinks(args: {
  store: CalendarStore
  displayTimeZone: string
  setStore: React.Dispatch<React.SetStateAction<CalendarStore>>
  background?: boolean
}) {
  const { store, displayTimeZone, setStore, background = true } = args
  const [status, setStatus] = useState<SchedulingCloudStatus>({
    connected: false,
    publicUrl: null,
    organisation: null,
    host: null,
    linkCount: 0,
    busyUpdatedAt: null,
  })
  const [cloudLinks, setCloudLinks] = useState<SchedulingLink[]>([])
  const [bookings, setBookings] = useState<SchedulingBooking[]>([])
  const [pollVotes, setPollVotes] = useState<Record<string, SchedulingPollVote[]>>({})
  const [busySyncLabel, setBusySyncLabel] = useState<string | null>(null)
  const lastBusyHashRef = useRef<string>('')
  const lastCatalogHashRef = useRef<string>('')

  const localLinks = store.settings.localSchedulingLinks ?? []
  const allLinks = useMemo(
    () => (status.connected ? [...cloudLinks, ...localLinks] : localLinks),
    [status.connected, cloudLinks, localLinks],
  )

  const refresh = useCallback(async () => {
    const nextStatus = await schedulingCloud.status()
    setStatus(nextStatus)
    if (!nextStatus.connected) {
      setCloudLinks([])
      setBookings([])
      setPollVotes({})
      return
    }
    try {
      const listed = await schedulingCloud.list()
      setCloudLinks(listed.links)
      setBookings(listed.bookings)
      setPollVotes(listed.pollVotes)
      // Project PureCloud guest bookings onto the calendar grid so they are immediately visible.
      if (listed.bookings.length > 0) {
        setStore(current => {
          const targetCalId = firstEditableCalendarId(current)
          if (!targetCalId) return current
          const byId = new Map(current.events.map(e => [e.id, e]))
          let changed = false
          for (const b of listed.bookings) {
            const eventId = `booking:${b.id}`
            const existing = byId.get(eventId)
            const status = b.status === 'cancelled' ? 'cancelled' : b.status === 'pending' ? 'tentative' : 'confirmed'
            if (
              existing &&
              existing.startsAt === b.startsAt &&
              existing.endsAt === b.endsAt &&
              existing.status === status
            ) {
              continue
            }
            changed = true
            byId.set(eventId, {
              id: eventId,
              calendarId: existing?.calendarId ?? targetCalId,
              externalUid: b.icsUid,
              title: `${b.linkTitle} · ${b.guestName}`,
              description: [
                b.notes,
                `Guest timezone: ${b.guestTimeZone}`,
                `Manage: ${b.manageUrl}`,
              ]
                .filter(Boolean)
                .join('\n'),
              startsAt: b.startsAt,
              endsAt: b.endsAt,
              timeZone: b.guestTimeZone || displayTimeZone,
              allDay: false,
              status,
              lifecycle: 'active',
              visibility: 'default',
              busyStatus: status === 'cancelled' ? 'free' : status === 'tentative' ? 'tentative' : 'busy',
              attendees: [{ name: b.guestName, email: b.guestEmail, response: 'accepted' }],
              reminders: existing?.reminders ?? [{ id: 'reminder_booking', minutesBefore: 10 }],
              attachments: existing?.attachments ?? [],
              linkedItems: existing?.linkedItems ?? [],
              source: 'provider',
              syncState: 'synced',
            })
          }
          return changed ? { ...current, events: [...byId.values()] } : current
        })
      }
    } catch {
      // Keep last known links on transient fetch failure.
    }
  }, [displayTimeZone, setStore])

  useEffect(() => {
    if (!background || !cloudSchedulingOffered()) return
    void refresh()
    const timer = window.setInterval(() => void refresh(), 45_000)
    return () => window.clearInterval(timer)
  }, [background, refresh])

  // Keep anonymized busy windows synced to PureServer when connected.
  useEffect(() => {
    if (!background || !status.connected) return
    const now = new Date()
    const fromIso = new Date(now.getTime() - 86_400_000).toISOString()
    const toIso = new Date(now.getTime() + 65 * 86_400_000).toISOString()
    const intervals = buildAnonymizedBusyIntervals(store, fromIso, toIso, displayTimeZone)
    const hash = JSON.stringify(intervals)
    if (hash === lastBusyHashRef.current) return
    lastBusyHashRef.current = hash
    void schedulingCloud
      .syncBusy(intervals)
      .then(res => setBusySyncLabel(`Availability synced (${res.count} busy block${res.count === 1 ? '' : 's'})`))
      .catch(() => setBusySyncLabel(null))
  }, [background, status.connected, store, displayTimeZone])

  // Publish lightweight scheduling catalog to platform storage so PureMail can insert booking links & free slots.
  useEffect(() => {
    if (!background) return
    const hash = JSON.stringify({
      tz: displayTimeZone,
      c: status.connected,
      links: allLinks.map(l => [l.id, l.active, l.url, l.title]),
      events: store.events.length,
    })
    if (hash === lastCatalogHashRef.current) return
    const timer = window.setTimeout(() => {
      lastCatalogHashRef.current = hash
      void publishSchedulingCatalog(store, allLinks, displayTimeZone, status.connected)
    }, 2_000)
    return () => window.clearTimeout(timer)
  }, [background, store, allLinks, displayTimeZone, status.connected])

  const createLink = useCallback(
    async (input: {
      kind: SchedulingLinkKind
      title: string
      slug?: string
      description?: string
      location?: string
      durations?: number[]
      defaultDuration?: number
      bufferBeforeMinutes?: number
      bufferAfterMinutes?: number
      minNoticeMinutes?: number
      maxBookingsPerDay?: number | null
      requireConfirmation?: boolean
      candidateSlots?: CandidateSlot[]
      questions?: SchedulingQuestion[]
    }): Promise<SchedulingLink> => {
      const baseAvail = defaultSchedulingAvailability(store)
      const availability = {
        ...baseAvail,
        bufferBeforeMinutes: input.bufferBeforeMinutes ?? baseAvail.bufferBeforeMinutes,
        bufferAfterMinutes: input.bufferAfterMinutes ?? baseAvail.bufferAfterMinutes,
        minNoticeMinutes: input.minNoticeMinutes ?? baseAvail.minNoticeMinutes,
        maxBookingsPerDay: input.maxBookingsPerDay ?? baseAvail.maxBookingsPerDay,
      }

      if (status.connected) {
        const res = await schedulingCloud.create({
          kind: input.kind,
          title: input.title,
          slug: input.slug,
          description: input.description,
          location: input.location,
          hostTimeZone: displayTimeZone,
          durations: input.durations ?? [30],
          defaultDuration: input.defaultDuration ?? input.durations?.[0] ?? 30,
          availability,
          candidateSlots: input.candidateSlots ?? [],
          questions: input.questions ?? [],
          requireConfirmation: input.requireConfirmation ?? false,
        })
        await refresh()
        return res.link
      }

      // Offline / PureServer unattached fallback: keep locally so templates & PureMail work smoothly.
      const id = `local_link_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      const token = Math.random().toString(36).slice(2, 12)
      const slug =
        input.kind === 'booking'
          ? (input.slug || input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'meeting')
          : null
      const url =
        input.kind === 'booking'
          ? `https://purecloud.local/book/${slug}`
          : input.kind === 'poll'
            ? `https://purecloud.local/book/p/${token}`
            : `https://purecloud.local/book/i/${token}`
      const localLink: SchedulingLink = {
        id,
        kind: input.kind,
        slug,
        token,
        url,
        title: input.title,
        description: input.description || null,
        location: input.location || null,
        hostName: store.accounts[0]?.name || 'Me',
        hostEmail: store.accounts[0]?.email || null,
        hostTimeZone: displayTimeZone,
        durations: input.durations ?? [30],
        defaultDuration: input.defaultDuration ?? input.durations?.[0] ?? 30,
        availability,
        candidateSlots: input.candidateSlots ?? [],
        questions: input.questions ?? [],
        requireConfirmation: input.requireConfirmation ?? false,
        active: true,
        expiresAt: null,
        bookingCount: 0,
        pollVoteCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        localOnly: true,
      }
      setStore(current => ({
        ...current,
        settings: {
          ...current.settings,
          localSchedulingLinks: [localLink, ...(current.settings.localSchedulingLinks ?? [])],
        },
      }))
      return localLink
    },
    [store, displayTimeZone, status.connected, refresh, setStore],
  )

  const toggleLinkActive = useCallback(
    async (link: SchedulingLink) => {
      if (link.localOnly || !status.connected) {
        setStore(current => ({
          ...current,
          settings: {
            ...current.settings,
            localSchedulingLinks: (current.settings.localSchedulingLinks ?? []).map(item =>
              item.id === link.id ? { ...item, active: !item.active, updatedAt: Date.now() } : item,
            ),
          },
        }))
        return
      }
      await schedulingCloud.update({ id: link.id, active: !link.active })
      await refresh()
    },
    [status.connected, setStore, refresh],
  )

  const deleteLink = useCallback(
    async (link: SchedulingLink) => {
      if (link.localOnly || !status.connected) {
        setStore(current => ({
          ...current,
          settings: {
            ...current.settings,
            localSchedulingLinks: (current.settings.localSchedulingLinks ?? []).filter(item => item.id !== link.id),
          },
        }))
        return
      }
      await schedulingCloud.remove(link.id)
      await refresh()
    },
    [status.connected, setStore, refresh],
  )

  const confirmBooking = useCallback(
    async (id: string) => {
      await schedulingCloud.confirmBooking(id)
      await refresh()
    },
    [refresh],
  )

  const cancelBooking = useCallback(
    async (id: string) => {
      await schedulingCloud.cancelBooking(id)
      await refresh()
    },
    [refresh],
  )

  const finalizePoll = useCallback(
    async (linkId: string, startsAt: string, endsAt: string) => {
      const res = await schedulingCloud.finalizePoll(linkId, startsAt, endsAt)
      await refresh()
      return res
    },
    [refresh],
  )

  return {
    status,
    links: allLinks,
    bookings,
    pollVotes,
    busySyncLabel,
    refresh,
    createLink,
    toggleLinkActive,
    deleteLink,
    confirmBooking,
    cancelBooking,
    finalizePoll,
  }
}
