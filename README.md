<div align="center">

# Apc Customize UI++ Extension README

The Successor to iocave/Customize UI

![Visual Studio Marketplace Version (including pre-releases)](https://img.shields.io/visual-studio-marketplace/v/drcika.apc-extension?label=latest%20version&&color=dark-green) ![Visual Studio Marketplace Downloads](https://img.shields.io/visual-studio-marketplace/d/drcika.apc-extension?color=blue) ![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/drcika.apc-extension?color=yellow) ![License](https://img.shields.io/github/license/drcika/apc-extension?color=red) ![GitHub Repo stars](https://img.shields.io/github/stars/drcika/apc-extension?style=social)

</div>

## Overview

This extension allows customization outside of vscode's usual scope.

Unlike its predecessor, it ships with no default settings, granting you full customization control.

Explore my setup for inspiration: [View Settings](https://github.com/drcika/apc-extension/blob/production/demo/settings.json)

## Activation regression test

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
disable, and startup after restoration. Application HTML and `main.js` are
compared against their original bytes. All patching uses the downloaded editor.

## Modern VS Code compatibility

The modern port restores imports through a separate workbench renderer script.
It preserves VS Code's existing startup script and CSP, adds a narrowly scoped
Trusted Types policy for configured script URLs, and does not replace its main
process or bootstrap files. It detects module-based workbench layouts under
`electron-browser` and `electron-sandbox`; unknown layouts fail before patching.
The first activation fix alone did not restore these customizations.

| Feature | Modern port status |
| --- | --- |
| Local `.css`/`.js` imports | Absolute paths, `file://` URLs, and `${userHome}` supported |
| Import objects with `href`/`src` | Local sources and HTTP(S) sources supported; explicitly configured external origins are added to the relevant CSP directives |
| `apc.stylesheet` | Supported, including live configuration changes |
| Live local file updates | Supported, including atomic saves; renderer checks published changes about once per second |
| `apc.buttons`, `apc.theme` | Existing public extension API implementations retained |
| Font, row, header, activity/status bar layout overrides | Legacy AMD/internal-service implementations have not been ported |
| `apc.electron`, compact menubar, iframe styling | Not implemented by the modern import path |

After enabling APC for the first time, **reload the window** to load its renderer
script. Configuration and local file edits then update imports without another
reload. New external origins require a reload because CSP is set at window
startup. Nested external resources (such as fonts referenced by a remote CSS
file) remain subject to the rest of VS Code's CSP. Remote imports are not watched.

JavaScript runs as a classic browser script, preserving its global scope.
Unchanged scripts run once per window, so CSS edits do not redeclare their
top-level variables. Editing a script runs its new contents; scripts must manage
their own observers, listeners, and repeated initialization. Reload after changing
scripts with top-level `const`/`let`, or after removing/disabling scripts whose
effects need to be undone. Removing a script element cannot undo arbitrary code.
Import errors identify the source in Developer Tools; unreadable local files and
patching failures also produce extension notifications.

Patches and the published configuration snapshot are application-wide. Use one
local profile's APC configuration at a time; different simultaneous profiles do
not have independent renderer snapshots. Other platforms and older layouts need
their own validation; do not infer full APC feature parity from import support.

The original HTML is backed up with its checksum, VS Code version, and workbench
build hash. Partial installation failures roll back. Disable restores the original
HTML and removes generated files; reload afterward to unload the renderer and
JavaScript effects. If the editor was independently modified, the backup is
corrupt, or its build changed, APC refuses to overwrite it with an old backup.
Use a clean editor installation in that case. A lock left after an editor crash
is reported with its path and must be cleared before another patch operation.

## Getting Started

  - Open Visual Studio Code
  - Disable any similar extensions
  - Install this extension (auto-enabled on first install)
  - Add configurations to your user [settings.json](https://code.visualstudio.com/docs/getstarted/settings#_settingsjson) to customize

## Enabling and Disabling

  - Open the Command Palette (Mac: <kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>, Windows: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>)
  - Type `Enable Apc extension` to enable or `Disable Apc extension` to disable

## Troubleshooting Extension Issues

### Extension stopped functioning after an update

- To re-enable, go to the Command Palette and type `Enable Apc extension`

### Windows Users

- **Single-user** installs: No admin rights required.
- **All-user** installs: Run VSCode or VSCodium in Administrator mode.

### Mac and Linux Users

To ensure the extension works, allow VSCode or [VSCodium](https://github.com/VSCodium/vscodium) to modify itself by fixing read-only code files and permission issues.

> [!IMPORTANT]
> If you use a package manager, confirm the custom installation path before executing these commands.

#### macOS
  ```sh
  sudo chown -R $(whoami) $(which code)
  ```

#### Linux
  ```sh
  sudo chown -R $(whoami) /usr/share/code
  ```

#### Common Software Installation Paths
| Operating System       | Software        | Installation Path |
|------------------------|-----------------|-------------------|
| 🍎 **macOS**           | VSCode          | `/Applications/Visual Studio Code.app/Contents/Resources/app/out` |
|                        | VSCode Insiders | `/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/out` |
|                        | VSCodium        | `/Applications/VSCodium.app/Contents/Resources/app/out` |
| 🐧 **Linux** (most distros) | VSCode | `/usr/share/code` |
| 🐧 **Arch Linux**  | VSCode | `/opt/visual-studio-code` |
|| VSCodium | `/usr/share/vscodium` |



## Disclaimer

This experimental extension tweaks certain VSCode / VSCodium files. <br>

> Proceed at your own risk

🚀 Disable the extension to revert to original files if you run into issues. <br>
🔄 Patchers are automatically reapplied after each VSCode / VSCodium update. If it doesn't, re-enable the extension. <br>
🐞 Found a bug? Report it on our [GitHub repository](https://github.com/drcika/apc-extension/issues)

---

## Supported Configuration Options

### `apc.electron`

Configures the Electron window. For detailed info, see the [Electron BrowserWindow documentation](https://www.electronjs.org/docs/latest/api/browser-window#new-browserwindowoptions)

> [!CAUTION]
> Incorrect "apc.electron" settings might prevent VSCode or VSCodium from starting up.

> [!NOTE]
> Here's what we covered. Choose a style you like, or create your own!

#### frameless title bar
```jsonc
    "apc.electron": {
      "frame": false,
    }
```

#### inline title bar
```jsonc
    "apc.electron": {
      "titleBarStyle": "hidden",
    },
    "window.titleBarStyle": "native",
    "window.customTitleBarVisibility": "never",
```

#### inline title bar with traffic light position
```jsonc
    "apc.electron": {
      "titleBarStyle": "hiddenInset",
      "trafficLightPosition": {
        "x": 7,
        "y": 5
      }
    }
```

<details>
<summary><b>custom title bar</b></summary>

```jsonc
    "apc.electron": {
      "titleBarStyle": "hidden",
      "titleBarOverlay": {
        "color": "#2f3241",
        "symbolColor": "#74b1be",
        "height": 60
      }
    }
```
</details>

<details>
<summary><b>vibrancy setting</b></summary>

```jsonc
    // To utilize the `vibrancy` option, ensure other panels are transparent.
    // Demo: https://github.com/drcika/apc-extension/blob/production/demo/vibrancy.settings.json
    "apc.electron": {
      "vibrancy": "ultra-dark"
    }
```
</details>

<details>
<summary><b>background color, transparency</b></summary>

```jsonc
    "apc.electron": {
      "backgroundColor": "rgba(123, 123, 123, 0.5)",
      "frame": false,
      "transparent": true,
      "titleBarStyle": "hiddenInset",
      "vibrancy": "ultra-dark",
      "opacity": 0.98,  // Range: 0-1 (To go fully transparent, set it to 0)
      "visualEffectState": "active"
    }
```
</details>

> [!NOTE]
> Multiple declarations of `apc.electron` will apply only the last declaration, ignoring previous ones.

### `font.family`

Customize font family for any part of VS Code

<details>
<summary>Defaults in vscode</summary>

```jsonc
  "editor.fontFamily": "Roboto Mono",
  "editor.inlayHints.fontFamily": "Roboto Mono",
  "editor.codeLensFontFamily": "Roboto Mono",
  "terminal.integrated.fontFamily": "Roboto Mono",
  "scm.inputFontFamily": "Roboto Mono",
  "chat.editor.fontFamily": "Roboto Mono",
  "debug.console.fontFamily": "Roboto Mono",
  "notebook.output.fontFamily": "Roboto Mono",
  "markdown.preview.fontFamily": "Roboto Mono",
```
</details>

To adjust font family for `extension-editor`, install the font on your computer and restart vscode.

```jsonc
  "apc.font.family": "Roboto Mono",
  "apc.monospace.font.family": "Roboto Mono",
```

Change default font family for individual sections

```jsonc
  "apc.parts.font.family": {
    "sidebar": "Roboto Mono",
    "titlebar": "Roboto Mono",
    "activityBar": "Roboto Mono",
    "panel": "Roboto Mono",
    "tabs": "Roboto Mono",
    "statusbar": "Roboto Mono",
    "settings-body": "Roboto Mono",
    "extension-editor": "Roboto Mono", // Install the font and restart vscode
    "monaco-menu": "Roboto Mono"
  },
```

### `apc.stylesheet`

Override the default CSS of VS Code

```jsonc
    "apc.stylesheet": {
      ".monaco-workbench .part.editor>.content .editor-group-container>.title div.tabs-container": "border-radius: 5px; font-family: 'Times New Roman', Times, serif;"
      
      "body": {
        // Other panels have to be transparent for this. See "workbench.colorCustomizations"
        "background-image": "url(/Users/aleksandarpopovic/imgs/19.png), linear-gradient(to top,rgba(0, 0, 0, 0.6), rgba(0, 0, 0, 0.2))",
        "background-size": "cover",
        "background-blend-mode": "multiply",
        "background-repeat": "no-repeat"
      },
      "workbench.colorCustomizations": {
        "sideBar.background": "#00000000", // transparent
        "editor.background": "#00000000"
      ...etc
   	  }
    }
```

### `apc.imports`

Customize VS Code's Look and Feel with Real-time CSS & JS Imports

```jsonc
    "apc.imports": [
      "/Users/some/path/style.css",
      "/Users/some/path/script.js",
      "/C:/Users/path/style.css", // Windows path
      "${userHome}/path/style.css", // Only supports ${userHome}

      // Local file imports like this are not watched in real time
      // Reference: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/link
      {
        "rel": "stylesheet",
        "href": "https://fonts.googleapis.com/css?family=Sofia"
      },

      // Reference: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script
      {
        "async":"async",
        "type":"text/javascript",
        "src": "https://some/path.js"
      }
    ]
```

### `apc.menubar.compact`

Move Menu bar to Activity bar for a compact design

```jsonc
    "apc.menubar.compact": true
```

### `apc.header`

Adjust the height and font size of the header bar

```jsonc
    "apc.header": {
      "default": number, // For "window.density.editorTabHeight": "default"
      "compact": number, // For "window.density.editorTabHeight": "compact"
      "height": number, // When neither "default" nor "compact" is specified
      "fontSize": number
    }
```

### `apc.activityBar`

Set the position and dimensions of the activity bar

```jsonc
    "apc.activityBar": {
      "position": "bottom", // Options: bottom, left (default). Works only with 'bottom' or default position.
      "size": number, // Height (for bottom) or width (in default position)
      "itemSize": number, // Size of items within the bar (default: size)
      "itemMargin": number // Margin between two items (default: 3)
    }
```

Removed
```jsonc
  apc.activityBar.position: 'top'
  apc.activityBar.hideSettings
```

Alternative 
```jsonc
  "workbench.activityBar.location": "top",
  "window.customTitleBarVisibility": "never",
```

### `apc.sidebar.titlebar`

Define the height and font size of the sidebar title bar

```jsonc
    "apc.sidebar.titlebar": {
      "height": number,
      "fontSize": number
    }
```

### `apc.statusBar`

Set the position and height of the status bar

```jsonc
    "apc.statusBar": {
      "position": "top" | "bottom" | "editor-top" | "editor-bottom",
      "height": number,
      "fontSize": number
    }
```

### `apc.listRow`

Specify the height and font size of list rows

```jsonc
    // knownlistViews = ['customview-tree', 'tabs-list', 'results', 'open-editors', 'explorer-folders-view', 'tree', 'outline-tree', 'scm-view', 'debug-view-content', 'debug-breakpoints',
    // 'settings-toc-wrapper', 'settings-tree-container', 'quick-input-list', 'monaco-table', 'select-box-dropdown-list-container', 'extensions-list', 'notifications-list-container'];

    "apc.listRow": {
      "lists": ["explorer-folders-view", "results"], // Default lists if height or fontSize are specified ['customview-tree', 'results', 'open-editors', 'explorer-folders-view', 'outline-tree', 'scm-view', 'debug-view-content', 'debug-breakpoints', 'tree']
      "height": number,
      "fontSize": number,
      // Customize individual list
      "parts" : {
        "extensions-list" : {
          "height": number,
          "fontSize": number,
        },
        "scm-view": {
          "height": number,
          "fontSize": number,
          "actionButton": number, // only for scm-view
          "input": number // only for scm-view
        }
      }
    },

    // Additional styling
    "stylesheet": {
      ".explorer-folders-view.custom-list-row .monaco-list-row": "font-weight: bold; color: red;"
    }
```

### `apc.iframe.style`

Apply custom CSS to iframes (Notebook, Extension view, etc)

> [!IMPORTANT]
> If you have an open iframe tab when starting VSCode, reopen it to apply the styles.

```jsonc
  "apc.iframe.style": "/Users/path/style.css",
  "apc.iframe.style": "C:\\Users\\path\\style.css", // Windows

  "apc.iframe.style": {
    "h1": "color: red; font-size: 2rem;"
  }

  "apc.iframe.style": {
    "h1": {
      "color": "red",
      "font-size": "2rem;"
      }
  }
```

## Demo

<div style="text-align:center">
  <img src="https://raw.githubusercontent.com/drcika/apc-extension/production/demo.png" alt="demo.png"/>
</div>

## ⚠️ Important Notice

This extension is your go-to tool for customizing Electron and Visual Studio Code.

While I haven't developed any features or provided support for bugs, think of me as your bridge to tailor Electron and VS Code just the way you like.

## Inspirations

  - [iocave/customize-ui](https://github.com/iocave/customize-ui)
  - [iocave/monkey-patch](https://github.com/iocave/monkey-patch)
