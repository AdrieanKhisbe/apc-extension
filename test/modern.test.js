const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');

const html = `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; trusted-types existingPolicy;"></head><body></body><script src="./workbench.js" type="module"></script></html>`;

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-modern-'));
  const base = path.join(root, 'out/vs/code/electron-browser/workbench');
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(path.join(base, 'workbench.html'), html);
  fs.writeFileSync(path.join(base, 'workbench.js'), 'export {};');
  const config = new Map([['apc.imports', []]]);
  const vscode = {
    env: { appRoot: root }, version: '1.140.0',
    workspace: { getConfiguration: () => ({ get: key => config.get(key) }) },
    window: { showInformationMessage: () => Promise.resolve(), showErrorMessage() {} },
  };
  let fault;
  const watchCallbacks = [];
  const controlledFs = new Proxy(fs, {
    get(target, key) {
      if (key === 'watch') {
        // Deliver controlled events here; real filesystem watching is covered
        // by the workbench integration test's atomic CSS save.
        return (...args) => { watchCallbacks.push(args[args.length - 1]); return { close() {}, on() {} }; };
      }
      if (key === 'writeFileSync') {
        return (filename, ...args) => {
          if (fault?.(filename)) { fault = undefined; throw new Error('injected write failure'); }
          return target.writeFileSync(filename, ...args);
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
  const modern = load(path.resolve(__dirname, '../dist/modern.js'));
  t.after(() => { modern.disposeModern(); fs.rmSync(root, { recursive: true, force: true }); });
  return {
    root, base, config, modern,
    context: { extensionPath: path.resolve(__dirname, '..') },
    failWrite: predicate => { fault = predicate; },
    watchCallbacks,
    currentHtml: () => fs.readFileSync(path.join(base, 'workbench.html'), 'utf8'),
    publication: () => JSON.parse(fs.readFileSync(path.join(base, 'apc-extension/config.json'), 'utf8')),
  };
}

test('modern install preserves startup/CSP and repeated install restores the exact original', t => {
  const f = fixture(t);
  f.modern.installModern(f.context);
  const patched = f.currentHtml();
  assert.match(patched, /default-src 'none'/);
  assert.match(patched, /trusted-types existingPolicy apcImports/);
  assert.match(patched, /<script src="\.\/workbench.js" type="module"><\/script>/);
  f.modern.installModern(f.context);
  assert.equal(f.currentHtml(), patched);
  assert.equal(f.modern.uninstallModern(), true);
  assert.equal(f.currentHtml(), html);
  assert.ok(!fs.existsSync(path.join(f.base, 'apc-extension')));
});

test('local file URLs, absolute paths, object imports, and stylesheet preserve order', t => {
  const f = fixture(t);
  const css = path.join(f.root, 'space style.css');
  const js = path.join(f.root, 'script.js');
  fs.writeFileSync(css, 'body { color: red; }'); fs.writeFileSync(js, 'globalThis.test = true;');
  f.config.set('apc.imports', [pathToFileURL(css).href, { src: pathToFileURL(js).href, type: 'text/javascript' }, css]);
  f.config.set('apc.stylesheet', { body: { color: 'blue' } });
  f.modern.installModern(f.context);
  const { entries } = f.publication();
  assert.deepEqual(entries.map(item => item.kind), ['css', 'js', 'css', 'css']);
  assert.equal(entries[0].text, 'body { color: red; }');
  assert.match(entries[1].src, /^script-[a-f0-9]{64}\.js$/);
  assert.match(entries[3].text, /color: blue/);
});

test('external object imports add only the configured origins to existing CSP rules', t => {
  const f = fixture(t);
  f.config.set('apc.imports', [{ href: 'https://styles.example/theme.css', rel: 'stylesheet' }, { src: 'https://scripts.example/script.js' }]);
  f.modern.installModern(f.context);
  assert.match(f.currentHtml(), /script-src 'self' https:\/\/scripts.example/);
  assert.match(f.currentHtml(), /style-src 'self' 'unsafe-inline' https:\/\/styles.example/);
  assert.match(f.currentHtml(), /default-src 'none'/);
});

test('invalid imports and unknown CSP fail before patch files are created', t => {
  const f = fixture(t);
  f.config.set('apc.imports', [path.join(f.root, 'missing.css')]);
  assert.throws(() => f.modern.installModern(f.context), /Cannot read APC import/);
  assert.equal(f.currentHtml(), html);
  assert.ok(!fs.existsSync(path.join(f.base, 'apc-extension')));
  f.config.set('apc.imports', []);
  fs.writeFileSync(path.join(f.base, 'workbench.html'), html.replace('Content-Security-Policy', 'unknown'));
  assert.throws(() => f.modern.installModern(f.context), /Content-Security-Policy/);
  assert.ok(!fs.existsSync(path.join(f.base, 'apc-extension')));
});

test('first-install failure rolls back all files and the original HTML', t => {
  const f = fixture(t);
  f.failWrite(file => file.startsWith(path.join(f.base, 'workbench.html.apc-tmp')));
  assert.throws(() => f.modern.installModern(f.context), /injected write failure/);
  assert.equal(f.currentHtml(), html);
  assert.ok(!fs.existsSync(path.join(f.base, 'apc-extension')));
});

test('failed refresh preserves the installed publication and backup', t => {
  const f = fixture(t);
  f.modern.installModern(f.context);
  const before = f.publication();
  const patched = f.currentHtml();
  f.config.set('apc.stylesheet', { body: { color: 'red' } });
  f.failWrite(file => file.includes('config.json.apc-tmp'));
  assert.throws(() => f.modern.updateModernImports(f.context), /injected write failure/);
  assert.deepEqual(f.publication(), before);
  assert.equal(f.currentHtml(), patched);
  f.modern.uninstallModern();
  assert.equal(f.currentHtml(), html);
});

test('changed application files or builds are never overwritten with stale backups', t => {
  const f = fixture(t);
  f.modern.installModern(f.context);
  const patched = f.currentHtml();
  fs.writeFileSync(path.join(f.base, 'workbench.html'), patched + '<!-- foreign -->');
  assert.throws(() => f.modern.installModern(f.context), /changed outside APC/);
  assert.throws(() => f.modern.uninstallModern(), /changed outside APC/);
  assert.equal(f.currentHtml(), patched + '<!-- foreign -->');
  fs.writeFileSync(path.join(f.base, 'workbench.html'), patched);
  fs.writeFileSync(path.join(f.base, 'workbench.js'), 'export const newerBuild = true;');
  assert.throws(() => f.modern.uninstallModern(), /different VS Code build/);
  assert.equal(f.currentHtml(), patched);
});

test('pre-existing unrecognized patch directories are preserved', t => {
  const f = fixture(t);
  const directory = path.join(f.base, 'apc-extension');
  fs.mkdirSync(directory); fs.writeFileSync(path.join(directory, 'user-file'), 'preserve me');
  assert.throws(() => f.modern.installModern(f.context), /unrecognized directory/);
  assert.equal(fs.readFileSync(path.join(directory, 'user-file'), 'utf8'), 'preserve me');
});

test('corrupt backup contents are not restored over a working editor', t => {
  const f = fixture(t);
  f.modern.installModern(f.context);
  const before = f.currentHtml();
  const file = path.join(f.base, 'apc-extension/state.json');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  state.original += '<!-- corrupted backup -->';
  fs.writeFileSync(file, JSON.stringify(state));
  assert.throws(() => f.modern.uninstallModern(), /backup is invalid/);
  assert.equal(f.currentHtml(), before);
});

test('uninstall never deletes unrecognized files added to the patch directory', t => {
  const f = fixture(t);
  f.modern.installModern(f.context);
  const file = path.join(f.base, 'apc-extension/user-file');
  fs.writeFileSync(file, 'preserve me');
  assert.throws(() => f.modern.uninstallModern(), /unrecognized file/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'preserve me');
});

test('a concurrent application patch operation fails before changing files', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.base, 'apc-extension.lock'), 'another operation');
  assert.throws(() => f.modern.installModern(f.context), /Another APC operation/);
  assert.equal(f.currentHtml(), html);
  assert.ok(!fs.existsSync(path.join(f.base, 'apc-extension')));
});

test('a queued file event cannot reinstall APC after its watcher is disposed', async t => {
  const f = fixture(t);
  const css = path.join(f.root, 'style.css');
  fs.writeFileSync(css, 'body {}');
  f.config.set('apc.imports', [css]);
  f.modern.installModern(f.context);
  const callback = f.watchCallbacks[0];
  f.modern.uninstallModern();
  callback('change', 'style.css');
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(f.currentHtml(), html);
  assert.ok(!fs.existsSync(path.join(f.base, 'apc-extension')));
});
