import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const nativeOptions = new Set(['frame', 'transparent', 'opacity', 'vibrancy', 'visualEffectState', 'backgroundMaterial', 'backgroundColor', 'titleBarStyle', 'trafficLightPosition', 'titleBarOverlay']);
export const nativeConfigurationKeys = ['apc.electron', 'apc.menubar.compact'];

function validateOptions(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { throw new Error('apc.electron must be an object'); }
  const options = value as Record<string, unknown>;
  for (const [key, setting] of Object.entries(options)) {
    if (!nativeOptions.has(key)) { throw new Error(`Unsupported apc.electron option: ${key}`); }
    if ((key === 'frame' || key === 'transparent') && typeof setting !== 'boolean') { throw new Error(`apc.electron.${key} must be a boolean`); }
    if (key === 'opacity' && (typeof setting !== 'number' || !Number.isFinite(setting) || setting < 0 || setting > 1)) { throw new Error('apc.electron.opacity must be between 0 and 1'); }
    if (['vibrancy', 'visualEffectState', 'backgroundMaterial', 'backgroundColor', 'titleBarStyle'].includes(key) && typeof setting !== 'string') { throw new Error(`apc.electron.${key} must be a string`); }
    const enums: Record<string, string[]> = {
      vibrancy: ['appearance-based', 'light', 'dark', 'titlebar', 'selection', 'menu', 'popover', 'sidebar', 'medium-light', 'ultra-dark', 'header', 'sheet', 'window', 'hud', 'fullscreen-ui', 'tooltip', 'content', 'under-window', 'under-page'],
      visualEffectState: ['followWindow', 'active', 'inactive'],
      backgroundMaterial: ['auto', 'none', 'mica', 'acrylic', 'tabbed'],
      titleBarStyle: ['default', 'hidden', 'hiddenInset', 'customButtonsOnHover'],
    };
    if (enums[key] && !enums[key].includes(setting as string)) { throw new Error(`Invalid apc.electron.${key}: ${setting}`); }
    if (key === 'trafficLightPosition') {
      if (!setting || typeof setting !== 'object' || Object.keys(setting).some(name => name !== 'x' && name !== 'y') ||
          !['x', 'y'].every(name => typeof (setting as Record<string, unknown>)[name] === 'number' && Number.isFinite((setting as Record<string, number>)[name]))) {
        throw new Error('apc.electron.trafficLightPosition must contain finite x/y numbers');
      }
    }
    if (key === 'titleBarOverlay' && typeof setting !== 'boolean') {
      if (!setting || typeof setting !== 'object' || Array.isArray(setting) || Object.entries(setting).some(([name, item]) => name === 'height' ? typeof item !== 'number' || !Number.isFinite(item) || item < 0 : !['color', 'symbolColor'].includes(name) || typeof item !== 'string')) {
        throw new Error('Invalid apc.electron.titleBarOverlay');
      }
    }
  }
  return options;
}

function replaceOne(source: string, expression: RegExp, transform: (...args: string[]) => string, description: string): string {
  const matches = [...source.matchAll(expression)];
  if (matches.length !== 1) { throw new Error(`Unsupported VS Code native layout: expected one ${description}, found ${matches.length}`); }
  return source.replace(expression, transform);
}

function compactMenu(source: string): string {
  // Select by the complete configuration-normalization operation, not a
  // release-specific minified function name. Unknown layouts fail preflight.
  const expression = /function ([\w$]+)\(([\w$]+)\)\{let ([\w$]+)=\2.getValue\("window.menuBarVisibility"\);return [^{};]{1,220}\}/g;
  return replaceOne(source, expression, (match, name) => {
    if (!match.includes('"compact"') || !match.includes('"classic"')) { throw new Error('Unsupported compact menubar normalization'); }
    return `function ${name}(){return"compact"}`;
  }, 'menubar visibility normalization');
}

/** Prepare only; patch.ts owns preflight, backup, transaction and restoration. */
export function prepareNative(context: vscode.ExtensionContext, originals: ReadonlyMap<string, string>): Map<string, string> {
  const read = (file: string) => originals.get(file) ?? fs.readFileSync(file, 'utf8');
  const out = path.join(vscode.env.appRoot, 'out');
  const mainFile = path.join(out, 'main.js');
  const implementationFile = path.join(out, 'mainImpl.js');
  const rendererFile = path.join(out, 'vs/workbench/workbench.desktop.main.js');
  const loaderFile = path.join(out, 'apc-native-loader.mjs');
  const configuration = vscode.workspace.getConfiguration('apc');
  const options = validateOptions(configuration.get('electron') ?? {});
  const compact = configuration.get('menubar.compact') === true;
  const changes = new Map<string, string>();
  if (!compact && !Object.keys(options).length) { return changes; }
  let implementation = read(implementationFile);
  if (Object.keys(options).length) {
    const startup = /await import\("\.\/mainImpl\.js"\)/g;
    changes.set(mainFile, replaceOne(read(mainFile), startup, match => `await import("./apc-native-loader.mjs");${match}`, 'main-process module startup'));
    const ending = /backgroundThrottling:!1\}\),([\w$]+)\}function/g;
    implementation = replaceOne(implementation, ending, (match, result) => {
      const location = implementation.indexOf(match);
      const body = implementation.slice(implementation.lastIndexOf('function ', location), location);
      if (!body.includes(`${result}={backgroundColor:`) || !body.includes('.getBackgroundColor(),minWidth:') || !body.includes('webPreferences:') || !body.includes('sandbox:!0')) {
        throw new Error('Unsupported BrowserWindow default-options function');
      }
      // A window can start while files are being published. Until the startup
      // loader is present, retain VS Code's defaults rather than crash startup.
      return `backgroundThrottling:!1}),globalThis[Symbol.for("apc.native.options")]?.(${result})??${result}}function`;
    }, 'BrowserWindow default-options return');
    // These properties must remain owned by VS Code, including its sandbox.
    if (!implementation.includes('sandbox:!0') || !implementation.includes('autoplayPolicy:"user-gesture-required"')) { throw new Error('Unsupported BrowserWindow preferences'); }
    const template = fs.readFileSync(path.join(context.extensionPath, 'resources/native-loader.mjs'), 'utf8');
    changes.set(loaderFile, replaceOne(template, /\/\*__APC_NATIVE_OPTIONS__\*\/\{\}/g, () => JSON.stringify(options), 'native options snapshot marker'));
  }
  if (compact) {
    implementation = compactMenu(implementation);
    changes.set(rendererFile, compactMenu(read(rendererFile)));
  }
  changes.set(implementationFile, implementation);
  return changes;
}
