const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { connect, eventually } = require('./cdp');

exports.run = async function () {
  await vscode.extensions.getExtension('drcika.apc-extension').activate();
  const cdp = await connect(process.env.APC_CDP_PORT);
  const config = vscode.workspace.getConfiguration();
  const platform = process.platform === 'darwin' ? 'osx' : 'linux';
  const settings = ['apc.buttons', 'apc.theme', 'apc.statusBar', 'workbench.colorCustomizations',
    `terminal.integrated.profiles.${platform}`, `terminal.integrated.defaultProfile.${platform}`];
  const original = new Map(settings.map(key => [key, config.inspect(key)?.globalValue]));
  const update = (key, value) => config.update(key, value, vscode.ConfigurationTarget.Global);
  const colors = () => vscode.workspace.getConfiguration().get('workbench.colorCustomizations');
  const labels = () => cdp.evaluate(`Array.from(document.querySelectorAll('.statusbar-item')).map(node => node.textContent.trim()).filter(text => text.startsWith('APC check'))`);
  const click = label => cdp.evaluate(`Array.from(document.querySelectorAll('.statusbar-item')).find(node => node.textContent.trim() === ${JSON.stringify(label)})?.querySelector('a')?.click()`);
  const cssColor = token => cdp.evaluate(`getComputedStyle(document.querySelector('.monaco-workbench')).getPropertyValue(${JSON.stringify('--vscode-' + token.replaceAll('.', '-'))}).trim().toLowerCase()`);
  let clicks = 0;
  const command = vscode.commands.registerCommand('apc.test.button', () => { clicks++; });
  const terminals = [];
  const terminalListener = vscode.window.onDidOpenTerminal(terminal => terminals.push(terminal));
  const output = path.join(process.env.APC_FIXTURE, 'button-command.txt');
  const terminalCommand = `printf APC_TERMINAL_TEST > '${output.replaceAll("'", "'\\''")}'`;
  const generatedCommand = `apc.${terminalCommand.replace(/\s/g, '.')}`;
  try {
    // Exercise button creation at activation, before any configuration rebuild.
    await eventually(async () => (await labels()).includes('APC check startup'), 'Configured startup button was not shown');
    await click('APC check startup');
    await eventually(() => clicks === 1, 'Status bar click did not invoke the configured VS Code command');
    const fontFile = path.join(process.env.APC_FIXTURE, 'font-test.txt');
    fs.writeFileSync(fontFile, 'APC monospace test');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(fontFile)));
    await eventually(() => cdp.evaluate(`getComputedStyle(document.querySelector('.monaco-editor')).getPropertyValue('--monaco-monospace-font').trim() === 'monospace'`), 'Monospace override did not reach the editor scope');
    try {
      await eventually(() => cdp.evaluate(`(() => { const bar = document.querySelector('.part.activitybar'); const grid = bar.parentElement.getBoundingClientRect(); return grid.height === 56 && grid.width === document.querySelector('.monaco-workbench').getBoundingClientRect().width && document.querySelectorAll('.part.activitybar .composite-bar .action-item').length >= 2; })()`), 'Configured bottom activity bar must reserve a full row and populate navigation with compact menus enabled');
    } catch (error) {
      console.log('ACTIVITY STARTUP DIAGNOSTIC', await cdp.evaluate(`(() => {const bar=document.querySelector('.part.activitybar');const grid=bar.parentElement.getBoundingClientRect();return {width:grid.width,height:grid.height,workbenchWidth:document.querySelector('.monaco-workbench').getBoundingClientRect().width,items:document.querySelectorAll('.part.activitybar .composite-bar .action-item').length,content:bar.innerHTML.slice(0,4000)};})()`));
      throw error;
    }
    const menu = await cdp.evaluate(`(() => { const r = document.querySelector('.part.activitybar .menubar-menu-button').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height}; })()`);
    assert.ok(menu.width >= 20 && menu.height >= 20, 'Compact menu must remain a usable pointer target in the bottom bar');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x: menu.x, y: menu.y });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: menu.x, y: menu.y });
    await eventually(() => cdp.evaluate(`Array.from(document.querySelectorAll('.monaco-menu .action-label')).some(node => node.getBoundingClientRect().width > 0 && node.textContent.includes('File'))`), 'Compact menu did not open from the horizontal activity bar');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });

    await update('apc.buttons', [
      { text: 'APC check high', tooltip: 'APC test tooltip', vscommand: 'apc.test.button', priority: 100 },
      { text: 'APC check low', vscommand: 'apc.test.button', priority: 10 },
    ]);
    await eventually(async () => JSON.stringify(await labels()) === JSON.stringify(['APC check high', 'APC check low']), 'Button update must replace the old item and preserve priority order');
    await click('APC check high');
    await eventually(() => clicks === 2, 'Updated status bar button did not invoke its command');

    const statusHeight = () => cdp.evaluate(`(() => { const node = document.querySelector('.part.statusbar'); return [node.getBoundingClientRect().height, node.parentElement.getBoundingClientRect().height]; })()`);
    await eventually(async () => JSON.stringify(await statusHeight()) === '[30,30]', 'Initial status bar height must match its grid allocation');
    await update('apc.statusBar', { height: 36 });
    await eventually(async () => JSON.stringify(await statusHeight()) === '[36,36]', 'Live status height must resize the grid');
    await update('apc.statusBar', { height: 30 });
    await eventually(async () => JSON.stringify(await statusHeight()) === '[30,30]', 'Returning to a previous configuration must reapply it');

    // A real terminal command proves the generated registration is usable.
    await update(`terminal.integrated.profiles.${platform}`, { 'APC test shell': { path: '/bin/sh', args: [] } });
    await update(`terminal.integrated.defaultProfile.${platform}`, 'APC test shell');
    await update('apc.buttons', [{ text: 'APC check terminal', command: terminalCommand }]);
    await eventually(async () => (await labels()).includes('APC check terminal'), 'Terminal button was not rendered');
    await click('APC check terminal');
    await eventually(() => fs.existsSync(output) && fs.readFileSync(output, 'utf8') === 'APC_TERMINAL_TEST', 'Terminal button did not run its configured shell command', 30000);
    await update('apc.buttons', []);
    await eventually(async () => (await labels()).length === 0 && !(await vscode.commands.getCommands(true)).includes(generatedCommand), 'Removing buttons must dispose their items and generated commands');

    // Check published colors and real renderer output, including a second edit.
    await update('workbench.colorCustomizations', { 'editor.background': '#102030' });
    await update('apc.theme', [{ color: '#123456', tokens: ['statusBar.background', 'statusBar.noFolderBackground'] }]);
    await eventually(() => colors()['statusBar.background'] === '#123456', 'Theme configuration was not published');
    await eventually(async () => (await cssColor('statusBar.background')) === '#123456', 'Theme color did not reach the workbench');
    assert.equal(colors()['editor.background'], '#102030', 'APC must preserve unrelated user colors');
    await update('apc.theme', [{ color: '#654321', tokens: ['statusBar.background', 'statusBar.noFolderBackground'] }]);
    await eventually(async () => (await cssColor('statusBar.background')) === '#654321', 'Second theme edit did not update the renderer');

    await update('apc.buttons', [{ text: 'APC check disable', command: terminalCommand }]);
    await eventually(async () => (await labels()).includes('APC check disable'), 'Button missing before disable');
    await vscode.commands.executeCommand('apc.extension.disable');
    await eventually(async () => (await labels()).length === 0 && !(await vscode.commands.getCommands(true)).includes(generatedCommand), 'Disable must dispose buttons and generated commands');
    await update('apc.buttons', [{ text: 'APC check reenable', vscommand: 'apc.test.button' }]);
    await update('apc.theme', [{ color: '#abcdef', tokens: ['statusBar.background'] }]);
    // A configuration read after the next event turn checks disabled-state gating.
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.deepEqual(await labels(), [], 'Disabled APC must not recreate buttons');
    assert.deepEqual(colors(), { 'editor.background': '#102030' }, 'Disable must restore colors and ignore subsequent theme edits');
    await vscode.commands.executeCommand('apc.extension.enable');
    await eventually(async () => (await cssColor('statusBar.background')) === '#abcdef', 'Re-enable must apply the current theme immediately');
    await update('apc.theme', []);
    await eventually(() => JSON.stringify(colors()) === JSON.stringify({ 'editor.background': '#102030' }), 'Removing all theme tokens must restore previous colors');
    await eventually(async () => (await labels()).includes('APC check reenable'), 'Re-enable must recreate configured buttons');
    await click('APC check reenable');
    await eventually(() => clicks === 3, 'Re-enabled button command did not run');
    console.log('PASS: startup and live buttons, priority, clicks, terminal execution, removal/disable cleanup, re-enable, live theme colors, preservation, and disabled configuration gating.');
  } finally {
    await vscode.commands.executeCommand('apc.extension.disable');
    for (const [key, value] of original) { await update(key, value); }
    await vscode.commands.executeCommand('apc.extension.enable');
    terminalListener.dispose();
    terminals.forEach(terminal => terminal.dispose());
    command.dispose();
    cdp.close();
  }
};
