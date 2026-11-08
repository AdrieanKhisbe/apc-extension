# Native window and compact-menu runtime findings

Recorded 2026-11-06 for implementation commit
`7a5ac6c3885bcee164b2b425426a168319dde771` on `review/native-menu`.
These results supersede the earlier prototype's **unproven runtime** verdict.

Both **VS Code 1.140.0 and 1.143.1** passed on macOS/arm64, Node 22.23.4.
The sanitized observations are [native-1.140.0.json](native-1.140.0.json) and
[native-1.143.1.json](native-1.143.1.json). No native/platform parity is inferred
from the earlier source-only evaluation.

## Observed behavior

| Check | Both versions |
| --- | --- |
| Unmodified control | Workbench opened; no compact menubar (`menuCount: 0`). |
| Actual native window getters | Opacity `0.83`, traffic lights `{x:30,y:30}`, background `#112233`. |
| Native security preferences | Actual `webContents.getLastWebPreferences().sandbox` remained `true`. |
| Compact control | A visible `Application Menu` button measured `36 × 36` pixels. |
| Mouse interaction | Real CDP mouse press/release opened File, Edit, Selection, View, Go, Run, Terminal, Help, and Preferences. |
| Keyboard interaction | CDP Escape closed the menu; focus and CDP Enter reopened it with the File menu item focused. |
| Restoration | All changed application files matched their original bytes; the generated loader was removed. A subsequent independent launch had the original menu count. |

The harness exercises `prepareNative()` directly in its own disposable editor,
then restores files. Root integration tests separately validate the common
transaction, rollback, configuration listeners, disable, and backup handling.

The earlier failing clone/startup control did not recur when using a freshly
cloned copy of the root's known-working cached editor. The first automatic clone
in this implementation pass also timed out during control startup. Reusing the
separately verified clone yielded all passing phases on both versions. No cause
for the earlier startup failures is established. They must not be presented as a
native hook failure or as a guarantee of launchability on every machine.

## Reproduce

From this worktree, with nvm available, compile and run the focused regressions:

```sh
. "$HOME/.nvm/nvm.sh"
nvm use 22
npm run compile
npm run lint
node --test test/native.test.js
```

Use a disposable downloaded **macOS `.app`**, never `/Applications` or the daily
editor. The source-app and clone paths below are local parameters; they are
intentionally absent from the recorded JSON evidence. Equivalent invocations to
the successful runs, executed once with each version, are:

```sh
APC_NATIVE_TEST_APP="$PWD/.native-runtime/Visual Studio Code.app" \
  node test/native.run.js "$DISPOSABLE_VSCODE_1_143_1_APP"
APC_NATIVE_TEST_APP="$PWD/.native-runtime140/Visual Studio Code.app" \
  node test/native.run.js "$DISPOSABLE_VSCODE_1_140_0_APP"
```

`APC_NATIVE_TEST_APP` refers to an **already isolated, independently launchable
clone** and the runner modifies/restores it. Without that variable the runner
creates its own APFS clone using `cp -cR`. The 1.140.0 source download contained
the user's old manual import patch, so only its clone was restored from the APC
backup and cleared of copied APC sidecars before the run. The original cached
editor and daily/editor configuration were unchanged.

The passing runner's final message was:

```text
PASS: native window options, compact menu, and clean restored startup.
```

## CI and limits

`test/native.test.js` uses Node mocks and is suitable for the root Linux CI.
`test/native.run.js` is deliberately **macOS-only**: it accepts a `.app`, uses
APFS clone flags, launches `Contents/MacOS/Code`, and observes the macOS traffic
light API. Run it in a macOS job or manually. Do not add it unchanged to the
Linux `npm test` path. Linux integration should verify the shared transaction
with native configuration seeded, plus platform-supported observations in its
own runner. Linux opacity and traffic-light behavior cannot be assumed to match
macOS; Windows also needs independent verification.

All documented APC native settings are validated and forwarded. Actual visual
runtime evidence here covers the three getter values above, not every possible
frame, transparency, vibrancy, overlay, material, or fullscreen combination.
Undocumented arbitrary BrowserWindow options and custom `webPreferences` are
rejected. Configuration snapshots apply on process restart; disabling restores
files and requires restarting existing processes to remove already loaded code.
