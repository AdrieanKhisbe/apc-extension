const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { withBackgroundEditor, source } = require('./background-editor');

test('test windows use showInactive and suppress application/window focus', () => {
  let inactive = 0; let focused = 0; let created;
  class BrowserWindow {
    showInactive() { inactive++; }
    show() { focused++; }
    focus() { focused++; }
  }
  const app = { focus() { focused++; }, on: (event, fn) => { assert.equal(event, 'browser-window-created'); created = fn; } };
  vm.runInNewContext(source.replace(/^import .*?;\n/, ''), { app, BrowserWindow });
  const window = new BrowserWindow();
  created(null, window);
  window.show(); window.focus(); app.focus();
  assert.equal(inactive, 1);
  assert.equal(focused, 0);
});

test('background guard restores original application bytes on failure and nests safely', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-background-'));
  const main = path.join(root, 'out/main.js');
  fs.mkdirSync(path.dirname(main)); fs.writeFileSync(main, 'original');
  try {
    await assert.rejects(() => withBackgroundEditor(root, async () => {
      assert.match(fs.readFileSync(main, 'utf8'), /apc-test-background/);
      await withBackgroundEditor(root, async () => {});
      assert.ok(fs.existsSync(path.join(root, 'out/apc-test-background.mjs')));
      throw new Error('test failed');
    }), /test failed/);
    assert.equal(fs.readFileSync(main, 'utf8'), 'original');
    assert.deepEqual(fs.readdirSync(path.join(root, 'out')), ['main.js']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
