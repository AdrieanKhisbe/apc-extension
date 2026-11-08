const { appRoot: resolveAppRoot } = require('./editor-paths');
const { withBackgroundEditor } = require('./background-editor');
// Run after compilation with Node 22: node test/native.run.js /path/to/disposable.app
// Platform native getters + compact menu; touches only an isolated editor copy.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const { connect, eventually } = require('./cdp');

async function input(port, method, params) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find(item => item.type === 'page' && item.url.includes('workbench.html'));
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Native input timed out')), 10000);
      socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id === 1) { clearTimeout(timer); message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result); } });
      socket.send(JSON.stringify({ id: 1, method, params }));
    });
  } finally { socket.close(); }
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const source = process.argv[2];
  assert.ok(source && !source.startsWith('/Applications/'), 'Supply a disposable editor download');
  const cache = path.join(root, '.vscode-test');
  fs.mkdirSync(cache, { recursive: true });
  const runtime = fs.mkdtempSync(path.join(cache, 'native-runtime-'));
  const mac = process.platform === 'darwin';
  const app = process.env.APC_NATIVE_TEST_APP || path.join(runtime, mac ? 'Visual Studio Code.app' : 'editor');
  if (!process.env.APC_NATIVE_TEST_APP) {
    if (mac) { assert.equal(spawnSync('cp', ['-cR', source, app]).status, 0); }
    else { fs.cpSync(path.dirname(source), app, { recursive: true }); }
  }
  const executable = mac ? path.join(app, 'Contents/MacOS/Code') : path.join(app, path.basename(source));
  const appRoot = resolveAppRoot(executable);
  return withBackgroundEditor(appRoot, async () => {
  const options = { opacity: 0.83, backgroundColor: '#112233', ...(mac ? { trafficLightPosition: { x: 30, y: 30 } } : {}) };
  const vscode = { env: { appRoot }, workspace: { getConfiguration: () => ({ get: key => key === 'electron' ? options : key === 'menubar.compact' }) } };
  const mod = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(path.join(root, 'dist/native.js'), 'utf8')}\n})`)(id => id === 'vscode' ? vscode : require(id), mod, mod.exports);
  const changes = mod.exports.prepareNative({ extensionPath: root }, new Map());
  const before = new Map([...changes].map(([file]) => [file, fs.existsSync(file) ? fs.readFileSync(file) : undefined]));
  const observation = path.join(runtime, 'native.json');
  const loader = path.join(appRoot, 'out/apc-native-loader.mjs');
  changes.set(loader, changes.get(loader) + `\nimport fs from 'node:fs'; electron.app.on('browser-window-created',(_event,win)=>setTimeout(()=>fs.writeFileSync(${JSON.stringify(observation)},JSON.stringify({ opacity:win.getOpacity(),trafficLightPosition:process.platform==='darwin'?win.getWindowButtonPosition():undefined,backgroundColor:win.getBackgroundColor(),focused:win.isFocused(),focusable:win.isFocusable(),sandbox:win.webContents.getLastWebPreferences().sandbox })),1500));`);
  const evidence = { platform: process.platform, architecture: process.arch, version: JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'))).version, runtime };
  async function launch(mode, callback) {
    const profile = fs.mkdtempSync(path.join(mac ? '/tmp' : os.tmpdir(), 'apcn-'));
    fs.mkdirSync(path.join(profile, 'User'));
    fs.writeFileSync(path.join(profile, 'User/settings.json'), JSON.stringify({ 'update.mode': 'none', 'telemetry.telemetryLevel': 'off', 'window.titleBarStyle': 'custom', 'window.menuStyle': 'custom', 'security.workspace.trust.enabled': false }));
    const server = require('node:net').createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    const child = spawn(executable, ['--user-data-dir=' + profile, '--extensions-dir=' + profile + '/extensions', '--disable-extensions', '--disable-gpu', '--skip-welcome', '--disable-updates', '--remote-debugging-port=' + port], {
      stdio: ['ignore', fs.openSync(path.join(runtime, mode + '.log'), 'w'), fs.openSync(path.join(runtime, mode + '.err'), 'w')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    });
    let cdp;
    try {
      await eventually(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).some(target => target.url.includes('workbench.html')), mode + ' editor startup', 60000);
      cdp = await connect(port);
      await eventually(() => cdp.evaluate(`!!document.querySelector('.monaco-workbench')`), 'Workbench missing', 45000);
      await callback(cdp, port);
    } finally {
      cdp?.close();
      if (process.platform === 'win32') { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']); }
      else { child.kill('SIGTERM'); }
      await new Promise(resolve => { if (child.exitCode !== null || child.signalCode) { resolve(); } else { child.once('exit', resolve); setTimeout(resolve, 5000); } });
    }
  }
  try {
    await launch('control', async cdp => { evidence.control = await cdp.evaluate(`({ menuCount:document.querySelectorAll('.menubar').length })`); });
    changes.forEach((content, file) => fs.writeFileSync(file, content));
    await launch('native', async (cdp, port) => {
      await eventually(() => fs.existsSync(observation), 'Native window observation unavailable');
      evidence.native = JSON.parse(fs.readFileSync(observation));
      assert.ok(Math.abs(evidence.native.opacity - options.opacity) < 0.01);
      if (mac) { assert.deepEqual(evidence.native.trafficLightPosition, options.trafficLightPosition); }
      assert.equal(evidence.native.focused, false, 'Background test windows must not acquire native focus');
      assert.equal(evidence.native.focusable, false, 'Background test windows must reject future focus attempts');
      assert.equal(evidence.native.backgroundColor.toLowerCase(), options.backgroundColor);
      assert.equal(evidence.native.sandbox, true);
      evidence.menu = await cdp.evaluate(`({ html:[...document.querySelectorAll('.menubar')].map(el=>el.outerHTML), buttons:[...document.querySelectorAll('.menubar .menubar-menu-button')].map(el=>({label:el.getAttribute('aria-label'),width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})) })`);
      assert.ok(evidence.menu.buttons.some(button => button.width > 0 && button.height > 0), 'Compact menu button missing');
      const point = await cdp.evaluate(`(()=>{const r=document.querySelector('.menubar .menubar-menu-button').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      await input(port, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await input(port, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
      evidence.menu.open = await eventually(() => cdp.evaluate(`document.querySelector('.monaco-menu') ? [...document.querySelectorAll('.monaco-menu .action-label')].filter(el=>el.getBoundingClientRect().width>0).map(el=>el.textContent) : null`), 'Compact menu did not open');
      assert.ok(evidence.menu.open.some(label => /File/.test(label)), 'Application File menu missing');
      await input(port, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await input(port, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await cdp.evaluate(`document.querySelector('.menubar .menubar-menu-button').focus()`);
      await input(port, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await input(port, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      evidence.menu.keyboard = await cdp.evaluate(`({ focused:document.activeElement?.outerHTML, menuCount:document.querySelectorAll('.monaco-menu').length })`);
      assert.ok(evidence.menu.keyboard.menuCount > 0, 'Keyboard did not reopen compact menu');
    });
  } finally {
    before.forEach((content, file) => content === undefined ? fs.rmSync(file, { force: true }) : fs.writeFileSync(file, content));
    evidence.restored = [...before].every(([file, content]) => content === undefined ? !fs.existsSync(file) : fs.readFileSync(file).equals(content));
    fs.writeFileSync(path.join(runtime, 'result.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
    assert.equal(evidence.restored, true);
  }
  await launch('restored', async cdp => { assert.equal(await cdp.evaluate(`document.querySelectorAll('.menubar').length`), evidence.control.menuCount); });
  console.log('PASS: native window options, compact menu, and clean restored startup.');
  });
}
run().catch(error => { console.error(error); process.exitCode = 1; });
