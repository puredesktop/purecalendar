# purecalendar contribution roadmap

Build something you can see and try in the app. The first five items are **good first contributions**: bounded changes with a concrete demonstration. Choose a feature below, fix a bug, or propose your own improvement.

## Scope

Keep day, week, month and agenda views, existing event drafts and supported account/iCalendar workflows.

Size describes scope, not a promised completion time: **Small** = one focused interface change; **Medium** = coordinated interface/state work; **Large** = a feature across several flows, storage or export paths. All items are proposals, not claims that existing features are absent. Check the current code and extend what is there. Maintainers review code and tests before merging. Attribution is your choice.

## Good first contributions

1. **Copy an event location.** Add a copy control beside event locations, with confirmation, so long addresses can be reused without selecting text manually.
   <!-- contribution: {"id": "location-copy-action", "size": "small", "goodFirstIssue": true, "guide": "docs/contributions/location-copy-action.md"} -->
   [Small · Good first contribution · Implementation brief](docs/contributions/location-copy-action.md)

2. **See which timezone an event uses.** Show the active timezone abbreviation beside event-detail times, with the full timezone name available on focus or hover.
   <!-- contribution: {"id": "timezone-beside-event-times", "size": "small", "goodFirstIssue": true, "guide": "docs/contributions/timezone-beside-event-times.md"} -->
   [Small · Good first contribution · Implementation brief](docs/contributions/timezone-beside-event-times.md)

3. **See meeting duration while editing.** Display the calculated event duration next to start and end fields and explain when the end precedes the start.
   <!-- contribution: {"id": "duration-feedback-while-editing", "size": "small", "goodFirstIssue": true, "guide": "docs/contributions/duration-feedback-while-editing.md"} -->
   [Small · Good first contribution · Implementation brief](docs/contributions/duration-feedback-while-editing.md)

4. **See who has answered an invitation.** Summarize accepted, tentative, declined and unanswered attendees above the existing attendee list using the stored responses.
   <!-- contribution: {"id": "attendee-response-counts", "size": "small", "goodFirstIssue": true, "guide": "docs/contributions/attendee-response-counts.md"} -->
   [Small · Good first contribution · Implementation brief](docs/contributions/attendee-response-counts.md)

5. **Choose calendar colours by name.** Give each colour choice a readable name and selection state so selecting a calendar colour does not depend only on sight.
   <!-- contribution: {"id": "calendar-colour-labels", "size": "small", "goodFirstIssue": true, "guide": "docs/contributions/calendar-colour-labels.md"} -->
   [Small · Good first contribution · Implementation brief](docs/contributions/calendar-colour-labels.md)

## More improvements

6. **Preview quick-add dates before creating an event.** Show the date and time interpreted by quick add before activation, keeping the existing draft-first behavior for ambiguous input.
   <!-- contribution: {"id": "quick-add-interpretation-preview", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/quick-add-interpretation-preview.md"} -->
   [Medium · Implementation brief](docs/contributions/quick-add-interpretation-preview.md)

7. **Find the new copy of an event.** After the existing duplicate action, focus the new draft and label it clearly so users do not accidentally edit the original event.
   <!-- contribution: {"id": "duplicate-event-feedback", "size": "small", "goodFirstIssue": false, "guide": "docs/contributions/duplicate-event-feedback.md"} -->
   [Small · Implementation brief](docs/contributions/duplicate-event-feedback.md)

8. **Read a recurrence rule as a sentence.** Render supported recurrence rules as a plain-language sentence in event details, including any end date or occurrence limit.
   <!-- contribution: {"id": "readable-recurrence-summary", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/readable-recurrence-summary.md"} -->
   [Medium · Implementation brief](docs/contributions/readable-recurrence-summary.md)

9. **Choose which recurring events an edit affects.** Make existing recurrence edit choices explicitly name the selected occurrence and series so their effects are clear before saving.
   <!-- contribution: {"id": "recurring-edit-scope-labels", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/recurring-edit-scope-labels.md"} -->
   [Medium · Implementation brief](docs/contributions/recurring-edit-scope-labels.md)

10. **See the last included day of an all-day event.** Explain the displayed last day of a multi-day all-day event and consistently translate any exclusive end date from imported calendar data.
   <!-- contribution: {"id": "all-day-date-guidance", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/all-day-date-guidance.md"} -->
   [Medium · Implementation brief](docs/contributions/all-day-date-guidance.md)

11. **Find the meeting link in an event.** Present a recognizable meeting URL as a labelled link in event details while retaining the full location or description text.
   <!-- contribution: {"id": "meeting-link-visibility", "size": "small", "goodFirstIssue": false, "guide": "docs/contributions/meeting-link-visibility.md"} -->
   [Small · Implementation brief](docs/contributions/meeting-link-visibility.md)

12. **Read long titles in a crowded month.** Improve truncation and wrapping in crowded month cells, with the complete title available to keyboard and pointer users.
   <!-- contribution: {"id": "long-event-title-handling", "size": "small", "goodFirstIssue": false, "guide": "docs/contributions/long-event-title-handling.md"} -->
   [Small · Implementation brief](docs/contributions/long-event-title-handling.md)

13. **Open the other events on a busy day.** Make the month view's overflow control announce the date and number of additional events, and return focus after it closes.
   <!-- contribution: {"id": "hidden-event-count-clarity", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/hidden-event-count-clarity.md"} -->
   [Medium · Implementation brief](docs/contributions/hidden-event-count-clarity.md)

14. **Understand why a calendar is read-only.** Show why editing is unavailable for a read-only calendar beside the event controls rather than only after a save attempt.
   <!-- contribution: {"id": "read-only-calendar-explanation", "size": "small", "goodFirstIssue": false, "guide": "docs/contributions/read-only-calendar-explanation.md"} -->
   [Small · Implementation brief](docs/contributions/read-only-calendar-explanation.md)

15. **See when each calendar last synced.** Show the last successful synchronization time per connected calendar and distinguish it from an in-progress or failed sync.
   <!-- contribution: {"id": "sync-status-timestamps", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/sync-status-timestamps.md"} -->
   [Medium · Implementation brief](docs/contributions/sync-status-timestamps.md)

16. **Review what an import added or skipped.** After an iCalendar import, report how many events were accepted or skipped and provide understandable reasons for skipped records.
   <!-- contribution: {"id": "import-result-summary", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/import-result-summary.md"} -->
   [Medium · Implementation brief](docs/contributions/import-result-summary.md)

17. **Check the calendar and dates before exporting.** Repeat the chosen calendar and date range in the export confirmation so users can verify what the file will contain.
   <!-- contribution: {"id": "export-date-range-summary", "size": "small", "goodFirstIssue": false, "guide": "docs/contributions/export-date-range-summary.md"} -->
   [Small · Implementation brief](docs/contributions/export-date-range-summary.md)

18. **Tell same-titled search results apart.** Include the event date, timezone and calendar name in search rows so similarly titled events are distinguishable.
   <!-- contribution: {"id": "search-result-date-context", "size": "small", "goodFirstIssue": false, "guide": "docs/contributions/search-result-date-context.md"} -->
   [Small · Implementation brief](docs/contributions/search-result-date-context.md)

19. **Show calendars hidden by filters.** Distinguish an empty date range from calendars hidden by filters, and offer a direct way to show the hidden calendars.
   <!-- contribution: {"id": "agenda-empty-state-wording", "size": "small", "goodFirstIssue": false, "guide": "docs/contributions/agenda-empty-state-wording.md"} -->
   [Small · Implementation brief](docs/contributions/agenda-empty-state-wording.md)

20. **Return to the edited event with the keyboard.** Return keyboard focus to the edited event or its date cell after closing details, including when the event moved to another day.
   <!-- contribution: {"id": "restore-focus-after-event-edits", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/restore-focus-after-event-edits.md"} -->
   [Medium · Implementation brief](docs/contributions/restore-focus-after-event-edits.md)

21. **Compare two timezones while planning.** Add an optional second timezone ruler to day and week views, with named zones and date rollover indicators. Store the view preference without changing event times.
   <!-- contribution: {"id": "compare-two-timezones-while-planning", "size": "large", "goodFirstIssue": false, "guide": "docs/contributions/compare-two-timezones-while-planning.md"} -->
   [Large · Implementation brief](docs/contributions/compare-two-timezones-while-planning.md)

## References

- [Contribution brief index](docs/contributions/README.md)
- [App guide](docs/app-guide.md)
- [Development guide](docs/development.md)
- [Contributing](CONTRIBUTING.md)
