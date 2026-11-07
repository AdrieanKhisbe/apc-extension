const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
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
    await vscode.commands.executeCommand('workbench.view.explorer');
    await vscode.window.showTextDocument(vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'outline-fixture.js'));
    await configure({ listRow: { height: 44, lists: ['outline-tree'] }, 'parts.font.family': { sidebar: 'monospace', tabs: 'monospace' } });
    await vscode.commands.executeCommand('outline.focus');
    reports.outline = await eventually(async () => {
      const rendered = await rows('.outline-tree .monaco-list-row');
      return rendered.length >= 3 && rendered.every(row => row.height === 44) && rendered;
    }, 'Outline symbols must use the configured measured height');
    const symbol = await cdp.evaluate(`(() => {const node=[...document.querySelectorAll('.outline-tree .monaco-list-row')].find(node=>node.textContent.includes('apcCoverageThree'));const r=node.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await input({ type: 'mousePressed', button: 'left', clickCount: 1, ...symbol });
    await input({ type: 'mouseReleased', button: 'left', clickCount: 1, ...symbol });
    await eventually(() => vscode.window.activeTextEditor?.selection.active.line === 4, 'Clicking a resized Outline row must reveal its symbol');
    assert.equal(await cdp.evaluate(`getComputedStyle(document.querySelector('.tabs-container')).fontFamily`), 'monospace');
    console.log('PASS: real Outline row measurement, tab fonts and pointer navigation.');

    const workspace = vscode.workspace.workspaceFolders[0].uri;
    const gitCommand = args => execFileSync('git', args, { cwd: workspace.fsPath });
    gitCommand(['init']); gitCommand(['add', '.']);
    gitCommand(['-c', 'user.name=APC Tests', '-c', 'user.email=apc-tests@example.invalid', 'commit', '-m', 'fixture']);
    fs.appendFileSync(path.join(workspace.fsPath, 'file-000.txt'), '\nchanged for SCM coverage');
    const git = (await vscode.extensions.getExtension('vscode.git').activate()).getAPI(1);
    const repository = await git.openRepository(workspace); assert.ok(repository); await repository.status();
    await configure({ listRow: { height: 42, lists: ['scm-view'] }, 'parts.font.family': { sidebar: 'monospace' } });
    await vscode.commands.executeCommand('workbench.view.scm');
    reports.scm = await eventually(async () => {
      const rendered = await rows('.scm-view .monaco-list-row');
      return rendered.some(row => row.text.includes('file-000.txt')) && rendered.filter(row => row.text.includes('file-000.txt')).every(row => row.height === 42) && rendered;
    }, 'SCM resources must use the configured measured height');
    console.log('PASS: real Git SCM resource rows use measured sizing.');

    const output = vscode.window.createOutputChannel('APC extended layouts');
    try {
      await configure({ activityBar: { size: 56, position: 'bottom' }, statusBar: { height: 32, position: 'editor-bottom' }, 'parts.font.family': { sidebar: 'monospace', panel: 'monospace' } });
      output.appendLine('Side-panel layout fixture'); output.show(true);
      await vscode.commands.executeCommand('workbench.action.moveSideBarRight');
      const geometry = () => cdp.evaluate(`(() => {const box=selector=>{const n=document.querySelector(selector);const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};return {editor:box('.part.editor'),sidebar:box('.part.sidebar'),panel:box('.part.panel'),status:box('.part.statusbar'),activity:box('.part.activitybar')};})()`);
      reports.sidePanels = {};
      for (const side of ['Right', 'Left']) {
        await vscode.commands.executeCommand('workbench.action.positionPanel' + side);
        const placed = await eventually(async () => {
          const g = await geometry();
          const beside = side === 'Right' ? g.panel.x >= g.editor.right - 1 : g.panel.right <= g.editor.x + 1;
          return g.panel.width > 50 && g.panel.height > 50 && beside && g.sidebar.x >= g.editor.right - 1 && Math.abs(g.status.width - g.editor.width) <= 1 && g.status.y >= g.editor.bottom - 1 && g.status.bottom <= g.activity.y + 1 && g;
        }, `Editor-relative status bar must stay below the editor with a ${side.toLowerCase()} panel and right sidebar`);
        reports.sidePanels[side.toLowerCase()] = placed;
      }
      assert.equal(await cdp.evaluate(`getComputedStyle(document.querySelector('.part.panel')).fontFamily`), 'monospace');
      await vscode.commands.executeCommand('workbench.action.closePanel');
      await vscode.commands.executeCommand('workbench.action.moveSideBarLeft');
      await vscode.commands.executeCommand('workbench.action.toggleStatusbarVisibility');
      await eventually(async () => (await geometry()).status.height === 0, 'Status bar must remain hideable after custom placement');
      await vscode.commands.executeCommand('workbench.action.toggleStatusbarVisibility');
      reports.statusRevealed = await eventually(async () => { const g = await geometry(); return g.status.height === 32 && g.status.y >= g.editor.bottom - 1 && g; }, 'Revealed status bar must retain its measured size and placement');
      console.log('PASS: left/right panels, right sidebar, panel fonts and status visibility preserve non-overlapping grid bounds.');
    } finally {
      output.dispose();
      await vscode.commands.executeCommand('workbench.action.closePanel');
      await vscode.commands.executeCommand('workbench.action.positionPanelBottom');
      await vscode.commands.executeCommand('workbench.action.moveSideBarLeft');
    }
    return reports;
  } finally {
    for (const [key, value] of original) { await config.update(key, value, vscode.ConfigurationTarget.Global); }
    await cdp.evaluate(`document.getElementById('apc-extended-styles')?.remove();globalThis.__apcCustomizations.configure({});true`);
  }
};
