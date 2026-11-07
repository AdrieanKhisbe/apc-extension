// Test-only Electron shim. Never imported by the extension or packaged VSIX.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const prefix = 'import "./apc-test-background.mjs";\n';
const source = `import electron from 'electron';
const { app, BrowserWindow } = electron;
const preventFocus = process.platform === 'darwin' || process.platform === 'win32';
if (process.platform === 'darwin') { app.setActivationPolicy('accessory'); }
app.focus = () => {};
BrowserWindow.prototype.show = BrowserWindow.prototype.showInactive;
BrowserWindow.prototype.focus = () => {};
app.on('browser-window-created', (_event, window) => {
  if (preventFocus) {
    const setFocusable = window.setFocusable.bind(window);
    window.setFocusable = () => setFocusable(false);
    window.setFocusable();
  }
  window.show = window.showInactive.bind(window);
  window.focus = () => {};
});
`;

async function withBackgroundEditor(appRoot, run) {
  assert.ok(!path.resolve(appRoot).startsWith('/Applications/'), 'Use a disposable editor');
  const main = path.join(appRoot, 'out/main.js');
  const original = fs.readFileSync(main);
  // A child measured-layout runner inherits its parent's already guarded editor.
  if (original.toString().startsWith(prefix)) { return run(); }
  const implementation = path.join(appRoot, 'out/mainImpl.js');
  const originalImplementation = fs.readFileSync(implementation);
  const constructor = /new ([\w$]+)\.BrowserWindow\(([\w$]+)\)/g;
  assert.ok([...originalImplementation.toString().matchAll(constructor)].length, 'Unsupported test BrowserWindow constructor');
  const guardedImplementation = originalImplementation.toString().replace(constructor, 'new $1.BrowserWindow({...$2,show:false,...(process.platform==="darwin"||process.platform==="win32"?{focusable:false}:{})})');
  const shim = path.join(appRoot, 'out/apc-test-background.mjs');
  assert.ok(!fs.existsSync(shim), 'Editor contains a stale background-test shim');
  fs.writeFileSync(shim, source);
  try {
    fs.writeFileSync(implementation, guardedImplementation);
    fs.writeFileSync(main, prefix + original.toString());
    return await run();
  } finally {
    fs.writeFileSync(main, original);
    fs.writeFileSync(implementation, originalImplementation);
    fs.rmSync(shim, { force: true });
  }
}
module.exports = { withBackgroundEditor, source };
