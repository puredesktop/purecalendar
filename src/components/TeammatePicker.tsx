import { useMemo, useState } from 'react'
import { styled } from 'styled-components'
import { X } from 'lucide-react'
import { Button } from '@purescience/platform-ui/components/common/buttons/Button'
import { teammateAddress, teammateId } from '../lib/teamCalendar'
import type { EventAttendee } from '../types'

const Wrap = styled.div`
  display: grid;
  gap: 10px;
`

const Heading = styled.div`
  color: var(--platform-colors-text-secondary);
  font-size: var(--platform-typography-font-size-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
`

const People = styled.ul`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
`

const Person = styled.li<{ $answer: EventAttendee['response'] }>`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 6px 4px 4px;
  border-radius: 999px;
  background: var(--platform-colors-surface-muted, var(--platform-colors-surface));
  box-shadow: inset 0 0 0 1px var(--platform-colors-border);
  font-size: var(--platform-typography-font-size-sm);
  color: var(--platform-colors-text);
  opacity: ${props => (props.$answer === 'declined' ? 0.6 : 1)};

  small {
    color: ${props =>
      props.$answer === 'accepted'
        ? 'var(--platform-colors-success-text, var(--platform-colors-text-secondary))'
        : props.$answer === 'declined'
          ? 'var(--platform-colors-danger-text, var(--platform-colors-text-secondary))'
          : 'var(--platform-colors-text-secondary)'};
    font-size: var(--platform-typography-font-size-xs);
  }

  button {
    display: inline-grid;
    place-items: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--platform-colors-text-secondary);
    cursor: pointer;
  }
  button:hover {
    background: var(--platform-colors-border);
    color: var(--platform-colors-text);
  }
`

const Initial = styled.span`
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: var(--platform-colors-accent-muted, var(--platform-colors-border));
  color: var(--platform-colors-accent-text, var(--platform-colors-text));
  font-size: 11px;
  font-weight: 700;
`

const AddRow = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;

  input {
    flex: 1;
    min-width: 0;
    padding: 8px 10px;
    border: 1px solid var(--platform-colors-border);
    border-radius: var(--platform-radius-sm);
    background: var(--platform-colors-surface);
    color: var(--platform-colors-text);
    font: inherit;
  }
`

const Matches = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`

const Hint = styled.p`
  margin: 0;
  color: var(--platform-colors-text-secondary);
  font-size: var(--platform-typography-font-size-sm);
`

const ANSWER: Record<EventAttendee['response'], string> = {
  accepted: 'Going',
  tentative: 'Maybe',
  declined: 'Not going',
  needsAction: 'Asked',
}

/**
 * Who a team meeting is with: teammates, each with how they answered, added
 * by name from the organisation's people. The person booking it is always in.
 */
export function TeammatePicker({
  people,
  me,
  attendees,
  disabled,
  onChange,
  onFindTime,
  findingTime,
}: {
  people: Array<{ id: string; name: string }>
  me: { id: string; name: string }
  attendees: EventAttendee[]
  disabled: boolean
  onChange: (attendees: EventAttendee[]) => void
  onFindTime?: () => void
  findingTime?: boolean
}): React.ReactElement {
  const [query, setQuery] = useState('')
  const invited = useMemo(() => new Set(attendees.map(attendee => teammateId(attendee.email)).filter(Boolean)), [attendees])
  const matches = useMemo(() => {
    const words = query.trim().toLowerCase()
    return people
      .filter(person => !invited.has(person.id) && person.id !== me.id)
      .filter(person => !words || person.name.toLowerCase().includes(words))
      .slice(0, words ? 8 : 6)
  }, [people, invited, me.id, query])

  const withMe = (list: EventAttendee[]): EventAttendee[] =>
    list.some(attendee => teammateId(attendee.email) === me.id)
      ? list
      : [{ name: me.name, email: teammateAddress(me.id), response: 'accepted' }, ...list]
  const add = (person: { id: string; name: string }) => {
    onChange(withMe([...attendees, { name: person.name, email: teammateAddress(person.id), response: 'needsAction' }]))
    setQuery('')
  }
  const remove = (email: string) => onChange(attendees.filter(attendee => attendee.email !== email))
  const others = attendees.filter(attendee => teammateId(attendee.email) !== me.id)

  return (
    <Wrap>
      <Heading>With</Heading>
      {attendees.length > 0 ? (
        <People>
          {attendees.map(attendee => {
            const self = teammateId(attendee.email) === me.id
            return (
              <Person key={attendee.email} $answer={attendee.response}>
                <Initial aria-hidden>{(attendee.name || '?').slice(0, 1).toUpperCase()}</Initial>
                {self ? 'You' : attendee.name}
                <small>{ANSWER[attendee.response]}</small>
                {!self && !disabled && (
                  <button type="button" aria-label={`Take ${attendee.name} off`} onClick={() => remove(attendee.email)}>
                    <X size={12} />
                  </button>
                )}
              </Person>
            )
          })}
        </People>
      ) : (
        <Hint>Just you so far. Add the teammates it is with; they are asked, and answer Yes, Maybe or No.</Hint>
      )}
      {!disabled && (
        <>
          <AddRow>
            <input
              value={query}
              placeholder="Add a teammate…"
              aria-label="Add a teammate"
              onChange={event => setQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && matches[0]) {
                  event.preventDefault()
                  add(matches[0])
                }
              }}
            />
            {onFindTime && (
              <Button size="sm" variant="ghost" disabled={!others.length || findingTime} onClick={onFindTime}>
                {findingTime ? 'Looking…' : 'Find a time'}
              </Button>
            )}
          </AddRow>
          {matches.length > 0 && (
            <Matches>
              {matches.map(person => (
                <Button key={person.id} size="sm" variant="ghost" onClick={() => add(person)}>
                  + {person.name}
                </Button>
              ))}
            </Matches>
          )}
        </>
      )}
    </Wrap>
  )
}
