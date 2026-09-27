# purecalendar roadmap

## Scope

Keep day, week, month and agenda views, existing event drafts and supported account/iCalendar workflows.

These are proposed, incremental improvements, not a release schedule or a list of missing core features. Keep each change small and preserve existing file formats, user data and app workflows.

## Improvements

1. **Timezone beside event times.** Show the active timezone abbreviation beside event-detail times, with the full timezone name available on focus or hover.

2. **Duration feedback while editing.** Display the calculated event duration next to start and end fields and explain when the end precedes the start.

3. **Quick-add interpretation preview.** Show the date and time interpreted by quick add before activation, keeping the existing draft-first behavior for ambiguous input.

4. **Duplicate event feedback.** After the existing duplicate action, focus the new draft and label it clearly so users do not accidentally edit the original event.

5. **Readable recurrence summary.** Render supported recurrence rules as a plain-language sentence in event details, including any end date or occurrence limit.

6. **Recurring-edit scope labels.** Make existing recurrence edit choices explicitly name the selected occurrence and series so their effects are clear before saving.

7. **All-day date guidance.** Explain the displayed last day of a multi-day all-day event and consistently translate any exclusive end date from imported calendar data.

8. **Location copy action.** Add a copy control beside event locations, with confirmation, so long addresses can be reused without selecting text manually.

9. **Meeting-link visibility.** Present a recognizable meeting URL as a labelled link in event details while retaining the full location or description text.

10. **Attendee response counts.** Summarize accepted, tentative, declined and unanswered attendees above the existing attendee list using the stored responses.

11. **Long event title handling.** Improve truncation and wrapping in crowded month cells, with the complete title available to keyboard and pointer users.

12. **Hidden-event count clarity.** Make the month view's overflow control announce the date and number of additional events, and return focus after it closes.

13. **Calendar colour labels.** Give each colour choice a readable name and selection state so selecting a calendar colour does not depend only on sight.

14. **Read-only calendar explanation.** Show why editing is unavailable for a read-only calendar beside the event controls rather than only after a save attempt.

15. **Sync status timestamps.** Show the last successful synchronization time per connected calendar and distinguish it from an in-progress or failed sync.

16. **Import result summary.** After an iCalendar import, report how many events were accepted or skipped and provide understandable reasons for skipped records.

17. **Export date-range summary.** Repeat the chosen calendar and date range in the export confirmation so users can verify what the file will contain.

18. **Search result date context.** Include the event date, timezone and calendar name in search rows so similarly titled events are distinguishable.

19. **Agenda empty-state wording.** Distinguish an empty date range from calendars hidden by filters, and offer a direct way to show the hidden calendars.

20. **Restore focus after event edits.** Return keyboard focus to the edited event or its date cell after closing details, including when the event moved to another day.

## References

- [App guide](docs/app-guide.md)
- [Development guide](docs/development.md)
- [Current implementation](src/components/PureCalendarShell.tsx)
