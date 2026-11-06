# Contributing

This guide covers development, test setup, and the modern compatibility port.
For installation, configuration, and feature availability, see [README.md](README.md).

## Functional and regression tests

With Node.js 22 or newer, run `npm ci` then `npm test`. The test compiles and lints the extension, downloads
VS Code 1.140.0 into `.vscode-test`, and launches its real extension host with
isolated user data and extensions. APC is enabled normally and the test executes
`apc.extension.enable`. It never launches the machine's installed editor.

Use `VSCODE_VERSION=stable npm test` to test the latest stable release. On Linux,
run `xvfb-run -a npm test` to provide a display.

The GitHub Actions workflow tests both 1.140.0 and latest stable and uploads
editor logs even when a test fails. Focused lifecycle and patch-transaction
regressions run before real-editor tests. Those tests verify activation, CSS/JS
imports in the actual workbench, live updates, reopening, repeated enable,
buttons and live theme colors, disable, and startup after restoration. Application
HTML and `main.js` are compared against their original bytes. All patching uses
the downloaded editor.

`test/lifecycle.test.js` and `test/modern.test.js` use `node:test` in a normal Node
process. The five real-editor suites export an awaited `run()` function, following
VS Code's [custom test runner interface](https://code.visualstudio.com/api/working-with-extensions/testing-extension#the-test-runner-script).
They run sequentially in separate editor launches because patching takes effect
on the next startup: activate/install, exercise imports, exercise public-API
buttons/theme behavior, reopen/disable, and check restored startup.
`test/public-api.test.js` checks startup/live button rendering, priority, command
clicks, actual shell execution in an isolated terminal profile, cleanup on removal
and disable, re-enable, and live color-token updates without losing unrelated
user colors. SCM counts, initial theme application, and theme-token removal are
outside that suite's coverage. Plain `node --test` cannot provide the real
`vscode` module;
using `node:test` inside the extension host would require an in-process runner
that forwards failures to this `run()` promise. The current runners use strict
assertions and rejected promises for that contract.

## Modern compatibility implementation

### Porting steps and module mapping

VS Code's [ESM migration](https://code.visualstudio.com/updates/v1_94#_esm-is-shipping-for-vs-code)
changed its internal startup/loading system. This port keeps the extension host
in CommonJS; it replaces the assumptions about the application's internals:

1. Resolve application files through `vscode.env.appRoot`, since `require.main`
   can be undefined. Register commands before checking or modifying those files.
2. Detect a module-based `workbench.js` startup tag under `electron-browser` or
   `electron-sandbox`. Preserve that tag and inject a separate browser module,
   with the required CSP/Trusted Types permissions.
3. Read configuration/local imports in the extension host and publish a watched
   snapshot. The renderer applies CSS and ordered scripts without AMD or private
   VS Code services.
4. Await installation/removal before persisting enabled state. Dispose watchers,
   buttons, registered button commands, and SCM listeners on their lifecycle paths.
5. Record backups/checksums and roll back failed writes; verify actual workbench
   behavior and exact restoration in disposable editor installations.

`src/modern.ts` is the module-based counterpart of the installation, workbench
patching, and restoration functions in `src/patch.ts`. Compare its import
preparation with `appendFiles`/`appendStyles` in `vs/modules/ui.js`; execution now
lives in `resources/modern-loader.js`. That resource is shipped verbatim as a
browser ES module. Putting it through the existing `src` compiler would target
CommonJS without DOM types; moving it there would need a separate browser build.
The legacy `vs/modules/main.js` and `patch.js` also load private service/layout
overrides, which the new import loader does not implement.

Here, **legacy layout** means the original AMD installation: `bootstrap-amd.js`,
`electron-sandbox/workbench/workbench.html`, and an expected AMD bootstrap call in
`out/main.js`. `assertLegacyLayout()` checks those concrete anchors after modern
layout detection fails. The original AMD implementation is retained, but it has
not been validated by the current CI matrix. Retention is not a guarantee of
older-version support.

## Work required for the remaining customizations

This is an implementation assessment from the legacy modules, not a claim that
these features work in the modern port. VS Code's public extension API
[does not expose the workbench DOM](https://code.visualstudio.com/api/extension-capabilities/overview).

| Feature | Existing implementation | Modern implementation and acceptance checks needed |
| --- | --- | --- |
| Font families, part fonts, font sizes | `vs/modules/ui.js`, `main.css`, and the font override in `classes.js` | Port configuration/CSS variables and current selectors to the renderer. CSS can cover styling, but replacing the internal default font needs separate evaluation. Check computed fonts in each part, theme changes, and removal/reload. This is the smallest independent feature group. |
| List rows and header dimensions | `classes.js`, `configuration.js`, and `main.css` | Port CSS plus virtualized-list/header measurements. CSS height alone can disagree with list scrolling and hit targets. Locate current internals or explicitly narrow support to visual styling; test scrolling, selection, resize, density changes, and restoration. |
| Activity/status bar position and sizing | `layout.js`, `layout.activitybar.js`, `layout.statusbar.js`, and `override.js` | Replace AMD service lookup and grid/prototype interception, or limit settings to existing VS Code placements. Moving DOM alone does not update grid constraints. Validate panel/sidebar positions, resize, Zen/fullscreen modes, auxiliary windows, and disable. This requires a separate layout port. |
| `apc.electron` | `vs/modules/patch.main.js` via the main-process AMD bootstrap | Find and preflight a modern main-process hook before `BrowserWindow` creation; the renderer cannot supply constructor options. Add versioned backup/rollback for every affected main-process file and test restart, window creation, and restore on each supported OS. This is a separate native-window patcher. |
| Compact menubar | `classes.js`, `patch.js`, and `override.js` | Reassess current menu/titlebar implementations and native versus custom menu behavior. Port service/event/placement hooks where built-in menu settings are insufficient. Test keyboard access, overflow, titlebar modes, platform differences, and restoration. |
| `apc.iframe.style` | `appendIframeStyle()` in `src/patch.ts`, which rewrites shared webview HTML and disables its CSP | Workbench CSS cannot cross into isolated webviews. Identify current webview entry points and CSP-compatible style injection without removing their CSP; integrate all affected files with transactional backup/restore. Test real webviews, reload/theme changes, other extensions' content, and disable. This needs a separate webview design. |

Start with font/CSS-only options, then tackle measured lists/layout and native
windows/webviews as separate feature changes. Each needs behavioral tests; the
current import suite alone cannot validate those internal customizations.

### Feasibility evidence

The assessment above identifies candidate approaches from the old implementation.
It does not demonstrate full feature parity on modern VS Code. Throwaway worktree
prototypes are being used to distinguish observed behavior from assumptions before
any production implementation is proposed.
