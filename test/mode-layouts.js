const assert = require('node:assert/strict');
const vscode = require('vscode');
const { eventually } = require('./cdp');

// Enter real workbench modes through commands; observe rendered allocations.
exports.run = async function (cdp, configure) {
  const settings = vscode.workspace.getConfiguration();
  const keys = ['zenMode.fullScreen', 'zenMode.centerLayout', 'zenMode.hideActivityBar', 'zenMode.hideStatusBar', 'zenMode.showTabs'];
  const original = new Map(keys.map(key => [key, settings.inspect(key)?.globalValue]));
  let inZen = false;
  const snapshot = () => cdp.evaluate(`(() => {
    const box=selector=>{const node=document.querySelector(selector);if(!node)return {visible:false,width:0,height:0};const r=node.getBoundingClientRect();const grid=node.parentElement.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,visible:node.checkVisibility()&&grid.width>0&&grid.height>0,gridWidth:grid.width,gridHeight:grid.height};};
    return {fullscreen:document.querySelector('.monaco-workbench').classList.contains('fullscreen'),editor:box('.part.editor'),sidebar:box('.part.sidebar'),activity:box('.part.activitybar'),status:box('.part.statusbar'),tabs:box('.editor-group-container .tabs-container')};
  })()`);
  const reports = {};
  try {
    for (const [key, value] of Object.entries({ 'zenMode.fullScreen': false, 'zenMode.centerLayout': true, 'zenMode.hideActivityBar': true, 'zenMode.hideStatusBar': true, 'zenMode.showTabs': 'none' })) {
      await settings.update(key, value, vscode.ConfigurationTarget.Global);
    }
    await vscode.commands.executeCommand('workbench.view.explorer');
    await configure({ activityBar: { size: 56, position: 'bottom' }, statusBar: { height: 32, position: 'editor-bottom' }, header: { height: 42 } });
    reports.before = await snapshot();
    await vscode.commands.executeCommand('workbench.action.toggleZenMode'); inZen = true;
    reports.zen = await eventually(async () => {
      const s = await snapshot();
      assert.equal(s.fullscreen, false, 'Zen mode must respect fullScreen=false');
      assert.equal(s.activity.visible, false, 'Zen mode must hide the custom horizontal activity bar');
      assert.equal(s.status.visible, false, 'Zen mode must hide the editor-relative status bar');
      assert.equal(s.sidebar.visible, false, 'Zen mode must hide the sidebar');
      assert.ok(s.editor.width > 500 && s.editor.height > 300, 'Zen mode must preserve a usable editor: ' + JSON.stringify(s));
      assert.ok(!s.tabs.visible || s.tabs.height === 0, 'Zen mode must hide custom-height tabs');
      return s;
    }, 'Custom layout must respect Zen mode visibility');
    await vscode.commands.executeCommand('workbench.action.toggleZenMode'); inZen = false;
    reports.restored = await eventually(async () => {
      const s = await snapshot();
      assert.ok(s.sidebar.visible && s.sidebar.width > 100, 'Leaving Zen mode must restore the sidebar');
      assert.ok(s.activity.visible && s.activity.gridWidth > 1000, 'Leaving Zen mode must restore horizontal activity allocation');
      assert.equal(s.activity.gridHeight, 56);
      assert.equal(s.status.height, 32);
      assert.equal(s.tabs.height, 42);
      assert.ok(s.status.y >= s.editor.bottom - 1 && s.status.bottom <= s.activity.y + 1, 'Leaving Zen mode must restore non-overlapping editor/status/activity bounds: ' + JSON.stringify(s));
      return s;
    }, 'Leaving Zen mode must restore APC sizes and placement');
    console.log('PASS: real Zen mode hides custom bars/tabs and restores measured layout.');
    return reports;
  } finally {
    if (inZen) { await vscode.commands.executeCommand('workbench.action.toggleZenMode'); }
    for (const [key, value] of original) { await settings.update(key, value, vscode.ConfigurationTarget.Global); }
  }
};
