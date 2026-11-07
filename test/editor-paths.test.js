const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { appRoot } = require('./editor-paths');
function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-editor-paths-'));
  const runtime = relative => { const app = path.join(root, relative); fs.mkdirSync(path.join(app, 'out'), { recursive: true }); fs.writeFileSync(path.join(app, 'out/main.js'), 'original'); return app; };
  try { run(root, runtime); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
test('flat Linux and legacy Windows archives resolve their application root', () => fixture((root, runtime) => {
  const expected = runtime('resources/app');
  assert.equal(appRoot(path.join(root, 'code'), 'linux'), expected);
  assert.equal(appRoot(path.join(root, 'Code.exe'), 'win32'), expected);
}));
test('versioned Windows archives resolve the runtime rather than the launcher directory', () => fixture((root, runtime) => {
  const expected = runtime('b224f6bf5a/resources/app');
  assert.equal(appRoot(path.join(root, 'Code.exe'), 'win32'), expected);
}));
test('macOS executable resolves inside its application bundle', () => fixture((root, runtime) => {
  const expected = runtime('Code.app/Contents/Resources/app');
  assert.equal(appRoot(path.join(root, 'Code.app/Contents/MacOS/Code'), 'darwin'), expected);
}));
test('ambiguous or missing runtime layouts are rejected before patching', () => fixture((root, runtime) => {
  assert.throws(() => appRoot(path.join(root, 'Code.exe'), 'win32'), /found 0/);
  runtime('b224f6bf5a/resources/app'); runtime('0123456789/resources/app');
  assert.throws(() => appRoot(path.join(root, 'Code.exe'), 'win32'), /found 2/);
}));
