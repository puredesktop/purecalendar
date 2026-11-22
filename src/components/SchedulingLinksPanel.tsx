import { useState } from 'react'
import { styled } from 'styled-components'
import { Check, Cloud, CloudOff, Copy, ExternalLink, Link2, Mail, Plus, Trash2, Users, X } from 'lucide-react'
import type {
  CalendarStore,
  SchedulingBooking,
  SchedulingLink,
  SchedulingPollVote,
  SchedulingQuestion,
} from '../types'
import { defaultSchedulingAvailability } from '../lib/schedulingClient'
import { localTimeReadout } from '../lib/timeZoneDirectory'
import { Button } from '../ui/Button'

const Panel = styled.aside`
  display: flex;
  flex-direction: column;
  width: min(560px, 100vw);
  height: 100%;
  min-height: 0;
  border-left: 1px solid var(--pure-chrome-line);
  background: var(--pure-chrome-paper, var(--platform-colors-surface));
  box-shadow: -12px 0 28px rgb(0 0 0 / 0.12);
  color: var(--platform-colors-text);
`

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--pure-chrome-line);
`

const Tabs = styled.div`
  display: flex;
  gap: 6px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--pure-chrome-fence);
  background: var(--platform-colors-surface-subtle);
`

const TabBtn = styled.button<{ $active: boolean }>`
  height: 28px;
  padding: 0 10px;
  border: 1px solid ${props => (props.$active ? 'var(--platform-colors-accent)' : 'var(--pure-chrome-line)')};
  border-radius: var(--platform-radius-sm, 3px);
  background: ${props => (props.$active ? 'var(--platform-colors-surface-selected)' : 'var(--platform-colors-surface)')};
  color: var(--platform-colors-text);
  font: inherit;
  font-size: 12px;
  font-weight: ${props => (props.$active ? 650 : 500)};
  cursor: pointer;
`

const Body = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px;
  display: grid;
  align-content: start;
  gap: 12px;
`

const StatusBar = styled.div<{ $live: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--pure-chrome-line);
  border-radius: var(--platform-radius-sm, 3px);
  background: var(--platform-colors-surface-subtle);
  font-size: 12px;
  color: ${props => (props.$live ? 'var(--platform-colors-success-text)' : 'var(--platform-colors-text-secondary)')};
`

const Card = styled.article`
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--pure-chrome-line);
  border-radius: var(--platform-radius-sm, 3px);
  background: var(--platform-colors-surface);
`

const CardHead = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;

  strong {
    font-size: 14px;
    font-weight: 650;
  }
`

const Kicker = styled.span`
  color: var(--pure-chrome-muted);
  font-family: var(--platform-typography-font-family-mono);
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
`

const UrlLine = styled.div`
  font-family: var(--platform-typography-font-family-mono);
  font-size: 11.5px;
  color: var(--platform-colors-accent-text);
  word-break: break-all;
`

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
`

const FieldGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
`

const Field = styled.label<{ $wide?: boolean }>`
  display: grid;
  gap: 4px;
  grid-column: ${props => (props.$wide ? '1 / -1' : 'auto')};
  font-size: 11.5px;
  font-weight: 600;
  color: var(--platform-colors-text-secondary);

  input,
  textarea {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--platform-colors-border);
    border-radius: var(--platform-radius-sm, 3px);
    background: var(--platform-colors-surface);
    color: var(--platform-colors-text);
    font: inherit;
    font-weight: 400;
    font-size: 13px;
  }
`

const PollSlotRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 8px;
  border: 1px solid var(--pure-chrome-fence);
  border-radius: var(--platform-radius-sm, 3px);
  font-size: 12px;
`

export interface SchedulingLinksPanelProps {
  store: CalendarStore
  displayTimeZone: string
  timeFormat: '12h' | '24h'
  cloudConnected: boolean
  cloudOrgName: string | null
  cloudPublicUrl: string | null
  links: SchedulingLink[]
  bookings: SchedulingBooking[]
  pollVotes: Record<string, SchedulingPollVote[]>
  busySyncLabel: string | null
  onClose: () => void
  onRefresh: () => Promise<void>
  onCreateBookingLink: (input: {
    title: string
    slug: string
    description: string
    location: string
    durations: number[]
    defaultDuration: number
    bufferBeforeMinutes: number
    bufferAfterMinutes: number
    minNoticeMinutes: number
    maxBookingsPerDay: number | null
    requireConfirmation: boolean
    questions: SchedulingQuestion[]
  }) => Promise<void>
  onToggleLinkActive: (link: SchedulingLink) => Promise<void>
  onDeleteLink: (link: SchedulingLink) => Promise<void>
  onConfirmBooking: (bookingId: string) => Promise<void>
  onCancelBooking: (bookingId: string) => Promise<void>
  onFinalizePoll: (linkId: string, startsAt: string, endsAt: string) => Promise<void>
  onSendLinkViaPureMail: (link: SchedulingLink) => Promise<void>
  onEmailGuestViaPureMail: (booking: SchedulingBooking) => Promise<void>
  onOpenExternalUrl: (url: string) => void
  onStartShareAvailability: () => void
}

export function SchedulingLinksPanel({
  store,
  displayTimeZone,
  timeFormat,
  cloudConnected,
  cloudOrgName,
  cloudPublicUrl,
  links,
  bookings,
  pollVotes,
  busySyncLabel,
  onClose,
  onRefresh,
  onCreateBookingLink,
  onToggleLinkActive,
  onDeleteLink,
  onConfirmBooking,
  onCancelBooking,
  onFinalizePoll,
  onSendLinkViaPureMail,
  onEmailGuestViaPureMail,
  onOpenExternalUrl,
  onStartShareAvailability,
}: SchedulingLinksPanelProps) {
  const [tab, setTab] = useState<'links' | 'polls' | 'bookings'>('links')
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('30 min Intro')
  const [slug, setSlug] = useState('intro-30')
  const [location, setLocation] = useState('PureMeet')
  const [description, setDescription] = useState('')
  const [durations, setDurations] = useState<number[]>([15, 30, 60])
  const [defaultDuration, setDefaultDuration] = useState(30)
  const [bufferBefore, setBufferBefore] = useState('10')
  const [bufferAfter, setBufferAfter] = useState('10')
  const [minNotice, setMinNotice] = useState('60')
  const [maxPerDay, setMaxPerDay] = useState('6')
  const [requireConfirm, setRequireConfirm] = useState(false)
  const [questionText, setQuestionText] = useState('What would you like to discuss?')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const bookingAndOneOffLinks = links.filter(l => l.kind !== 'poll')
  const pollLinks = links.filter(l => l.kind === 'poll')

  const copy = async (id: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(id)
      window.setTimeout(() => setCopiedId(c => (c === id ? null : c)), 1800)
    } catch {}
  }

  const toggleDuration = (mins: number) => {
    setDurations(prev => {
      const next = prev.includes(mins) ? prev.filter(x => x !== mins) : [...prev, mins].sort((a, b) => a - b)
      if (!next.length) return prev
      if (!next.includes(defaultDuration)) setDefaultDuration(next[0]!)
      return next
    })
  }

  const submitCreate = async () => {
    if (!title.trim()) {
      setError('Enter a title for this booking link.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onCreateBookingLink({
        title: title.trim(),
        slug: slug.trim(),
        description: description.trim(),
        location: location.trim(),
        durations,
        defaultDuration,
        bufferBeforeMinutes: Math.max(0, Number(bufferBefore) || 0),
        bufferAfterMinutes: Math.max(0, Number(bufferAfter) || 0),
        minNoticeMinutes: Math.max(0, Number(minNotice) || 0),
        maxBookingsPerDay: maxPerDay.trim() ? Math.max(1, Number(maxPerDay) || 1) : null,
        requireConfirmation: requireConfirm,
        questions: questionText.trim() ? [{ id: 'q_topic', label: questionText.trim(), required: false, type: 'text' }] : [],
      })
      setCreating(false)
      setTitle('30 min Intro')
      setSlug(`meet-${Math.random().toString(36).slice(2, 6)}`)
      setDescription('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const defaults = defaultSchedulingAvailability(store)

  return (
    <Panel aria-label="Booking links and scheduling studio">
      <Header>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Link2 size={15} />
          <strong>Booking links &amp; polls</strong>
        </div>
        <Row>
          <Button size="sm" variant="subtle" onClick={() => void onRefresh()}>
            Refresh
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close booking links">
            <X size={14} />
          </Button>
        </Row>
      </Header>

      <Tabs role="tablist">
        <TabBtn type="button" role="tab" aria-selected={tab === 'links'} $active={tab === 'links'} onClick={() => setTab('links')}>
          Links ({bookingAndOneOffLinks.length})
        </TabBtn>
        <TabBtn type="button" role="tab" aria-selected={tab === 'polls'} $active={tab === 'polls'} onClick={() => setTab('polls')}>
          Group polls ({pollLinks.length})
        </TabBtn>
        <TabBtn type="button" role="tab" aria-selected={tab === 'bookings'} $active={tab === 'bookings'} onClick={() => setTab('bookings')}>
          Bookings ({bookings.length})
        </TabBtn>
      </Tabs>

      <Body>
        <StatusBar $live={cloudConnected}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {cloudConnected ? <Cloud size={14} /> : <CloudOff size={14} />}
            {cloudConnected
              ? `PureCloud connected (${cloudOrgName ?? 'Organisation'})${busySyncLabel ? ` · ${busySyncLabel}` : ''}`
              : 'PureServer not attached — saving link templates locally. Connect PureServer in Settings to publish live guest URLs.'}
          </span>
          {cloudPublicUrl && <Kicker>{cloudPublicUrl.replace(/^https?:\/\//, '')}</Kicker>}
        </StatusBar>

        {tab === 'links' && (
          <>
            <Row>
              <Button size="sm" variant="primary" onClick={() => setCreating(v => !v)}>
                <Plus size={13} /> New booking page
              </Button>
              <Button size="sm" variant="subtle" onClick={onStartShareAvailability}>
                Pick slots on grid (one-off / poll)
              </Button>
            </Row>

            {creating && (
              <Card>
                <Kicker>New reusable booking page</Kicker>
                <FieldGrid>
                  <Field>
                    Title
                    <input value={title} onChange={e => setTitle(e.target.value)} />
                  </Field>
                  <Field>
                    URL slug
                    <input value={slug} onChange={e => setSlug(e.target.value)} placeholder="adam/intro" />
                  </Field>
                  <Field>
                    Location / call link
                    <input value={location} onChange={e => setLocation(e.target.value)} placeholder="PureMeet / Zoom" />
                  </Field>
                  <Field>
                    Max bookings / day
                    <input type="number" min={1} value={maxPerDay} onChange={e => setMaxPerDay(e.target.value)} />
                  </Field>
                  <Field $wide>
                    Guest-selectable durations (beats Calendly: let guests pick length)
                    <Row style={{ marginTop: 4 }}>
                      {[15, 30, 45, 60, 90].map(m => (
                        <TabBtn key={m} type="button" $active={durations.includes(m)} onClick={() => toggleDuration(m)}>
                          {m}m
                        </TabBtn>
                      ))}
                    </Row>
                  </Field>
                  <Field>
                    Buffer before (min)
                    <input type="number" min={0} step={5} value={bufferBefore} onChange={e => setBufferBefore(e.target.value)} />
                  </Field>
                  <Field>
                    Buffer after (min)
                    <input type="number" min={0} step={5} value={bufferAfter} onChange={e => setBufferAfter(e.target.value)} />
                  </Field>
                  <Field>
                    Min notice (min)
                    <input type="number" min={0} step={15} value={minNotice} onChange={e => setMinNotice(e.target.value)} />
                  </Field>
                  <Field>
                    Host availability
                    <input readOnly value={`${Object.keys(defaults.weekdays).length} days/wk · ${displayTimeZone}`} />
                  </Field>
                  <Field $wide>
                    Booking question (optional)
                    <input value={questionText} onChange={e => setQuestionText(e.target.value)} />
                  </Field>
                  <Field $wide>
                    Description
                    <textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} />
                  </Field>
                </FieldGrid>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <input type="checkbox" checked={requireConfirm} onChange={e => setRequireConfirm(e.target.checked)} />
                  Require my confirmation before confirming booking
                </label>
                {error && <div style={{ color: 'var(--platform-colors-danger-text)', fontSize: 12 }}>{error}</div>}
                <Row>
                  <Button size="sm" variant="primary" disabled={saving} onClick={() => void submitCreate()}>
                    {saving ? 'Saving…' : 'Create link'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
                    Cancel
                  </Button>
                </Row>
              </Card>
            )}

            {bookingAndOneOffLinks.length === 0 ? (
              <Card>
                <strong>No booking links yet</strong>
                <span style={{ fontSize: 12.5, color: 'var(--platform-colors-text-secondary)' }}>
                  Create a reusable booking page with guest-selectable durations and dual-timezone comparison, or drag slots on the grid to send a one-off private invite link.
                </span>
              </Card>
            ) : (
              bookingAndOneOffLinks.map(link => (
                <Card key={link.id}>
                  <CardHead>
                    <strong>{link.title}</strong>
                    <Kicker>
                      {link.kind === 'oneoff' ? 'One-off invite' : 'Booking page'}
                      {link.localOnly ? ' · Local' : link.active ? ' · Active' : ' · Paused'}
                    </Kicker>
                  </CardHead>
                  <UrlLine>{link.url}</UrlLine>
                  <div style={{ fontSize: 12, color: 'var(--platform-colors-text-secondary)' }}>
                    {link.durations.map(d => `${d}m`).join(' / ')} · {link.hostTimeZone}
                    {link.location ? ` · ${link.location}` : ''}
                    {link.bookingCount > 0 ? ` · ${link.bookingCount} booked` : ''}
                  </div>
                  <Row>
                    <Button size="sm" variant="primary" onClick={() => void copy(link.id, link.url)}>
                      {copiedId === link.id ? <Check size={12} /> : <Copy size={12} />}
                      {copiedId === link.id ? 'Copied' : 'Copy link'}
                    </Button>
                    <Button size="sm" variant="subtle" onClick={() => void onSendLinkViaPureMail(link)}>
                      <Mail size={12} /> Send in PureMail
                    </Button>
                    {!link.localOnly && (
                      <Button size="sm" variant="subtle" onClick={() => onOpenExternalUrl(link.url)}>
                        <ExternalLink size={12} /> Preview
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => void onToggleLinkActive(link)}>
                      {link.active ? 'Pause' : 'Resume'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void onDeleteLink(link)} aria-label={`Delete ${link.title}`}>
                      <Trash2 size={12} />
                    </Button>
                  </Row>
                </Card>
              ))
            )}
          </>
        )}

        {tab === 'polls' && (
          <>
            <Row>
              <Button size="sm" variant="primary" onClick={onStartShareAvailability}>
                <Users size={13} /> New group poll from grid
              </Button>
            </Row>
            {pollLinks.length === 0 ? (
              <Card>
                <strong>No group polls yet</strong>
                <span style={{ fontSize: 12.5, color: 'var(--platform-colors-text-secondary)' }}>
                  Select candidate slots on your calendar or in the Multi-Timezone Matrix to create a group poll link where invitees vote in their own timezone.
                </span>
              </Card>
            ) : (
              pollLinks.map(poll => {
                const votes = pollVotes[poll.id] ?? []
                return (
                  <Card key={poll.id}>
                    <CardHead>
                      <strong>{poll.title}</strong>
                      <Kicker>{poll.active ? 'Open poll' : 'Closed'} · {votes.length} vote{votes.length === 1 ? '' : 's'}</Kicker>
                    </CardHead>
                    <UrlLine>{poll.url}</UrlLine>
                    <Row>
                      <Button size="sm" variant="subtle" onClick={() => void copy(poll.id, poll.url)}>
                        <Copy size={12} /> {copiedId === poll.id ? 'Copied' : 'Copy poll link'}
                      </Button>
                      <Button size="sm" variant="subtle" onClick={() => void onSendLinkViaPureMail(poll)}>
                        <Mail size={12} /> Invite via PureMail
                      </Button>
                    </Row>
                    {poll.candidateSlots.map(slot => {
                      const yes = votes.filter(v => v.votes[slot.start] === 'yes').length
                      const maybe = votes.filter(v => v.votes[slot.start] === 'maybe').length
                      const r = localTimeReadout(slot.start, slot.end, displayTimeZone, displayTimeZone, timeFormat)
                      return (
                        <PollSlotRow key={slot.start}>
                          <div>
                            <strong>{r.dateLabel} · {r.startTime}–{r.endTime}</strong>
                            <div style={{ fontSize: 11, color: 'var(--platform-colors-text-secondary)' }}>
                              Yes: {yes} · If needed: {maybe}
                            </div>
                          </div>
                          {poll.active && !poll.localOnly && (
                            <Button size="sm" variant="primary" onClick={() => void onFinalizePoll(poll.id, slot.start, slot.end)}>
                              Confirm winner
                            </Button>
                          )}
                        </PollSlotRow>
                      )
                    })}
                  </Card>
                )
              })
            )}
          </>
        )}

        {tab === 'bookings' && (
          <>
            {bookings.length === 0 ? (
              <Card>
                <strong>No upcoming bookings</strong>
                <span style={{ fontSize: 12.5, color: 'var(--platform-colors-text-secondary)' }}>
                  When guests book through your PureCloud links, they appear here automatically and sync to your calendar.
                </span>
              </Card>
            ) : (
              bookings.map(b => {
                const mine = localTimeReadout(b.startsAt, b.endsAt, displayTimeZone, displayTimeZone, timeFormat)
                const guest = localTimeReadout(b.startsAt, b.endsAt, b.guestTimeZone, displayTimeZone, timeFormat)
                return (
                  <Card key={b.id}>
                    <CardHead>
                      <strong>{b.linkTitle}</strong>
                      <Kicker>{b.status}</Kicker>
                    </CardHead>
                    <div style={{ fontSize: 12.5 }}>
                      <strong>{b.guestName}</strong> ({b.guestEmail})
                    </div>
                    <div style={{ fontSize: 12, fontFamily: 'var(--platform-typography-font-family-mono)' }}>
                      You: {mine.dateLabel} · {mine.startTime}–{mine.endTime} ({mine.offsetLabel})
                      {b.guestTimeZone !== displayTimeZone && (
                        <div>
                          Guest: {guest.dateLabel} · {guest.startTime}–{guest.endTime} ({b.guestTimeZone})
                        </div>
                      )}
                    </div>
                    {b.notes && <div style={{ fontSize: 12, color: 'var(--platform-colors-text-secondary)' }}>{b.notes}</div>}
                    <Row>
                      {b.status === 'pending' && (
                        <Button size="sm" variant="primary" onClick={() => void onConfirmBooking(b.id)}>
                          Confirm
                        </Button>
                      )}
                      <Button size="sm" variant="subtle" onClick={() => void onEmailGuestViaPureMail(b)}>
                        <Mail size={12} /> Email guest
                      </Button>
                      {b.status !== 'cancelled' && (
                        <Button size="sm" variant="ghost" onClick={() => void onCancelBooking(b.id)}>
                          Cancel
                        </Button>
                      )}
                    </Row>
                  </Card>
                )
              })
            )}
          </>
        )}
      </Body>
    </Panel>
  )
}
