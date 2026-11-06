const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function fixture(t) {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-native-'));
  const out = path.join(appRoot, 'out');
  fs.mkdirSync(path.join(out, 'vs/workbench'), { recursive: true });
  const files = { main: path.join(out, 'main.js'), implementation: path.join(out, 'mainImpl.js'), renderer: path.join(out, 'vs/workbench/workbench.desktop.main.js'), loader: path.join(out, 'apc-native-loader.mjs') };
  const normalization = 'function visibility(config){let value=config.getValue("window.menuBarVisibility");return value==="default"||value==="compact"&&native(config)||mac&&nativeTitle?"classic":value}';
  fs.writeFileSync(files.main, 'await import("./mainImpl.js");');
  fs.writeFileSync(files.implementation, 'function options(){const c={backgroundColor:theme.getBackgroundColor(),minWidth:400,webPreferences:{sandbox:!0,autoplayPolicy:"user-gesture-required"}};return tweak&&(c.webPreferences={backgroundThrottling:!1}),c}function next(){}' + normalization);
  fs.writeFileSync(files.renderer, normalization);
  const config = new Map();
  const mod = { exports: {} };
  const vscode = { env: { appRoot }, workspace: { getConfiguration: () => ({ get: key => config.get(key) }) } };
  vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(path.resolve(__dirname, '../dist/native.js'), 'utf8')}\n})`)(id => id === 'vscode' ? vscode : require(id), mod, mod.exports);
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }));
  return { files, config, prepare: originals => mod.exports.prepareNative({ extensionPath: path.resolve(__dirname, '..') }, originals || new Map()) };
}

test('native preparation is opt-in and never writes application files', t => {
  const f = fixture(t);
  assert.equal(f.prepare().size, 0);
  const original = fs.readFileSync(f.files.main, 'utf8');
  f.config.set('electron', { opacity: 0.7, trafficLightPosition: { x: 12, y: 8 } });
  const changes = f.prepare();
  assert.ok(changes.get(f.files.main).includes('await import("./apc-native-loader.mjs")'));
  assert.ok(changes.get(f.files.loader).includes('"opacity":0.7'));
  assert.ok(changes.get(f.files.implementation).includes('globalThis[Symbol.for("apc.native.options")](c)'));
  assert.equal(fs.readFileSync(f.files.main, 'utf8'), original);
  assert.equal(fs.existsSync(f.files.loader), false);
});

test('native preparation uses original snapshots rather than patching a patched application', t => {
  const f = fixture(t);
  f.config.set('menubar.compact', true);
  const originals = new Map([f.files.implementation, f.files.renderer].map(file => [file, fs.readFileSync(file, 'utf8')]));
  const first = f.prepare();
  first.forEach((content, file) => fs.writeFileSync(file, content));
  const second = f.prepare(originals);
  assert.deepEqual([...first], [...second]);
  assert.ok(second.get(f.files.renderer).includes('function visibility(){return"compact"}'));
});

test('unknown or ambiguous native anchors fail before writing', t => {
  const f = fixture(t);
  f.config.set('electron', { opacity: 0.7 });
  fs.writeFileSync(f.files.main, 'await import("./different.js")');
  assert.throws(() => f.prepare(), /expected one main-process module startup/);
  fs.writeFileSync(f.files.main, 'await import("./mainImpl.js");await import("./mainImpl.js");');
  assert.throws(() => f.prepare(), /found 2/);
  assert.equal(fs.existsSync(f.files.loader), false);
});

test('native options cannot replace web preferences or serialize invalid settings', t => {
  const f = fixture(t);
  for (const electron of [{ webPreferences: { sandbox: false } }, { opacity: 2 }, { opacity: NaN }, { trafficLightPosition: { x: 1 } }, { titleBarOverlay: { height: -1 } }, { frame: 'false' }]) {
    f.config.set('electron', electron);
    assert.throws(() => f.prepare(), /apc.electron/);
  }
});

test('native bootstrap preserves preferences and explicit native choices after VS Code setters run', t => {
  const f = fixture(t);
  f.config.set('electron', { opacity: 0.7, backgroundColor: '#123456', trafficLightPosition: { x: 9, y: 12 } });
  const loader = f.prepare().get(f.files.loader);
  let onWindow;
  const context = { electron: { app: { on: (_event, callback) => { onWindow = callback; } } } };
  vm.runInNewContext(loader.replace("import electron from 'electron';", ''), context);
  const preferences = { sandbox: true, contextIsolation: true };
  const transform = vm.runInNewContext('globalThis[Symbol.for("apc.native.options")]', context);
  assert.equal(transform({ webPreferences: preferences }).webPreferences, preferences);
  assert.equal(transform({ webPreferences: preferences }).opacity, 0.7);
  const observed = {};
  const window = { setBackgroundColor: value => { observed.color = value; }, setWindowButtonPosition: value => { observed.position = value; } };
  onWindow(undefined, window);
  window.setBackgroundColor('#ffffff');
  window.setWindowButtonPosition({ x: 1, y: 1 });
  assert.equal(observed.color, '#123456');
  assert.equal(observed.position.x, 9);
  assert.equal(observed.position.y, 12);
});
