const assert = require('node:assert/strict');
const fs = require('node:fs');
const vscode = require('vscode');
const { eventually } = require('./cdp');

// Enter real workbench modes through commands; observe rendered allocations.
exports.run = async function (cdp, configure) {
  const settings = vscode.workspace.getConfiguration();
  const keys = ['zenMode.fullScreen', 'zenMode.centerLayout', 'zenMode.hideActivityBar', 'zenMode.hideStatusBar', 'zenMode.showTabs'];
  const original = new Map(keys.map(key => [key, settings.inspect(key)?.globalValue]));
  let inZen = false;
  const snapshot = async () => ({ ...await cdp.evaluate(`(() => {
    const box=selector=>{const node=document.querySelector(selector);if(!node)return {visible:false,width:0,height:0};const r=node.getBoundingClientRect();const grid=node.parentElement.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,visible:node.checkVisibility()&&grid.width>0&&grid.height>0,gridWidth:grid.width,gridHeight:grid.height};};
    return {fullscreen:document.querySelector('.monaco-workbench').classList.contains('fullscreen'),editor:box('.part.editor'),sidebar:box('.part.sidebar'),activity:box('.part.activitybar'),status:box('.part.statusbar'),tabs:box('.editor-group-container .tabs-container')};
  })()`), native: JSON.parse(fs.readFileSync(process.env.APC_NATIVE_MODE_RESULTS, 'utf8')) });
  const reports = {};
  function nativeSettled(s, fullscreen) {
    assert.equal(s.native.fullscreen, fullscreen, 'Wait for the native fullscreen getter: ' + JSON.stringify(s.native));
    const last = s.native.events.filter(event => event.event === 'entered' || event.event === 'left').at(-1);
    assert.equal(last?.event, fullscreen ? 'entered' : 'left', 'Wait for the matching completed native transition: ' + JSON.stringify(s.native));
  }
  async function placed(fullscreen, top = false) {
    return eventually(async () => {
      const s = await snapshot();
      assert.equal(s.fullscreen, fullscreen, 'Native fullscreen transition must reach the workbench');
      nativeSettled(s, fullscreen);
      assert.ok(s.editor.width > 500 && s.editor.height > 300, 'Mode transition must preserve usable editor bounds: ' + JSON.stringify(s));
      assert.ok(s.activity.visible && s.activity.gridWidth > 1000);
      assert.equal(s.activity.gridHeight, 56);
      assert.equal(s.status.height, 32);
      assert.equal(s.tabs.height, 42);
      if (top) { assert.equal(s.status.y, 0, 'Global status bar must stay at the top in fullscreen'); }
      else { assert.ok(s.status.y >= s.editor.bottom - 1 && s.status.bottom <= s.activity.y + 1, 'Editor-relative status must keep its reserved row: ' + JSON.stringify(s)); }
      return s;
    }, `Custom grid must survive ${fullscreen ? 'entering' : 'leaving'} fullscreen`, 30000);
  }
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
    await vscode.commands.executeCommand('workbench.action.toggleFullScreen');
    reports.fullscreen = await placed(true);
    await configure({ activityBar: { size: 56, position: 'bottom' }, statusBar: { height: 32, position: 'top' }, header: { height: 42 } });
    reports.fullscreenUpdated = await placed(true, true);
    await vscode.commands.executeCommand('workbench.action.toggleFullScreen');
    reports.fullscreenRestored = await placed(false, true);
    console.log('PASS: native fullscreen enter/exit retains custom sizes and live status placement.');

    await configure({ activityBar: { size: 56, position: 'bottom' }, statusBar: { height: 32, position: 'editor-bottom' }, header: { height: 42 } });
    await settings.update('zenMode.fullScreen', true, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand('workbench.action.toggleZenMode'); inZen = true;
    reports.zenFullscreen = await eventually(async () => {
      const s = await snapshot();
      assert.equal(s.fullscreen, true, 'Zen mode must enter native fullscreen when requested');
      nativeSettled(s, true);
      assert.ok(!s.sidebar.visible && !s.activity.visible && !s.status.visible, 'Fullscreen Zen mode must hide all configured bars: ' + JSON.stringify(s));
      assert.ok(!s.tabs.visible || s.tabs.height === 0);
      assert.ok(s.editor.width > 500 && s.editor.height > 300);
      return s;
    }, 'Zen mode must combine hidden parts with native fullscreen', 30000);
    await vscode.commands.executeCommand('workbench.action.toggleZenMode'); inZen = false;
    reports.zenFullscreenRestored = await placed(false);
    console.log('PASS: fullscreen Zen mode exits to the original measured grid.');
    return reports;
  } finally {
    if (inZen) {
      await vscode.commands.executeCommand('workbench.action.toggleZenMode');
      await eventually(async () => { const s = await snapshot(); return !s.fullscreen && !s.native.fullscreen; }, 'Zen cleanup must finish leaving native fullscreen', 30000);
    }
    if ((await snapshot()).fullscreen) {
      await vscode.commands.executeCommand('workbench.action.toggleFullScreen');
      await eventually(async () => { const s = await snapshot(); return !s.fullscreen && !s.native.fullscreen; }, 'Cleanup must leave fullscreen', 30000);
    }
    for (const [key, value] of original) { await settings.update(key, value, vscode.ConfigurationTarget.Global); }
  }
};
