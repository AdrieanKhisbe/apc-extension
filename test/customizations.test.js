const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const vm = require('node:vm');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-customizations-unit-'));
const bundle = path.join(directory, 'out/vs/workbench/workbench.desktop.main.js');
fs.mkdirSync(path.dirname(bundle), { recursive: true });
let settings = {};
const originalLoad = Module._load;
Module._load = function (name, ...args) {
  return name === 'vscode' ? { version: '1.143.1', env: { appRoot: directory }, workspace: { getConfiguration: () => ({ get: key => settings[key] }) } } : originalLoad.call(this, name, ...args);
};
const { prepareCustomizations, customizationStyles } = require('../dist/customizations');
Module._load = originalLoad;
const context = { extensionPath: path.resolve(__dirname, '..') };
const fixture = 'class A{constructor(a,b,c,d=Opts){this.virtualDelegate=b;this.domId=`list_id_${1}`;}get tabHeight(){let a=this.groupsView.partOptions.tabHeight;return a==="compact"?22:35}getHoverTitle(){}};this.workbenchGrid=a,this.workbenchGrid.edgeSnapping=false;const options={partContainerClass:"activitybar",orientation:1,icon:true};this._orientation=this.options.orientation??0,this.foo=1;function layout(a,b){let c;if(this.options.hasTitle){let d=35;c=new D(a,Math.min(b,d))}else c=D.None;let e;if(this.headerVisible){}}';
test.after(() => fs.rmSync(directory, { recursive: true, force: true }));
test('empty settings do not read or require an application bundle', () => {
  settings = {};
  assert.equal(prepareCustomizations(context, new Map()).size, 0);
  assert.equal(customizationStyles(), '');
  assert.equal(prepareCustomizations(context, new Map([[bundle, 'original']])).get(bundle), 'original');
});
test('semantic hooks use backup originals and preflight every required anchor', () => {
  settings = { listRow: { height: 40 } };
  const changes = prepareCustomizations(context, new Map([[bundle, fixture]]));
  assert.ok(changes.get(bundle).includes('b=globalThis.__apcCustomizations.list(this,a,b)'));
  assert.ok(changes.get(bundle).includes('globalThis.__apcCustomizations.layout(this)'));
  assert.ok(changes.get(bundle).includes('globalThis.__apcCustomizations.header(this,d)'));
  assert.throws(() => prepareCustomizations(context, new Map([[bundle, fixture.replace('this.virtualDelegate', 'this.changed')]])), /expected one virtualized list hook/);
  assert.throws(() => prepareCustomizations(context, new Map([[bundle, fixture + fixture]])), /found 2/);
  assert.equal(fs.existsSync(bundle), false, 'Preflight must not write application files');
});
test('styles respect per-list overrides and reject malformed dimensions or selectors', () => {
  settings = { 'font.family': 'Georgia', 'parts.font.family': { statusbar: 'monospace' }, listRow: { height: 40, fontSize: 17, parts: { 'explorer-folders-view': { fontSize: 19 } } } };
  const css = customizationStyles();
  assert.ok(css.includes('.part.statusbar{font-family:monospace'));
  assert.ok(css.includes('.explorer-folders-view .monaco-list-row{font-size:19px'));
  assert.ok(css.includes('line-height:40px'));
  settings = { 'font.family': 'Georgia; color:red' };
  assert.throws(customizationStyles, /delimiter/);
  settings = { listRow: { height: -1 } };
  assert.throws(customizationStyles, /positive finite/);
});
test('list wrapper preserves private delegate receivers and remeasures on live removal', () => {
  const realm = vm.createContext({ queueMicrotask: callback => callback() });
  vm.runInContext(fs.readFileSync(path.join(context.extensionPath, 'resources/customizations.js'), 'utf8'), realm);
  const runtime = realm.__apcCustomizations;
  const resized = [];
  let dispose;
  const view = { items: [{ element: {} }], updateElementHeight: (index, height) => resized.push([index, height]), disposables: { add: item => { dispose = item.dispose; } } };
  class Delegate {
    #height = 22;
    getHeight() { return this.#height; }
    getTemplateId() { return `row-${this.#height}`; }
  }
  const wrapped = runtime.list(view, { isConnected: true, closest: selector => selector === '.explorer-folders-view' }, new Delegate());
  assert.equal(wrapped.getTemplateId(), 'row-22');
  runtime.configure({ listRow: { height: 40, lists: ['explorer-folders-view'] } });
  assert.deepEqual(resized.pop(), [0, 40]);
  runtime.configure({});
  assert.deepEqual(resized.pop(), [0, 22]);
  dispose();
  runtime.configure({ listRow: { height: 50 } });
  assert.equal(resized.length, 0, 'Disposed views must not be retained or remeasured');
});
