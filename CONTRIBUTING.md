# Contributing

Bug reports, fixes and improvements are welcome. For user setup and supported
features, see [README.md](README.md). For architecture and detailed test-harness
notes, see the [development reference](docs/development.md).

## Report a bug

Include your VS Code version, operating system, relevant `apc.*` settings and
steps to reproduce the problem. Describe what you expected and what happened.
Attach relevant errors or screenshots, removing private paths and other personal
information first. A small configuration that reproduces the issue is helpful.

## Set up a development environment

You need Git, Node.js 22 or newer and npm. Fork and clone the repository, then
run these commands from its root:

```sh
npm ci
npm run pretest
```

`pretest` compiles the extension, runs lint and executes the Node tests without
launching an editor.

Create a branch for your change:

```sh
git switch -c feature/my-change
```

## Make changes

- Edit extension-host code in `src/` and browser/main-process resources in
  `resources/`. The browser resources are shipped as source.
- Use `npm run watch` to rebuild TypeScript while working. Compiled files go to
  `dist/`; change the source files rather than generated output.
- Follow the existing code style and keep TypeScript strict checks passing.
- Add a regression test for a bug fix where practical. Test observable behavior
  through settings, commands or rendered output.
- Update README settings examples and coverage notes when behavior changes.

The [module map](docs/development.md#module-based-port) explains where patching,
customizations, native options and webview styling live.

## Run tests

Run the checks that match your change:

| Command | Purpose |
| --- | --- |
| `npm run pretest` | Compilation, lint and Node regressions; no editor launch |
| `npm test` | The checks above plus real-editor lifecycle, layout and webview tests |
| `xvfb-run -a npm test` | Full suite on Linux with a virtual display |
| `node test/native-ci.js` | Native window/menu checks on macOS or Windows, after compilation |

The editor harness downloads a disposable VS Code installation and uses isolated
profiles. Use that harness for testing patches; do not point standalone runners
at your daily editor or a copy being used by another test.

The default test version is VS Code 1.140.0. To select the current stable release
on macOS:

```sh
VSCODE_VERSION=stable npm test
```

On Linux, use `VSCODE_VERSION=stable xvfb-run -a npm test`. In PowerShell:

```powershell
$env:VSCODE_VERSION = 'stable'
npm test
```

CI runs both versions on Linux, macOS and Windows, with additional native probes
on macOS and Windows. Logs and measured results are uploaded as workflow
artifacts. See the [test-harness reference](docs/development.md#tests) for focused
runners and the [README coverage table](README.md#modern-vs-code-compatibility)
for verified behavior and remaining gaps.

## Submit a pull request

Open a pull request against `production`. Keep it focused on one problem or
improvement and include:

- The problem and the resulting behavior.
- The checks you ran, including VS Code version and operating system for editor
  tests. State any checks you could not run.
- Screenshots or other rendered evidence for visible UI changes.
- Any compatibility or recovery implications when changing application patches.

Draft pull requests are useful for work in progress or early feedback.
