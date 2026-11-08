const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { withBackgroundEditor, source } = require('./background-editor');

for (const platform of ['linux', 'darwin', 'win32']) {
  test(`test focus calls are suppressed on ${platform}`, () => {
    let inactive = 0; let focused = 0; let created; let policy; let loaded;
    class BrowserWindow {
      constructor(options) { this.options = options; this.webContents = { once: (event, fn) => { assert.equal(event, 'did-finish-load'); loaded = fn; } }; }
      isDestroyed() { return false; }
      showInactive() { inactive++; }
      show() { focused++; }
      focus() { focused++; }
      setFocusable(value) { this.options.focusable = value; }
    }
    const app = { focus() { focused++; }, setActivationPolicy: value => { policy = value; }, on: (event, fn) => { assert.equal(event, 'browser-window-created'); created = fn; } };
    const electron = { app, BrowserWindow };
    vm.runInNewContext(source.replace(/^import .*?;\n/gm, ''), { app, BrowserWindow, electron, fs, process: { platform } });
    const preferences = { sandbox: true };
    const window = new electron.BrowserWindow({ show: true, focusable: true, webPreferences: preferences });
    assert.equal(window.options.webPreferences, preferences, 'The guard must preserve native security preferences');
    created(null, window);
    window.show(); window.focus(); app.focus(); window.setFocusable(true);
    loaded();
    assert.equal(inactive, 2, 'Loading must show the window without activation');
    assert.equal(focused, 0);
    assert.equal(window.options.focusable, platform === 'linux');
    assert.equal(policy, platform === 'darwin' ? 'accessory' : undefined);
  });
}

test('background guard restores original application bytes on failure and nests safely', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-background-'));
  const main = path.join(root, 'out/main.js');
  fs.mkdirSync(path.dirname(main)); fs.writeFileSync(main, 'original');
  fs.writeFileSync(path.join(root, 'out/mainImpl.js'), 'new electron.BrowserWindow(options);');
  try {
    await assert.rejects(() => withBackgroundEditor(root, async () => {
      assert.match(fs.readFileSync(main, 'utf8'), /apc-test-background/);
      await withBackgroundEditor(root, async () => {});
      assert.ok(fs.existsSync(path.join(root, 'out/apc-test-background.mjs')));
      throw new Error('test failed');
    }), /test failed/);
    assert.equal(fs.readFileSync(main, 'utf8'), 'original');
    assert.deepEqual(fs.readdirSync(path.join(root, 'out')).sort(), ['main.js', 'mainImpl.js']);
    assert.equal(fs.readFileSync(path.join(root, 'out/mainImpl.js'), 'utf8'), 'new electron.BrowserWindow(options);');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('guarded constructors start hidden and nonfocusable without changing security preferences', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-background-constructor-'));
  fs.mkdirSync(path.join(root, 'out')); fs.writeFileSync(path.join(root, 'out/main.js'), 'original');
  fs.writeFileSync(path.join(root, 'out/mainImpl.js'), 'new electron.BrowserWindow(options);');
  try {
    await withBackgroundEditor(root, async () => {
      for (const platform of ['darwin', 'win32', 'linux']) {
        let recorded;
        const preferences = { sandbox: true };
        const electron = { BrowserWindow: class { constructor(options) { recorded = options; } } };
        vm.runInNewContext(fs.readFileSync(path.join(root, 'out/mainImpl.js'), 'utf8'), { electron, options: { show: true, focusable: true, webPreferences: preferences }, process: { platform } });
        assert.equal(recorded.show, false);
        assert.equal(recorded.focusable, platform === 'linux');
        assert.equal(recorded.webPreferences, preferences);
      }
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
