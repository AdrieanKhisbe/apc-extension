import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

type Colors = Record<string, unknown>;
type Override = { hadOriginal: boolean; original?: unknown; applied: string; pending?: string };
type Journal = { version: 1; wasUnset: boolean; tokens: Record<string, Override> };
export type ThemeManager = { apply(): Promise<void>; restore(): Promise<void> };
export type ThemeStorage = { read(): Promise<unknown>; write(value: Journal | undefined): Promise<void> };

// Memento can replay older whole-extension snapshots after acknowledged writes.
// Keep ownership independent of that cache and publish each journal atomically.
function journalStorage(context: vscode.ExtensionContext): ThemeStorage {
  const directory = context.globalStorageUri.fsPath;
  const file = path.join(directory, 'theme-overrides.json');
  return {
    async read() {
      try { return JSON.parse(await fs.readFile(file, 'utf8')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return; } throw error; }
    },
    async write(value) {
      if (value === undefined) { await fs.rm(file, { force: true }); return; }
      await fs.mkdir(directory, { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try { await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await fs.rename(temporary, file); }
      finally { await fs.rm(temporary, { force: true }); }
    },
  };
}
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

async function readJournal(storage: ThemeStorage): Promise<Journal | undefined> {
  const saved = await storage.read() as Journal | undefined;
  if (!saved) { return; }
  if (saved.version !== 1 || typeof saved.wasUnset !== 'boolean' || !saved.tokens || typeof saved.tokens !== 'object' || Array.isArray(saved.tokens) ||
      Object.entries(saved.tokens).some(([token, record]) => !validToken(token) || !record || typeof record.hadOriginal !== 'boolean' || typeof record.applied !== 'string' || (record.pending !== undefined && typeof record.pending !== 'string'))) {
    throw new Error('Saved APC theme ownership is invalid; refusing to overwrite user colors');
  }
  return saved;
}

async function transition(storage: ThemeStorage, desired: Map<string, string>) {
  const saved = await readJournal(storage);
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
  await storage.write({ version: 1, wasUnset, tokens: staged } satisfies Journal);
  if (changed) {
    await config.update(colorsKey, !Object.keys(colors).length && wasUnset ? undefined : colors, vscode.ConfigurationTarget.Global);
  }
  await storage.write(Object.keys(committed).length ? { version: 1, wasUnset, tokens: committed } satisfies Journal : undefined);
}

export function createThemeManager(context: vscode.ExtensionContext, storage: ThemeStorage = journalStorage(context)): ThemeManager {
  let tail = Promise.resolve();
  function enqueue(operation: () => Promise<void>) {
    const result = tail.then(operation);
    tail = result.catch(() => {});
    return result;
  }
  return {
    apply: () => enqueue(() => transition(storage, desiredColors())),
    restore: () => enqueue(() => transition(storage, new Map())),
  };
}
