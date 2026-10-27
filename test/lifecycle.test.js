const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Exercise the compiled extension lifecycle with controlled VS Code services.
// Real-editor coverage remains in activation.test.js.
function harness(options = {}) {
  const { patch = {}, appRoot = '/unused' } = options;
  const initialState = Object.hasOwn(options, 'initialState') ? options.initialState : false;
  const commands = new Map();
  const errors = [];
  const state = new Map([['isEnabled', initialState]]);
  let configurationListener;
  const disposable = { dispose() {} };
  const context = {
    extensionPath: path.resolve(__dirname, '..'),
    subscriptions: [],
    globalState: {
      get: key => state.get(key),
      update: async (key, value) => { state.set(key, value); },
    },
  };
  const vscode = {
    env: { appRoot },
    version: '1.140.0',
    commands: { registerCommand: (name, fn) => (commands.set(name, fn), disposable) },
    window: { showErrorMessage: message => (errors.push(message), Promise.resolve()) },
    workspace: {
      getConfiguration: () => ({ get: () => undefined }),
      onDidChangeConfiguration: listener => (configurationListener = listener, disposable),
      onDidChangeWorkspaceFolders: () => disposable,
    },
  };
  const cache = new Map();
  function load(filename, overrides = {}) {
    if (cache.has(filename)) { return cache.get(filename).exports; }
    const mod = { exports: {} };
    cache.set(filename, mod);
    function localRequire(id) {
      if (id === 'vscode') { return vscode; }
      if (Object.hasOwn(overrides, id)) { return overrides[id]; }
      if (!id.startsWith('.')) { return require(id); }
      const resolved = path.resolve(path.dirname(filename), id);
      if (id.endsWith('.json')) { return JSON.parse(fs.readFileSync(resolved, 'utf8')); }
      return load(resolved + '.js', overrides);
    }
    // No require.main, matching the ESM extension host.
    const wrapper = vm.runInThisContext(`(function(require, module, exports) {\n${fs.readFileSync(filename, 'utf8')}\n})`, { filename });
    wrapper(localRequire, mod, mod.exports);
    return mod.exports;
  }
  const patchStub = {
    ensurePatch: async () => {}, install: async () => {},
    uninstallPatch: async () => {}, appendIframeStyles: async () => {},
    disposePatch: () => {}, ...patch,
  };
  return {
    commands, errors, state, context,
    extension: () => load(path.resolve(__dirname, '../dist/extension.js'), {
      './patch': patchStub, './utils': { promptRestart() {} },
    }),
    realPatch: () => load(path.resolve(__dirname, '../dist/patch.js')),
    changeConfiguration: () => configurationListener({ affectsConfiguration: key => key === 'apc.iframe.style' }),
  };
}

test('modern installation preflight rejects before writing any application files', async () => {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-layout-'));
  try {
    fs.mkdirSync(path.join(appRoot, 'out'));
    fs.writeFileSync(path.join(appRoot, 'out/main.js'), 'export {};');
    const h = harness({ appRoot });
    const patch = h.realPatch();
    await assert.rejects(() => patch.install(h.context), /unsupported|not supported/i);
    assert.deepEqual(fs.readdirSync(path.join(appRoot, 'out')), ['main.js']);
    assert.equal(fs.readFileSync(path.join(appRoot, 'out/main.js'), 'utf8'), 'export {};');
  } finally {
    fs.rmSync(appRoot, { recursive: true, force: true });
  }
});

test('startup patch failure leaves activation and both commands available', async () => {
  const h = harness({ initialState: undefined, patch: {
    ensurePatch: async () => { throw new Error('unsupported editor'); },
  } });
  await h.extension().activate(h.context);
  assert.equal(h.commands.size, 2);
  assert.equal(h.state.get('isEnabled'), undefined);
  assert.match(h.errors.join('\n'), /unsupported editor/);
});

test('commands are registered before startup patching finishes', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const h = harness({ initialState: true, patch: { ensurePatch: () => pending } });
  const activation = h.extension().activate(h.context);
  assert.ok(h.commands.has('apc.extension.enable'));
  assert.ok(h.commands.has('apc.extension.disable'));
  finish();
  await activation;
});

test('enable waits for installation and does not save success on failure', async () => {
  let rejectInstall;
  const pending = new Promise((resolve, reject) => { rejectInstall = reject; });
  const h = harness({ patch: { install: () => pending } });
  await h.extension().activate(h.context);
  const enable = h.commands.get('apc.extension.enable')();
  assert.equal(h.state.get('isEnabled'), false);
  rejectInstall(new Error('installation failed'));
  await assert.rejects(() => enable, /installation failed/);
  assert.equal(h.state.get('isEnabled'), false);
  assert.match(h.errors.join('\n'), /installation failed/);
});

test('configuration listener follows enable and disable in the same session', async () => {
  let iframeCalls = 0;
  const h = harness({ patch: { appendIframeStyles: async () => { iframeCalls++; } } });
  await h.extension().activate(h.context);
  await h.commands.get('apc.extension.enable')();
  assert.equal(h.state.get('isEnabled'), true);
  const before = iframeCalls;
  await h.changeConfiguration();
  assert.equal(iframeCalls, before + 1);
  await h.commands.get('apc.extension.disable')();
  assert.equal(h.state.get('isEnabled'), false);
  await h.changeConfiguration();
  assert.equal(iframeCalls, before + 1);
});

test('failed removal does not save a disabled state', async () => {
  const h = harness({ initialState: true, patch: {
    uninstallPatch: async () => { throw new Error('removal failed'); },
  } });
  await h.extension().activate(h.context);
  await assert.rejects(() => h.commands.get('apc.extension.disable')(), /removal failed/);
  assert.equal(h.state.get('isEnabled'), true);
  assert.match(h.errors.join('\n'), /removal failed/);
});
