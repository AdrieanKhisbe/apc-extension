const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { eventually } = require('./cdp');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');

const html = `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; trusted-types existingPolicy;"></head><body></body><script src="./workbench.js" type="module"></script></html>`;

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-modern-'));
  const base = path.join(root, 'out/vs/code/electron-browser/workbench');
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(path.join(base, 'workbench.html'), html);
  fs.writeFileSync(path.join(base, 'workbench.js'), 'export {};');
  const config = new Map([['apc.imports', []]]);
  const notifications = [];
  const vscode = {
    env: { appRoot: root }, version: '1.140.0',
    workspace: { getConfiguration: section => ({ get: key => config.get(section ? section + '.' + key : key) }) },
    window: { showInformationMessage: message => { notifications.push(message); return Promise.resolve(); }, showErrorMessage: message => { errors.push(message); } },
  };
  let fault; let faultCode; let faultRemaining = 1;
  let renameFault; let renameAttempts = 0;
  const watchCallbacks = [];
  const activeWatches = new Map();
  const errors = [];
  const controlledFs = new Proxy(fs, {
    get(target, key) {
      if (key === 'renameSync') {
        return (from, to) => {
          if (renameFault?.(from, to, ++renameAttempts)) { const error = new Error('injected sharing lock'); error.code = 'EPERM'; throw error; }
          return target.renameSync(from, to);
        };
      }
      if (key === 'watch') {
        // Deliver controlled events here; real filesystem watching is covered
        // by the workbench integration test's atomic CSS save.
        return (...args) => { const callback = args[args.length - 1]; watchCallbacks.push(callback); activeWatches.set(callback, args[0]); return { close() { activeWatches.delete(callback); }, on() {} }; };
      }
      if (key === 'writeFileSync' || key === 'openSync') {
        return (filename, ...args) => {
          if (fault?.(filename)) { if (--faultRemaining <= 0) { fault = undefined; } const error = new Error('injected write failure'); if (faultCode) { error.code = faultCode; } throw error; }
          return target[key](filename, ...args);
        };
      }
      return target[key];
    },
  });
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) { return cache.get(file).exports; }
    const mod = { exports: {} }; cache.set(file, mod);
    const localRequire = id => id === 'vscode' ? vscode : id === 'fs' ? controlledFs
      : id.startsWith('.') ? load(path.resolve(path.dirname(file), id + '.js')) : require(id);
    vm.runInThisContext(`(function(require, module, exports) {\n${fs.readFileSync(file, 'utf8')}\n})`, { filename: file })(localRequire, mod, mod.exports);
    return mod.exports;
  }
  const modern = load(path.resolve(__dirname, '../dist/patch.js'));
  t.after(() => { modern.disposePatch(); fs.rmSync(root, { recursive: true, force: true }); });
  return {
    root, base, config, modern, notifications, errors,
    context: { extensionPath: path.resolve(__dirname, '..') },
    failWrite: (predicate, code, times = 1) => { fault = predicate; faultCode = code; faultRemaining = times; },
    failRename: predicate => { renameFault = predicate; renameAttempts = 0; },
    fileChanged: file => { for (const [callback, directory] of [...activeWatches]) { if (directory === path.dirname(file)) { callback('change', path.basename(file)); } } },
    watchCallbacks,
    currentHtml: () => fs.readFileSync(path.join(base, 'workbench.html'), 'utf8'),
    publication: () => JSON.parse(fs.readFileSync(path.join(base, 'apc-extension/config.json'), 'utf8')),
  };
}

test('modern install preserves startup/CSP and repeated install restores the exact original', t => {
  const f = fixture(t);
  f.modern.install(f.context);
  const patched = f.currentHtml();
  assert.match(patched, /default-src 'none'/);
  assert.match(patched, /trusted-types existingPolicy apcImports/);
  assert.match(patched, /<script src="\.\/workbench.js" type="module"><\/script>/);
  f.modern.install(f.context);
  assert.equal(f.currentHtml(), patched);
  assert.equal(f.modern.uninstallPatch(), true);
  assert.equal(f.currentHtml(), html);
  assert.ok(!fs.existsSync(path.join(f.base, 'apc-extension')));
});

test('first startup requests a reload while an unchanged startup does not repeat the prompt', t => {
  const f = fixture(t);
  f.modern.ensurePatch(f.context);
  assert.equal(f.notifications.length, 1);
  assert.match(f.notifications[0], /Reload VS Code/);
  f.modern.ensurePatch(f.context);
  assert.equal(f.notifications.length, 1);
});

test('local file URLs, absolute paths, object imports, and stylesheet preserve order', t => {
  const f = fixture(t);
  const css = path.join(f.root, 'space style.css');
  const js = path.join(f.root, 'script.js');
  fs.writeFileSync(css, 'body { color: red; }'); fs.writeFileSync(js, 'globalThis.test = true;');
  f.config.set('apc.imports', [pathToFileURL(css).href, { src: pathToFileURL(js).href, type: 'text/javascript' }, css]);
  f.config.set('apc.stylesheet', { body: { color: 'blue' } });
  f.modern.install(f.context);
  const { entries } = f.publication();
  assert.deepEqual(entries.map(item => item.kind), ['css', 'js', 'css', 'css', 'js']);
  assert.equal(entries[4].source, 'APC customization configuration');
  assert.equal(entries[0].text, 'body { color: red; }');
  assert.match(entries[1].src, /^script-[a-f0-9]{64}\.js$/);
  assert.match(entries[3].text, /color: blue/);
});

test('external object imports add only the configured origins to existing CSP rules', t => {
  const f = fixture(t);
  f.config.set('apc.imports', [{ href: 'https://styles.example/theme.css', rel: 'stylesheet' }, { src: 'https://scripts.example/script.js' }]);
  f.modern.install(f.context);
  assert.match(f.currentHtml(), /script-src 'self' https:\/\/scripts.example/);
  assert.match(f.currentHtml(), /style-src 'self' 'unsafe-inline' https:\/\/styles.example/);
  assert.match(f.currentHtml(), /default-src 'none'/);
});

test('invalid imports and unknown CSP fail before patch files are created', t => {
  const f = fixture(t);
  f.config.set('apc.imports', [path.join(f.root, 'missing.css')]);
  assert.throws(() => f.modern.install(f.context), /Cannot read APC import/);
  assert.equal(f.currentHtml(), html);
  assert.ok(!fs.existsSync(path.join(f.base, 'apc-extension')));
  f.config.set('apc.imports', []);
  fs.writeFileSync(path.join(f.base, 'workbench.html'), html.replace('Content-Security-Policy', 'unknown'));
  assert.throws(() => f.modern.install(f.context), /Content-Security-Policy/);
  assert.ok(!fs.existsSync(path.join(f.base, 'apc-extension')));
});

test('first-install failure rolls back all files and the original HTML', t => {
  const f = fixture(t);
  f.failWrite(file => file.startsWith(path.join(f.base, 'workbench.html.apc-tmp')));
  assert.throws(() => f.modern.install(f.context), /injected write failure/);
  assert.equal(f.currentHtml(), html);
  assert.ok(!fs.existsSync(path.join(f.base, 'apc-extension')));
});

test('failed refresh preserves the installed publication and backup', t => {
  const f = fixture(t);
  f.modern.install(f.context);
  const before = f.publication();
  const patched = f.currentHtml();
  f.config.set('apc.stylesheet', { body: { color: 'red' } });
  f.failWrite(file => file.includes('config.json.apc-tmp'));
  assert.throws(() => f.modern.updateImports(f.context), /injected write failure/);
  assert.deepEqual(f.publication(), before);
  assert.equal(f.currentHtml(), patched);
  f.modern.uninstallPatch();
  assert.equal(f.currentHtml(), html);
});

test('changed application files or builds are never overwritten with stale backups', t => {
  const f = fixture(t);
  f.modern.install(f.context);
  const patched = f.currentHtml();
  fs.writeFileSync(path.join(f.base, 'workbench.html'), patched + '<!-- foreign -->');
  assert.throws(() => f.modern.install(f.context), /changed outside APC/);
  assert.throws(() => f.modern.uninstallPatch(), /changed outside APC/);
  assert.equal(f.currentHtml(), patched + '<!-- foreign -->');
  fs.writeFileSync(path.join(f.base, 'workbench.html'), patched);
  fs.writeFileSync(path.join(f.base, 'workbench.js'), 'export const newerBuild = true;');
  assert.throws(() => f.modern.uninstallPatch(), /different VS Code build/);
  assert.equal(f.currentHtml(), patched);
});

test('pre-existing unrecognized patch directories are preserved', t => {
  const f = fixture(t);
  const directory = path.join(f.base, 'apc-extension');
  fs.mkdirSync(directory); fs.writeFileSync(path.join(directory, 'user-file'), 'preserve me');
  assert.throws(() => f.modern.install(f.context), /unrecognized directory/);
  assert.equal(fs.readFileSync(path.join(directory, 'user-file'), 'utf8'), 'preserve me');
});

test('corrupt backup contents are not restored over a working editor', t => {
  const f = fixture(t);
  f.modern.install(f.context);
  const before = f.currentHtml();
  const file = path.join(f.base, 'apc-extension/state.json');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  state.original += '<!-- corrupted backup -->';
  fs.writeFileSync(file, JSON.stringify(state));
  assert.throws(() => f.modern.uninstallPatch(), /backup is invalid/);
  assert.equal(f.currentHtml(), before);
});

test('uninstall never deletes unrecognized files added to the patch directory', t => {
  const f = fixture(t);
  f.modern.install(f.context);
  const file = path.join(f.base, 'apc-extension/user-file');
  fs.writeFileSync(file, 'preserve me');
  assert.throws(() => f.modern.uninstallPatch(), /unrecognized file/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'preserve me');
});

test('a concurrent application patch operation fails before changing files', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.base, 'apc-extension.lock'), 'another operation');
  assert.throws(() => f.modern.install(f.context), /Another APC operation/);
  assert.equal(f.currentHtml(), html);
  assert.ok(!fs.existsSync(path.join(f.base, 'apc-extension')));
});

test('a queued file event cannot reinstall APC after its watcher is disposed', async t => {
  const f = fixture(t);
  const css = path.join(f.root, 'style.css');
  fs.writeFileSync(css, 'body {}');
  f.config.set('apc.imports', [css]);
  f.modern.install(f.context);
  const callback = f.watchCallbacks[0];
  f.modern.uninstallPatch();
  callback('change', 'style.css');
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(f.currentHtml(), html);
  assert.ok(!fs.existsSync(path.join(f.base, 'apc-extension')));
});

function webviewFixture(f) {
  const file = path.join(f.root, 'out/vs/workbench/contrib/webview/browser/pre/index.html');
  const script = `const defaultStyles = document.createElement('style');
defaultStyles.id = '_defaultStyles';
defaultStyles.textContent = \`blockquote { color: black; }\`;
newDocument.head.prepend(defaultStyles.cloneNode(true));`;
  const hash = createHash('sha256').update(script).digest('base64');
  const original = `<html><head><meta http-equiv="Content-Security-Policy" content="script-src 'sha256-${hash}';"></head><script async type="module">${script}</script></html>`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, original);
  return { file, original };
}

test('webview configuration and atomic file saves participate in publication and exact restoration', async t => {
  const f = fixture(t);
  const webview = webviewFixture(f);
  const style = path.join(f.root, 'webview.css');
  fs.writeFileSync(style, 'body { color: red; }');
  f.config.set('apc.iframe.style', style);
  f.modern.install(f.context);
  assert.match(fs.readFileSync(webview.file, 'utf8'), /body \{ color: red;/);
  fs.writeFileSync(style + '.tmp', 'body { color: blue; }');
  fs.renameSync(style + '.tmp', style);
  f.watchCallbacks.at(-1)('rename', path.basename(style));
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.match(fs.readFileSync(webview.file, 'utf8'), /body \{ color: blue;/);
  f.config.delete('apc.iframe.style');
  f.modern.updateImports(f.context);
  assert.equal(fs.readFileSync(webview.file, 'utf8'), webview.original);
  f.modern.uninstallPatch();
  assert.equal(f.currentHtml(), html);
  assert.equal(fs.readFileSync(webview.file, 'utf8'), webview.original);
  assert.ok(!fs.existsSync(path.join(f.base, 'apc-extension')));
});

test('failed installation rolls back external application files along with sidecars', t => {
  const f = fixture(t);
  const webview = webviewFixture(f);
  f.config.set('apc.iframe.style', { body: { color: 'red' } });
  f.failWrite(file => path.basename(file).startsWith('config.json.apc-tmp-'));
  assert.throws(() => f.modern.install(f.context), /injected write failure/);
  assert.equal(fs.readFileSync(webview.file, 'utf8'), webview.original);
  assert.equal(f.currentHtml(), html);
  assert.ok(!fs.existsSync(path.join(f.base, 'apc-extension')));
});

test('failed refresh restores external files, publication and backup metadata together', t => {
  const f = fixture(t);
  const webview = webviewFixture(f);
  f.config.set('apc.iframe.style', { body: { color: 'red' } });
  f.modern.install(f.context);
  const before = fs.readFileSync(webview.file, 'utf8');
  const backup = fs.readFileSync(path.join(f.base, 'apc-extension/state.json'), 'utf8');
  f.config.set('apc.iframe.style', { body: { color: 'blue' } });
  f.failWrite(file => path.basename(file).startsWith('state.json.apc-tmp-'));
  assert.throws(() => f.modern.updateImports(f.context), /injected write failure/);
  assert.equal(fs.readFileSync(webview.file, 'utf8'), before);
  assert.equal(fs.readFileSync(path.join(f.base, 'apc-extension/state.json'), 'utf8'), backup);
  f.modern.uninstallPatch();
  assert.equal(fs.readFileSync(webview.file, 'utf8'), webview.original);
});

test('external edits and corrupt external backups block both updates and restoration', t => {
  const f = fixture(t);
  const webview = webviewFixture(f);
  f.config.set('apc.iframe.style', { body: { color: 'red' } });
  f.modern.install(f.context);
  const patched = fs.readFileSync(webview.file, 'utf8');
  fs.writeFileSync(webview.file, patched + 'external edit');
  assert.throws(() => f.modern.updateImports(f.context), /changed outside APC/);
  assert.throws(() => f.modern.uninstallPatch(), /changed outside APC/);
  assert.equal(fs.readFileSync(webview.file, 'utf8'), patched + 'external edit');
  fs.writeFileSync(webview.file, patched);
  const directory = path.join(f.base, 'apc-extension');
  const state = JSON.parse(fs.readFileSync(path.join(directory, 'state.json'), 'utf8'));
  const snapshot = Object.values(state.files)[0];
  fs.writeFileSync(path.join(directory, snapshot.backup), 'corrupt backup');
  assert.throws(() => f.modern.uninstallPatch(), /backup is invalid/);
  assert.equal(fs.readFileSync(webview.file, 'utf8'), patched);
});

test('native changes share backup, refresh, setting-removal and uninstall transactions', t => {
  const f = fixture(t);
  const out = path.join(f.root, 'out');
  const main = path.join(out, 'main.js');
  const implementation = path.join(out, 'mainImpl.js');
  const renderer = path.join(out, 'vs/workbench/workbench.desktop.main.js');
  const loader = path.join(out, 'apc-native-loader.mjs');
  const visibility = 'function visible(config){let value=config.getValue("window.menuBarVisibility");return value==="default"||value==="compact"&&native(config)||mac&&nativeTitle?"classic":value}';
  fs.mkdirSync(path.dirname(renderer), { recursive: true });
  fs.writeFileSync(main, 'await import("./mainImpl.js");');
  fs.writeFileSync(implementation, 'function options(){const c={backgroundColor:theme.getBackgroundColor(),minWidth:400,webPreferences:{sandbox:!0,autoplayPolicy:"user-gesture-required"}};return tweak&&(c.webPreferences={backgroundThrottling:!1}),c}function next(){}' + visibility);
  const measurements = 'class A{constructor(a,b,c,d=Opts){this.virtualDelegate=b;this.domId=`list_id_${1}`;}get tabHeight(){let a=this.groupsView.partOptions.tabHeight;return a==="compact"?22:35}getHoverTitle(){}};this.workbenchGrid=a,this.workbenchGrid.edgeSnapping=false;const options={partContainerClass:"activitybar",orientation:1,icon:true};this._orientation=this.options.orientation??0,this.foo=1;function layout(a,b){let c;if(this.options.hasTitle){let d=35;c=new D(a,Math.min(b,d))}else c=D.None;let e;if(this.headerVisible){}}';
  fs.writeFileSync(renderer, measurements + visibility);
  const originals = new Map([main, implementation, renderer].map(file => [file, fs.readFileSync(file, 'utf8')]));
  f.config.set('apc.electron', { opacity: 0.8 });
  f.config.set('apc.menubar.compact', true);
  f.config.set('apc.listRow', { height: 40 });
  f.modern.install(f.context);
  assert.match(fs.readFileSync(loader, 'utf8'), /"opacity":0.8/);
  assert.match(fs.readFileSync(renderer, 'utf8'), /return"compact"/);
  assert.match(fs.readFileSync(renderer, 'utf8'), /__apcCustomizations\.list/);
  f.config.set('apc.electron', { opacity: 0.6 });
  f.modern.updateImports(f.context);
  assert.match(fs.readFileSync(loader, 'utf8'), /"opacity":0.6/);
  f.config.delete('apc.electron');
  f.config.delete('apc.menubar.compact');
  f.modern.updateImports(f.context);
  assert.match(fs.readFileSync(renderer, 'utf8'), /__apcCustomizations\.list/, 'Removing compact menus must preserve the independent measurement patch');
  assert.equal(fs.existsSync(loader), false, 'Removing native settings must remove the generated bootstrap');
  f.config.delete('apc.listRow');
  f.modern.updateImports(f.context);
  for (const [file, content] of originals) { assert.equal(fs.readFileSync(file, 'utf8'), content); }
  f.modern.uninstallPatch();
  assert.equal(fs.existsSync(loader), false);
  assert.equal(f.currentHtml(), html);
});

test('a failed publication keeps file watching active for the next save', async t => {
  const f = fixture(t); const css = path.join(f.root, 'style.css');
  fs.writeFileSync(css, 'body { color: red; }'); f.config.set('apc.imports', [css]); f.modern.install(f.context);
  fs.writeFileSync(css, 'body { color: blue; }');
  f.failWrite(file => path.basename(file).startsWith('config.json.apc-tmp-'));
  assert.throws(() => f.modern.updateImports(f.context), /injected write failure/);
  assert.equal(f.publication().entries[0].text, 'body { color: red; }');
  fs.writeFileSync(css, 'body { color: green; }'); f.fileChanged(css);
  await eventually(() => f.publication().entries[0].text === 'body { color: green; }', 'The next save must still publish after a failed refresh', 2000);
});

test('a transient sharing failure retries publication without a second save', async t => {
  const f = fixture(t); const css = path.join(f.root, 'style.css');
  fs.writeFileSync(css, 'body { color: red; }'); f.config.set('apc.imports', [css]); f.modern.install(f.context);
  fs.writeFileSync(css, 'body { color: blue; }');
  f.failWrite(file => path.basename(file).startsWith('config.json.apc-tmp-'), 'EBUSY');
  f.fileChanged(css);
  await eventually(() => f.publication().entries[0].text === 'body { color: blue; }', 'A transient file lock must not lose an accepted save', 2500);
  assert.deepEqual(f.errors, []);
});

test('disable cancels a pending sharing-error retry', async t => {
  const f = fixture(t); const css = path.join(f.root, 'style.css'); let failures = 0;
  fs.writeFileSync(css, 'body { color: red; }'); f.config.set('apc.imports', [css]); f.modern.install(f.context);
  f.failWrite(file => { if (path.basename(file).startsWith('config.json.apc-tmp-')) { failures++; return true; } return false; }, 'EBUSY');
  fs.writeFileSync(css, 'body { color: blue; }'); f.fileChanged(css);
  await eventually(() => failures === 1, 'First sharing failure was not injected');
  f.modern.uninstallPatch();
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(f.currentHtml(), html);
  assert.ok(!fs.existsSync(path.join(f.base, 'apc-extension')));
});

test('persistent sharing failures stop retrying and report one error', async t => {
  const f = fixture(t); const css = path.join(f.root, 'style.css'); let failures = 0;
  fs.writeFileSync(css, 'body { color: red; }'); f.config.set('apc.imports', [css]); f.modern.install(f.context);
  f.failWrite(file => { if (path.basename(file) === 'apc-extension.lock') { failures++; return true; } return false; }, 'EBUSY', 100);
  fs.writeFileSync(css, 'body { color: blue; }'); f.fileChanged(css);
  await eventually(() => f.errors.length === 1, 'Persistent lock failure must eventually be reported', 3500);
  assert.ok(failures > 1 && failures <= 5, 'Retries must be attempted but bounded');
  assert.equal(f.publication().entries[0].text, 'body { color: red; }');
});


test('unchanged startup does not rewrite application files and resumes watching', async t => {
  const f = fixture(t); const css = path.join(f.root, 'style.css');
  fs.writeFileSync(css, 'body { color: red; }'); f.config.set('apc.imports', [css]); f.modern.install(f.context);
  f.modern.disposePatch();
  f.failWrite(file => String(file).includes('.apc-tmp-'));
  assert.doesNotThrow(() => f.modern.ensurePatch(f.context));
  f.failWrite(() => false);
  fs.writeFileSync(css, 'body { color: blue; }'); f.fileChanged(css);
  await eventually(() => f.publication().entries[0].text === 'body { color: blue; }', 'Reopened editor must resume file watching');
});

test('a briefly locked application file can be replaced without losing installation', t => {
  const f = fixture(t); const webview = webviewFixture(f); let blocked = 0;
  f.config.set('apc.iframe.style', { body: { color: 'red' } });
  f.failRename((_from, to) => to === webview.file && ++blocked <= 2);
  assert.doesNotThrow(() => f.modern.install(f.context));
  assert.match(fs.readFileSync(webview.file, 'utf8'), /color: red/);
  f.failRename(() => false);
  f.modern.uninstallPatch();
  assert.equal(fs.readFileSync(webview.file, 'utf8'), webview.original);
});

test('a persistently locked unchanged file does not break rollback or leave an unrecognized installation', t => {
  const f = fixture(t); const webview = webviewFixture(f); let blocked = 0;
  f.config.set('apc.iframe.style', { body: { color: 'red' } });
  f.failRename((_from, to) => to === webview.file && ++blocked > 0);
  assert.throws(() => f.modern.install(f.context), error => error.code === 'EPERM' && !error.message.includes('rollback also failed'));
  assert.ok(blocked > 1 && blocked <= 6, 'Replacement retries must be bounded');
  assert.equal(fs.readFileSync(webview.file, 'utf8'), webview.original);
  assert.equal(f.currentHtml(), html);
  assert.ok(!fs.existsSync(path.join(f.base, 'apc-extension')), 'A failed first install must not leave an unrecognized patch directory');
  f.failRename(() => false);
  assert.doesNotThrow(() => f.modern.install(f.context), 'The next explicit enable must remain usable');
});
