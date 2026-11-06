# Contributing

User setup and feature availability are in [README.md](README.md).

## Tests

Use Node.js 22 or newer: `npm ci`, then `npm test`. On Linux, use
`xvfb-run -a npm test`. Set `VSCODE_VERSION=stable` to test the current stable
release; the default is 1.140.0. CI runs both and uploads editor logs.

The harness downloads a disposable editor and uses isolated profiles/extensions.
It never patches the installed editor. Compilation, lint and the focused
`node:test` regressions run first. Real extension-host runners export an awaited
`run()` function through VS Code's custom runner interface: install, imports,
buttons/theme/live status sizing, webview updates, reopen/disable, and independent
restored startup. Application files are compared byte-for-byte before cleanup,
so cleanup cannot mask a failed restoration.

`test/public-api.test.js` covers command/terminal buttons, priority, configuration
changes, removal, disable/re-enable, live theme colors and preservation, plus
status height A→B→A. SCM counts and theme startup/token removal remain untested.
`test/webview.integration.js` exercises the actual watcher/configuration path.
`test/webview.run.js` additionally checks three CSP policies, theme changes and
document recreation in a separate fixture extension.

The main harness also runs the measured-layout suite after restoration. To run
that suite independently, use
`APC_EDITOR='/path/to/disposable/editor' node test/customizations-run.js`.
It checks fonts, row geometry, pointer/scroll behavior, header bounds, horizontal
activity navigation, all status positions, panel handling, live changes and reset. Never supply
the daily editor or an editor copy currently used by another test.

The macOS native-window/menu runner is separate:
`node test/native.run.js '/path/to/disposable/Visual Studio Code.app'`.
It creates its own APFS clone and checks actual window getters, sandboxing,
mouse/keyboard menu interaction and exact restoration. Its platform-specific
appearance assertions do not establish Windows/Linux support. Recorded macOS
observations are in [test/evidence/native-findings.md](test/evidence/native-findings.md).
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

The browser resources are editable source shipped verbatim. Passing them through
the extension-host compiler would target CommonJS without DOM types. UI settings
are also published as an internal configuration script that runs on every
revision, including A→B→A; user scripts still execute once per unchanged file.

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

The current checks establish specific behavior on the recorded builds, not every
combination of private workbench internals. Extend coverage for other list/SCM
views, auxiliary windows, panel/sidebar combinations, Zen/fullscreen modes,
every font selector, custom editors/Markdown previews/nested frames, and native
appearance on each OS. Keep those gaps explicit in the README feature table.
