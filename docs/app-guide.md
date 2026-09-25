# purecalendar app guide

A calendar for viewing and editing events, managing calendars, and planning around tasks. Switch between day, week, month, and agenda views, and connect supported calendar accounts or use iCalendar files.

## Workspace layout

| Area | What you use it for |
| --- | --- |
| **Calendar navigation** | Select calendars and move to the date you want to work on. |
| **View controls** | Choose a day, week, month, or agenda view. |
| **Calendar area** | See events arranged by time or as an agenda and select one to inspect it. |
| **Event details** | Review or edit dates, times, attendees, location, and other event information. |

## Working with purecalendar

1. Open a calendar and choose the view that fits your planning horizon.
2. Create or edit events and review their date, time, and calendar before saving.
3. Connect supported accounts through the host’s account integration; use iCalendar import/export when exchanging calendar files.

## Development and loading

You can edit and develop this module outside [puredesktop](https://puredesktop.ai) with your own tools, then register or install it in the desktop. Alternatively, work on your local version through purefactory or the app’s drawer agent. These are ways to develop the same app source; your changes stay local until you choose to share them.

### Prepare the development environment

This repository currently references local `@purescience/platform-*` packages and, for some apps, build helpers from the parent suite. Provide the matching shared packages and build configuration when working with this source. For a new standalone app or an adaptation of this module, follow the published [app API guide](https://puredesktop.ai/docs/apps/) for the supported bridge and project setup.

Run the scripts from this app’s `package.json` in that configured environment:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the app’s development entry point. |
| `npm run build` | Build the app bundle. |
| `npm run typecheck` | Check the source’s TypeScript types. |
| `npm test` | Run the app’s tests. |

Use the package manager and installation procedure required by your development environment. The presence of these scripts does not mean this checkout includes every shared package needed to run them.

### Load your local module

1. Start the development server and note its local URL. Keep `plugin.json` consistent with the app’s entry point, identity, and required permissions.
2. Use **File → Register App…** in a current version of [puredesktop](https://puredesktop.ai), enter the app URL and name, and select the permissions the module needs. Open it from **Browse Apps**.
3. Continue editing with your external tools, then reload and test the app in the desktop. Browser development can exercise UI where the app supports it; the desktop supplies the file, account, and agent services needed by integrated features.
4. For a packaged app, follow the platform packaging guide. The documented workflow uses **Share** from the project in purefactory to produce a `.pureapp` package and **File → Install App…** to load it on another installation.

When making a fork that should coexist with the original, give it a distinct app identity and update its manifest consistently. See the [integration guide](https://puredesktop.ai/docs/apps/) for current registration and packaging details.

### Change your local version inside the desktop

In **purefactory**, open the app project and describe the feature or change you want. You can also ask the app’s **drawer agent** to change your local version. Be explicit that the request concerns the app’s source or behavior when that is your intent, rather than the open document. Review the diff, run appropriate checks, and reload the app. You can retain the result privately, publish a fork, or send a pull request upstream.

## Source layout

| Path | Purpose |
| --- | --- |
| [plugin.json](../plugin.json) | App identity, entry point, permissions, supported documents, and agent-tool declarations. |
| [package.json](../package.json) | Dependencies and development, build, and validation scripts. |
| [src/App.tsx](../src/App.tsx) | App entry and workspace composition. |
| [src/components](../src/components) | Workspace views, panels, and controls. |
| [src/hooks](../src/hooks) | Boot, state, and interaction hooks. |
| [src/lib](../src/lib) | App data models, document handling, and domain logic. |
| [src/agents](../src/agents) | Agent-tool declarations and handlers. |
| [src/bridge](../src/bridge) | Integration with the desktop’s services. |
| [agents.md](../agents.md) | Instructions and capabilities for the app’s agent. |
| [docs](../docs) | Usage and technical documentation. |

## Developer accounts and the marketplace

[Create a developer account on puredesktop.ai](https://puredesktop.ai/developers) to take part in the developer community and submit apps for review. We welcome contributions to this app, forks that take it in a different direction, and entirely new apps to offer on [puredesktop](https://puredesktop.ai).

We welcome **open-source and proprietary projects alike** to the [puredesktop](https://puredesktop.ai) marketplace. A marketplace with support for **paid apps is coming soon**, so developers will be able to charge for their apps if they choose. When distributing a fork, follow the licenses of the code and dependencies you use.

For more information about developer accounts, app submissions, or the upcoming marketplace, contact [info@puredesktop.ai](mailto:info@puredesktop.ai).

## Further documentation

- [Technical documentation index](README.md)


## Contributing

We welcome pull requests, bug reports, new features, and documentation improvements. You may modify and distribute this app under its applicable licenses. See [CONTRIBUTING.md](../CONTRIBUTING.md), [LICENSE](../LICENSE), and [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
