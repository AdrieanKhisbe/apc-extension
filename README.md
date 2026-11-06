<div align="center">

# Apc Customize UI++ Extension README

The Successor to iocave/Customize UI

![Visual Studio Marketplace Version (including pre-releases)](https://img.shields.io/visual-studio-marketplace/v/drcika.apc-extension?label=latest%20version&&color=dark-green) ![Visual Studio Marketplace Downloads](https://img.shields.io/visual-studio-marketplace/d/drcika.apc-extension?color=blue) ![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/drcika.apc-extension?color=yellow) ![License](https://img.shields.io/github/license/drcika/apc-extension?color=red) ![GitHub Repo stars](https://img.shields.io/github/stars/drcika/apc-extension?style=social)

</div>

## Overview

This extension allows customization outside of vscode's usual scope.

Unlike its predecessor, it ships with no default settings, granting you full customization control.

Explore my setup for inspiration: [View Settings](https://github.com/drcika/apc-extension/blob/production/demo/settings.json)

## Modern VS Code compatibility

On modern VS Code, this port restores CSS/JavaScript imports and live local
updates. The table below shows which other customizations are available.
Compatibility is tested on VS Code 1.140.0 and the latest stable release;
older AMD-based editors are no longer supported.

| Feature | Implemented | Tested |
| --- | --- | --- |
| Activation, enable/disable, restoration | ✅ Modern editor lifecycle and reversible patching | ✅ Automated lifecycle and real-editor checks |
| Local `.css`/`.js` imports | ✅ Absolute paths, `file://`, `${userHome}`, import objects | ✅ Automated publication and real-editor imports |
| HTTP(S) import objects | ✅ Configured script/style origins | ✅ Real-editor loading under CSP |
| `apc.stylesheet` | ✅ Live configuration updates | ✅ Real-editor changes and removal |
| Live local file updates | ✅ Including atomic saves | ✅ Real-editor CSS/JS updates and unchanged-script deduplication |
| `apc.buttons` | ✅ Status-bar commands and terminal buttons | 🟡 Automated startup, clicks, updates, priority, terminal execution, cleanup and re-enable; SCM counts untested |
| `apc.theme` | 🟡 Applies color tokens on configuration changes | 🟡 Automated live colors, preservation and disabled-state gating; startup/removal not covered |
| Font overrides | ❌ Not ported | 🧪 Selected font styling demonstrated in prototype |
| List row/header dimensions | ❌ Not ported | 🧪 Explorer measurement hook works; CSS-only rows/headers have geometry errors |
| Activity/status bar layout | ❌ APC overrides not ported | 🧪 Built-in placement checked; custom CSS sizing/placement has geometry errors |
| `apc.electron`, compact menubar | ❌ Not ported | ❌ Runtime unverified; source investigation only |
| Iframe/webview styling | ❌ Not ported | 🧪 Privileged template injection demonstrated on fixture webviews |

✅ = implemented or automated checks passed for the stated scope; 🟡 = partial;
🧪 = separate prototype evidence, not integrated feature coverage; ❌ = unavailable
or unverified. Prototype findings are limited to VS Code 1.143.1 on macOS ARM64.

- **Reload after enabling or disabling APC**, adding remote import origins, or
  removing JavaScript effects. CSS and local file edits otherwise update live.
- **Scripts run once per unchanged file per window.** Edited scripts must clean
  up their own listeners/observers; reload after editing top-level `const`/`let`.
- **Use one APC profile per installation.** Patches and import configuration are
  shared by every window using that editor. Remote resources remain subject to
  VS Code's CSP and are not watched.
- **Disable restores the backed-up application files.** If APC reports a changed
  build, damaged backup, or stale lock, follow the recovery guidance in
  [CONTRIBUTING.md](CONTRIBUTING.md#patch-recovery).
- Import errors appear in Developer Tools; file and patch errors also show a
  notification.

For test setup, porting notes, and contributor guidance, see
[CONTRIBUTING.md](CONTRIBUTING.md).

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

## Configuration reference

The examples below include original APC features that have not been ported to
modern VS Code. Check the [compatibility table](#modern-vs-code-compatibility)
before using them. The old AMD implementation has been removed.

### `apc.electron`

**Unavailable on modern VS Code in this port.**

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

**These APC font overrides are unavailable on modern VS Code in this port.**
Normal VS Code editor font settings remain available.

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

**Unavailable on modern VS Code in this port.**

Move Menu bar to Activity bar for a compact design

```jsonc
    "apc.menubar.compact": true
```

### `apc.header`

**Unavailable on modern VS Code in this port.**

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

**Unavailable on modern VS Code in this port.**

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

**Unavailable on modern VS Code in this port.**

Define the height and font size of the sidebar title bar

```jsonc
    "apc.sidebar.titlebar": {
      "height": number,
      "fontSize": number
    }
```

### `apc.statusBar`

**Unavailable on modern VS Code in this port.**

Set the position and height of the status bar

```jsonc
    "apc.statusBar": {
      "position": "top" | "bottom" | "editor-top" | "editor-bottom",
      "height": number,
      "fontSize": number
    }
```

### `apc.listRow`

**Unavailable on modern VS Code in this port.**

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

**Unavailable on modern VS Code in this port.**

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
