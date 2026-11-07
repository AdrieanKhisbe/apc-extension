const assert = require('node:assert/strict');
const path = require('node:path');
const vscode = require('vscode');
const { customizationStyles, customizationScript } = require('../dist/customizations');
const { eventually } = require('./cdp');

exports.run = async function (cdp, input) {
  const config = vscode.workspace.getConfiguration('apc');
  const keys = ['listRow', 'parts.font.family', 'header', 'sidebar.titlebar', 'activityBar', 'statusBar'];
  const original = new Map(keys.map(key => [key, config.inspect(key)?.globalValue]));
  const reports = {};
  async function configure(values) {
    for (const key of keys) { await config.update(key, values[key], vscode.ConfigurationTarget.Global); }
    const script = customizationScript({ extensionPath: path.resolve(__dirname, '..') });
    const css = customizationStyles();
    await cdp.evaluate(`(() => {${script}
let style=document.getElementById('apc-extended-styles');if(!style){style=document.createElement('style');style.id='apc-extended-styles';document.head.appendChild(style);}style.textContent=${JSON.stringify(css)};return true;})()`);
  }
  const rows = selector => cdp.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).filter(node=>node.getBoundingClientRect().height>0).map(node=>({height:node.getBoundingClientRect().height,top:node.offsetTop,text:node.textContent}))`);
  try {
    await configure({ listRow: { height: 38, lists: ['results'] }, 'parts.font.family': { sidebar: 'monospace' } });
    await vscode.commands.executeCommand('workbench.action.findInFiles', { query: 'APC_NEEDLE', filesToInclude: 'outline-fixture.js', triggerSearch: true });
    reports.search = await eventually(async () => {
      const rendered = await rows('.search-view .results .monaco-list-row');
      return rendered.length >= 3 && rendered.every(row => row.height === 38) && rendered;
    }, 'Search results must use the configured measured height');
    assert.equal(await cdp.evaluate(`getComputedStyle(document.querySelector('.part.sidebar')).fontFamily`), 'monospace');
    const target = await cdp.evaluate(`(() => {const nodes=[...document.querySelectorAll('.search-view .results .monaco-list-row')];const node=nodes.find(node=>node.textContent.includes('APC_NEEDLE'));const r=node.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await input({ type: 'mousePressed', button: 'left', clickCount: 1, ...target });
    await input({ type: 'mouseReleased', button: 'left', clickCount: 1, ...target });
    await eventually(() => vscode.window.activeTextEditor?.document.uri.path.endsWith('/outline-fixture.js'), 'Clicking a resized Search result must open its source');
    console.log('PASS: real Search row measurement, sidebar font and pointer navigation.');
    return reports;
  } finally {
    for (const [key, value] of original) { await config.update(key, value, vscode.ConfigurationTarget.Global); }
    await cdp.evaluate(`document.getElementById('apc-extended-styles')?.remove();globalThis.__apcCustomizations.configure({});true`);
  }
};
