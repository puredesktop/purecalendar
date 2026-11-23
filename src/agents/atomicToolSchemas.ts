import type {
  AppAtomicToolDefinition,
  AppOperationExposure,
  AppOperationRisk,
} from '@purescience/platform-ui/bridge/appFunctions'

/**
 * Lossless catalog of all 10 PureCalendar atomic tool schemas extracted from `plugin.json`.
 *
 * Each entry declares:
 *   - `category`: clean domain grouping for `discoverAppTools`
 *   - `exposure`: `'always'` (2 core CRUD verbs + all 4 release/guest-release-gated tools)
 *     or `'extended'` (4 specialist discovery/settings/meeting tools)
 *   - explicit `risk` and `requiresApproval` satisfying `scripts/check-manifests.mjs`
 */
export type PureCalendarAtomicToolSchema = Omit<
  AppAtomicToolDefinition<unknown>,
  'opClass' | 'run'
> & {
  exposure: AppOperationExposure
  risk: AppOperationRisk
}

export const PURECALENDAR_ATOMIC_TOOL_SCHEMAS: readonly PureCalendarAtomicToolSchema[] =
  [
    // ---- Core & release-gated atomic tools (exposure: 'always') ------------
    {
      name: 'listCalendarEvents',
      category: 'agenda',
      exposure: 'always',
      risk: 'read',
      requiresApproval: false,
      description:
        "List calendar events in a date range, returning each event's id, title, startsAt, endsAt, calendarId, status, allDay, timeZone, and recurrenceRule.",
      inputSchema: {
        type: 'object',
        properties: {
          startsAt: {
            type: 'string',
            description: 'ISO 8601 start of the date range to query.',
          },
          endsAt: {
            type: 'string',
            description: 'ISO 8601 end of the date range to query.',
          },
          calendarId: {
            type: 'string',
            description: 'Optional calendar id to filter by.',
          },
        },
        required: ['startsAt', 'endsAt'],
        additionalProperties: false,
      },
    },
    {
      name: 'createCalendarDraft',
      category: 'drafts',
      exposure: 'always',
      risk: 'write',
      requiresApproval: true,
      description:
        'Create a draft calendar event. Drafts are private working copies: attendees may be listed but nobody is invited or notified until the event is activated.',
      inputSchema: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Title of the new draft event.',
          },
          startsAt: {
            type: 'string',
            description: 'ISO 8601 start time of the event.',
          },
          endsAt: {
            type: 'string',
            description: 'ISO 8601 end time of the event.',
          },
          calendarId: {
            type: 'string',
            description: 'Optional calendar id to assign the event to.',
          },
          timeZone: {
            type: 'string',
            description:
              'Optional IANA time zone identifier. Falls back to the system time zone when omitted.',
          },
          attendees: {
            type: 'array',
            description:
              'People listed on the event as {email, name?}. On a draft they are visible on the event but receive no invitation until the event is activated.',
            items: {
              type: 'object',
              properties: {
                email: {
                  type: 'string',
                },
                name: {
                  type: 'string',
                },
              },
              required: ['email'],
            },
          },
        },
        required: ['title', 'startsAt', 'endsAt'],
        additionalProperties: false,
      },
    },
    {
      name: 'updateCalendarEvent',
      category: 'events',
      exposure: 'always',
      risk: 'write',
      requiresApproval: true,
      riskWhen: {
        notifyInvitees: 'release',
      },
      description:
        'Update fields of an existing calendar event by id, passing only the fields to change. Refuses read-only events and active events with guests unless notifyInvitees is set (which is a release action).',
      inputSchema: {
        type: 'object',
        properties: {
          eventId: {
            type: 'string',
            description: 'ID of the event to update.',
          },
          title: {
            type: 'string',
            description: 'Optional new title.',
          },
          startsAt: {
            type: 'string',
            description: 'Optional new start time (ISO 8601).',
          },
          endsAt: {
            type: 'string',
            description: 'Optional new end time (ISO 8601).',
          },
          description: {
            type: 'string',
            description: 'Optional new description.',
          },
          status: {
            type: 'string',
            enum: ['confirmed', 'tentative', 'cancelled'],
            description:
              'Optional new status: confirmed, tentative, or cancelled.',
          },
          location: {
            type: 'string',
            description: 'Optional new location.',
          },
          calendarId: {
            type: 'string',
            description: 'Optional calendar id to move the event to.',
          },
          allDay: {
            type: 'boolean',
            description: 'Optional all-day flag.',
          },
          timeZone: {
            type: 'string',
            description: 'Optional IANA time zone identifier.',
          },
          attendees: {
            type: 'array',
            description:
              'People listed on the event as {email, name?}. On a draft they are visible on the event but receive no invitation until the event is activated.',
            items: {
              type: 'object',
              properties: {
                email: {
                  type: 'string',
                },
                name: {
                  type: 'string',
                },
              },
              required: ['email'],
            },
          },
          notifyInvitees: {
            type: 'boolean',
            description:
              "Set only to tell the event's guests about this change. Telling guests is a release action: an agent cannot do it at any trust level; only a person's own save in PureCalendar, or a CEO approval in the Executive team. Without it, a change to an event with guests is refused.",
          },
        },
        required: ['eventId'],
        additionalProperties: false,
      },
    },
    {
      name: 'deleteCalendarEvent',
      category: 'events',
      exposure: 'always',
      risk: 'destructive',
      requiresApproval: true,
      riskWhen: {
        notifyInvitees: 'release',
      },
      description:
        "Delete a calendar event by its id. The event is removed locally at once; a provider-backed event's remote copy is deleted on the next sync.",
      inputSchema: {
        type: 'object',
        properties: {
          eventId: {
            type: 'string',
            description: 'ID of the event to delete.',
          },
          notifyInvitees: {
            type: 'boolean',
            description:
              "Set only to tell the event's guests about this change. Telling guests is a release action: an agent cannot do it at any trust level; only a person's own save in PureCalendar, or a CEO approval in the Executive team. Without it, a change to an event with guests is refused.",
          },
        },
        required: ['eventId'],
        additionalProperties: false,
      },
    },
    {
      name: 'rescheduleCalendarEvent',
      category: 'events',
      exposure: 'always',
      risk: 'write',
      requiresApproval: true,
      riskWhen: {
        notifyInvitees: 'release',
      },
      description:
        'Move an existing calendar event to a new start time while preserving its original duration. Refuses read-only events and active events with guests unless notifyInvitees is set (which is a release action).',
      inputSchema: {
        type: 'object',
        properties: {
          eventId: {
            type: 'string',
            description: 'ID of the event to reschedule.',
          },
          startsAt: {
            type: 'string',
            description: 'New ISO 8601 start time for the event.',
          },
          notifyInvitees: {
            type: 'boolean',
            description:
              "Set only to tell the event's guests about this change. Telling guests is a release action: an agent cannot do it at any trust level; only a person's own save in PureCalendar, or a CEO approval in the Executive team. Without it, a change to an event with guests is refused.",
          },
        },
        required: ['eventId', 'startsAt'],
        additionalProperties: false,
      },
    },
    {
      name: 'activateCalendarEvent',
      category: 'release',
      exposure: 'always',
      risk: 'release',
      releaseButton: 'Make active',
      requiresApproval: true,
      description:
        "Switch a draft event to active. This is the moment listed attendees become real invitees: the next sync carries them to the provider, which sends the invitations. A release action: only a person can do it, by pressing Make active under the event's Stage in PureCalendar, or by approving it as CEO in the Executive team. An agent cannot call this at any trust level; leave the draft for the person and say it is ready.",
      inputSchema: {
        type: 'object',
        properties: {
          eventId: {
            type: 'string',
          },
        },
        required: ['eventId'],
      },
    },

    // ---- Extended specialist atomic tools (exposure: 'extended') -----------
    {
      name: 'searchCalendar',
      category: 'discovery',
      exposure: 'extended',
      risk: 'read',
      requiresApproval: false,
      description:
        "Search calendar events matching a query string across title, description, and location, returning each result's id, type, title, subtitle, startsAt, eventId/taskId, timeZone, and recurrenceRule.",
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query to match against event fields.',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      name: 'getCalendarSettings',
      category: 'settings',
      exposure: 'extended',
      risk: 'read',
      requiresApproval: false,
      description:
        "Read the user's calendar settings: resolved time zone, working hours, available days, default calendar, and the calendar list with read-only status.",
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'findMeetingTimes',
      category: 'scheduling',
      exposure: 'extended',
      risk: 'read',
      requiresApproval: false,
      description:
        "Find up to three ranked meeting times in one pass: within the user's working days/hours, clear of events on their visible calendars (recurring occurrences, all-day events and the before/after gaps included), each shown in every participant's local date and time with the zone named, with the benefits and trade-offs of each, why fewer than three when fewer qualify, and copyable proposal wording with availability caveats. Read-only: nothing is created. Other people's availability is unknown unless the team calendar supplies it; never tell the user someone is free because of their time zone. If the user's calendar could not be read the tool refuses rather than suggest times. Show the options to the user and wait for them to choose one before calling createMeetingDraft.",
      inputSchema: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description:
              'What the meeting is called, used in the proposal wording and the draft title. Defaults to "Meeting".',
          },
          durationMinutes: {
            type: 'integer',
            minimum: 1,
            description:
              'Meeting length in whole minutes; must be more than 0 (at most 720).',
          },
          from: {
            type: 'string',
            description:
              "First day to search, YYYY-MM-DD in the user's calendar time zone (getCalendarSettings).",
          },
          to: {
            type: 'string',
            description:
              'Last day to search (inclusive), YYYY-MM-DD; not before from, and less than 62 days after it.',
          },
          participants: {
            type: 'array',
            description:
              'Other people, each with the IANA time zone the user actually gave for them (Europe/Berlin, not +01:00 and not a guess). A time zone only shows their local time; it never says they are free. Teammates on the team calendar (email <id>@team.invalid) have their team meetings checked; everyone else is reported as availability unknown.',
            items: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                },
                email: {
                  type: 'string',
                },
                timeZone: {
                  type: 'string',
                },
              },
              required: ['timeZone'],
            },
          },
          bufferBeforeMinutes: {
            type: 'integer',
            minimum: 0,
            description:
              "Minutes that must be clear of the user's events before the meeting (0 or more, at most 240).",
          },
          bufferAfterMinutes: {
            type: 'integer',
            minimum: 0,
            description:
              "Minutes that must be clear of the user's events after the meeting (0 or more, at most 240).",
          },
        },
        required: ['durationMinutes', 'from', 'to'],
        additionalProperties: false,
      },
    },
    {
      name: 'createMeetingDraft',
      category: 'scheduling',
      exposure: 'extended',
      risk: 'write',
      requiresApproval: true,
      description:
        "After the user has chosen one of the findMeetingTimes options: re-read their calendar (and any teammate free/busy that qualified it) and, if the time is still free, create ONE private draft at exactly that start and duration, with the participants who have an email listed but not invited. Send the same request fields as the search plus the chosen startsAt. Repeating the call returns the same draft instead of a second one. If the time now conflicts, or a recheck fails, nothing is created and the error says why: run findMeetingTimes again. It never activates the event, sends invitations or changes other events; tell the user the draft is ready for them to set its Stage to Active.",
      inputSchema: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description:
              'What the meeting is called, used in the proposal wording and the draft title. Defaults to "Meeting".',
          },
          durationMinutes: {
            type: 'integer',
            minimum: 1,
            description:
              'Meeting length in whole minutes; must be more than 0 (at most 720).',
          },
          from: {
            type: 'string',
            description:
              "First day to search, YYYY-MM-DD in the user's calendar time zone (getCalendarSettings).",
          },
          to: {
            type: 'string',
            description:
              'Last day to search (inclusive), YYYY-MM-DD; not before from, and less than 62 days after it.',
          },
          participants: {
            type: 'array',
            description:
              'Other people, each with the IANA time zone the user actually gave for them (Europe/Berlin, not +01:00 and not a guess). A time zone only shows their local time; it never says they are free. Teammates on the team calendar (email <id>@team.invalid) have their team meetings checked; everyone else is reported as availability unknown.',
            items: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                },
                email: {
                  type: 'string',
                },
                timeZone: {
                  type: 'string',
                },
              },
              required: ['timeZone'],
            },
          },
          bufferBeforeMinutes: {
            type: 'integer',
            minimum: 0,
            description:
              "Minutes that must be clear of the user's events before the meeting (0 or more, at most 240).",
          },
          bufferAfterMinutes: {
            type: 'integer',
            minimum: 0,
            description:
              "Minutes that must be clear of the user's events after the meeting (0 or more, at most 240).",
          },
          startsAt: {
            type: 'string',
            description:
              'The startsAt (ISO instant) of the option the user chose, exactly as findMeetingTimes returned it.',
          },
        },
        required: ['durationMinutes', 'from', 'to', 'startsAt'],
        additionalProperties: false,
      },
    },
  ]
