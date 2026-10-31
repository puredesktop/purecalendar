import { useRef, useState } from 'react'
import { styled } from 'styled-components'
import { X } from 'lucide-react'
import { Button } from '@purescience/platform-ui/components/common/buttons/Button'
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
import { teammateAddress } from '../lib/teamCalendar'
import type { CalendarEvent, CalendarStore } from '../types'

const Panel = styled.aside`
  display: flex;
  flex-direction: column;
  width: min(440px, 100vw);
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

  input {
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

const Note = styled.p<{ $tone?: 'danger' | 'muted' }>`
  margin: 0;
  color: ${props =>
    props.$tone === 'danger' ? 'var(--platform-colors-danger-text, #b42318)' : 'var(--platform-colors-text-secondary)'};
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
  border-radius: var(--platform-radius-md, 8px);
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
  color: ${props => (props.$known ? 'var(--platform-colors-success-text, var(--platform-colors-text-secondary))' : 'var(--platform-colors-warning-text, var(--platform-colors-text-secondary))')};
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

interface PersonDraft {
  key: number
  name: string
  email: string
  timeZone: string
}

export interface MeetingTimeFinderProps {
  defaultFrom: string
  defaultTo: string
  /** The owner's calendar as it is now (re-read from its provider where there is one). */
  readOwner: () => Promise<OwnerCalendarRead>
  /** The team calendar's busy reader while this person is in an organisation; null otherwise. */
  busyReader: TeamBusyReader | null
  /** Teammates who can be added (their free/busy comes from the team calendar). */
  teammates?: Array<{ id: string; name: string }>
  saveDraft: (event: CalendarEvent, base: CalendarStore) => void
  onOpenDraft: (eventId: string) => void
  onClose: () => void
  now?: () => Date
}

const outcomeMessage = (outcome: MeetingDraftOutcome): string =>
  outcome.kind === 'invalid' ? outcome.errors.join(' ') : outcome.kind === 'created' || outcome.kind === 'already-created' ? outcome.summary : outcome.reason

/**
 * Find a time: a meeting's length, dates, the people in it with their time
 * zones and the gaps to keep; up to three ranked times with what each is good
 * and less good for, in everyone's local time; wording to copy; and, once one
 * is chosen and still free, a private draft (lib/meetingTimes.ts — the same
 * code the findMeetingTimes / createMeetingDraft tools use).
 */
export function MeetingTimeFinder({
  defaultFrom,
  defaultTo,
  readOwner,
  busyReader,
  teammates = [],
  saveDraft,
  onOpenDraft,
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
  const [result, setResult] = useState<{ search: MeetingSearch; input: MeetingRequestInput } | null>(null)
  const [choosing, setChoosing] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<{ startsAt: string; outcome: MeetingDraftOutcome } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const proposalRef = useRef<HTMLTextAreaElement>(null)

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
        setErrors([`Your calendar could not be read (${error instanceof Error ? error.message : String(error)}), so no times are suggested. Try again.`])
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
      const found = findMeetingTimes(input, { ...owner, now: at }, availability)
      if (!found.ok) {
        setErrors(found.errors)
        setResult(null)
        return
      }
      setErrors([])
      setResult({ search: found, input })
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

  const proposal = result ? meetingProposalText(result.search) : ''
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(proposal)
      setCopied('Copied.')
    } catch {
      proposalRef.current?.select()
      setCopied('Selected — press Copy on your keyboard.')
    }
  }

  const unusedTeammates = teammates.filter(mate => !people.some(person => person.email === teammateAddress(mate.id)))

  return (
    <Panel aria-label="Find a time">
      <PanelHeader>
        <Kicker>Find a time</Kicker>
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
          <Kicker>People</Kicker>
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
                <input
                  value={person.timeZone}
                  placeholder="e.g. America/New_York"
                  aria-label={`Time zone for ${person.name || `person ${index + 1}`}`}
                  onChange={event => updatePerson(person.key, { timeZone: event.target.value })}
                />
              </Field>
              <IconButton type="button" aria-label={`Remove ${person.name || `person ${index + 1}`}`} onClick={() => setPeople(current => current.filter(item => item.key !== person.key))}>
                <X size={14} />
              </IconButton>
            </PersonRow>
          ))}
          <Row>
            <Button size="sm" variant="ghost" onClick={() => addPerson()}>
              Add person
            </Button>
            {unusedTeammates.slice(0, 6).map(mate => (
              <Button key={mate.id} size="sm" variant="ghost" onClick={() => addPerson({ name: mate.name, email: teammateAddress(mate.id) })}>
                + {mate.name}
              </Button>
            ))}
          </Row>
          <Note $tone="muted">
            A time zone shows each person's local time; it does not say they are free. Teammates' team meetings are checked; anyone else's availability stays unknown.
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
                        You · {option.owner.timeZone} ({option.owner.offset}) · {option.durationMinutes} min
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
              <Kicker>Proposal to copy</Kicker>
              <Proposal ref={proposalRef} readOnly value={proposal} aria-label="Proposal text" />
              <Row>
                <Button size="sm" onClick={() => void copy()}>
                  Copy
                </Button>
                {copied && <Note>{copied}</Note>}
              </Row>
            </Block>
          </>
        )}
      </Scroll>
    </Panel>
  )
}
