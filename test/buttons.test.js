const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function event() {
  const listeners = new Set();
  return { listen: fn => (listeners.add(fn), { dispose: () => listeners.delete(fn) }),
    fire: () => [...listeners].forEach(fn => fn()), get size() { return listeners.size; } };
}
function repository(count) {
  const change = event();
  return { change, state: { workingTreeChanges: Array(count).fill({}), onDidChange: change.listen } };
}
function harness(repositories = [], extensionOverride) {
  const open = event(); const close = event();
  const git = { repositories, onDidOpenRepository: open.listen, onDidCloseRepository: close.listen };
  const items = [];
  let settings = [{ text: 'SCM', vscommand: 'workbench.view.scm' }];
  const vscode = {
    extensions: { getExtension: () => extensionOverride ? extensionOverride(git) : ({ exports: { getAPI: () => git } }) },
    workspace: { getConfiguration: () => ({ get: () => settings }) },
    window: { createStatusBarItem: () => {
      const item = { show() {}, dispose() { this.disposed = true; } }; items.push(item); return item;
    } },
  };
  const mod = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../dist/buttons/button.js'), 'utf8');
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`)(name => {
    assert.equal(name, 'vscode'); return vscode;
  }, mod, mod.exports);
  const context = { subscriptions: [] };
  return { ...mod.exports, context, items, git, open, close, setButtons: value => { settings = value; } };
}

test('SCM button shows the initial total and follows repository changes', () => {
  const first = repository(2); const second = repository(3);
  const h = harness([first, second]);
  h.applyButtons(h.context);
  assert.equal(h.items[0].text, '$(source-control) 5');
  first.state.workingTreeChanges = [{}]; first.change.fire();
  assert.equal(h.items[0].text, '$(source-control) 4');
  h.disposeButtons();
});

test('SCM button follows opened and closed repositories and releases subscriptions', () => {
  const first = repository(2); const second = repository(3);
  const h = harness([first]);
  h.applyButtons(h.context);
  h.git.repositories.push(second); h.open.fire();
  assert.equal(h.items[0].text, '$(source-control) 5');
  assert.equal(second.change.size, 1);
  h.git.repositories.splice(0, 1); h.close.fire();
  assert.equal(h.items[0].text, '$(source-control) 3');
  assert.equal(first.change.size, 0);
  h.applyButtons(h.context);
  assert.equal(h.items[0].disposed, true);
  assert.equal(second.change.size, 1, 'Rebuilding must not duplicate listeners');
  h.disposeButtons();
  assert.equal(second.change.size, 0);
  assert.equal(h.open.size, 0); assert.equal(h.close.size, 0);
});

test('removing SCM buttons releases listeners and leaves normal labels intact', () => {
  const repo = repository(1); const h = harness([repo]);
  h.applyButtons(h.context);
  h.setButtons([{ text: 'Plain', vscommand: 'other.command' }]);
  h.applyButtons(h.context);
  assert.equal(h.items[1].text, 'Plain');
  assert.equal(repo.change.size, 0);
  h.disposeButtons();
});

test('pending Git activation cannot recreate subscriptions after button removal', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const h = harness([], () => ({ isActive: false, activate: () => pending }));
  h.applyButtons(h.context);
  h.disposeButtons();
  finish({ getAPI: () => h.git });
  await pending;
  await Promise.resolve();
  assert.equal(h.open.size, 0);
  assert.equal(h.close.size, 0);
  assert.equal(h.items[0].disposed, true);
});

test('SCM button connects when built-in Git finishes activating', async () => {
  const h = harness([repository(2)], git => ({ isActive: false, activate: () => Promise.resolve({ getAPI: () => git }) }));
  h.applyButtons(h.context);
  await Promise.resolve();
  assert.equal(h.items[0].text, '$(source-control) 2');
  h.disposeButtons();
});

test('SCM button handles an empty repository list and unavailable Git', () => {
  const empty = harness();
  empty.applyButtons(empty.context);
  assert.equal(empty.items[0].text, '$(source-control) 0');
  empty.disposeButtons();
  for (const extension of [undefined, { exports: undefined }]) {
    const h = harness([], () => extension);
    assert.doesNotThrow(() => h.applyButtons(h.context));
    assert.equal(h.items[0].text, 'SCM');
    h.disposeButtons();
  }
});
