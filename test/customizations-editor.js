const assert = require('node:assert/strict');
const fs = require('node:fs');
const vscode = require('vscode');
const { connect, eventually } = require('./cdp');

async function input(params) {
  const targets = await (await fetch(`http://127.0.0.1:${process.env.APC_CDP_PORT}/json/list`)).json();
  const target = targets.find(item => item.type === 'page' && item.url.includes('workbench.html'));
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  try {
    const response = new Promise(resolve => socket.addEventListener('message', event => resolve(JSON.parse(event.data)), { once: true }));
    socket.send(JSON.stringify({ id: 1, method: 'Input.dispatchMouseEvent', params }));
    assert.ok(!(await response).error);
  } finally { socket.close(); }
}

exports.run = async () => {
  await vscode.commands.executeCommand('workbench.view.explorer');
  await vscode.window.showTextDocument(vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'file-000.txt'));
  const cdp = await connect(process.env.APC_CDP_PORT);
  const snapshot = () => cdp.evaluate(`(() => {
    const box = selector => { const e=document.querySelector(selector); if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right,font:getComputedStyle(e).fontFamily,parentHeight:e.parentElement.getBoundingClientRect().height,parentWidth:e.parentElement.getBoundingClientRect().width}; };
    const rows=[...document.querySelectorAll('.explorer-folders-view .monaco-list-row')].slice(0,4).map(e=>({top:parseFloat(e.style.top),height:e.getBoundingClientRect().height}));
    return {rows,sidebar:box('.part.sidebar'),header:box('.part.sidebar > .title'),content:box('.part.sidebar > .content'),status:box('.part.statusbar'),activity:box('.part.activitybar'),editor:box('.part.editor'),tabs:box('.editor-group-container .tabs-container'),font:box('.monaco-workbench').font};
  })()`);
  try {
    const initial = await eventually(async () => { const s = await snapshot(); return s.rows.length > 3 && s.rows.every(r => r.height === 40) && s; }, 'Custom row sizing did not reach real Explorer');
    console.log('INITIAL CUSTOMIZATIONS', JSON.stringify(initial));
    assert.deepEqual(initial.rows.map(r => r.top), [0, 40, 80, 120]);
    assert.equal(initial.font, 'Georgia');
    assert.equal(initial.status.font, 'monospace');
    assert.equal(initial.status.height, 40);
    assert.equal(initial.status.parentHeight, 40, 'Status grid allocation must match its height');
    assert.equal(initial.activity.parentWidth, 68, 'Activity size includes the native floating gutter');
    assert.ok(initial.sidebar.x >= initial.activity.right, 'Activity bar must not overlap sidebar');
    assert.equal(initial.header.height, 48);
    assert.ok(initial.content.bottom <= initial.sidebar.bottom + 1, 'Header change must reduce content allocation');
    assert.equal(initial.tabs.height, 44);
    const target = await cdp.evaluate(`(() => {const row=[...document.querySelectorAll('.explorer-folders-view .monaco-list-row')][2];const r=row.getBoundingClientRect();return {x:r.x+120,y:r.y+20,index:row.dataset.index};})()`);
    await input({ type: 'mousePressed', button: 'left', clickCount: 1, x: target.x, y: target.y });
    await input({ type: 'mouseReleased', button: 'left', clickCount: 1, x: target.x, y: target.y });
    await eventually(() => cdp.evaluate(`document.querySelector('.explorer-folders-view .monaco-list-row.selected')?.dataset.index === ${JSON.stringify(target.index)}`), 'Real pointer selection did not hit the resized row');
    await input({ type: 'mouseWheel', x: target.x, y: target.y, deltaX: 0, deltaY: 650 });
    await eventually(() => cdp.evaluate(`Number(document.querySelector('.explorer-folders-view .monaco-list-row')?.dataset.index) > 0`), 'Real wheel input did not scroll the measured list');
    await input({ type: 'mouseWheel', x: target.x, y: target.y, deltaX: 0, deltaY: -10000 });
    await eventually(() => cdp.evaluate(`document.querySelector('.explorer-folders-view .monaco-list-row')?.dataset.index === '0'`), 'Explorer did not scroll back to its first resized row');
    await cdp.evaluate(`globalThis.__apcCustomizations.configure({listRow:{height:30,lists:['explorer-folders-view']},statusBar:{height:32,position:'top'},activityBar:{size:56},header:{height:36},'sidebar.titlebar':{height:40}});true`);
    const updated = await eventually(async () => { const s = await snapshot(); return s.rows.length > 3 && s.rows.every(r => r.height === 30) && s; }, 'Live list height update failed');
    assert.deepEqual(updated.rows.map(r => r.top), [0, 30, 60, 90]);
    assert.equal(updated.status.height, 32);
    assert.equal(updated.status.y, 0);
    assert.equal(updated.status.parentHeight, 32);
    await cdp.evaluate(`globalThis.__apcCustomizations.configure({});true`);
    const restored = await eventually(async () => { const s = await snapshot(); return s.rows.length > 3 && s.rows.every(r => r.height === 22) && s; }, 'Removing list configuration must restore delegate heights');
    assert.deepEqual(restored.rows.map(r => r.top), [0, 22, 44, 66]);
    fs.writeFileSync(process.env.APC_CUSTOMIZATIONS_RESULTS, JSON.stringify({ version: vscode.version, initial, updated, restored }, null, 2));
    console.log('PASS: real font overrides, measured list geometry/live removal, header content bounds, activity/status grid sizes and status placement.');
  } finally { cdp.close(); }
};
