import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash, randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import { getConfiguration, getStyles } from './utils';
import { prepareWebview, getWebviewStyleFiles } from './webview';
import { prepareNative } from './native';
import { prepareCustomizations, customizationStyles, customizationScript } from './customizations';

const directoryName = 'apc-extension';
const marker = '<!-- APC modern imports -->';
const policyName = 'apcImports';
const startup = /<script\b(?=[^>]*\bsrc=["'](?:\.\/)?workbench\.js["'])(?=[^>]*\btype=["']module["'])[^>]*>\s*<\/script>/g;

type FileState = { backup?: string; originalHash?: string; patchedHash?: string };
type State = { format: number; version: string; workbenchHash: string; original: string; originalHash: string; patchedHash: string; files?: Record<string, FileState> };
type Entry = { kind: 'css' | 'js'; text?: string; src?: string; source?: string; repeat?: boolean; attributes?: Record<string, string> };
type Publication = { revision: string; entries: Entry[] };
type Layout = { html: string; directory: string; state: string; workbench: string };

function digest(content: string | Buffer) { return createHash('sha256').update(content).digest('hex'); }

function applicationFile(relative: string): string {
  const root = path.join(vscode.env.appRoot, 'out');
  const file = path.resolve(root, relative);
  if (!relative || path.isAbsolute(relative) || path.relative(root, file).startsWith('..')) {
    throw new Error(`Invalid APC application backup path: ${relative}`);
  }
  return file;
}

function originalFiles(layout: Layout, state?: State): Map<string, string> {
  const originals = new Map<string, string>();
  for (const [relative, snapshot] of Object.entries(state?.files ?? {})) {
    const file = applicationFile(relative);
    if (snapshot.backup) {
      if (snapshot.backup !== `backup-${digest(relative)}.txt`) { throw new Error('Invalid APC file backup name'); }
      const original = fs.readFileSync(path.join(layout.directory, snapshot.backup), 'utf8');
      if (digest(original) !== snapshot.originalHash) { throw new Error(`APC backup is invalid: ${relative}`); }
      originals.set(file, original);
    } else if (snapshot.originalHash !== undefined) { throw new Error('Invalid APC file backup metadata'); }
  }
  return originals;
}

function withLock<T>(layout: Layout, operation: () => T): T {
  const lock = layout.directory + '.lock';
  let handle: number;
  try { handle = fs.openSync(lock, 'wx'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Another APC operation owns ${lock}. Retry after it finishes; a lock left by a crashed editor must be removed before retrying.`);
    }
    throw error;
  }
  try {
    fs.writeSync(handle, JSON.stringify({ pid: process.pid, version: vscode.version }));
    return operation();
  } finally { fs.closeSync(handle); fs.unlinkSync(lock); }
}

export function findLayout(): Layout | undefined {
  for (const kind of ['electron-browser', 'electron-sandbox']) {
    const base = path.join(vscode.env.appRoot, 'out/vs/code', kind, 'workbench');
    const html = path.join(base, 'workbench.html');
    const directory = path.join(base, directoryName);
    if (!fs.existsSync(directory) && (!fs.existsSync(html) || !fs.readFileSync(html, 'utf8').match(startup))) { continue; }
    return { html, directory, state: path.join(directory, 'state.json'), workbench: path.join(base, 'workbench.js') };
  }
}

function readState(layout: Layout): State | undefined {
  if (!fs.existsSync(layout.directory)) { return; }
  if (fs.lstatSync(layout.directory).isSymbolicLink() || !fs.statSync(layout.directory).isDirectory()) {
    throw new Error(`APC patch directory is not a regular directory: ${layout.directory}`);
  }
  if (!fs.existsSync(layout.state)) { throw new Error(`APC cannot overwrite an unrecognized directory: ${layout.directory}`); }
  for (const name of fs.readdirSync(layout.directory)) {
    if (!/^(state\.json|config\.json|loader\.js|script-[a-f0-9]{64}\.js|backup-[a-f0-9]{64}\.txt)$/.test(name) || !fs.lstatSync(path.join(layout.directory, name)).isFile()) {
      throw new Error(`APC patch directory contains an unrecognized file: ${name}`);
    }
  }
  const state: State = JSON.parse(fs.readFileSync(layout.state, 'utf8'));
  if (state.format !== 1 || typeof state.original !== 'string' || digest(state.original) !== state.originalHash || typeof state.patchedHash !== 'string') {
    throw new Error('APC backup is invalid. Restore a clean editor installation before enabling APC.');
  }
  if (state.version !== vscode.version || state.workbenchHash !== digest(fs.readFileSync(layout.workbench))) {
    throw new Error('APC backup belongs to a different VS Code build. Restore a clean editor installation before enabling APC.');
  }
  if (digest(fs.readFileSync(layout.html)) !== state.patchedHash) {
    throw new Error('VS Code workbench HTML changed outside APC. Refusing to overwrite it or restore an outdated backup.');
  }
  originalFiles(layout, state);
  for (const [relative, snapshot] of Object.entries(state.files ?? {})) {
    const file = applicationFile(relative);
    if (fs.existsSync(file) && !fs.lstatSync(file).isFile()) { throw new Error(`APC application file is not regular: ${relative}`); }
    const current = fs.existsSync(file) ? digest(fs.readFileSync(file)) : undefined;
    if (current !== snapshot.patchedHash) { throw new Error(`Application file changed outside APC: ${relative}`); }
  }
  return state;
}

function localPath(source: string): string {
  const substituted = source.replace(/\$\{userHome\}/g, os.homedir());
  if (substituted.startsWith('file:')) { return fileURLToPath(substituted); }
  // APC documented /C:/... alongside native Windows paths.
  const native = process.platform === 'win32' ? substituted.replace(/^\/([a-z]:\/)/i, '$1') : substituted;
  if (!path.isAbsolute(native)) { throw new Error(`APC import must be an absolute path or file URL: ${source}`); }
  return native;
}

// Compile configured imports into a versioned renderer snapshot: copy local JS,
// inline CSS, watch local sources, and collect explicitly allowed remote origins.
function prepareImports(context: vscode.ExtensionContext) {
  const imports = getConfiguration<unknown>('apc.imports') ?? [];
  if (!Array.isArray(imports)) { throw new Error('apc.imports must be an array'); }
  const entries: Entry[] = [];
  const files = new Map<string, string>();
  const watched = new Set<string>();
  const origins = { script: new Set<string>(), style: new Set<string>() };
  for (const item of imports) {
    let source: string;
    let attributes: Record<string, string> | undefined;
    let kind: 'css' | 'js';
    if (typeof item === 'string') {
      source = item;
      const extension = path.extname(source.startsWith('file:') ? fileURLToPath(source) : source).toLowerCase();
      if (extension !== '.css' && extension !== '.js') { throw new Error(`APC import must end in .css or .js: ${source}`); }
      kind = extension === '.css' ? 'css' : 'js';
    } else if (item && typeof item === 'object' && (typeof item.src === 'string' || typeof item.href === 'string')) {
      kind = typeof item.src === 'string' ? 'js' : 'css';
      source = kind === 'js' ? item.src : item.href;
      attributes = {};
      for (const [key, value] of Object.entries(item)) {
        if (key === 'src' || key === 'href') { continue; }
        if (/^on/i.test(key) || typeof value !== 'string') { throw new Error(`Unsupported APC import attribute: ${key}`); }
        attributes[key] = value;
      }
    } else { throw new Error(`Invalid APC import: ${JSON.stringify(item)}`); }

    if (/^https?:\/\//.test(source)) {
      const url = new URL(source);
      if (url.username || url.password) { throw new Error('APC external imports must not contain URL credentials'); }
      origins[kind === 'js' ? 'script' : 'style'].add(url.origin);
      entries.push({ kind, src: url.href, attributes });
    } else {
      const file = localPath(source);
      let text: string;
      try { text = fs.readFileSync(file, 'utf8'); }
      catch (error) { throw new Error(`Cannot read APC import ${file}: ${error}`); }
      watched.add(file);
      if (kind === 'css') { entries.push({ kind, text, attributes }); }
      else {
        const name = `script-${digest(text)}.js`;
        files.set(name, text);
        entries.push({ kind, src: name, source: file, attributes });
      }
    }
  }
  const stylesheet = getConfiguration<Record<string, string>>('apc.stylesheet');
  if (stylesheet) { entries.push({ kind: 'css', text: getStyles(stylesheet) }); }
  const styles = customizationStyles();
  if (styles) { entries.push({ kind: 'css', text: styles }); }
  const runtime = customizationScript(context);
  const runtimeName = `script-${digest(runtime)}.js`;
  files.set(runtimeName, runtime);
  entries.push({ kind: 'js', src: runtimeName, source: 'APC customization configuration', repeat: true });
  const publication: Publication = { revision: digest(JSON.stringify(entries)), entries };
  files.set('config.json', JSON.stringify(publication));
  return { files, watched, origins };
}

function patchHtml(original: string, origins: { script: Set<string>; style: Set<string> }) {
  if (original.includes(marker) || original.match(startup)?.length !== 1) {
    throw new Error('Unsupported or already modified VS Code workbench startup HTML');
  }
  // Keep the existing policy and startup tags. Only permit the APC URL policy
  // and origins explicitly requested through external import objects.
  const csp = /(<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*content=")([\s\S]*?)("\s*\/?>)/i;
  if (!csp.test(original)) { throw new Error('Unsupported workbench Content-Security-Policy'); }
  const patched = original.replace(csp, (full, start, policy, end) => {
    let updated = String(policy);
    const additions: Record<string, string[]> = {
      'trusted-types': [policyName],
      'script-src': [...origins.script],
      'style-src': [...origins.style],
    };
    for (const [directive, tokens] of Object.entries(additions)) {
      const rule = new RegExp(`(^|;)\\s*${directive}\\s+([^;]*)`);
      if (!rule.test(updated)) { throw new Error(`Workbench CSP lacks ${directive}`); }
      updated = updated.replace(rule, (match, boundary, values) => `${boundary} ${directive} ${values.trim()} ${tokens.join(' ')} `);
    }
    return start + updated + end;
  });
  return patched.replace('</html>', `${marker}\n<script type="module" src="./${directoryName}/loader.js"></script>\n</html>`);
}

function writeAtomic(file: string, data: string | Buffer) {
  const temporary = file + `.apc-tmp-${randomBytes(8).toString('hex')}`;
  try {
    fs.writeFileSync(temporary, data, { flag: 'wx', mode: fs.existsSync(file) ? fs.statSync(file).mode : 0o644 });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) { fs.unlinkSync(temporary); }
  }
}

// Snapshot exactly the files this operation will change. Failures restore both
// application HTML and sidecars; a backup is persisted before HTML is changed.
// Keep this bounded file batch synchronous while holding the cross-process lock.
// Awaiting writes here would also require serializing refresh/dispose callbacks.
function transaction(layout: Layout, changes: Map<string, string | undefined>) {
  const existed = fs.existsSync(layout.directory);
  const before = new Map<string, Buffer | undefined>();
  for (const file of changes.keys()) {
    if (fs.existsSync(file) && !fs.lstatSync(file).isFile()) { throw new Error(`APC refuses to overwrite a non-regular file: ${file}`); }
    const current = fs.existsSync(file) ? fs.readFileSync(file) : undefined;
    const desired = changes.get(file);
    // Reopening an unchanged installation must not rewrite loaded application
    // files (which can be held open by Windows) or replace identical sidecars.
    if (desired === undefined ? current === undefined : current?.equals(Buffer.from(desired))) { changes.delete(file); }
    else { before.set(file, current); }
  }
  try {
    fs.mkdirSync(layout.directory, { recursive: true });
    for (const [file, content] of changes) {
      if (content !== undefined) { writeAtomic(file, content); }
      else if (fs.existsSync(file)) { fs.unlinkSync(file); }
    }
  } catch (error) {
    const failures: unknown[] = [];
    for (const [file, content] of [...before].reverse()) {
      try {
        if (content !== undefined) { writeAtomic(file, content); }
        else if (fs.existsSync(file)) { fs.unlinkSync(file); }
      } catch (restoreError) { failures.push(restoreError); }
    }
    if (!existed && !failures.length) { fs.rmdirSync(layout.directory); }
    if (failures.length) { throw new Error(`APC patch failed (${error}); rollback also failed (${failures.join(', ')}). Backup: ${layout.state}`); }
    throw error;
  }
}

let watchers: fs.FSWatcher[] = [];
let refreshTimer: NodeJS.Timeout | undefined;
let watcherGeneration = 0;
export function disposePatch() {
  watcherGeneration++;
  watchers.forEach(watcher => watcher.close());
  watchers = [];
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = undefined; }
}

function watchImports(files: Set<string>, context: vscode.ExtensionContext) {
  // Keep the active watchers until the new publication commits. A failed
  // transaction must not prevent the next save from repairing the publication.
  const pending: fs.FSWatcher[] = [];
  let generation: number | undefined;
  function schedule(attempt = 0) {
    if (generation === undefined || generation !== watcherGeneration) { return; }
    if (refreshTimer) { clearTimeout(refreshTimer); }
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      if (generation !== watcherGeneration) { return; }
      try { updateImports(context); }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // Atomic saves and Windows sharing locks can briefly block publication.
        // Retry only native transient errors, never validation/rollback failures.
        if (attempt < 3 && code && ['EBUSY', 'EPERM', 'ENOENT'].includes(code)) { schedule(attempt + 1); }
        else { void vscode.window.showErrorMessage(`APC imports update failed: ${error}`); }
      }
    }, 75 * 2 ** attempt);
  }
  try {
    // Watch directories to survive atomic saves and replacement of source files.
    for (const directory of new Set([...files].map(file => path.dirname(file)))) {
      const watcher = fs.watch(directory, (_event, name) => {
        if (generation === undefined || generation !== watcherGeneration) { return; }
        if (name && !files.has(path.join(directory, name.toString()))) { return; }
        schedule();
      });
      watcher.on('error', error => {
        if (generation === undefined || generation !== watcherGeneration) { return; }
        disposePatch();
        void vscode.window.showErrorMessage(`APC file watching stopped for ${directory}: ${error}. Enable APC again to retry.`);
      });
      pending.push(watcher);
    }
  } catch (error) {
    pending.forEach(watcher => watcher.close());
    throw error;
  }
  return {
    commit() { disposePatch(); generation = watcherGeneration; watchers = pending; },
    dispose() { pending.forEach(watcher => watcher.close()); },
  };
}

// Public entry point: detect the layout and hold the application lock. The
// private applyInstallation performs the transaction using that resolved layout.
export function install(context: vscode.ExtensionContext, notify = true) {
  const layout = findLayout();
  if (!layout) { throw new Error(`Unsupported VS Code ${vscode.version} workbench layout`); }
  return withLock(layout, () => applyInstallation(layout, context, notify));
}

function applyInstallation(layout: Layout, context: vscode.ExtensionContext, notify: boolean) {
  const state = readState(layout);
  const original = state?.original ?? fs.readFileSync(layout.html, 'utf8');
  const originals = originalFiles(layout, state);
  const { files, watched, origins } = prepareImports(context);
  for (const file of getWebviewStyleFiles()) { watched.add(file); }
  const applicationChanges = new Map<string, string | undefined>();
  // Start from originals so removing a setting also removes its application patch.
  for (const relative of Object.keys(state?.files ?? {})) {
    const file = applicationFile(relative);
    applicationChanges.set(file, originals.get(file));
  }
  // Compose adapters over a working copy: native menus and UI measurements can
  // both change the renderer bundle, while backups always retain clean bytes.
  const working = new Map(originals);
  for (const prepare of [prepareCustomizations, prepareNative, prepareWebview]) {
    for (const [file, content] of prepare(context, working)) {
      applicationChanges.set(file, content);
      working.set(file, content);
    }
  }
  const html = patchHtml(original, origins);
  const backup: State = { format: 1, version: vscode.version, workbenchHash: digest(fs.readFileSync(layout.workbench)), original, originalHash: digest(original), patchedHash: digest(html), files: {} };
  const changes = new Map<string, string | undefined>();
  let applicationChanged = false;
  let nativeChanged = false;
  for (const [file, content] of applicationChanges) {
    const relative = path.relative(path.join(vscode.env.appRoot, 'out'), file);
    if (applicationFile(relative) !== file || file === layout.html || file.startsWith(layout.directory + path.sep)) {
      throw new Error(`Invalid APC application change: ${file}`);
    }
    if (fs.existsSync(file) && !fs.lstatSync(file).isFile()) { throw new Error(`APC refuses to overwrite a non-regular file: ${file}`); }
    const previous = state?.files?.[relative];
    const initial = previous ? originals.get(file) : fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
    const snapshot: FileState = { patchedHash: content === undefined ? undefined : digest(content) };
    if (initial !== undefined) {
      snapshot.backup = `backup-${digest(relative)}.txt`;
      snapshot.originalHash = digest(initial);
      if (!previous) { changes.set(path.join(layout.directory, snapshot.backup), initial); }
    }
    backup.files![relative] = snapshot;
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
    if (current !== content) {
      applicationChanged = true;
      if (['main.js', 'mainImpl.js', 'apc-native-loader.mjs'].includes(relative)) { nativeChanged = true; }
      changes.set(file, content);
    }
  }
  // Publish native dependencies before the main-process entry point. The native
  // adapter also falls back to editor defaults during concurrent window starts.
  const main = path.join(vscode.env.appRoot, 'out/main.js');
  if (changes.has(main)) { const content = changes.get(main); changes.delete(main); changes.set(main, content); }
  changes.set(layout.state, JSON.stringify(backup));
  files.set('loader.js', fs.readFileSync(path.join(context.extensionPath, 'resources/modern-loader.js'), 'utf8'));
  for (const [name, content] of files) { changes.set(path.join(layout.directory, name), content); }
  changes.set(layout.html, html);
  // Watcher creation can fail (permissions/resource limits); do it before writes.
  const pending = watchImports(watched, context);
  try { transaction(layout, changes); pending.commit(); }
  catch (error) { pending.dispose(); throw error; }
  if (notify && (!state || state.patchedHash !== backup.patchedHash || applicationChanged)) {
    const message = nativeChanged ? 'Restart VS Code to apply native window and menu changes.' : 'Reload VS Code windows and recreate webviews to apply changed application customizations.';
    void vscode.window.showInformationMessage(message, ...(nativeChanged ? [] : ['Reload Window']))
      .then(action => { if (action === 'Reload Window') { void vscode.commands.executeCommand('workbench.action.reloadWindow'); } });
  }
}

// Configuration changes reapply the same idempotent installation transaction.
export function updateImports(context: vscode.ExtensionContext) { install(context); }
export function ensurePatch(context: vscode.ExtensionContext) { install(context); }

export function uninstallPatch(): boolean {
  const layout = findLayout();
  if (!layout) { return false; }
  return withLock(layout, () => unapplyInstallation(layout));
}

function unapplyInstallation(layout: Layout): boolean {
  const state = readState(layout);
  if (!state) { disposePatch(); return true; }
  disposePatch();
  // Restore every application file as one rollback-capable batch before retiring
  // its backup. A failed write leaves the installed publication intact.
  const retired = layout.directory + '.removing';
  if (fs.existsSync(retired)) { throw new Error(`APC removal backup already exists: ${retired}`); }
  const originals = originalFiles(layout, state);
  const changes = new Map<string, string | undefined>([[layout.html, state.original]]);
  for (const relative of Object.keys(state.files ?? {})) {
    const file = applicationFile(relative);
    changes.set(file, originals.get(file));
  }
  const before = new Map([...changes].map(([file]) => [file, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined]));
  transaction(layout, changes);
  try { fs.renameSync(layout.directory, retired); }
  catch (error) { transaction(layout, before); throw error; }
  fs.rmSync(retired, { recursive: true });
  return true;
}
