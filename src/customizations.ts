import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

type Settings = Record<string, unknown>;
const keys = ['font.family', 'monospace.font.family', 'parts.font.family', 'listRow', 'header', 'sidebar.titlebar', 'activityBar', 'statusBar'];

export function customizationConfiguration(): Settings {
  const config = vscode.workspace.getConfiguration('apc');
  const values = Object.fromEntries(keys.map(key => [key, config.get(key)]));
  for (const key of ['listRow', 'header', 'sidebar.titlebar', 'activityBar', 'statusBar']) {
    const settings = values[key] as Record<string, unknown> | undefined;
    if (settings === undefined) { continue; }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) { throw new Error(`apc.${key} must be an object`); }
    for (const property of ['height', 'fontSize', 'size', 'itemSize', 'input', 'actionButton', 'default', 'compact']) { positive(settings[property]); }
    if (settings.itemMargin !== undefined && (typeof settings.itemMargin !== 'number' || !Number.isFinite(settings.itemMargin) || settings.itemMargin < 0 || settings.itemMargin > 512)) { throw new Error('APC item margin must be a finite number from 0 to 512'); }
  }
  const status = values.statusBar as Record<string, unknown> | undefined;
  if (status?.position !== undefined && !['bottom', 'top', 'editor-top', 'editor-bottom'].includes(String(status.position))) { throw new Error('Unknown APC status bar position'); }
  return values;
}

export function customizationScript(context: vscode.ExtensionContext): string {
  return fs.readFileSync(path.join(context.extensionPath, 'resources/customizations.js'), 'utf8') +
    `\nglobalThis.__apcCustomizations.configure(${JSON.stringify(customizationConfiguration())});\n`;
}

function replaceOne(source: string, pattern: RegExp, replacement: (...args: string[]) => string, name: string): string {
  const matches = [...source.matchAll(new RegExp(pattern.source, 'g'))];
  if (matches.length !== 1) { throw new Error(`Unsupported VS Code ${vscode.version}: expected one ${name} hook, found ${matches.length}`); }
  return source.replace(pattern, replacement);
}

// Hook semantic properties rather than names of minified classes. Every anchor
// is preflighted before the caller transactionally writes application files.
export function prepareCustomizations(context: vscode.ExtensionContext, originals: ReadonlyMap<string, string>): Map<string, string> {
  const bundle = path.join(vscode.env.appRoot, 'out/vs/workbench/workbench.desktop.main.js');
  if (!Object.values(customizationConfiguration()).some(value => value !== undefined && value !== null && value !== '' && (typeof value !== 'object' || Object.keys(value).length))) {
    return originals.has(bundle) ? new Map([[bundle, originals.get(bundle)!]]) : new Map();
  }
  let source = originals.get(bundle) ?? fs.readFileSync(bundle, 'utf8');
  source = replaceOne(source,
    /constructor\(([$\w]+),([$\w]+),([$\w]+),([$\w]+)=([$\w]+)\)\{this\.virtualDelegate=\2;this\.domId=`list_id_/, 
    (full, container, delegate) => full.replace(`this.virtualDelegate=${delegate};`, `${delegate}=globalThis.__apcCustomizations.list(this,${container},${delegate});this.virtualDelegate=${delegate};`), 'virtualized list');
  source = replaceOne(source, /this\.workbenchGrid=([$\w]+),this\.workbenchGrid\.edgeSnapping=/,
    (full, grid) => `this.workbenchGrid=${grid},globalThis.__apcCustomizations.layout(this),this.workbenchGrid.edgeSnapping=`, 'workbench grid');
  source = replaceOne(source, /;([$\w]+)=new ([$\w]+)\(([$\w]+),Math\.min\(([$\w]+),([$\w]+)\)\)\}else \1=\2\.None;let ([$\w]+);if\(this\.headerVisible\)/,
    (full, title, dimension, width, height, value, next) => `;${value}=globalThis.__apcCustomizations.header(this,${value});${title}=new ${dimension}(${width},Math.min(${height},${value}))}else ${title}=${dimension}.None;let ${next};if(this.headerVisible)`, 'part title measurement');
  source = replaceOne(source, /get tabHeight\(\)\{([\s\S]*?)\}getHoverTitle\(/,
    (full, body) => {
      const index = body.lastIndexOf('return');
      if (index < 0 || !body.includes('partOptions.tabHeight')) { throw new Error('Unsupported editor tab-height measurement'); }
      return `get tabHeight(){${body.slice(0, index)}return globalThis.__apcCustomizations.tab(this,(${body.slice(index + 6)}))}getHoverTitle(`;
    }, 'editor tab measurement');
  return new Map([[bundle, customizationScript(context) + '\n' + source]]);
}

function family(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) { return; }
  if (/[;{}<>]/.test(value)) { throw new Error('APC font family contains a CSS rule delimiter'); }
  return value;
}

function positive(value: unknown): number | undefined {
  if (value === undefined) { return; }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 512) { throw new Error('APC dimensions must be positive finite numbers up to 512'); }
  return value;
}

export function customizationStyles(): string {
  const config = customizationConfiguration();
  const rules: string[] = [];
  const addFamily = (selector: string, value: unknown) => { const font = family(value); if (font) { rules.push(`${selector}{font-family:${font} !important}`); } };
  addFamily('.monaco-workbench', config['font.family']);
  const monospace = family(config['monospace.font.family']);
  if (monospace) { rules.push(`.monaco-workbench{--monaco-monospace-font:${monospace}}`); }
  const parts = config['parts.font.family'] as Record<string, unknown> | undefined;
  const selectors: Record<string, string> = { 'monaco-menu': '.monaco-menu', banner: '.part.banner', titlebar: '.part.titlebar', statusbar: '.part.statusbar', panel: '.part.panel', 'extension-editor': '.extension-editor', 'settings-body': '.settings-body', auxiliarybar: '.part.auxiliarybar', tabs: '.tabs-container', sidebar: '.part.sidebar' };
  for (const [part, font] of Object.entries(parts ?? {})) {
    if (!selectors[part]) { throw new Error(`Unknown APC font part: ${part}`); }
    addFamily(selectors[part], font);
  }
  for (const key of ['statusBar', 'header', 'sidebar.titlebar']) {
    const value = config[key] as Record<string, unknown> | undefined;
    const size = positive(value?.fontSize);
    if (size) {
      const selector = key === 'statusBar' ? '.part.statusbar' : key === 'header' ? '.editor-group-container > .title' : '.part.sidebar > .title,.part.auxiliarybar > .title,.part.panel > .title';
      rules.push(`${selector}{font-size:${size}px !important}`);
    }
  }
  const header = config.header as Record<string, unknown> | undefined;
  if (header && ['height', 'default', 'compact'].some(key => positive(header[key]))) {
    rules.push('.editor-group-container .tabs-and-actions-container,.editor-group-container .tabs-container,.editor-group-container .tab{height:var(--editor-group-tab-height) !important}');
  }
  const row = config.listRow as { height?: number; fontSize?: number; lists?: string[]; parts?: Record<string, { fontSize?: number }> } | undefined;
  const defaults = ['customview-tree', 'results', 'open-editors', 'explorer-folders-view', 'outline-tree', 'scm-view', 'debug-view-content', 'debug-breakpoints', 'tree'];
  const rowParts = new Set([...(row?.lists ?? (row?.height || row?.fontSize ? defaults : [])), ...Object.keys(row?.parts ?? {})]);
  for (const part of rowParts) {
    if (!/^[a-z][a-z0-9-]*$/.test(part)) { throw new Error(`Invalid APC list class: ${part}`); }
    const size = positive(row?.parts?.[part]?.fontSize ?? row?.fontSize);
    const height = positive((row?.parts?.[part] as { height?: number } | undefined)?.height ?? row?.height);
    if (size) { rules.push(`.${part} .monaco-list-row{font-size:${size}px !important}`); }
    if (height) { rules.push(`.${part} .monaco-list-row{line-height:${height}px !important}`); }
  }
  return rules.join('\n');
}
