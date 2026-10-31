# req-0010 delivery verification

Status: local verification passed; publication and PureDev review are pending.
These logs are **not** receipts for a revised published commit.

## Latest run (review of `a671503`)

The [tests](tests.log), [typecheck](typecheck.log) and [build](build.log) logs
were replaced by this run. Source: `a671503661bc75acf5ae96caaff88a2147109e79`
plus the working-tree fixes for that review (a visible Google calendar missing
from a refreshed snapshot is unreadable and keeps its stored events; a saved
draft brings its newly found calendar, source and account into the app's state).
The app's own `npm run test`, `npm run typecheck` and `npm run build` ran
unchanged in a suite-shaped copy (same layout as below, reusing that earlier
workspace's copied dependencies read-only). All exit **0**: **29 files, 306
tests passed**, the typecheck passed, and the normal build (real SWC styling
plugin) passed with only the existing large-chunk warning. The earlier run's
notes follow.

## Source identity (earlier run)

- PR: https://github.com/puredesktop/purecalendar/pull/36
- Branch: `puredev/find-meeting-times-and-prepare-a-private-9b4faf`
- Published head read from GitHub during this run: `93811337e999c75cdcf5730b96f0654a5ab595d5`.
- Tested source: that head plus the accompanying component fix and regression tests.
- SHA-256 `src/components/MeetingTimeFinder.tsx`: `4f040d63710ff40b8b3b697db4b9b5781813170399762765d2ff25f821afad6e`.
- SHA-256 `src/components/MeetingTimeFinder.test.tsx`: `11b3dd7c8644badaa7fa17ff1d7a13b12429bc2c1628f4256f1839d79e391595`.
- Tested copies were compared byte-for-byte with the working tree.
- Product profile retained: `puredesktop`, design revision **4**. Existing product components, tokens and date labels remain; no new artwork or design rules.

## Cause and regression

The owner summary used only `owner.offset`, although `localTimes` already supplies
`endOffset` and the copied proposal shows both offsets. It now prints the same
start-to-end offset transition when they differ, retaining the ordinary single
offset when they agree.

Before the component change, the two new rendered-component tests failed on the
missing end offset (7 other component tests passed). After the change, all 9 pass.
The real search is constrained to one free elapsed hour in each fixture:

- London, 29 March 2026: 00:30 GMT+00:00 to 02:30 GMT+01:00.
- New York, 1 November 2026: 01:30 GMT-04:00 to 01:30 GMT-05:00,
  ending in the repeated hour.

Each test checks the actual rendered date, clocks, offsets and 60-minute label,
the copyable proposal, and the resulting private draft's exact instants and elapsed
duration. No browser or desktop is used for these regressions.

## Supported setup and results

Checked in an isolated suite-shaped workspace at `/tmp/purecalendar-req0010`.
The app's unchanged Vite config and TypeScript config were used, including the
real SWC styling plugin with `displayName` and `fileName` enabled.
No plugin-free build or alternative Vite config was used.

Host sources/dependencies: configured PureDev suite, ps-suite commit
`51fbabb182ab93509ff6cad3ca7ddfa33bfcaf75`. Node 24.16.0;
Vite 6.4.4; Vitest 3.2.7; React plugin 3.11.0.
The compiler and WASM plugin resolved beside that React plugin were verified as
`@swc/core` **1.16.1** and `@swc/plugin-styled-components` **13.0.0**,
the exact versions declared by this app. No shared repository repair was needed.

Commands from the isolated app directory, all exit **0**:

```sh
npm run test
npm run typecheck
npm run build
```

- Tests (earlier run; its log has been replaced by the latest run): **29 files, 303 tests passed**, including all original behavioral checks and the two component regressions.
- [Typecheck](typecheck.log): passed with the repository's original base config.
- Normal build (earlier run): passed in 4.66 seconds. The only build warning is the existing large-chunk warning.
- `git diff --check`: exit 0 in the original working tree.

To reproduce the suite layout without modifying shared dependencies (macOS):

```sh
# Run from the app checkout. Choose a new, empty scratch directory.
source_app="$PWD"
suite=/Users/adamhyde/.puredev/suite
scratch=$(mktemp -d /tmp/purecalendar-verify.XXXXXX)
mkdir -p "$scratch/apps/purecalendar" "$scratch/packages"
cp -cR "$suite/node_modules" "$scratch/node_modules"
rsync -a --exclude=node_modules "$suite/packages/ui" "$suite/packages/bridge" "$suite/packages/editor" "$scratch/packages/"
ln -s "$suite/scripts" "$scratch/scripts"
cp "$suite/tsconfig.base.json" "$scratch/tsconfig.base.json"
rsync -a --exclude=.git --exclude=node_modules --exclude=dist "$source_app/" "$scratch/apps/purecalendar/"
cp -cR "$suite/apps/purecalendar/node_modules" "$scratch/apps/purecalendar/node_modules"
npm install --prefix "$scratch/swc" --no-save --package-lock=false @swc/core@1.16.1 @swc/plugin-styled-components@13.0.0
cp -cR "$scratch/swc/node_modules/@swc/core" "$scratch/swc/node_modules/@swc/core-darwin-arm64" "$scratch/swc/node_modules/@swc/plugin-styled-components" "$scratch/apps/purecalendar/node_modules/@swc/"
cd "$scratch/apps/purecalendar"
npm run test
npm run typecheck
npm run build
```

This copies dependencies rather than installing into or modifying the shared suite.
It also copies the shared source packages so React resolves to a single instance.
The scratch copy has no parent workspace package.json.

## PureDev handoff: required before acceptance

The retained diagnostic request has already completed; it is not another task.
Its `checks` array is empty. The configured `evalCommands` is also empty, so a
completed Checking stage by itself supplies no build/test receipts. GitHub's
`statusCheckRollup` was empty at the published head above.

The diagnostic's next action is **Review again** on original task
`6d6fc55e-b6ba-41f7-8867-feb18f2441a5`. Its last review found the cached-draft
identity bypass. The published code now applies `sameDraft` to the cached-id
path and its existing regressions cover changed time, people and lifecycle;
all pass in this run. Only a new PureDev review can settle that retained finding.

This worker is explicitly forbidden to commit or push; PureDev publishes the
working tree after the worker finishes. No PureDev control tool is available
in this worker's tool inventory. Consequently it cannot honestly supply a new
published head or claim that the configured review has completed.

After publication, PureDev must retain the new PR head and rerun the three
commands above against that clean head, preserving both the commit identity and
exit codes with the output. Record `git rev-parse HEAD`,
`git status --porcelain`, and GitHub PR `headRefOid`; the clean source commit and
published head must agree. Use the supported suite setup above when the standalone
worktree lacks its parent config/packages. Run PureDev's Review again action on
that published revision and resolve any resulting findings through its pipeline.
Do not change branch rules, merge, or treat these local logs as published-head receipts.
