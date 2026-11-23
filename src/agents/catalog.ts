/**
 * Exposed PureCalendar operations (must stay in sync 1:1 with `plugin.json` -> `app.agents.tools[].name`).
 *
 * 3-tier exposure (built on `@purescience/platform-ui/bridge/appFunctions`):
 *   1. 4 composite `function` workflows (`fn_*`) — replace multi-round-trip agenda,
 *      meeting-planning, schedule-audit, and draft-staging workflows
 *   2. 6 core & release-gated atomic tools — direct event read/draft CRUD plus all
 *      release / guest-notification-gated verbs (`exposure: 'always'`)
 *   3. 3 universal escape-hatch meta-tools (`discoverAppTools`, `callExtendedReadTool`,
 *      `callExtendedTool`) providing full on-demand access to the 4 extended specialist tools.
 */
export const PURECALENDAR_FUNCTION_NAMES = [
  'fn_scheduleBriefing',
  'fn_planMeetingSlots',
  'fn_auditScheduleHealth',
  'fn_stageMeetingDrafts',
] as const

export const PURECALENDAR_CORE_TOOL_NAMES = [
  'listCalendarEvents',
  'createCalendarDraft',
  'updateCalendarEvent',
  'deleteCalendarEvent',
  'rescheduleCalendarEvent',
  'activateCalendarEvent',
] as const

export const PURECALENDAR_META_TOOL_NAMES = [
  'discoverAppTools',
  'callExtendedReadTool',
  'callExtendedTool',
] as const

export const EXPOSED_TOOL_NAMES = [
  ...PURECALENDAR_FUNCTION_NAMES,
  ...PURECALENDAR_CORE_TOOL_NAMES,
  ...PURECALENDAR_META_TOOL_NAMES,
] as const

/** Keep in sync with `plugin.json` -> `app.agents.tools[].name`. */
export const APP_AGENT_TOOL_NAMES = EXPOSED_TOOL_NAMES

export const PURECALENDAR_EXTENDED_TOOL_NAMES = [
  'searchCalendar',
  'getCalendarSettings',
  'findMeetingTimes',
  'createMeetingDraft',
] as const

export const PURECALENDAR_ALL_ATOMIC_TOOL_NAMES = [
  ...PURECALENDAR_CORE_TOOL_NAMES,
  ...PURECALENDAR_EXTENDED_TOOL_NAMES,
] as const

export const APP_AGENT_LOG_LABEL = 'calendar'
