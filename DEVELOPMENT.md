# Development reference

For setup and the contribution workflow, see [CONTRIBUTING.md](CONTRIBUTING.md).
User setup and feature availability are in [README.md](README.md). Commands
below run from the repository root. These notes describe the test harness,
patching architecture and recovery behavior.

## Feature coverage

| Feature | Implemented | Tested | Remaining coverage |
| --- | --- | --- | --- |
| Activation, enable/disable, restoration | ✅ Modern lifecycle and reversible patching | ✅ Automated lifecycle and real-editor checks | — |
| Local `.css`/`.js` imports | ✅ Absolute paths, `file://`, `${userHome}`, import objects | ✅ Publication and real-editor imports | — |
| HTTP(S) import objects | ✅ Configured script/style origins | ✅ Real-editor loading under CSP | — |
| `apc.stylesheet` | ✅ Live configuration updates | ✅ Real-editor changes and removal | — |
| Live local file updates | ✅ Including atomic saves | ✅ Repeated atomic CSS saves, CSS/JS updates, deduplication and failure recovery | — |
| `apc.buttons` | ✅ Commands, terminals and live SCM counts | ✅ Clicks, priority, terminal execution, Git counts, repository lifecycle, cleanup and re-enable | — |
| `apc.theme` | ✅ Startup/live colors and persistent restoration | ✅ Reopening, manual-edit preservation, interrupted writes, renderer colors and disabled-state gating | — |
| Font overrides | ✅ Global, monospace and per-part styles | ✅ All part selectors in unit tests; global/sidebar/tab/panel/status fonts and auxiliary-window tab/monospace scopes in editors | 🟡 Real-editor auxiliary-bar, titlebar, banner, menu, settings and extension-editor font rendering |
| List row/header dimensions | ✅ Virtualized measurements, font sizes and headers | ✅ Unit delegates/special rows; real Explorer/Search/Outline/SCM sizing; Explorer/Search/Outline pointer navigation; Explorer scrolling, live updates and reset | 🟡 Real debug/custom/open-editor lists and input/action row geometry |
| Activity/status bar layout | ✅ Measured sizing, bottom activity bar and four status positions | ✅ Positions, visibility, sidebars/panels, grid bounds, keyboard navigation, live changes and reset | 🟡 Split editor groups combined with side panels |
| Zen / fullscreen compatibility | ✅ Custom layout follows mode visibility and restoration | ✅ Zen, native fullscreen and combined enter/exit; native events/getters, hidden bars/tabs, live placement and restored sizes | 🟡 Zen/fullscreen in auxiliary windows |
| `apc.electron`, compact menubar | ✅ Documented window options and compact menus | ✅ macOS/Windows getters, sandbox preservation, background focus, mouse/keyboard menus and restoration | 🟡 Vibrancy, Mica, transparency and frame appearance |
| Iframe/webview styling | ✅ Object/file CSS, watching and restoration | ✅ CSP/theme/recreation, retained panels, custom editors, sidebar views, notebook output, Markdown edits/refresh/reopen and nested-frame boundaries | 🟡 Provider serialization across restarts; remote embedded content |

✅ describes implementation or checks passed for the stated scope. 🟡 appears
only under remaining coverage; it does not downgrade the passing checks.

CI runs VS Code 1.140.0 and current stable on Linux, macOS and Windows, including
native-window/menu probes on macOS and Windows. The [recorded full verification](https://github.com/AdrieanKhisbe/apc-extension/actions/runs/42476480627)
passed on 1.140.0 and 1.145.2 at `e3f0f47`. Unknown internal layouts are rejected
before application files are changed.

## Tests

Use Node.js 22 or newer: `npm ci`, then `npm test`. On Linux, use
`xvfb-run -a npm test`. Set `VSCODE_VERSION=stable` to test the current stable
release; the default is 1.140.0. CI runs both on Ubuntu, macOS and Windows and
uploads editor logs and measured results. To run compilation, lint and Node
regressions without launching an editor, use `npm run pretest`.

The harness downloads a disposable editor and uses isolated profiles/extensions.
It never patches the installed editor. All runners use a test-only Electron
guard that constructs hidden windows, makes macOS/Windows windows nonfocusable,
uses `showInactive()` and suppresses window/application focus calls. CDP emulates
renderer focus for keyboard tests without activating native windows. Runners
restore the guard in `finally`. Compilation, lint and the focused
`node:test` regressions run first. Real extension-host runners export an awaited
`run()` function through VS Code's custom runner interface: install, imports,
buttons/theme/live status sizing, webview updates, reopen/disable, and independent
restored startup. Application files are compared byte-for-byte before cleanup,
so cleanup cannot mask a failed restoration.

`test/public-api.test.js` covers command/terminal buttons, priority, configuration
changes, removal, disable/re-enable, live theme colors and preservation, plus
status height A→B→A. It also checks SCM counts against the built-in Git API in
a temporary repository. `test/buttons.test.js` covers initial counts, repository
open/close events, delayed Git activation and subscription cleanup.
`test/lifecycle.test.js` covers theme startup, token removal, reopening with saved
ownership, manual edits, global/workspace separation and interrupted writes.
Theme ownership uses an atomic journal in extension storage, independently of
Memento snapshots; disk-backed tests cover reopening, corruption and I/O errors.
`test/customizations.test.js` covers all supported font selectors and default
list delegates, including per-view overrides and special input/action rows;
the editor suite verifies actual geometry for Explorer, Search, Outline and SCM,
plus pointer navigation, scrolling and scoped fonts.
`test/webview.integration.js` exercises the actual watcher/configuration path
with four successive atomic CSS saves. Node regressions cover publication
failure recovery, bounded transient-error retries, disable cancellation and
unchanged startup without application writes. `test/webview.run.js` checks
three CSP policies and actual dark/light changes, document recreation, retained
panels, custom text editors, sidebar views and stored notebook output across
baseline/install/update/restoration phases in a separate fixture extension.
`test/markdown-preview.js` reads the built-in Markdown preview through CDP and
checks source edits, refresh, dark/light themes and reopen without changing
preview security. `test/nested-frames.js` checks same-origin, sandboxed and
two-level frames before/after recreation: CSS stays in the host webview,
inherited script CSP remains enforced, and opaque children retain DOM isolation.

The main harness runs the measured-layout suite first and restores its changes
before the remaining extension-host suites. To run
that suite independently, use
`APC_EDITOR='/path/to/disposable/editor' node test/customizations-run.js`.
It checks fonts, row geometry, pointer/scroll behavior, header bounds, horizontal
activity navigation, all status positions, status visibility, right sidebar,
left/right/bottom panels, auxiliary-window tab/font scopes, live changes and reset.
`test/mode-layouts.js` enters/exits actual Zen and native fullscreen, including
Zen-triggered fullscreen and live status placement, then checks restored sizes.
Never supply the daily editor or an editor copy currently used by another test.

The macOS/Windows native-window/menu runner is separate. Use
`node test/native-ci.js` to select the cached/downloaded version, or
`node test/native.run.js '/path/to/disposable/editor'` (the `.app` on macOS,
executable on Windows). It creates its own APFS clone or Windows archive copy,
checks actual opacity/background getters, macOS traffic-light position,
unfocused/nonfocusable windows, sandboxing, mouse/keyboard compact-menu
interaction and exact restoration. Windows runtime discovery also supports
commit-versioned application directories. The terminal-button test uses
PowerShell on Windows and `/bin/sh` elsewhere. These checks do not prove native
compositor effects such as vibrancy or Mica. Historical macOS observations are
in [test/evidence/native-findings.md](test/evidence/native-findings.md).
Measured layout observations are in
[test/evidence/customizations-findings.md](test/evidence/customizations-findings.md).

Ordinary `node --test` cannot provide the real `vscode` module. The editor runners
use strict assertions and promise rejection through VS Code's runner contract;
the pure preparation/lifecycle tests use `node:test` outside that host.

## Module-based port

VS Code's ESM startup invalidated the old `require.main` and AMD assumptions.
The extension host remains CommonJS; application paths come from
`vscode.env.appRoot`. The old AMD patcher and bundled runtime have been removed.
Unsupported startup/hooks fail preflight before writes. Historical implementations
remain in Git history for comparison.

| Module | Responsibility |
| --- | --- |
| `src/extension.ts` | Commands, enabled state and awaited configuration handling |
| `src/patch.ts` | Layout detection, lock, import publication, adapter composition, checksummed backups and rollback/restoration |
| `src/customizations.ts`, `resources/customizations.js` | CSS plus semantic hooks for list measurements, headers and the workbench grid |
| `src/native.ts`, `resources/native-loader.mjs` | Documented constructor options before `mainImpl`, explicit window setters and compact-menu normalization; preserves VS Code web preferences |
| `src/webview.ts` | Safely serialized default CSS and exact inline-module CSP hash updates |
| `resources/modern-loader.js` | Renderer imports, error isolation, unchanged user-script deduplication and repeatable internal configuration |

Adapters only prepare maps of absolute application paths to text. The patcher
composes shared renderer changes in order and keeps originals independently.
It snapshots every affected file, records build identity/checksums, publishes
dependencies before startup entry points, and rolls back failed batches. The
bounded file batch stays synchronous while holding the cross-process lock;
an asynchronous rewrite would also need a serialized refresh/disposal queue.
Atomic replacements retry native sharing errors for at most 775 ms per file.
Rollback skips destinations whose original bytes never changed, so a locked
untouched file cannot turn a failed installation into a failed rollback.

The browser resources are editable source shipped verbatim. Passing them through
the extension-host compiler would target CommonJS without DOM types. UI settings
are also published as an internal configuration script that runs on every
revision, including A→B→A; user scripts still execute once per unchanged file.
Edited scripts must clean up their own listeners/observers. Reload after editing
top-level `const`/`let` declarations in classic scripts.

Webview CSS uses the application's existing trusted default stylesheet, which
precedes an extension's CSP meta. The adapter updates the matching script-src
hash without removing directives or widening resource/script origins. This is
privileged application-template styling: it can override an extension author's
styling restriction, and extension code can remove/override the style. Existing
outer webview documents must be recreated to load changed template bytes.

## Patch recovery

Backups are checked against the editor version, workbench build and file hashes.
APC refuses to restore corrupt backups or overwrite files changed outside APC.
VS Code may show its modified-installation notice while these patches are active.
Use a clean editor installation if the build/backup no longer matches. A reported
lock left after a crash can be removed after confirming no other process is
patching that installation. Disabling restores every tracked application file
and removes generated sidecars; reload/restart afterward to unload running code.

## Coverage still needed

The matrix establishes the stated behavior on VS Code 1.140.0 and current stable,
not every combination of private workbench internals. Remaining gaps include
exhaustive layout and font/list combinations, provider serialization across
editor restarts, embedded remote-content variants, and native compositor appearance
(vibrancy, Mica, transparency and frame combinations). Keep these limits explicit
in the [feature coverage table](#feature-coverage).

## Visual evidence

The [README gallery](README.md#screenshots) shows matching neutral and blue
translucent layouts captured in an isolated CI editor on VS Code 1.145.2/Linux.
The screenshots demonstrate CSS surfaces; they do not establish native compositor
effects. The reusable palette is [demo/blue-translucent.css](demo/blue-translucent.css).
The [original upstream demo](README.md#original-upstream-demo) is a historical
capture retained for inspiration.
