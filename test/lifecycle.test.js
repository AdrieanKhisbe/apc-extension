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
  const state = options.state || new Map([['isEnabled', initialState]]);
  const settings = options.settings || new Map();
  let configurationListener;
  const disposable = { dispose() {} };
  const context = {
    extensionPath: path.resolve(__dirname, '..'),
    subscriptions: [],
    globalState: {
      get: key => state.get(key),
      update: async (key, value) => { await options.beforeStateUpdate?.(key, value); state.set(key, structuredClone(value)); },
    },
  };
  const vscode = {
    ConfigurationTarget: { Global: 1 },
    env: { appRoot },
    version: '1.140.0',
    commands: { registerCommand: (name, fn) => (commands.set(name, fn), disposable) },
    window: { showErrorMessage: message => (errors.push(message), Promise.resolve()) },
    workspace: {
      getConfiguration: section => {
        const full = key => section ? section + '.' + key : key;
        return {
          get: key => structuredClone(full(key) === 'workbench.colorCustomizations' && options.mergedColors ? options.mergedColors : settings.get(full(key))),
          inspect: key => ({ globalValue: structuredClone(settings.get(full(key))) }),
          update: async (key, value, target) => {
            assert.equal(target, 1, 'Theme writes must target global settings');
            await options.beforeSettingsUpdate?.(full(key), value);
            value === undefined ? settings.delete(full(key)) : settings.set(full(key), structuredClone(value));
          },
        };
      },
      onDidChangeConfiguration: listener => (configurationListener = listener, disposable),
      onDidChangeWorkspaceFolders: () => disposable,
    },
  };
  const storage = {
    read: async () => state.get('themeOverrides'),
    write: async value => { await options.beforeStateUpdate?.('themeOverrides', value); state.set('themeOverrides', structuredClone(value)); },
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
    uninstallPatch: async () => {},
    disposePatch: () => {}, updateImports: async () => {}, ...patch,
  };
  return {
    commands, errors, state, settings, context,
    extension: () => load(path.resolve(__dirname, '../dist/extension.js'), {
      './patch': patchStub, './utils': { promptRestart() {} },
      './theme': { createThemeManager: context => load(path.resolve(__dirname, '../dist/theme.js')).createThemeManager(context, storage) },
    }),
    realPatch: () => load(path.resolve(__dirname, '../dist/patch.js')),
    diskTheme: () => load(path.resolve(__dirname, '../dist/theme.js')).createThemeManager(context),
    theme: () => load(path.resolve(__dirname, '../dist/theme.js')).createThemeManager(context, storage),
    changeConfiguration: (setting = 'apc.iframe.style') => configurationListener({ affectsConfiguration: key => key === setting }),
  };
}

test('modern installation preflight rejects before writing any application files', async () => {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-layout-'));
  try {
    fs.mkdirSync(path.join(appRoot, 'out'));
    fs.writeFileSync(path.join(appRoot, 'out/main.js'), 'export {};');
    const h = harness({ appRoot });
    const patch = h.realPatch();
    assert.throws(() => patch.install(h.context), /unsupported|not supported/i);
    assert.deepEqual(fs.readdirSync(path.join(appRoot, 'out')), ['main.js']);
    assert.equal(fs.readFileSync(path.join(appRoot, 'out/main.js'), 'utf8'), 'export {};');
  } finally {
    fs.rmSync(appRoot, { recursive: true, force: true });
  }
});

test('configured theme applies at startup and disable restores the previous global colors', async () => {
  const original = { 'statusBar.background': '#112233', 'editor.background': '#445566' };
  const h = harness({ initialState: true, settings: new Map([
    ['apc.theme', [{ color: '#abcdef', tokens: ['statusBar.background'] }]],
    ['workbench.colorCustomizations', original],
  ]) });
  await h.extension().activate(h.context);
  assert.equal(h.settings.get('workbench.colorCustomizations')['statusBar.background'], '#abcdef');
  assert.equal(h.settings.get('workbench.colorCustomizations')['editor.background'], '#445566');
  await h.commands.get('apc.extension.disable')();
  assert.deepEqual(h.settings.get('workbench.colorCustomizations'), original);
});

test('removing theme tokens restores original values and removes newly introduced colors', async () => {
  const h = harness({ initialState: true, settings: new Map([
    ['apc.theme', [{ color: '#abcdef', tokens: ['statusBar.background', 'sideBar.background'] }]],
    ['workbench.colorCustomizations', { 'statusBar.background': '#112233' }],
  ]) });
  await h.extension().activate(h.context);
  h.settings.set('apc.theme', [{ color: '#654321', tokens: ['sideBar.background'] }]);
  await h.changeConfiguration('apc.theme');
  assert.deepEqual(h.settings.get('workbench.colorCustomizations'), { 'statusBar.background': '#112233', 'sideBar.background': '#654321' });
  h.settings.delete('apc.theme');
  await h.changeConfiguration('apc.theme');
  assert.deepEqual(h.settings.get('workbench.colorCustomizations'), { 'statusBar.background': '#112233' });
});

test('theme ownership survives reopening and preserves manual user color edits on disable', async () => {
  const settings = new Map([
    ['apc.theme', [{ color: '#abcdef', tokens: ['statusBar.background', 'sideBar.background'] }]],
    ['workbench.colorCustomizations', { 'statusBar.background': '#112233' }],
  ]);
  const first = harness({ initialState: true, settings });
  await first.extension().activate(first.context);
  settings.set('apc.theme', [{ color: '#654321', tokens: ['statusBar.background', 'sideBar.background'] }]);
  const reopened = harness({ settings, state: first.state });
  await reopened.extension().activate(reopened.context);
  assert.equal(settings.get('workbench.colorCustomizations')['statusBar.background'], '#654321');
  settings.set('workbench.colorCustomizations', { ...settings.get('workbench.colorCustomizations'), 'sideBar.background': '#fedcba' });
  await reopened.commands.get('apc.extension.disable')();
  assert.deepEqual(settings.get('workbench.colorCustomizations'), { 'statusBar.background': '#112233', 'sideBar.background': '#fedcba' });
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

test('theme removal restores unset and empty settings without applying an implicit palette', async () => {
  for (const baseline of [undefined, {}]) {
    const settings = new Map();
    if (baseline !== undefined) { settings.set('workbench.colorCustomizations', baseline); }
    const h = harness({ settings });
    const theme = h.theme();
    await theme.apply();
    assert.deepEqual(settings.get('workbench.colorCustomizations'), baseline);
    settings.set('apc.theme', [{ color: '#123456', tokens: ['statusBar.background'] }]);
    await theme.apply();
    settings.set('apc.theme', []);
    await theme.apply();
    assert.deepEqual(settings.get('workbench.colorCustomizations'), baseline);
    assert.equal(h.state.get('themeOverrides'), undefined);
  }
});

test('theme journal recovers interrupted application and removal', async () => {
  for (const failure of ['settings', 'commit', 'remove-settings', 'remove-commit']) {
    let armed = false;
    const settings = new Map([
      ['apc.theme', [{ color: '#abcdef', tokens: ['statusBar.background'] }]],
      ['workbench.colorCustomizations', { 'statusBar.background': '#112233', '[Dark]': { 'editor.background': '#000000' } }],
    ]);
    const original = structuredClone(settings.get('workbench.colorCustomizations'));
    const h = harness({ settings,
      beforeSettingsUpdate: () => { if (armed && failure.endsWith('settings')) { armed = false; throw new Error('write interrupted'); } },
      beforeStateUpdate: (key, value) => {
        if (armed && failure.endsWith('commit') && key === 'themeOverrides' && (!value || Object.values(value.tokens).every(record => !record.pending))) {
          armed = false; throw new Error('commit interrupted');
        }
      },
    });
    const theme = h.theme();
    if (failure.startsWith('remove-')) { await theme.apply(); }
    armed = true;
    await assert.rejects(() => failure.startsWith('remove-') ? theme.restore() : theme.apply(), /interrupted/);
    assert.ok(h.state.get('themeOverrides'), 'Ownership must survive an interrupted write');
    await harness({ settings, state: h.state }).theme().restore();
    assert.deepEqual(settings.get('workbench.colorCustomizations'), original, failure);
    assert.equal(h.state.get('themeOverrides'), undefined);
  }
});

test('theme validation rejects bad input without modifying user colors', async () => {
  for (const value of [null, {}, [{ color: '#fff', tokens: ['__proto__'] }], [{ color: '', tokens: ['statusBar.background'] }]]) {
    const settings = new Map([['apc.theme', value], ['workbench.colorCustomizations', { 'editor.background': '#123456' }]]);
    const h = harness({ settings });
    await assert.rejects(() => h.theme().apply(), /apc.theme/);
    assert.deepEqual(settings.get('workbench.colorCustomizations'), { 'editor.background': '#123456' });
    assert.equal(h.state.get('themeOverrides'), undefined);
  }
});

test('theme operations serialize and recover after a rejected write', async () => {
  let reject = true;
  const h = harness({ settings: new Map([['apc.theme', [{ color: '#fff', tokens: ['statusBar.background'] }]]]),
    beforeSettingsUpdate: () => { if (reject) { reject = false; throw new Error('settings unavailable'); } },
  });
  const theme = h.theme();
  const first = theme.apply();
  const second = theme.apply();
  const restore = theme.restore();
  await assert.rejects(() => first, /settings unavailable/);
  await second;
  await restore;
  assert.equal(h.settings.get('workbench.colorCustomizations'), undefined);
});

test('theme writes do not promote workspace colors into global settings', async () => {
  const h = harness({
    mergedColors: { 'editor.background': '#workspace' },
    settings: new Map([['apc.theme', [{ color: '#123456', tokens: ['statusBar.background'] }]]]),
  });
  await h.theme().apply();
  assert.deepEqual(h.settings.get('workbench.colorCustomizations'), { 'statusBar.background': '#123456' });
  await h.theme().restore();
  assert.equal(h.settings.get('workbench.colorCustomizations'), undefined);
});

test('theme refuses to write colors when ownership cannot be persisted or is corrupt', async () => {
  for (const corrupt of [false, true]) {
    const original = { 'statusBar.background': '#112233' };
    const h = harness({
      settings: new Map([['apc.theme', [{ color: '#abcdef', tokens: ['statusBar.background'] }]], ['workbench.colorCustomizations', original]]),
      beforeStateUpdate: () => { if (!corrupt) { throw new Error('storage unavailable'); } },
    });
    if (corrupt) { h.state.set('themeOverrides', { version: 42 }); }
    await assert.rejects(() => h.theme().apply(), corrupt ? /ownership is invalid/ : /storage unavailable/);
    assert.deepEqual(h.settings.get('workbench.colorCustomizations'), original);
  }
});

test('failed theme application rolls back installation and keeps enable retryable', async () => {
  let removals = 0; let fail = true;
  const h = harness({
    settings: new Map([['apc.theme', [{ color: '#123456', tokens: ['statusBar.background'] }]]]),
    beforeSettingsUpdate: () => { if (fail) { throw new Error('colors locked'); } },
    patch: { uninstallPatch: async () => { removals++; } },
  });
  await h.extension().activate(h.context);
  await assert.rejects(() => h.commands.get('apc.extension.enable')(), /colors locked/);
  assert.equal(removals, 1);
  assert.equal(h.state.get('isEnabled'), false);
  fail = false;
  await h.commands.get('apc.extension.enable')();
  assert.equal(h.state.get('isEnabled'), true);
  assert.equal(h.settings.get('workbench.colorCustomizations')['statusBar.background'], '#123456');
});

test('configuration events during disable cannot queue theme reapplication', async () => {
  let h; let pending;
  const original = { 'statusBar.background': '#112233' };
  h = harness({ initialState: true,
    settings: new Map([['apc.theme', [{ color: '#abcdef', tokens: ['statusBar.background'] }]], ['workbench.colorCustomizations', original]]),
    beforeSettingsUpdate: (_key, value) => {
      if (value?.['statusBar.background'] === '#112233') { pending = h.changeConfiguration('apc.theme'); }
    },
  });
  await h.extension().activate(h.context);
  await h.commands.get('apc.extension.disable')();
  await pending;
  assert.deepEqual(h.settings.get('workbench.colorCustomizations'), original);
  assert.equal(h.state.get('themeOverrides'), undefined);
});

test('file-backed ownership survives reopening despite stale Memento snapshots', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-theme-storage-'));
  const h = harness({ settings: new Map([
    ['apc.theme', [{ color: '#123456', tokens: ['statusBar.background'] }]],
    ['workbench.colorCustomizations', { 'statusBar.background': '#112233' }],
  ]) });
  h.context.globalStorageUri = { fsPath: directory };
  try {
    const theme = h.diskTheme();
    await theme.apply();
    const first = fs.readFileSync(path.join(directory, 'theme-overrides.json'), 'utf8');
    h.settings.set('apc.theme', [{ color: '#654321', tokens: ['statusBar.background'] }]);
    await theme.apply();
    h.state.set('themeOverrides', JSON.parse(first)); // delayed external Memento event
    const journal = JSON.parse(fs.readFileSync(path.join(directory, 'theme-overrides.json'), 'utf8'));
    assert.equal(journal.tokens['statusBar.background'].applied, '#654321');
    await h.diskTheme().restore(); // new manager reads the durable journal
    assert.deepEqual(h.settings.get('workbench.colorCustomizations'), { 'statusBar.background': '#112233' });
    assert.deepEqual(fs.readdirSync(directory), []);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('invalid or unwritable journal files leave user colors untouched', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-theme-storage-'));
  const h = harness({ settings: new Map([
    ['apc.theme', [{ color: '#123456', tokens: ['statusBar.background'] }]],
    ['workbench.colorCustomizations', { 'statusBar.background': '#112233' }],
  ]) });
  try {
    fs.writeFileSync(path.join(directory, 'theme-overrides.json'), '{broken');
    h.context.globalStorageUri = { fsPath: directory };
    await assert.rejects(() => h.diskTheme().apply(), /JSON|position|property/i);
    const blocked = path.join(directory, 'blocked'); fs.writeFileSync(blocked, 'file');
    h.context.globalStorageUri = { fsPath: blocked };
    await assert.rejects(() => h.diskTheme().apply(), /ENOTDIR/);
    assert.deepEqual(h.settings.get('workbench.colorCustomizations'), { 'statusBar.background': '#112233' });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
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
  const h = harness({ patch: { updateImports: async () => { iframeCalls++; } } });
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
  let updates = 0;
  const h = harness({ initialState: true, patch: {
    uninstallPatch: async () => { throw new Error('removal failed'); },
    updateImports: async () => { updates++; },
  } });
  await h.extension().activate(h.context);
  await assert.rejects(() => h.commands.get('apc.extension.disable')(), /removal failed/);
  assert.equal(h.state.get('isEnabled'), true);
  assert.match(h.errors.join('\n'), /removal failed/);
  await h.changeConfiguration();
  assert.equal(updates, 1, 'Failed disable must reopen the runtime configuration gate');
});

test('import and stylesheet configuration updates await publication and report failures', async () => {
  for (const setting of ['apc.imports', 'apc.stylesheet']) {
    let rejectUpdate;
    let updateCalls = 0;
    const h = harness({ patch: { updateImports: () => {
      updateCalls++;
      return new Promise((resolve, reject) => { rejectUpdate = reject; });
    } } });
    await h.extension().activate(h.context);
    await h.changeConfiguration(setting);
    assert.equal(updateCalls, 0, 'Disabled APC must not publish import changes');
    await h.commands.get('apc.extension.enable')();
    let finished = false;
    const update = h.changeConfiguration(setting).then(() => { finished = true; });
    await Promise.resolve();
    assert.equal(updateCalls, 1);
    assert.equal(finished, false, 'Configuration handler must await the publication');
    rejectUpdate(new Error(`Cannot publish ${setting}`));
    await update;
    assert.equal(h.errors.at(-1), `Apc Extension failed: Cannot publish ${setting}`);
    assert.equal(h.state.get('isEnabled'), true, 'A failed update must not change enabled state');
  }
});
