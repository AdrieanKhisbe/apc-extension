const assert = require('node:assert/strict');
const fs = require('node:fs');
const vscode = require('vscode');
const { connect, eventually } = require('./cdp');

async function input(params, method = 'Input.dispatchMouseEvent') {
  const targets = await (await fetch(`http://127.0.0.1:${process.env.APC_CDP_PORT}/json/list`)).json();
  const target = targets.find(item => item.type === 'page' && item.url.includes('workbench.html'));
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  try {
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out sending ${method}`)), 10000);
      socket.addEventListener('message', event => { clearTimeout(timer); resolve(JSON.parse(event.data)); }, { once: true });
    });
    socket.send(JSON.stringify({ id: 1, method, params }));
    assert.ok(!(await response).error);
  } finally { socket.close(); }
}

exports.run = async () => {
  await vscode.commands.executeCommand('workbench.view.explorer');
  await vscode.window.showTextDocument(vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'file-000.txt'));
  const cdp = await connect(process.env.APC_CDP_PORT);
  const snapshot = () => cdp.evaluate(`(() => {
    const box = selector => { const e=document.querySelector(selector); if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right,font:getComputedStyle(e).fontFamily,fontSize:getComputedStyle(e).fontSize,parentHeight:e.parentElement.getBoundingClientRect().height,parentWidth:e.parentElement.getBoundingClientRect().width}; };
    const rows=[...document.querySelectorAll('.explorer-folders-view .monaco-list-row')].slice(0,4).map(e=>({top:parseFloat(e.style.top),height:e.getBoundingClientRect().height}));
    return {rows,sidebar:box('.part.sidebar'),header:box('.part.sidebar > .title'),content:box('.part.sidebar > .content'),status:box('.part.statusbar'),activity:box('.part.activitybar'),editor:box('.part.editor'),panel:box('.part.panel'),tabs:box('.editor-group-container .tabs-container'),font:box('.monaco-workbench').font};
  })()`);
  try {
    const initial = await eventually(async () => { const s = await snapshot(); return s.rows.length > 3 && s.rows.every(r => r.height === 40) && s; }, 'Custom row sizing did not reach real Explorer');
    console.log('INITIAL CUSTOMIZATIONS', JSON.stringify(initial));
    assert.deepEqual(initial.rows.map(r => r.top), [0, 40, 80, 120]);
    assert.equal(initial.font, 'Georgia');
    assert.equal(initial.status.font, 'monospace');
    assert.equal(initial.status.fontSize, '17px');
    assert.equal(await cdp.evaluate(`getComputedStyle(document.querySelector('.editor-group-container > .title .label-name')).fontSize`), '19px');
    assert.equal(await cdp.evaluate(`getComputedStyle(document.querySelector('.part.sidebar > .title h2')).fontSize`), '18px');
    assert.equal(await cdp.evaluate(`getComputedStyle(document.querySelector('.explorer-folders-view .monaco-list-row .label-name')).fontSize`), '17px');
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
    console.log('PASS: actual pointer selection hits the resized row.');
    await input({ type: 'mouseWheel', x: target.x, y: target.y, deltaX: 0, deltaY: 650 });
    await eventually(() => cdp.evaluate(`Number(document.querySelector('.explorer-folders-view .monaco-list-row')?.dataset.index) > 0`), 'Real wheel input did not scroll the measured list');
    await input({ type: 'mouseWheel', x: target.x, y: target.y, deltaX: 0, deltaY: -10000 });
    await eventually(() => cdp.evaluate(`document.querySelector('.explorer-folders-view .monaco-list-row')?.dataset.index === '0'`), 'Explorer did not scroll back to its first resized row');
    console.log('PASS: actual wheel input scrolls the resized virtual list in both directions.');
    await cdp.evaluate(`globalThis.__apcCustomizations.configure({listRow:{height:30,lists:['explorer-folders-view']},statusBar:{height:32,position:'top'},activityBar:{size:56},header:{height:36},'sidebar.titlebar':{height:40}});true`);
    const updated = await eventually(async () => { const s = await snapshot(); return s.rows.length > 3 && s.rows.every(r => r.height === 30) && s; }, 'Live list height update failed');
    assert.deepEqual(updated.rows.map(r => r.top), [0, 30, 60, 90]);
    assert.equal(updated.status.height, 32);
    assert.equal(updated.status.y, 0);
    assert.equal(updated.status.parentHeight, 32);
    await cdp.evaluate(`globalThis.__apcCustomizations.configure({listRow:{height:30,lists:['explorer-folders-view']},statusBar:{height:32,position:'top'},activityBar:{size:56,position:'bottom'}});true`);
    const bottom = await eventually(async () => { const s = await snapshot(); return s.activity.parentWidth > 1000 && s; }, 'Activity bar did not enter a full-width grid row');
    assert.equal(bottom.activity.parentHeight, 56);
    assert.ok(bottom.editor.bottom <= bottom.activity.y, 'Horizontal activity bar must have its own reserved row');
    const buttons = await eventually(() => cdp.evaluate(`(() => {const items=[...document.querySelectorAll('.part.activitybar .composite-bar .action-item')].filter(e=>e.getBoundingClientRect().width>0);return items.length>=2 && items.slice(0,3).map(e=>({x:e.getBoundingClientRect().x,centerY:e.getBoundingClientRect().y+e.getBoundingClientRect().height/2}));})()`), 'Horizontal view switcher did not populate');
    console.log('BOTTOM ACTIVITY', JSON.stringify(bottom), JSON.stringify(buttons));
    assert.ok(buttons.length >= 2 && buttons[1].x > buttons[0].x && Math.abs(buttons[1].centerY - buttons[0].centerY) < 2, 'Activity buttons must lay out horizontally');
    assert.equal(await cdp.evaluate(`(() => {const item=document.querySelector('.part.activitybar .composite-bar .action-item');const e=item.querySelector('[tabindex]')||item;e.focus();globalThis.__apcFirstActivityFocus=document.activeElement;return !!document.activeElement?.closest('.part.activitybar .composite-bar');})()`), true, 'The view switcher must receive keyboard focus');
    await input({ type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }, 'Input.dispatchKeyEvent');
    await input({ type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }, 'Input.dispatchKeyEvent');
    assert.equal(await cdp.evaluate(`document.activeElement !== globalThis.__apcFirstActivityFocus && !!document.activeElement?.closest('.part.activitybar')`), true, 'Horizontal activity navigation must respond to ArrowRight');
    if ((await vscode.commands.getCommands(true)).includes('notifications.clearAll')) {
      await vscode.commands.executeCommand('notifications.clearAll');
    }
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(process.env.APC_CUSTOMIZATIONS_RESULTS.replace(/\.json$/, '.png'), Buffer.from(screenshot.data, 'base64'));
    await cdp.evaluate(`globalThis.__apcCustomizations.configure({activityBar:{size:56,position:'bottom'},statusBar:{height:32,position:'editor-top'}});true`);
    const editorTop = await snapshot();
    assert.ok(editorTop.status.bottom <= editorTop.editor.y && editorTop.editor.y - editorTop.status.bottom <= 8, 'Editor-top status bar must reserve space above the editor');
    assert.ok(editorTop.status.x >= editorTop.sidebar.right, 'Editor-relative status bar must not span the sidebar');
    await cdp.evaluate(`globalThis.__apcCustomizations.configure({activityBar:{size:56,position:'bottom'},statusBar:{height:32,position:'editor-bottom'}});true`);
    const editorBottom = await snapshot();
    assert.ok(editorBottom.editor.bottom <= editorBottom.status.y && editorBottom.status.y - editorBottom.editor.bottom <= 8, 'Editor-bottom status bar must reserve space below the editor');
    const output = vscode.window.createOutputChannel('APC Layout');
    output.appendLine('Panel placement check');
    output.show();
    const panelBottom = await eventually(async () => { const s = await snapshot(); return s.panel.height > 30 && s.status.y >= s.panel.bottom && s; }, 'Editor-bottom status bar must follow a visible bottom panel');
    await vscode.commands.executeCommand('workbench.action.closePanel');
    output.dispose();
    await cdp.evaluate(`document.getElementById('apc-customizations-test-styles').remove();globalThis.__apcCustomizations.configure({});true`);
    const restored = await eventually(async () => { const s = await snapshot(); return s.rows.length > 3 && s.rows.every(r => r.height === 22) && s; }, 'Removing list configuration must restore delegate heights');
    assert.deepEqual(restored.rows.map(r => r.top), [0, 22, 44, 66]);
    assert.notEqual(restored.font, 'Georgia');
    assert.notEqual(restored.status.font, 'monospace');
    assert.equal(restored.activity.parentWidth, 48);
    assert.equal(restored.status.width, initial.status.width);
    assert.ok(restored.status.y >= restored.editor.bottom);
    assert.ok(restored.header.height < 48);
    fs.writeFileSync(process.env.APC_CUSTOMIZATIONS_RESULTS, JSON.stringify({ version: vscode.version, initial, updated, bottom, editorTop, editorBottom, panelBottom, restored }, null, 2));
    console.log('PASS: fonts, measured list geometry/live removal, header bounds, native activity/status grid sizes, horizontal activity keyboard navigation, and all status positions.');
  } finally { cdp.close(); }
};
