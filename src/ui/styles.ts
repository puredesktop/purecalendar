import { createGlobalStyle, css } from 'styled-components'
import { PALETTE_DARK, PALETTE_LIGHT } from './palette.generated'

/**
 * The look: an enterprise desk for time. White sheets on a neutral grey ground, ruled with hairlines, dense and
 * aligned, with square corners and no shadows on rows.
 *
 * Backgrounds are white and neutral grey only (--n-*). Colour is never an area. It is saved for what acts or says something,
 * and there it is solid: Calendar's blue on the wordmark and the main action, and in the shared look of what is selected, edge to edge; the
 * system colours on status labels and marks, the same in every app: amber needs you, blue is working, green is done, red has
 * failed, violet is AI, teal is people, grey has not started. A status always keeps its word. An event's colour is its calendar's,
 * shown as a small solid square, never a bar or a tinted block.
 *
 * Everything the shared frame and editor draw reads --platform-colors-* and --pure-chrome-*, so those are set here. They are
 * set on body, not :root: the desktop's appearance rules say !important on :root, and an element's own value still beats one
 * it would inherit. The desktop's glass and tints stop at the door.
 */

const NEUTRAL_LIGHT = `--n-ground: #eef0f2; --n-panel: #f6f7f8; --n-sheet: #ffffff; --n-hover: #eef0f2; --n-selected: #e6e8eb; --n-line: #c8ccd2; --n-fence: #e2e5e8; --n-strong: #8d939b; --n-ink: #14171a; --n-soft: #474c54; --n-faint: #666c75; --n-disabled: #8d939b; --n-text-selection: #d3d7dc; --n-btn-line: #c3c8cf; --n-btn-foot: #a7adb5; --n-zebra: rgb(0 0 0 / 0.025);`
const NEUTRAL_DARK = `--n-ground: #141414; --n-panel: #212121; --n-sheet: #1c1c1c; --n-hover: #262626; --n-selected: #303030; --n-line: #3a3a3a; --n-fence: #2b2b2b; --n-strong: #6e6e6e; --n-ink: #ededed; --n-soft: #c2c2c2; --n-faint: #9c9c9c; --n-disabled: #7d7d7d; --n-text-selection: #4a4a4a; --n-btn-line: #3a3a3a; --n-btn-foot: #5a5a5a; --n-zebra: rgb(255 255 255 / 0.03);`

/** Calendar's colour on everything the frame draws in the app's colour: the wordmark, the desk dot, the main action. */
const FRAME = `--app-acc: var(--p-text); --app-bg: var(--n-panel); --app-text: var(--p-deep); --app-block: var(--p-deep); --app-primary-fill: var(--p-text); --pure-chrome-accent: var(--p-text); --pure-chrome-on-accent: var(--p-on-text);`

/** What each shared variable is here. Read where it is declared, so a held page can restate it over its own light values. */
const ROLES = `
  ${FRAME}

  --platform-colors-bg: var(--n-sheet);
  --platform-colors-background: var(--n-sheet);
  --platform-colors-app-viewport: var(--n-ground);
  --platform-colors-chrome-titlebar: var(--n-sheet);
  --platform-colors-chrome-tab-strip: var(--n-sheet);
  --platform-colors-surface: var(--n-sheet);
  --platform-colors-surface-raised: var(--n-sheet);
  --platform-colors-surface-subtle: var(--n-panel);
  --platform-colors-surface-hover: var(--n-hover);
  --platform-colors-surface-active: var(--n-selected);
  --platform-colors-surface-selected: var(--n-selected);
  --platform-colors-elevated: var(--n-sheet);
  --platform-colors-text: var(--n-ink);
  --platform-colors-text-primary: var(--n-ink);
  --platform-colors-text-secondary: var(--n-soft);
  --platform-colors-text-tertiary: var(--n-faint);
  --platform-colors-text-muted: var(--n-faint);
  --platform-colors-text-disabled: var(--n-disabled);
  --platform-colors-text-inverse: var(--p-failed-on-text);
  --platform-colors-text-on-accent: var(--p-on-text);
  --platform-colors-border: var(--n-line);
  --platform-colors-border-soft: var(--n-fence);
  --platform-colors-border-strong: var(--n-strong);
  --platform-colors-divider: var(--n-fence);
  --platform-colors-selection: var(--n-text-selection);
  --platform-colors-accent: var(--p-text);
  --platform-colors-accent-hover: var(--p-deep);
  --platform-colors-accent-muted: var(--n-selected);
  --platform-colors-accent-text: var(--p-deep);
  --platform-colors-focus: var(--p-text);
  --platform-colors-focus-ring: var(--p-text);
  --platform-colors-success: var(--p-done-text);
  --platform-colors-success-text: var(--p-done-text);
  --platform-colors-success-muted: var(--n-selected);
  --platform-colors-warning: var(--b-amber);
  --platform-colors-warning-text: var(--p-needs-you-text);
  --platform-colors-warning-muted: var(--n-selected);
  --platform-colors-danger: var(--p-failed-text);
  --platform-colors-danger-text: var(--p-failed-text);
  --platform-colors-danger-muted: var(--n-selected);
  --platform-colors-text-danger: var(--p-failed-text);
  --platform-colors-info: var(--p-working-text);
  --platform-colors-semantic-green: var(--p-done-text);
  --platform-colors-semantic-green-text: var(--p-done-text);
  --platform-colors-semantic-green-muted: var(--n-selected);
  --platform-colors-semantic-green-border: var(--p-done-mark);
  --platform-colors-semantic-orange: var(--b-amber);
  --platform-colors-semantic-orange-text: var(--p-needs-you-text);
  --platform-colors-semantic-orange-muted: var(--n-selected);
  --platform-colors-semantic-orange-border: var(--b-amber);
  --platform-colors-semantic-red: var(--p-failed-text);
  --platform-colors-semantic-red-text: var(--p-failed-text);
  --platform-colors-semantic-red-muted: var(--n-selected);
  --platform-colors-semantic-red-border: var(--p-failed-mark);
  --platform-colors-semantic-blue: var(--p-working-text);
  --platform-colors-semantic-blue-text: var(--p-working-text);
  --platform-colors-semantic-blue-muted: var(--n-selected);
  --platform-colors-semantic-blue-border: var(--p-working-mark);

  --pure-chrome-bar: var(--n-sheet);
  --pure-chrome-format-bar: var(--n-sheet);
  --pure-chrome-wordmark-bar: var(--n-sheet);
  --pure-chrome-sidebar: var(--n-sheet);
  --pure-chrome-surface: var(--n-sheet);
  --pure-chrome-paper: var(--n-sheet);
  --pure-chrome-well: var(--n-hover);
  --pure-chrome-hover: var(--n-hover);
  --pure-chrome-selection: var(--n-selected);
  --pure-chrome-line: var(--n-line);
  --pure-chrome-fence: var(--n-fence);
  --pure-chrome-hairline: var(--n-fence);
  --pure-chrome-soft: var(--n-soft);
  --pure-chrome-secondary: var(--n-soft);
  --pure-chrome-muted: var(--n-faint);
  --pure-chrome-tertiary: var(--n-faint);
  --pure-chrome-radius: 3px;
  --pure-chrome-label-size: 10.5px;
  --pure-chrome-label-tracking: 0.05em;
  --platform-radius-sm: 3px;
  --platform-radius-md: 3px;
  --platform-radius-lg: 4px;
  --platform-radius-full: 3px;
  --pure-radius-pill: 3px;
  --platform-button-height-sm: 26px;
  --platform-button-height-md: 30px;
  --pure-disabled-primary: var(--n-disabled);
  --platform-shadow-sm: none;
  --platform-shadow-md: 0 2px 8px rgb(0 0 0 / 0.14);
  --platform-shadow-lg: 0 2px 8px rgb(0 0 0 / 0.14);

  --page-shadow: none;
  --white-panel-shadow: none;
  --glass-blur: none;
  --glass-shadow: 0 2px 8px rgb(0 0 0 / 0.14);
  --glass-panel: var(--n-sheet);
  --glass-panel-strong: var(--n-sheet);
  --glass-card: var(--n-sheet);
  --glass-popover: var(--n-sheet);
  --glass-well: var(--n-hover);
  --glass-edge: var(--n-line);
  --glass-edge-strong: var(--n-strong);
  --glass-line: var(--n-line);
`

/** A button does something: raised on a firm edge, pressed in when pressed, plain grey when it can't be pressed. */
export const quiet = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  box-sizing: border-box;
  height: 28px;
  min-height: 0;
  padding: 0 10px;
  border: 1px solid var(--n-btn-line);
  border-bottom-color: var(--n-btn-foot);
  border-radius: 3px;
  background: var(--n-sheet);
  box-shadow: 0 1px 1px rgb(0 0 0 / 0.08);
  color: var(--n-ink);
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.1s ease, border-color 0.1s ease;

  &:hover:not(:disabled) { border-color: var(--n-btn-foot); background: var(--n-hover); }
  &:active:not(:disabled) { background: var(--n-selected); box-shadow: inset 0 1px 2px rgb(0 0 0 / 0.16); }
  &:disabled { border-color: var(--n-fence); background: var(--n-panel); box-shadow: none; color: var(--n-faint); cursor: default; opacity: 1; }
  &:focus-visible { outline: 2px solid var(--p-text); outline-offset: 2px; }
`


/** The one main action in an area: Calendar's colour, solid. */
export const primaryLook = css`
  border-color: var(--p-text);
  background: var(--p-text);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.18), 0 1px 2px rgb(0 0 0 / 0.24);
  color: var(--p-on-text);

  &:hover:not(:disabled) { border-color: var(--p-deep); background: var(--p-deep); }
  &:active:not(:disabled) { background: var(--p-deep); box-shadow: inset 0 1px 3px rgb(0 0 0 / 0.35); }
  &:disabled { border-color: var(--n-fence); background: var(--n-panel); box-shadow: none; color: var(--n-faint); }
`

const dangerLook = css`
  border-color: var(--p-failed-text);
  background: var(--p-failed-text);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.18), 0 1px 2px rgb(0 0 0 / 0.24);
  color: var(--p-failed-on-text);

  &:hover:not(:disabled) { border-color: var(--p-failed-deep); background: var(--p-failed-deep); }
  &:active:not(:disabled) { background: var(--p-failed-deep); box-shadow: inset 0 1px 3px rgb(0 0 0 / 0.35); }
  &:disabled { border-color: var(--n-fence); background: var(--n-panel); box-shadow: none; color: var(--n-faint); }
`

/**
 * What is selected: the look every app shares, from the generated palette (--p-chosen, --p-chosen-edge), edge to edge and square,
 * the same on hover. The words stay ink, and everything else in it keeps its own colours.
 */
export const selectedRow = css`
  border-radius: 0;
  background: var(--p-chosen);
  box-shadow: var(--p-chosen-edge);

  &:hover,
  &:hover:not(:disabled) {
    background: var(--p-chosen);
  }
`


export const CalendarStyles = createGlobalStyle`
  :root {
    ${PALETTE_DARK} ${NEUTRAL_DARK}
    /* needs you: amber at full strength, with dark words on it, so it can't be taken for anything of Calendar's */
    --b-amber: oklch(0.8 0.165 78);
    --b-on-amber: #22190a;
    ${FRAME}
  }
  :root:not([data-platform-theme='dark']) { ${PALETTE_LIGHT} ${NEUTRAL_LIGHT} }
  :root body { ${ROLES} }
  /* The frame again: the platform names this app's colour on [data-app] too. */
  :root [data-app] { ${FRAME} }

  /* Beats the desktop's frost and wallpaper on body, which say !important too. */
  :root:root:root body { background: var(--n-sheet) !important; color: var(--n-ink); }

  /* The desktop gives sidebars their own warm hairlines and sage selection. */
  :root:root:root body [data-chrome='sidebar'] {
    --pure-chrome-line: var(--n-line);
    --pure-chrome-fence: var(--n-fence);
    --pure-chrome-muted: var(--n-faint);
    --pure-chrome-hover: var(--n-hover);
    --pure-chrome-selection: var(--n-selected);
    background: var(--n-sheet);
    border-right: 1px solid var(--n-line);
  }
  :root:root:root body [data-chrome='sidebar'][data-side='right'] {
    border-right: 0;
    border-left: 1px solid var(--n-line);
  }
  :root:root:root body [data-chrome='sidebar'] :is([aria-current]:not([aria-current='false']), [aria-selected='true'], [data-active]):not([data-chrome]) { box-shadow: none; }
  /* Every row in a list runs edge to edge, square, with what is in it starting 10px in. What is selected has the woven ground and outline;
     hover is the same shape in neutral grey. */
  :root:root body :is([data-chrome='row'], [data-chrome='list-row']) {
    box-sizing: border-box;
    width: 100%;
    margin: 0;
    padding-inline: 10px;
    border-radius: 0;
  }
  :root:root body :is([data-chrome='row'], [data-chrome='list-row']):is([aria-current]:not([aria-current='false']), [aria-selected='true'], [data-active]) {
    ${selectedRow}
    font-weight: 600;
  }
  /* A tool that is on (Bold and so on) is pressed, not selected: grey, with ink, no colour. */
  :root:root body :is([data-chrome='toolbar-control'], [data-editor-toolbar] button):is([aria-pressed='true'], [data-active]) {
    border-radius: var(--pure-chrome-radius);
    background: var(--n-selected);
    box-shadow: none;
    color: var(--n-ink);
  }

  /* The shared toolbar draws its controls and dropdowns as pills (999px); here they are square like every other button. */
  :root:root body :is([data-chrome='toolbar-control'], [data-chrome='toolbar-select']) { border-radius: var(--pure-chrome-radius); }

  /* Counts, times and status lines in the platform sans, not the mono of the old family look. */
  :root:root body [data-chrome='meta'] { font-family: var(--platform-typography-font-family); letter-spacing: 0; }

  /* A panel's head: its name in small capitals on a band a shade down from the sheet. */
  :root:root body [class*='PanelToolbarHeader__StyledWrap-'] {
    --platform-kicker-color: var(--n-soft);
    flex: none;
    margin: 0;
    padding: 0 4px 0 2px;
    border-bottom: 1px solid var(--n-line);
    background: var(--n-panel);
  }
  :root:root body [class*='PanelToolbarHeader__StyledRow-'] { min-height: 36px; }

  /* Every platform button, one design. A word that only reads as a link stays one. The writing bar keeps its flat tools. */
  :root:root body button[class*='Button__StyledButton-']:not([data-calendar-flat], [data-editor-toolbar] *) {
    ${quiet}
  }
  :root:root body button[class*='Button__StyledButton-'][data-calendar-primary] {
    ${primaryLook}
  }
  :root:root body button[class*='Button__StyledButton-'][data-calendar-danger] {
    ${dangerLook}
  }

  /* The library: the same buttons; rows told apart by a hairline and a shade, each with its menu always there. */
  :root:root body [class*='DocumentSwitcher__SecondaryButton-'] {
    ${quiet}
  }
  :root:root body [class*='DocumentSwitcher__PrimaryButton-'] {
    ${quiet}
    ${primaryLook}
  }
  :root:root body [class*='DocumentSwitcher__Row-']:nth-child(even) { background-image: linear-gradient(var(--n-zebra), var(--n-zebra)); }
  :root:root body [class*='DocumentSwitcher__ItemMenuTrigger-'] { opacity: 1; visibility: visible; }

  /* A notice: a full outline in its status colour on grey, with a small square of it. The outline is the component's own border,
     which knows the kind, and the square inherits that colour. */
  :root:root body [class*='InlineBanner__StyledRoot-'] {
    background: var(--n-panel);
    color: var(--n-ink);
  }
  :root:root body [class*='InlineBanner__StyledRoot-']::before {
    content: '';
    flex: none;
    box-sizing: border-box;
    width: 8px;
    height: 8px;
    border: 4px solid;
    border-color: inherit;
  }
  /* Dots are small squares. */
  :root:root body [class*='AppHeader__HomeDot-'] { border-radius: 1px; }
  :root input[type='checkbox'] { accent-color: var(--p-text); }
`

export type StatusTone = 'needs-you' | 'working' | 'done' | 'failed' | 'made-by-ai' | 'people' | 'idle'

const TAG_ICON = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z'/%3E%3Ccircle cx='7.5' cy='7.5' r='1' fill='black'/%3E%3C/svg%3E")`

/**
 * Labels and buttons never look alike. A label says something: a flat tag, its tag icon in a white stub at the left end, the
 * colour after it, in normal case, with nothing to press. It keeps its word.
 */
export const labelLook = css`
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  box-sizing: border-box;
  height: 18px;
  padding: 0 6px 0 23px;
  border-radius: 3px;
  background: var(--lab);
  color: var(--lab-ink);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  cursor: default;

  &::before {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    box-sizing: border-box;
    width: 17px;
    border: 1px solid var(--lab-edge, var(--lab));
    border-right: 0;
    border-radius: 3px 0 0 3px;
    background: var(--n-sheet);
  }
  &::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 4px;
    width: 10px;
    height: 10px;
    margin-top: -5px;
    background: var(--lab-mark, var(--lab));
    mask: ${TAG_ICON} center / contain no-repeat;
    -webkit-mask: ${TAG_ICON} center / contain no-repeat;
  }
`

const LABEL_COLOURS: Record<StatusTone, string> = {
  'needs-you': '--lab: var(--b-amber); --lab-ink: var(--b-on-amber); --lab-mark: var(--p-needs-you-deep);',
  working: '--lab: var(--p-working-text); --lab-ink: var(--p-working-on-text);',
  done: '--lab: var(--p-done-text); --lab-ink: var(--p-done-on-text);',
  failed: '--lab: var(--p-failed-text); --lab-ink: var(--p-failed-on-text);',
  'made-by-ai': '--lab: var(--p-made-by-ai-text); --lab-ink: var(--p-made-by-ai-on-text);',
  people: '--lab: var(--p-people-text); --lab-ink: var(--p-people-on-text);',
  idle: '--lab: var(--n-hover); --lab-ink: var(--n-soft); --lab-mark: var(--n-soft); --lab-edge: var(--n-line);',
}

/** A status label, in the colour of what it says. */
export const statusLabel = (tone: StatusTone) => css`
  ${labelLook}
  ${LABEL_COLOURS[tone]}
`

/** A quiet label: grey, its tag mark in the colour it stands for (a mail label's own colour, say). */
export const quietLabel = css`
  ${labelLook}
  --lab: var(--n-hover);
  --lab-ink: var(--n-soft);
  --lab-mark: var(--lab-colour, var(--n-soft));
  --lab-edge: var(--n-line);
`
