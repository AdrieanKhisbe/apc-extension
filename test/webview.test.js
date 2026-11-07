const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');

const digest = value => createHash('sha256').update(value).digest('base64');
const script = `const defaultStyles = document.createElement('style');
defaultStyles.id = '_defaultStyles';
defaultStyles.textContent = \`body { color: var(--vscode-editor-foreground); }\`;
newDocument.head.prepend(defaultStyles.cloneNode(true));`;
const template = value => `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${digest(value)}' 'self'; frame-src 'self'; style-src 'unsafe-inline';"></head><body><script async type="module">${value}</script></body></html>`;

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-webview-'));
  const file = path.join(root, 'out/vs/workbench/contrib/webview/browser/pre/index.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const original = template(script);
  fs.writeFileSync(file, original);
  const config = new Map();
  const vscode = { env: { appRoot: root }, workspace: { getConfiguration: () => ({ get: key => config.get(key) }) } };
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) { return cache.get(filename).exports; }
    const mod = { exports: {} }; cache.set(filename, mod);
    const localRequire = id => id === 'vscode' ? vscode : id.startsWith('.') ? load(path.resolve(path.dirname(filename), id + '.js')) : require(id);
    vm.runInThisContext(`(function(require, module, exports) {\n${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(localRequire, mod, mod.exports);
    return mod.exports;
  }
  const webview = load(path.resolve(__dirname, '../dist/webview.js'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, file, original, config, webview, prepare: originals => webview.prepareWebview({}, originals || new Map()) };
}

test('webview styles preserve CSP directives and publish from the original template', t => {
  const f = fixture(t);
  f.config.set('apc.iframe.style', { body: { color: 'red', 'font-size': 17 } });
  const patched = f.prepare().get(f.file);
  assert.match(patched, /body \{ color: red; font-size: 17;/);
  const beforePolicy = f.original.match(/content="([^"]*)"/)[1];
  const afterPolicy = patched.match(/content="([^"]*)"/)[1];
  assert.equal(afterPolicy.replace(/sha256-[^']+/, 'HASH'), beforePolicy.replace(/sha256-[^']+/, 'HASH'));
  const patchedScript = patched.match(/<script async type="module">([\s\S]*?)<\/script>/)[1];
  assert.ok(afterPolicy.includes(`'sha256-${digest(patchedScript)}'`));
  fs.writeFileSync(f.file, patched);
  assert.equal(f.prepare(new Map([[f.file, f.original]])).get(f.file), patched);
  f.config.delete('apc.iframe.style');
  assert.equal(f.prepare(new Map([[f.file, f.original]])).get(f.file), f.original);
  assert.equal(f.prepare().size, 0);
  assert.equal(fs.readFileSync(f.file, 'utf8'), patched, 'Preparation must not mutate application files');
});

test('CSS containing JavaScript/HTML delimiters remains literal stylesheet data', t => {
  const f = fixture(t);
  const css = 'body::before { content: "` ${globalThis.pwned = true} </script><script>globalThis.pwned=true</script> \\ \u2028 \u2029"; }';
  const source = path.join(f.root, 'style.css'); fs.writeFileSync(source, css);
  f.config.set('apc.iframe.style', pathToFileURL(source).href);
  assert.deepEqual([...f.webview.getWebviewStyleFiles()], [source]);
  const patched = f.prepare().get(f.file);
  assert.equal((patched.match(/<script/g) || []).length, 1);
  assert.equal((patched.match(/<\/script>/g) || []).length, 1);
  const content = patched.match(/<script async type="module">([\s\S]*?)<\/script>/)[1];
  let inserted;
  const scope = { document: { createElement: () => ({ textContent: '', cloneNode() { return this; } }) }, newDocument: { head: { prepend: node => { inserted = node; } } } };
  vm.runInNewContext(content, scope);
  assert.equal(scope.pwned, undefined);
  assert.ok(inserted.textContent.endsWith('\n' + css));
});

test('hash replacement is confined to script-src when another directive uses the same hash', t => {
  const f = fixture(t);
  const hash = `'sha256-${digest(script)}'`;
  fs.writeFileSync(f.file, f.original.replace(/content="[^"]*"/, `content="default-src 'none'; style-src ${hash}; script-src ${hash} 'self';"`));
  f.config.set('apc.iframe.style', { body: 'color: red;' });
  const patched = f.prepare().get(f.file);
  assert.ok(patched.includes(`style-src ${hash};`));
  assert.ok(!patched.includes(`script-src ${hash}`));
});

test('file updates are re-read and missing/relative/invalid style configurations fail before writes', t => {
  const f = fixture(t);
  const source = path.join(f.root, 'style.css'); fs.writeFileSync(source, 'body { color: red; }');
  f.config.set('apc.iframe.style', source);
  const before = f.prepare().get(f.file);
  fs.writeFileSync(source, 'body { color: blue; }');
  assert.notEqual(f.prepare().get(f.file), before);
  fs.unlinkSync(source);
  assert.throws(() => f.prepare(), /ENOENT/);
  for (const value of ['relative.css', [], 8, { body: null }, { body: { color: [] } }]) {
    f.config.set('apc.iframe.style', value);
    assert.throws(() => f.prepare(), /apc\.iframe\.style/);
  }
  assert.equal(fs.readFileSync(f.file, 'utf8'), f.original);
});

test('unknown or already modified webview templates fail semantic/hash preflight', t => {
  const f = fixture(t);
  f.config.set('apc.iframe.style', { body: 'color: red;' });
  const patched = f.prepare().get(f.file);
  const invalid = [f.original.replace('defaultStyles.cloneNode(true)', 'defaultStyles.cloneNode(false)'),
    f.original.replace('sha256-', 'sha512-'), template(script + '\n' + script),
    template(script.replace("defaultStyles.id = '_defaultStyles';", '')), patched];
  for (const content of invalid) {
    fs.writeFileSync(f.file, content);
    assert.throws(() => f.prepare(), /Unsupported webview template|CSP hash|already contains APC/);
    assert.equal(fs.readFileSync(f.file, 'utf8'), content);
  }
});

test('Windows line endings use browser-normalized CSP hashes without accepting changed scripts', t => {
  const f = fixture(t);
  f.config.set('apc.iframe.style', { body: { color: 'red' } });
  for (const ending of ['\r\n', '\r']) {
    const windows = f.original.replace(/\n/g, ending);
    fs.writeFileSync(f.file, windows);
    const patched = f.prepare().get(f.file);
    const inline = patched.match(/<script async type="module">([\s\S]*?)<\/script>/)[1];
    const policy = patched.match(/content="([^"]*)"/)[1];
    assert.ok(policy.includes(`'sha256-${digest(inline.replace(/\r\n?/g, '\n'))}'`));
    assert.equal(fs.readFileSync(f.file, 'utf8'), windows, 'Preparation must preserve the input file');
    const changed = windows.replace('color: var(', 'background: var(');
    fs.writeFileSync(f.file, changed);
    assert.throws(() => f.prepare(), /does not match its CSP hash/);
    assert.equal(fs.readFileSync(f.file, 'utf8'), changed);
  }
});
