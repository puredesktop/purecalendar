import { useMemo, useState } from 'react'
import { styled } from 'styled-components'
import { Check, Copy, Link2, Mail, Plus, Trash2, Users, X } from 'lucide-react'
import type { ProposedSlot } from '../types'
import { isValidTimeZone } from '../lib/calendarModel'
import { formatProposedSlotsText } from '../lib/overlapMatrix'
import { localTimeReadout, timeZoneDisplayLabel, timeZoneShortCode } from '../lib/timeZoneDirectory'
import { Button } from '../ui/Button'
import { TimeZonePicker } from './TimeZonePicker'

const Bar = styled.section`
  display: grid;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--platform-colors-accent);
  background: var(--platform-colors-surface-subtle);
  color: var(--platform-colors-text);
`

const TopRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
`

const TitleGroup = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
`

const Kicker = styled.span`
  color: var(--platform-colors-accent-text);
  font-family: var(--platform-typography-font-family-mono);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.05em;
  text-transform: uppercase;
`

const TitleInput = styled.input`
  width: 210px;
  padding: 5px 8px;
  border: 1px solid var(--platform-colors-border);
  border-radius: var(--platform-radius-sm, 3px);
  background: var(--platform-colors-surface);
  color: var(--platform-colors-text);
  font: inherit;
  font-size: var(--platform-typography-font-size-sm);
`

const Chips = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
`

const SlotChip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 7px;
  border: 1px solid var(--platform-colors-border);
  border-radius: var(--platform-radius-sm, 3px);
  background: var(--platform-colors-surface);
  font-family: var(--platform-typography-font-family-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
`

const RemoveBtn = styled.button`
  display: inline-grid;
  place-items: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--platform-colors-text-tertiary);
  cursor: pointer;

  &:hover {
    color: var(--platform-colors-text);
  }
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
`

const CheckLabel = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--platform-colors-text-secondary);
  cursor: pointer;
`

const Feedback = styled.span`
  font-size: 12px;
  color: var(--platform-colors-success-text);
`

export interface ShareAvailabilityBarProps {
  slots: ProposedSlot[]
  primaryTimeZone: string
  extraTimeZones: string[]
  timeFormat: '12h' | '24h'
  placeHolds: boolean
  cloudConnected: boolean
  onTogglePlaceHolds: (next: boolean) => void
  onAddExtraTimeZone: (tz: string) => void
  onRemoveExtraTimeZone: (tz: string) => void
  onRemoveSlot: (startIso: string) => void
  onClearSlots: () => void
  onCreateLink: (kind: 'oneoff' | 'poll', title: string) => Promise<string | null>
  onSendViaPureMail: (title: string, body: string) => Promise<void>
  onClose: () => void
}

export function ShareAvailabilityBar({
  slots,
  primaryTimeZone,
  extraTimeZones,
  timeFormat,
  placeHolds,
  cloudConnected,
  onTogglePlaceHolds,
  onAddExtraTimeZone,
  onRemoveExtraTimeZone,
  onRemoveSlot,
  onClearSlots,
  onCreateLink,
  onSendViaPureMail,
  onClose,
}: ShareAvailabilityBarProps) {
  const [title, setTitle] = useState('Meeting')
  const [addingZone, setAddingZone] = useState(false)
  const [zoneDraft, setZoneDraft] = useState('')
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [createdUrl, setCreatedUrl] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const zones = useMemo(
    () => [
      { label: timeZoneShortCode(primaryTimeZone), timeZone: primaryTimeZone },
      ...extraTimeZones
        .filter(tz => tz !== primaryTimeZone && isValidTimeZone(tz))
        .map(tz => ({ label: timeZoneShortCode(tz), timeZone: tz })),
    ],
    [primaryTimeZone, extraTimeZones],
  )

  const previewText = useMemo(
    () =>
      formatProposedSlotsText(slots, zones, {
        title: title.trim() || 'Meeting',
        bookingUrl: createdUrl ?? undefined,
        timeFormat,
        referenceTimeZone: primaryTimeZone,
      }),
    [slots, zones, title, createdUrl, timeFormat, primaryTimeZone],
  )

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setFeedback(label)
    } catch {
      setFeedback('Ready — copy from PureMail or Studio')
    }
    window.setTimeout(() => setFeedback(null), 2600)
  }

  const handleLink = async (kind: 'oneoff' | 'poll') => {
    if (!slots.length || busyAction) return
    setBusyAction(kind)
    try {
      const url = await onCreateLink(kind, title.trim() || 'Meeting')
      if (url) {
        setCreatedUrl(url)
        await copyText(url, kind === 'oneoff' ? 'One-off link created & copied' : 'Group poll link created & copied')
      }
    } finally {
      setBusyAction(null)
    }
  }

  const handleMail = async () => {
    if (!slots.length || busyAction) return
    setBusyAction('mail')
    try {
      await onSendViaPureMail(title.trim() || 'Meeting', previewText)
      setFeedback('Opened draft in PureMail')
      window.setTimeout(() => setFeedback(null), 2600)
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <Bar aria-label="Share availability mode">
      <TopRow>
        <TitleGroup>
          <Kicker>Share availability</Kicker>
          <TitleInput
            value={title}
            onChange={e => setTitle(e.target.value)}
            aria-label="Proposed meeting title"
            placeholder="Meeting title"
          />
          <CheckLabel>
            <input
              type="checkbox"
              checked={placeHolds}
              onChange={e => onTogglePlaceHolds(e.target.checked)}
            />
            Place tentative holds
          </CheckLabel>
        </TitleGroup>
        <Actions>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X size={13} /> Done
          </Button>
        </Actions>
      </TopRow>

      <Chips>
        <span style={{ fontSize: 12, color: 'var(--platform-colors-text-secondary)' }}>
          Compare zones:
        </span>
        {zones.map((z, idx) => (
          <SlotChip key={z.timeZone}>
            {timeZoneDisplayLabel(z.timeZone)} ({z.label})
            {idx > 0 && (
              <RemoveBtn type="button" aria-label={`Remove ${z.label}`} onClick={() => onRemoveExtraTimeZone(z.timeZone)}>
                <X size={11} />
              </RemoveBtn>
            )}
          </SlotChip>
        ))}
        {addingZone ? (
          <div style={{ width: 220 }}>
            <TimeZonePicker
              value={zoneDraft}
              placeholder="Add guest city / timezone…"
              ariaLabel="Add guest comparison timezone"
              onChange={val => {
                setZoneDraft(val)
                if (isValidTimeZone(val) && (val.includes('/') || val === 'UTC')) {
                  onAddExtraTimeZone(val)
                  setZoneDraft('')
                  setAddingZone(false)
                }
              }}
            />
          </div>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setAddingZone(true)}>
            <Plus size={12} /> Add guest zone
          </Button>
        )}
      </Chips>

      {slots.length === 0 ? (
        <div style={{ fontSize: 12.5, color: 'var(--platform-colors-text-secondary)' }}>
          Drag directly across open times on the calendar grid below to select proposed slots.
        </div>
      ) : (
        <>
          <Chips aria-label="Selected proposed slots">
            {slots.map(slot => {
              const primary = localTimeReadout(slot.start, slot.end, primaryTimeZone, primaryTimeZone, timeFormat)
              const secondary = extraTimeZones[0] && isValidTimeZone(extraTimeZones[0])
                ? localTimeReadout(slot.start, slot.end, extraTimeZones[0], primaryTimeZone, timeFormat)
                : null
              return (
                <SlotChip key={slot.start}>
                  <span>
                    {primary.dateLabel} · {primary.startTime}–{primary.endTime} {primary.shortCode}
                    {secondary ? ` / ${secondary.startTime} ${secondary.shortCode}${secondary.dayBadge ? ` ${secondary.dayBadge}` : ''}` : ''}
                  </span>
                  <RemoveBtn type="button" aria-label="Remove slot" onClick={() => onRemoveSlot(slot.start)}>
                    <X size={11} />
                  </RemoveBtn>
                </SlotChip>
              )
            })}
          </Chips>

          <Actions>
            <Button
              size="sm"
              variant="primary"
              disabled={busyAction !== null}
              onClick={() => void handleLink('oneoff')}
              title={cloudConnected ? 'Create a single-use PureCloud booking link' : 'Create a local one-off invite draft (connect PureServer to host live)'}
            >
              <Link2 size={13} />
              {busyAction === 'oneoff' ? 'Creating…' : cloudConnected ? 'Create one-off link' : 'Save one-off invite'}
            </Button>
            <Button
              size="sm"
              variant="subtle"
              disabled={busyAction !== null}
              onClick={() => void handleLink('poll')}
            >
              <Users size={13} />
              {busyAction === 'poll' ? 'Creating…' : 'Create group poll'}
            </Button>
            <Button size="sm" variant="subtle" disabled={busyAction !== null} onClick={() => void handleMail()}>
              <Mail size={13} /> Send in PureMail
            </Button>
            <Button size="sm" variant="subtle" onClick={() => void copyText(previewText, 'Copied multi-TZ times')}>
              <Copy size={13} /> Copy text
            </Button>
            <Button size="sm" variant="ghost" onClick={onClearSlots}>
              <Trash2 size={13} /> Clear
            </Button>
            {feedback && (
              <Feedback>
                <Check size={12} style={{ verticalAlign: -2, marginRight: 3 }} />
                {feedback}
              </Feedback>
            )}
          </Actions>
        </>
      )}
    </Bar>
  )
}
