import * as vscode from 'vscode';

type Colors = Record<string, unknown>;
type Override = { hadOriginal: boolean; original?: unknown; applied: string; pending?: string };
type Journal = { version: 1; wasUnset: boolean; tokens: Record<string, Override> };
export type ThemeManager = { apply(): Promise<void>; restore(): Promise<void> };
const storageKey = 'themeOverrides';
const colorsKey = 'workbench.colorCustomizations';
const has = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const validToken = (token: unknown): token is string => typeof token === 'string' && !!token.trim() && !['__proto__', 'constructor', 'prototype'].includes(token);

function desiredColors(): Map<string, string> {
  const value = vscode.workspace.getConfiguration().get<unknown>('apc.theme');
  if (value === undefined) { return new Map(); }
  if (!Array.isArray(value)) { throw new Error('apc.theme must be an array of color/token groups'); }
  const colors = new Map<string, string>();
  for (const entry of value) {
    if (!entry || typeof entry.color !== 'string' || !entry.color.trim() || !Array.isArray(entry.tokens) || !entry.tokens.every(validToken)) {
      throw new Error('Each apc.theme group must have a color and valid token names');
    }
    for (const token of entry.tokens) { colors.set(token, entry.color); }
  }
  return colors;
}

function readJournal(context: vscode.ExtensionContext): Journal | undefined {
  const saved = context.globalState.get<Journal>(storageKey);
  if (!saved) { return; }
  if (saved.version !== 1 || typeof saved.wasUnset !== 'boolean' || !saved.tokens || typeof saved.tokens !== 'object' || Array.isArray(saved.tokens) ||
      Object.entries(saved.tokens).some(([token, record]) => !validToken(token) || !record || typeof record.hadOriginal !== 'boolean' || typeof record.applied !== 'string' || (record.pending !== undefined && typeof record.pending !== 'string'))) {
    throw new Error('Saved APC theme ownership is invalid; refusing to overwrite user colors');
  }
  return saved;
}

async function transition(context: vscode.ExtensionContext, desired: Map<string, string>) {
  const saved = readJournal(context);
  if (!desired.size && !Object.keys(saved?.tokens ?? {}).length) { return; }
  const config = vscode.workspace.getConfiguration();
  // Only own global values. Copying the merged configuration here would leak
  // workspace colors into the user's global settings.
  const original = config.inspect<Colors>(colorsKey)?.globalValue;
  if (process.env.APC_THEME_TRACE) { console.log('APC theme transition:', JSON.stringify({ desired: [...desired], original, saved })); }
  if (original !== undefined && (!original || typeof original !== 'object' || Array.isArray(original))) {
    throw new Error('workbench.colorCustomizations must be an object');
  }
  const colors: Colors = { ...original };
  const wasUnset = saved?.wasUnset ?? original === undefined;
  const staged: Record<string, Override> = Object.create(null);
  const committed: Record<string, Override> = Object.create(null);
  let changed = false;
  const owned = (token: string, record: Override) => has(colors, token) && (colors[token] === record.applied || (record.pending !== undefined && colors[token] === record.pending));

  for (const [token, record] of Object.entries(saved?.tokens ?? {})) {
    if (desired.has(token)) { continue; }
    // Retain the old ownership record until the color write succeeds, so an
    // interrupted removal can still restore it on the next activation.
    staged[token] = { ...record };
    if (owned(token, record)) {
      if (record.hadOriginal) { colors[token] = record.original; }
      else { delete colors[token]; }
      changed = true;
    }
  }
  for (const [token, color] of desired) {
    const previous = saved?.tokens[token];
    const ownPrevious = previous && owned(token, previous);
    const baseline = ownPrevious ? { hadOriginal: previous.hadOriginal, original: previous.original } : { hadOriginal: has(colors, token), original: colors[token] };
    committed[token] = { ...baseline, applied: color };
    staged[token] = { ...baseline, applied: ownPrevious ? colors[token] as string : color, pending: color };
    if (colors[token] !== color) { colors[token] = color; changed = true; }
  }

  // Persist ownership before settings. Keeping both the previous and pending
  // color lets the next operation recover either side of an interrupted write.
  await context.globalState.update(storageKey, { version: 1, wasUnset, tokens: staged } satisfies Journal);
  if (changed) {
    await config.update(colorsKey, !Object.keys(colors).length && wasUnset ? undefined : colors, vscode.ConfigurationTarget.Global);
  }
  await context.globalState.update(storageKey, Object.keys(committed).length ? { version: 1, wasUnset, tokens: committed } satisfies Journal : undefined);
}

export function createThemeManager(context: vscode.ExtensionContext): ThemeManager {
  let tail = Promise.resolve();
  function enqueue(operation: () => Promise<void>) {
    const result = tail.then(operation);
    tail = result.catch(() => {});
    return result;
  }
  return {
    apply: () => enqueue(() => transition(context, desiredColors())),
    restore: () => enqueue(() => transition(context, new Map())),
  };
}
