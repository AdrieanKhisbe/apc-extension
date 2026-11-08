# Modern customization behavior verified on 2026-11-06

The JSON files beside this note contain measured DOM/grid geometry from isolated
VS Code 1.140.0 and 1.143.1 editors on macOS/arm64. They contain no profile paths
or credentials. The runner restored its application bundle byte-for-byte after
each successful test; `restored` and `originalBundleSha256` record that check.

Run after compiling with Node 22:

```sh
APC_EDITOR='/path/to/disposable/editor/executable' node test/customizations-run.js
```

The runner supports macOS `.app` and Linux `resources/app` layouts. Linux uses
the same tests but needs a display, such as `xvfb-run`. It copies editor logs to
`.vscode-test/runs/customizations-VERSION/logs`, preserves a recovery copy of the
original bundle there, and removes the temporary profile after restoring files.

Both measured versions passed:

- Global Georgia font and a separate monospace status font; actual tab text
  19px, sidebar-title text 18px, status text 17px, and list text 17px.
- Real Explorer rows 40px at offsets 0/40/80/120; trusted pointer selection and
  wheel scrolling. Live changes produced 30px offsets; removal restored 22px.
- Sidebar title 48px with content staying inside its allocated bounds; actual
  tab boxes 44px with editor title measurement updated together.
- A 68px activity grid allocation, including the native floating gutter.
  Visible width is 64px on these modern floating-panel configurations.
- Status height 40px in an actual 40px grid row, then live height 32px.
- Full-width bottom activity placement in a 56px grid row. Native view-switcher
  buttons align horizontally and trusted ArrowRight input changes their focus.
  A placeholder preserves the original grid slot for configuration removal.
- Status positions bottom, top, editor-top and editor-bottom; a visible bottom
  Output panel moves editor-bottom status underneath the panel.
- Empty configuration plus removal of the published CSS restores fonts, 22px
  rows, the native 48px activity allocation, full-width bottom status placement,
  and default title dimensions. No arbitrary user-script side effects are part
  of this reset test.

These are behavioral checks of the main workbench on two builds. The evidence
does not establish every list type, every native density/titlebar combination,
all auxiliary-window scenarios, or Windows behavior. Native floating gutters
remain part of activity-bar sizing; explicit item sizes/margins feed the native
action-height/gap model rather than replacing workbench scrolling with CSS.
