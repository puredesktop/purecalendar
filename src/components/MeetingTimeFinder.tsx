import { useEffect, useMemo, useRef, useState } from 'react'
import { styled } from 'styled-components'
import { AlertTriangle, Link2, Mail, Users, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { readParticipantAvailability, type TeamBusyReader } from '../lib/meetingAvailability'
import {
  findMeetingTimes,
  meetingDraftFlow,
  meetingProposalText,
  validateMeetingRequest,
  type MeetingDraftOutcome,
  type MeetingOption,
  type MeetingRequestInput,
  type MeetingSearch,
  type OwnerCalendarRead,
} from '../lib/meetingTimes'
import { buildOverlapMatrix, formatProposedSlotsText, type OverlapSlotCell } from '../lib/overlapMatrix'
import { isValidTimeZone } from '../lib/calendarModel'
import { localTimeReadout, timeZoneShortCode } from '../lib/timeZoneDirectory'
import { teammateAddress } from '../lib/teamCalendar'
import type { CalendarEvent, CalendarStore, CandidateSlot, PinnedTimeZone, SavedTimeZoneContact } from '../types'
import { TimeZonePicker } from './TimeZonePicker'

const Panel = styled.aside`
  display: flex;
  flex-direction: column;
  width: min(600px, 100vw);
  height: 100%;
  min-height: 0;
  border-left: 1px solid var(--pure-chrome-line);
  background: var(--pure-chrome-paper, var(--platform-colors-surface));
  box-shadow: -18px 0 34px rgb(0 0 0 / 0.12);
  color: var(--platform-colors-text);
`

const PanelHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px var(--pure-chrome-inset, 16px);
  border-bottom: 1px solid var(--pure-chrome-line);
`

const Scroll = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
`

const Block = styled.section`
  display: grid;
  gap: 12px;
  padding: 16px var(--pure-chrome-inset, 16px);
  border-bottom: 1px solid var(--pure-chrome-line);
`

const Kicker = styled.div`
  color: var(--pure-chrome-muted);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--pure-chrome-label-size, 11px);
  font-weight: 500;
  letter-spacing: var(--pure-chrome-label-tracking, 0.08em);
  text-transform: uppercase;
`

const Fields = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
`

const Field = styled.label<{ $wide?: boolean }>`
  display: grid;
  gap: 5px;
  grid-column: ${props => (props.$wide ? '1 / -1' : 'auto')};
  color: var(--platform-colors-text-secondary);
  font-size: var(--platform-typography-font-size-xs);
  font-weight: 600;

  > input {
    width: 100%;
    min-width: 0;
    padding: 7px 9px;
    border: 1px solid var(--platform-colors-border);
    border-radius: var(--platform-radius-sm);
    background: var(--platform-colors-surface);
    color: var(--platform-colors-text);
    font: inherit;
    font-weight: 400;
    font-size: var(--platform-typography-font-size-sm);
  }
`

const PersonRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr 28px;
  gap: 8px;
  align-items: end;
  padding: 10px;
  border: 1px solid var(--platform-colors-border);
  border-radius: var(--platform-radius-sm);

  > label:nth-of-type(3) {
    grid-column: 1 / 3;
  }
`

const IconButton = styled.button`
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--platform-colors-text-secondary);
  cursor: pointer;
  grid-row: 1;
  grid-column: 3;

  &:hover {
    background: var(--platform-colors-border);
    color: var(--platform-colors-text);
  }
`

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
`

const Note = styled.p<{ $tone?: 'danger' | 'muted' | 'warn' }>`
  margin: 0;
  color: ${props =>
    props.$tone === 'danger'
      ? 'var(--platform-colors-danger-text, #b42318)'
      : props.$tone === 'warn'
        ? 'var(--platform-colors-warning-text, #9a5b13)'
        : 'var(--platform-colors-text-secondary)'};
  font-size: var(--platform-typography-font-size-sm);
  line-height: 1.45;
`

const Errors = styled.ul`
  margin: 0;
  padding-left: 18px;
  color: var(--platform-colors-danger-text, #b42318);
  font-size: var(--platform-typography-font-size-sm);
`

const Option = styled.article`
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--platform-colors-border);
  border-radius: var(--platform-radius-md, 4px);
  background: var(--platform-colors-surface);
`

const OptionTime = styled.div`
  font-size: var(--platform-typography-font-size-md, 15px);
  font-weight: 650;
  line-height: 1.3;

  small {
    display: block;
    margin-top: 2px;
    color: var(--platform-colors-text-secondary);
    font-family: var(--platform-typography-font-family-mono);
    font-size: var(--platform-typography-font-size-xs);
    font-weight: 400;
  }
`

const Local = styled.ul`
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--platform-typography-font-size-sm);

  strong {
    font-weight: 600;
  }
  span {
    display: block;
    color: var(--platform-colors-text-secondary);
  }
`

const Availability = styled.em<{ $known: boolean }>`
  display: inline-block;
  margin-top: 2px;
  color: ${props =>
    props.$known
      ? 'var(--platform-colors-success-text, var(--platform-colors-text-secondary))'
      : 'var(--platform-colors-warning-text, var(--platform-colors-text-secondary))'};
  font-size: var(--platform-typography-font-size-xs);
  font-style: normal;
  font-weight: 600;
`

const Reasons = styled.ul`
  display: grid;
  gap: 3px;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--platform-colors-text-secondary);
  font-size: var(--platform-typography-font-size-xs);
  line-height: 1.4;

  li::before {
    content: attr(data-mark);
    display: inline-block;
    width: 14px;
    color: var(--platform-colors-text);
    font-weight: 700;
  }
`

const Proposal = styled.textarea`
  width: 100%;
  min-height: 180px;
  padding: 10px;
  border: 1px solid var(--platform-colors-border);
  border-radius: var(--platform-radius-sm);
  background: var(--platform-colors-surface);
  color: var(--platform-colors-text);
  font-family: var(--platform-typography-font-family-mono);
  font-size: var(--platform-typography-font-size-xs);
  line-height: 1.5;
  resize: vertical;
`

const MatrixWrap = styled.div`
  display: grid;
  gap: 8px;
`

const DayTabs = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`

const DayTab = styled.button<{ $active: boolean }>`
  height: 24px;
  padding: 0 8px;
  border: 1px solid ${props => (props.$active ? 'var(--platform-colors-accent)' : 'var(--platform-colors-border)')};
  border-radius: var(--platform-radius-sm, 3px);
  background: ${props => (props.$active ? 'var(--platform-colors-surface-selected)' : 'var(--platform-colors-surface)')};
  color: var(--platform-colors-text);
  font: inherit;
  font-size: 11px;
  font-weight: ${props => (props.$active ? 650 : 450)};
  cursor: pointer;
`

const MatrixScroll = styled.div`
  overflow-x: auto;
  border: 1px solid var(--platform-colors-border);
  border-radius: var(--platform-radius-sm, 3px);
  background: var(--platform-colors-surface);
`

const MatrixTable = styled.div<{ $cols: number }>`
  display: grid;
  grid-template-columns: 96px repeat(${props => props.$cols}, minmax(30px, 1fr));
  min-width: 540px;
  font-family: var(--platform-typography-font-family-mono);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
`

const MatrixRowLabel = styled.div`
  padding: 5px 6px;
  border-right: 1px solid var(--pure-chrome-line);
  border-bottom: 1px solid var(--pure-chrome-fence);
  background: var(--platform-colors-surface-subtle);
  color: var(--platform-colors-text);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const MatrixCellBtn = styled.button<{
  $quality: OverlapSlotCell['quality']
  $selected: boolean
  $hovered: boolean
}>`
  padding: 5px 2px;
  border: 0;
  border-right: 1px solid var(--pure-chrome-fence);
  border-bottom: 1px solid var(--pure-chrome-fence);
  background: ${props => {
    if (props.$selected) return 'var(--platform-colors-accent)'
    if (props.$quality === 'golden') return 'color-mix(in srgb, var(--platform-colors-success) 16%, var(--platform-colors-surface))'
    if (props.$quality === 'good') return 'color-mix(in srgb, var(--platform-colors-success) 8%, var(--platform-colors-surface))'
    if (props.$quality === 'stretch') return 'color-mix(in srgb, var(--platform-colors-warning) 14%, var(--platform-colors-surface))'
    if (props.$quality === 'owner-busy' || props.$quality === 'teammate-busy') return 'var(--platform-colors-surface-selected)'
    return 'var(--platform-colors-surface-subtle)'
  }};
  color: ${props =>
    props.$selected
      ? 'var(--platform-colors-text-on-accent)'
      : props.$quality === 'owner-busy' || props.$quality === 'teammate-busy' || props.$quality === 'past'
        ? 'var(--platform-colors-text-disabled)'
        : 'var(--platform-colors-text)'};
  outline: ${props => (props.$hovered ? '1px solid var(--platform-colors-accent)' : 'none')};
  outline-offset: -1px;
  font: inherit;
  text-decoration: ${props => (props.$quality === 'owner-busy' || props.$quality === 'teammate-busy' ? 'line-through' : 'none')};
  cursor: ${props => (props.$quality === 'past' || props.$quality === 'owner-busy' || props.$quality === 'teammate-busy' ? 'not-allowed' : 'pointer')};
`

const MatrixBandCell = styled.div<{ $band: 'daytime' | 'stretch' | 'night'; $busy?: boolean; $hovered?: boolean }>`
  padding: 4px 2px;
  text-align: center;
  border-right: 1px solid var(--pure-chrome-fence);
  border-bottom: 1px solid var(--pure-chrome-fence);
  background: ${props =>
    props.$busy
      ? 'var(--platform-colors-surface-selected)'
      : props.$band === 'daytime'
        ? 'color-mix(in srgb, var(--platform-colors-success) 12%, var(--platform-colors-surface))'
        : props.$band === 'stretch'
          ? 'color-mix(in srgb, var(--platform-colors-warning) 12%, var(--platform-colors-surface))'
          : 'var(--platform-colors-surface-subtle)'};
  color: ${props => (props.$band === 'night' || props.$busy ? 'var(--platform-colors-text-tertiary)' : 'var(--platform-colors-text)')};
  outline: ${props => (props.$hovered ? '1px solid var(--platform-colors-accent)' : 'none')};
  outline-offset: -1px;
`

const ScrubberReadout = styled.div`
  padding: 8px 10px;
  border: 1px solid var(--pure-chrome-line);
  border-radius: var(--platform-radius-sm, 3px);
  background: var(--platform-colors-surface-subtle);
  font-family: var(--platform-typography-font-family-mono);
  font-size: 11px;
  display: grid;
  gap: 3px;
`

interface PersonDraft {
  key: number
  name: string
  email: string
  timeZone: string
}

export interface MeetingTimeFinderProps {
  /** Out of sight but still mounted, so what was typed survives. */
  hidden?: boolean
  defaultFrom: string
  defaultTo: string
  /** The owner's calendar as it is now (re-read from its provider where there is one). */
  readOwner: () => Promise<OwnerCalendarRead>
  /** The team calendar's busy reader while this person is in an organisation; null otherwise. */
  busyReader: TeamBusyReader | null
  /** Teammates who can be added (their free/busy comes from the team calendar). */
  teammates?: Array<{ id: string; name: string }>
  ownerTimeZone?: string
  /** Pinned zones & saved contacts for one-click add into multi-TZ overlap finder. */
  pinnedTimeZones?: PinnedTimeZone[]
  savedContacts?: SavedTimeZoneContact[]
  timeFormat?: '12h' | '24h'
  cloudConnected?: boolean
  saveDraft: (event: CalendarEvent, base: CalendarStore) => void
  onOpenDraft: (eventId: string) => void
  onCreateLinkFromSlots?: (kind: 'oneoff' | 'poll', title: string, slots: CandidateSlot[]) => Promise<string | null>
  onSendViaPureMail?: (input: { to: Array<{ email: string; name?: string }>; subject: string; body: string }) => Promise<void>
  onRememberContacts?: (contacts: Array<{ name: string; email?: string; timeZone: string }>) => void
  onClose: () => void
  now?: () => Date
}

const outcomeMessage = (outcome: MeetingDraftOutcome): string =>
  outcome.kind === 'invalid'
    ? outcome.errors.join(' ')
    : outcome.kind === 'created' || outcome.kind === 'already-created'
      ? outcome.summary
      : outcome.reason

export function MeetingTimeFinder({
  hidden = false,
  defaultFrom,
  defaultTo,
  readOwner,
  busyReader,
  teammates = [],
  pinnedTimeZones = [],
  savedContacts = [],
  timeFormat = '12h',
  cloudConnected = false,
  saveDraft,
  onOpenDraft,
  onCreateLinkFromSlots,
  onSendViaPureMail,
  onRememberContacts,
  onClose,
  now = () => new Date(),
}: MeetingTimeFinderProps) {
  const [title, setTitle] = useState('')
  const [duration, setDuration] = useState('30')
  const [from, setFrom] = useState(defaultFrom)
  const [to, setTo] = useState(defaultTo)
  const [before, setBefore] = useState('0')
  const [after, setAfter] = useState('0')
  const [people, setPeople] = useState<PersonDraft[]>([])
  const nextKey = useRef(1)
  const [errors, setErrors] = useState<string[]>([])
  const [searching, setSearching] = useState(false)
  const [result, setResult] = useState<{
    search: MeetingSearch
    input: MeetingRequestInput
    owner: OwnerCalendarRead
  } | null>(null)
  const [choosing, setChoosing] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<{ startsAt: string; outcome: MeetingDraftOutcome } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [matrixDayIndex, setMatrixDayIndex] = useState(0)
  const [hoveredStart, setHoveredStart] = useState<string | null>(null)
  const [pickedSlots, setPickedSlots] = useState<CandidateSlot[]>([])
  const [linkUrl, setLinkUrl] = useState<string | null>(null)
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const proposalRef = useRef<HTMLTextAreaElement>(null)

  const formVersion = useRef(0)
  useEffect(() => {
    formVersion.current += 1
    setResult(null)
    setOutcome(null)
    setCopied(null)
    setPickedSlots([])
    setLinkUrl(null)
    setMatrixDayIndex(0)
  }, [title, duration, from, to, before, after, people])

  const addPerson = (person: Partial<PersonDraft> = {}) =>
    setPeople(current => [...current, { key: nextKey.current++, name: '', email: '', timeZone: '', ...person }])
  const updatePerson = (key: number, patch: Partial<PersonDraft>) =>
    setPeople(current => current.map(person => (person.key === key ? { ...person, ...patch } : person)))

  const currentInput = (): MeetingRequestInput => ({
    title: title.trim() || undefined,
    durationMinutes: Number(duration),
    from,
    to,
    bufferBeforeMinutes: Number(before || 0),
    bufferAfterMinutes: Number(after || 0),
    participants: people.map(person => ({
      ...(person.name.trim() ? { name: person.name.trim() } : {}),
      ...(person.email.trim() ? { email: person.email.trim() } : {}),
      timeZone: person.timeZone.trim(),
    })),
  })

  const search = async (): Promise<void> => {
    const input = currentInput()
    const version = formVersion.current
    const stale = () => formVersion.current !== version
    setOutcome(null)
    setCopied(null)
    const validation = validateMeetingRequest(input)
    if (!validation.ok) {
      setErrors(validation.errors)
      setResult(null)
      return
    }
    setSearching(true)
    try {
      let owner: OwnerCalendarRead
      try {
        owner = await readOwner()
      } catch (error) {
        if (stale()) return
        setErrors([
          `Your calendar could not be read (${error instanceof Error ? error.message : String(error)}), so no times are suggested. Try again.`,
        ])
        setResult(null)
        return
      }
      const at = now()
      const request = validation.request
      const availability = await readParticipantAvailability(
        request.participants,
        new Date(Date.parse(`${request.from}T00:00:00Z`) - 86_400_000).toISOString(),
        new Date(Date.parse(`${request.to}T00:00:00Z`) + 2 * 86_400_000).toISOString(),
        busyReader,
        at,
      )
      if (stale()) return
      const found = findMeetingTimes(input, { ...owner, now: at }, availability)
      if (!found.ok) {
        setErrors(found.errors)
        setResult(null)
        return
      }
      setErrors([])
      setResult({ search: found, input, owner })
      if (onRememberContacts) {
        const toRemember = request.participants
          .filter(p => (p.name || p.email) && !p.email?.endsWith('@team.invalid'))
          .map(p => ({ name: p.name || p.email!, ...(p.email ? { email: p.email } : {}), timeZone: p.timeZone }))
        if (toRemember.length > 0) onRememberContacts(toRemember)
      }
    } finally {
      setSearching(false)
    }
  }

  const choose = async (option: MeetingOption): Promise<void> => {
    if (!result || choosing) return
    setChoosing(option.startsAt)
    try {
      const done = await meetingDraftFlow.run(result.input, option.startsAt, result.search.availability, {
        readOwner,
        readParticipants: (participants, start, end) => readParticipantAvailability(participants, start, end, busyReader),
        saveDraft,
        now,
      })
      setOutcome({ startsAt: option.startsAt, outcome: done })
    } finally {
      setChoosing(null)
    }
  }

  const matrix = useMemo(() => {
    if (!result) return null
    return buildOverlapMatrix({
      store: result.owner.store,
      ownerTimeZone: result.owner.timeZone,
      fromDateKey: result.search.request.from,
      toDateKey: result.search.request.to,
      durationMinutes: result.search.request.durationMinutes,
      stepMinutes: 60,
      participants: result.search.request.participants.map(p => ({
        label: p.label,
        email: p.email,
        timeZone: p.timeZone,
      })),
      availability: result.search.availability,
      bufferBeforeMinutes: result.search.request.bufferBeforeMinutes,
      bufferAfterMinutes: result.search.request.bufferAfterMinutes,
      timeFormat,
      now: new Date(result.search.checkedAt),
    })
  }, [result, timeFormat])

  const activeMatrixDay = matrix?.days[matrixDayIndex] ?? matrix?.days[0] ?? null
  const hoveredCell = useMemo(
    () => activeMatrixDay?.cells.find(c => c.startsAt === hoveredStart) ?? null,
    [activeMatrixDay, hoveredStart],
  )

  const togglePickedSlot = (cell: OverlapSlotCell) => {
    if (cell.quality === 'past' || cell.quality === 'owner-busy' || cell.quality === 'teammate-busy') return
    setPickedSlots(current =>
      current.some(s => s.start === cell.startsAt)
        ? current.filter(s => s.start !== cell.startsAt)
        : [...current, { start: cell.startsAt, end: cell.endsAt }].sort((a, b) => a.start.localeCompare(b.start)),
    )
  }

  const slotsForShare = useMemo<CandidateSlot[]>(() => {
    if (pickedSlots.length > 0) return pickedSlots
    return result?.search.options.map(o => ({ start: o.startsAt, end: o.endsAt })) ?? []
  }, [pickedSlots, result])

  const proposal = useMemo(() => {
    if (!result) return ''
    if (pickedSlots.length > 0 || linkUrl) {
      const zones = [
        { label: `You (${timeZoneShortCode(result.search.ownerTimeZone)})`, timeZone: result.search.ownerTimeZone },
        ...result.search.request.participants.map(p => ({ label: p.label, timeZone: p.timeZone })),
      ]
      return formatProposedSlotsText(slotsForShare, zones, {
        title: result.search.request.title,
        bookingUrl: linkUrl ?? undefined,
        timeFormat,
        referenceTimeZone: result.search.ownerTimeZone,
      })
    }
    return meetingProposalText(result.search)
  }, [result, pickedSlots, linkUrl, slotsForShare, timeFormat])

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(proposal)
      setCopied('Copied.')
    } catch {
      proposalRef.current?.select()
      setCopied('Selected — press Copy on your keyboard.')
    }
  }

  const createLink = async (kind: 'oneoff' | 'poll') => {
    if (!result || !onCreateLinkFromSlots || !slotsForShare.length || actionBusy) return
    setActionBusy(kind)
    try {
      const url = await onCreateLinkFromSlots(kind, result.search.request.title, slotsForShare)
      if (url) {
        setLinkUrl(url)
        try {
          await navigator.clipboard.writeText(url)
          setCopied(kind === 'oneoff' ? 'One-off booking link created & copied.' : 'Group poll link created & copied.')
        } catch {
          setCopied(`Link ready: ${url}`)
        }
      }
    } finally {
      setActionBusy(null)
    }
  }

  const sendInMail = async () => {
    if (!result || !onSendViaPureMail || actionBusy) return
    setActionBusy('mail')
    try {
      const recipients = people
        .filter(p => p.email.trim())
        .map(p => ({ email: p.email.trim(), ...(p.name.trim() ? { name: p.name.trim() } : {}) }))
      await onSendViaPureMail({
        to: recipients,
        subject: `Meeting times: ${result.search.request.title}`,
        body: proposal,
      })
      setCopied('Opened pre-filled draft in PureMail.')
    } finally {
      setActionBusy(null)
    }
  }

  const unusedTeammates = teammates.filter(mate => !people.some(person => person.email === teammateAddress(mate.id)))
  const unusedContacts = savedContacts.filter(
    c => !people.some(p => (c.email && p.email === c.email) || (p.name === c.name && p.timeZone === c.timeZone)),
  )
  const unusedPinned = pinnedTimeZones.filter(z => isValidTimeZone(z.timeZone) && !people.some(p => p.timeZone === z.timeZone))

  return (
    <Panel aria-label="Find a time" style={hidden ? { display: 'none' } : undefined}>
      <PanelHeader>
        <Kicker>Find a time · Multi-timezone matrix</Kicker>
        <Button size="sm" onClick={onClose}>
          Close
        </Button>
      </PanelHeader>
      <Scroll>
        <Block>
          <Fields>
            <Field $wide>
              Meeting
              <input value={title} placeholder="Meeting" onChange={event => setTitle(event.target.value)} />
            </Field>
            <Field>
              Minutes
              <input type="number" min={1} step={5} value={duration} onChange={event => setDuration(event.target.value)} />
            </Field>
            <span />
            <Field>
              From
              <input type="date" value={from} onChange={event => setFrom(event.target.value)} />
            </Field>
            <Field>
              To
              <input type="date" value={to} onChange={event => setTo(event.target.value)} />
            </Field>
            <Field>
              Gap before (min)
              <input type="number" min={0} step={5} value={before} onChange={event => setBefore(event.target.value)} />
            </Field>
            <Field>
              Gap after (min)
              <input type="number" min={0} step={5} value={after} onChange={event => setAfter(event.target.value)} />
            </Field>
          </Fields>
        </Block>
        <Block>
          <Kicker>People &amp; time zones</Kicker>
          {people.map((person, index) => (
            <PersonRow key={person.key}>
              <Field>
                Name
                <input value={person.name} onChange={event => updatePerson(person.key, { name: event.target.value })} />
              </Field>
              <Field>
                Email
                <input value={person.email} placeholder="Optional" onChange={event => updatePerson(person.key, { email: event.target.value })} />
              </Field>
              <Field>
                Time zone
                <TimeZonePicker
                  value={person.timeZone}
                  placeholder="City, airport (SFO, LHR, TYO) or IANA…"
                  ariaLabel={`Time zone for ${person.name || `person ${index + 1}`}`}
                  onChange={tz => updatePerson(person.key, { timeZone: tz })}
                />
              </Field>
              <IconButton
                type="button"
                aria-label={`Remove ${person.name || `person ${index + 1}`}`}
                onClick={() => setPeople(current => current.filter(item => item.key !== person.key))}
              >
                <X size={14} />
              </IconButton>
            </PersonRow>
          ))}
          <Row>
            <Button size="sm" variant="ghost" onClick={() => addPerson()}>
              Add person
            </Button>
            {unusedTeammates.slice(0, 4).map(mate => (
              <Button key={mate.id} size="sm" variant="ghost" onClick={() => addPerson({ name: mate.name, email: teammateAddress(mate.id) })}>
                + {mate.name}
              </Button>
            ))}
            {unusedContacts.slice(0, 4).map(c => (
              <Button key={c.id} size="sm" variant="ghost" onClick={() => addPerson({ name: c.name, email: c.email ?? '', timeZone: c.timeZone })}>
                + {c.name} ({timeZoneShortCode(c.timeZone)})
              </Button>
            ))}
            {unusedPinned.slice(0, 4).map(pin => (
              <Button key={pin.id} size="sm" variant="ghost" onClick={() => addPerson({ name: pin.label, timeZone: pin.timeZone })}>
                + {pin.label}
              </Button>
            ))}
          </Row>
          <Note $tone="muted">
            A time zone shows each person&apos;s local time; it does not say they are free. Teammates&apos; team meetings are checked; anyone else&apos;s availability stays unknown.
          </Note>
          <Row>
            <Button size="sm" variant="primary" disabled={searching} onClick={() => void search()}>
              {searching ? 'Looking…' : 'Find times'}
            </Button>
          </Row>
          {errors.length > 0 && (
            <Errors role="alert" aria-label="Problems">
              {errors.map(error => (
                <li key={error}>{error}</li>
              ))}
            </Errors>
          )}
        </Block>
        {result && (
          <>
            {matrix && activeMatrixDay && (
              <Block aria-label="Multi-timezone overlap matrix">
                <Kicker>Visual overlap matrix · click open cells to pick slots</Kicker>
                {matrix.dstAlerts.map(alert => (
                  <Note key={`${alert.timeZone}:${alert.dateKey}`} $tone="warn">
                    <AlertTriangle size={12} style={{ verticalAlign: -1, marginRight: 5 }} />
                    DST alert: {alert.summary}
                  </Note>
                ))}
                {matrix.fairnessNote && <Note $tone="muted">{matrix.fairnessNote}</Note>}
                <MatrixWrap>
                  <DayTabs>
                    {matrix.days.map((d, idx) => (
                      <DayTab key={d.dateKey} type="button" $active={idx === matrixDayIndex} onClick={() => setMatrixDayIndex(idx)}>
                        {d.dayLabel}
                      </DayTab>
                    ))}
                  </DayTabs>
                  <MatrixScroll>
                    <MatrixTable $cols={activeMatrixDay.cells.length}>
                      <MatrixRowLabel>You ({timeZoneShortCode(matrix.ownerTimeZone)})</MatrixRowLabel>
                      {activeMatrixDay.cells.map(cell => {
                        const selected = pickedSlots.some(s => s.start === cell.startsAt)
                        return (
                          <MatrixCellBtn
                            key={`${cell.ownerHour}-${cell.ownerMinute}-${cell.startsAt}`}
                            type="button"
                            $quality={cell.quality}
                            $selected={selected}
                            $hovered={hoveredStart === cell.startsAt}
                            onMouseEnter={() => setHoveredStart(cell.startsAt)}
                            onMouseLeave={() => setHoveredStart(cur => (cur === cell.startsAt ? null : cur))}
                            onClick={() => togglePickedSlot(cell)}
                            title={`${cell.ownerLabel} · ${cell.quality}`}
                          >
                            {cell.ownerHour}
                          </MatrixCellBtn>
                        )
                      })}
                      {result.search.request.participants.map((p, pIdx) => (
                        <FragmentRow
                          key={`${p.label}-${pIdx}`}
                          label={`${p.label} (${timeZoneShortCode(p.timeZone)})`}
                          cells={activeMatrixDay.cells}
                          participantIndex={pIdx}
                          hoveredStart={hoveredStart}
                        />
                      ))}
                    </MatrixTable>
                  </MatrixScroll>
                  {hoveredCell && (
                    <ScrubberReadout>
                      <div>
                        <strong>
                          You: {localTimeReadout(hoveredCell.startsAt, hoveredCell.endsAt, matrix.ownerTimeZone, matrix.ownerTimeZone, timeFormat).startTime}–
                          {localTimeReadout(hoveredCell.startsAt, hoveredCell.endsAt, matrix.ownerTimeZone, matrix.ownerTimeZone, timeFormat).endTime} ({timeZoneShortCode(matrix.ownerTimeZone)})
                        </strong>
                      </div>
                      {hoveredCell.participants.map(pc => (
                        <div key={pc.label}>
                          {pc.label}: {pc.timeLabel} ({timeZoneShortCode(pc.timeZone)}
                          {pc.dayDiff !== 0 ? `, ${pc.dayDiff > 0 ? `+${pc.dayDiff}d` : `${pc.dayDiff}d`}` : ''}) ·{' '}
                          {pc.knownBusy ? 'Busy (team)' : pc.knownFree ? 'Free (team)' : `${pc.band} (availability unknown)`}
                        </div>
                      ))}
                    </ScrubberReadout>
                  )}
                  {pickedSlots.length > 0 && (
                    <Note $tone="muted">
                      Selected {pickedSlots.length} slot{pickedSlots.length === 1 ? '' : 's'} from matrix for booking link / email proposal.
                    </Note>
                  )}
                </MatrixWrap>
              </Block>
            )}

            <Block aria-label="Suggested times">
              <Kicker>
                {result.search.options.length
                  ? `${result.search.options.length} suggested time${result.search.options.length === 1 ? '' : 's'}`
                  : 'No suitable times'}
              </Kicker>
              {result.search.shortfall && <Note>{result.search.shortfall}</Note>}
              {result.search.options.map(option => {
                const mine = outcome?.startsAt === option.startsAt ? outcome.outcome : null
                const drafted = mine && (mine.kind === 'created' || mine.kind === 'already-created') ? mine.event : null
                return (
                  <Option key={option.startsAt} aria-label={`Option ${option.rank}`}>
                    <Kicker>Option {option.rank}</Kicker>
                    <OptionTime>
                      {option.owner.dateLabel}, {option.owner.start}–{option.owner.endDateLabel ? `${option.owner.endDateLabel}, ` : ''}
                      {option.owner.end}
                      <small>
                        You · {option.owner.timeZone} ({option.owner.offset}
                        {option.owner.endOffset !== option.owner.offset ? ` → ${option.owner.endOffset}` : ''}) · {option.durationMinutes} min
                      </small>
                    </OptionTime>
                    {option.participants.length > 0 && (
                      <Local>
                        {option.participants.map(slot => (
                          <li key={slot.label}>
                            <strong>{slot.label}</strong>
                            <span>{slot.local.text}</span>
                            <Availability $known={slot.availability === 'free'}>{slot.availabilityNote}</Availability>
                          </li>
                        ))}
                      </Local>
                    )}
                    <Reasons>
                      {option.benefits.map(text => (
                        <li key={text} data-mark="+">
                          {text}
                        </li>
                      ))}
                      {option.tradeOffs.map(text => (
                        <li key={text} data-mark="–">
                          {text}
                        </li>
                      ))}
                    </Reasons>
                    {drafted ? (
                      <Row>
                        <Note>{mine && outcomeMessage(mine)}</Note>
                        <Button size="sm" onClick={() => onOpenDraft(drafted.id)}>
                          Open draft
                        </Button>
                      </Row>
                    ) : (
                      <>
                        <Row>
                          <Button size="sm" variant="primary" disabled={choosing !== null} onClick={() => void choose(option)}>
                            {choosing === option.startsAt ? 'Checking…' : 'Draft this time'}
                          </Button>
                        </Row>
                        {mine && (
                          <Note $tone="danger" role="alert">
                            {outcomeMessage(mine)}
                          </Note>
                        )}
                      </>
                    )}
                  </Option>
                )
              })}
              <Note $tone="muted">{result.search.basis.join(' ')}</Note>
            </Block>
            <Block aria-label="Availability">
              <Kicker>Availability</Kicker>
              {result.search.availabilityCaveats.length ? (
                result.search.availabilityCaveats.map(text => <Note key={text}>{text}</Note>)
              ) : (
                <Note>Only your calendar is involved.</Note>
              )}
            </Block>
            <Block aria-label="Proposal">
              <Kicker>Proposal, links &amp; PureMail</Kicker>
              <Proposal ref={proposalRef} readOnly value={proposal} aria-label="Proposal text" />
              <Row>
                <Button size="sm" onClick={() => void copy()}>
                  Copy
                </Button>
                {onCreateLinkFromSlots && slotsForShare.length > 0 && (
                  <>
                    <Button size="sm" variant="primary" disabled={actionBusy !== null} onClick={() => void createLink('oneoff')}>
                      <Link2 size={12} /> {cloudConnected ? 'Create one-off link' : 'Save one-off link'}
                    </Button>
                    <Button size="sm" variant="subtle" disabled={actionBusy !== null} onClick={() => void createLink('poll')}>
                      <Users size={12} /> Create group poll
                    </Button>
                  </>
                )}
                {onSendViaPureMail && (
                  <Button size="sm" variant="subtle" disabled={actionBusy !== null} onClick={() => void sendInMail()}>
                    <Mail size={12} /> Send in PureMail
                  </Button>
                )}
                {copied && <Note>{copied}</Note>}
              </Row>
            </Block>
          </>
        )}
      </Scroll>
    </Panel>
  )
}

function FragmentRow({
  label,
  cells,
  participantIndex,
  hoveredStart,
}: {
  label: string
  cells: OverlapSlotCell[]
  participantIndex: number
  hoveredStart: string | null
}) {
  return (
    <>
      <MatrixRowLabel title={label}>{label}</MatrixRowLabel>
      {cells.map(cell => {
        const pc = cell.participants[participantIndex]
        const cellKey = `${cell.ownerHour}-${cell.ownerMinute}-${cell.startsAt}`
        if (!pc) return <MatrixBandCell key={cellKey} $band="night" />
        return (
          <MatrixBandCell
            key={cellKey}
            $band={pc.band}
            $busy={pc.knownBusy}
            $hovered={hoveredStart === cell.startsAt}
            title={`${pc.label}: ${pc.timeLabel} (${pc.timeZone})`}
          >
            {pc.hour}
          </MatrixBandCell>
        )
      })}
    </>
  )
}
