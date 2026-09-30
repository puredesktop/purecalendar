import { createGlobalStyle } from 'styled-components'

/**
 * White, light mode: bland on purpose, as in Typeset. A calendar carries its events' colours;
 * its chrome must not compete with the colours being set on it, so White is
 * neutral greys with no desktop tint. `html:root` outranks the shared
 * appearance rules, which are !important on :root.
 */
export const WhiteNeutral = createGlobalStyle`
  html:root[data-platform-appearance='white']:not([data-platform-theme='dark']) {
    --platform-colors-bg: #f2f2f2 !important;
    --platform-colors-app-viewport: #f2f2f2 !important;
    --platform-colors-surface: #f7f7f7 !important;
    --platform-colors-elevated: #ffffff !important;
    --platform-colors-surface-hover: #ececec !important;
    --platform-colors-surface-active: #e4e4e4 !important;
    --platform-colors-chrome-titlebar: #f6f6f6 !important;
    --platform-colors-border: #dcdcdc !important;
    --platform-colors-border-soft: #e6e6e6 !important;
    --platform-colors-border-strong: #bdbdbd !important;
    --platform-colors-divider: #e3e3e3 !important;
    --pure-chrome-sidebar: #f7f7f7 !important;
    --pure-chrome-well: #ececec !important;
    --pure-chrome-hover: #ebebeb !important;
    --pure-chrome-selection: #e3e3e3 !important;
    --pure-chrome-line: #dcdcdc !important;
    --pure-chrome-fence: #e6e6e6 !important;
    --glass-panel: #f7f7f7 !important;
    --glass-panel-strong: #ffffff !important;
    --glass-card: #ffffff !important;
    --glass-popover: #ffffff !important;
    --glass-well: #ececec !important;
    --glass-edge: #dcdcdc !important;
    --glass-line: #e0e0e0 !important;
  }
  html:root[data-platform-appearance='white']:not([data-platform-theme='dark']) body {
    background: #f2f2f2 !important;
  }
`
