import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { getConfiguration, getStyles } from './utils';

const marker = '// APC webview styles';
export const webviewConfigurationKeys = ['apc.iframe.style'] as const;

function styleFile(source: string): string {
  const substituted = source.replace(/\$\{userHome\}/g, os.homedir());
  const file = substituted.startsWith('file:') ? fileURLToPath(substituted) : substituted;
  if (!path.isAbsolute(file)) { throw new Error('apc.iframe.style must name an absolute CSS file path or file URL'); }
  return file;
}

export function getWebviewStyleFiles(): Set<string> {
  const value = getConfiguration<unknown>('apc.iframe.style');
  return new Set(typeof value === 'string' && value ? [styleFile(value)] : []);
}

function configuredStyle(): string {
  const value = getConfiguration<unknown>('apc.iframe.style');
  if (value === undefined || value === null || value === '') { return ''; }
  if (typeof value === 'string') { return fs.readFileSync(styleFile(value), 'utf8'); }
  if (typeof value !== 'object' || Array.isArray(value)) { throw new Error('apc.iframe.style must be a CSS file path or stylesheet object'); }
  for (const declarations of Object.values(value)) {
    if (typeof declarations === 'string') { continue; }
    if (!declarations || typeof declarations !== 'object' || Array.isArray(declarations) ||
        Object.values(declarations).some(item => typeof item !== 'string' && typeof item !== 'number')) {
      throw new Error('apc.iframe.style selectors must contain CSS text or string/number declarations');
    }
  }
  return getStyles(value as Record<string, string>);
}

function once(text: string, expression: RegExp, description: string): RegExpMatchArray {
  const matches = [...text.matchAll(expression)];
  if (matches.length !== 1) { throw new Error(`Unsupported webview template: expected one ${description}`); }
  return matches[0];
}

// CSS is data in a JSON string, never a JavaScript template literal or HTML.
// Escaping '<' also prevents a CSS </script> sequence ending the enclosing tag.
function scriptString(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function prepareWebview(_context: vscode.ExtensionContext, originals: ReadonlyMap<string, string>): Map<string, string> {
  const file = path.join(vscode.env.appRoot, 'out/vs/workbench/contrib/webview/browser/pre/index.html');
  const style = configuredStyle();
  if (!style.trim()) { return originals.has(file) ? new Map([[file, originals.get(file)!]]) : new Map(); }
  const original = originals.get(file) ?? fs.readFileSync(file, 'utf8');
  if (original.includes(marker)) { throw new Error('Webview template already contains APC changes without an original backup'); }
  const script = once(original, /<script\b(?=[^>]*\btype=["']module["'])(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script\s*>/g, 'inline module');
  const policy = once(original, /(<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*content=")([^"]*)(")/g, 'outer CSP');
  const rules = once(policy[2], /(?:^|;)\s*script-src\s+([^;]*)/g, 'script-src directive');
  const digest = (value: string) => createHash('sha256').update(value).digest('base64');
  const oldHash = `'sha256-${digest(script[1])}'`;
  if (rules[1].split(/\s+/).filter(token => token === oldHash).length !== 1) {
    throw new Error('Webview inline module does not match its CSP hash');
  }
  const defaults = once(script[1], /defaultStyles\.textContent\s*=\s*`[\s\S]*?`;/g, 'default stylesheet assignment');
  once(script[1], /const defaultStyles\s*=\s*document\.createElement\(['"]style['"]\);/g, 'default style node');
  once(script[1], /defaultStyles\.id\s*=\s*['"]_defaultStyles['"];?/g, 'default style identity');
  once(script[1], /newDocument\.head\.prepend\(defaultStyles\.cloneNode\(true\)\);/g, 'default stylesheet insertion');
  const replacement = defaults[0] + `\n\t\t${marker}\n\t\tdefaultStyles.textContent += ${scriptString('\n' + style)};`;
  const updatedScript = script[1].replace(defaults[0], () => replacement);
  const updatedPolicy = policy[2].replace(oldHash, `'sha256-${digest(updatedScript)}'`);
  // The existing trusted default stylesheet precedes each extension's CSP. This
  // is privileged application styling; extension CSS/DOM can still override it.
  const updated = original.replace(script[0], () => script[0].replace(script[1], () => updatedScript))
    .replace(policy[0], () => policy[1] + updatedPolicy + policy[3]);
  return new Map([[file, updated]]);
}
