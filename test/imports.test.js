const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vscode = require('vscode');
const { connect, eventually } = require('./cdp');

exports.run = async function () {
  await vscode.extensions.getExtension('drcika.apc-extension').activate();
  const cdp = await connect(process.env.APC_CDP_PORT);
  const fixture = process.env.APC_FIXTURE;
  const color = () => cdp.evaluate(`getComputedStyle(document.body).getPropertyValue('--apc-test-color').trim()`);
  const config = vscode.workspace.getConfiguration();
  const original = config.get('apc.imports');
  try {
    await eventually(async () => (await color()) === 'baseline', 'CSS file URL import did not load');
    await eventually(() => cdp.evaluate('globalThis.__apcTestRuns === 1'), 'JS file URL import did not execute');
    assert.deepEqual(await cdp.evaluate('globalThis.__apcOrder'), ['first', 'second']);
    await eventually(() => cdp.evaluate(`globalThis.__apcExternalRuns === 1 && getComputedStyle(document.body).getPropertyValue('--apc-external').trim() === 'loaded'`), 'External object imports failed under the workbench CSP');
    const style = path.join(fixture, 'style.css');
    fs.writeFileSync(style + '.tmp', 'body { --apc-test-color: updated; }');
    fs.renameSync(style + '.tmp', style);
    await eventually(async () => (await color()) === 'updated', 'Atomic CSS save was not watched');
    assert.equal(await cdp.evaluate('globalThis.__apcTestRuns'), 1, 'CSS refresh must not re-execute JS');

    fs.writeFileSync(path.join(fixture, 'replacement.css'), 'body { --apc-test-color: replacement; }');
    await config.update('apc.imports', [pathToFileURL(path.join(fixture, 'replacement.css')).href, ...original.slice(1)], vscode.ConfigurationTarget.Global);
    await eventually(async () => (await color()) === 'replacement', 'Import configuration update did not reach renderer');
    await config.update('apc.stylesheet', { body: { '--apc-test-color': 'stylesheet' } }, vscode.ConfigurationTarget.Global);
    await eventually(async () => (await color()) === 'stylesheet', 'apc.stylesheet update did not reach renderer');
    await config.update('apc.stylesheet', undefined, vscode.ConfigurationTarget.Global);
    await config.update('apc.imports', [], vscode.ConfigurationTarget.Global);
    await eventually(async () => (await color()) === '', 'Removing imports must remove CSS');
    await config.update('apc.imports', original, vscode.ConfigurationTarget.Global);
    await eventually(async () => (await color()) === 'updated', 'Restoring imports did not reload CSS');
    assert.equal(await cdp.evaluate('globalThis.__apcTestRuns'), 1, 'Unchanged JS must run once per window');
    assert.equal(await cdp.evaluate('globalThis.__apcExternalRuns'), 1, 'Unchanged external JS must run once per window');

    // Exercise an imported script's visible behavior, not just its execution flag.
    const interactive = path.join(fixture, 'interactive.js');
    const buttonScript = label => `
      document.getElementById('apc-functional-button')?.remove();
      globalThis.__apcInteractiveRuns = (globalThis.__apcInteractiveRuns || 0) + 1;
      (() => {
        const button = document.createElement('button');
        button.id = 'apc-functional-button';
        button.textContent = '${label}';
        button.onclick = () => { button.textContent = '${label} clicked'; };
        document.querySelector('.monaco-workbench').appendChild(button);
      })();`;
    fs.writeFileSync(interactive, buttonScript('original'));
    await config.update('apc.imports', [...original, interactive], vscode.ConfigurationTarget.Global);
    await eventually(() => cdp.evaluate(`document.getElementById('apc-functional-button')?.textContent === 'original'`), 'Imported JS did not create the workbench button');
    assert.equal(await cdp.evaluate(`document.getElementById('apc-functional-button').click(); document.getElementById('apc-functional-button').textContent`), 'original clicked');
    fs.writeFileSync(interactive + '.tmp', buttonScript('updated'));
    fs.renameSync(interactive + '.tmp', interactive);
    await eventually(() => cdp.evaluate(`document.getElementById('apc-functional-button')?.textContent === 'updated'`), 'Atomic JS save did not update workbench behavior');
    assert.equal(await cdp.evaluate(`document.getElementById('apc-functional-button').click(); document.getElementById('apc-functional-button').textContent`), 'updated clicked');
    assert.equal(await cdp.evaluate('globalThis.__apcInteractiveRuns'), 2, 'Each changed script should execute once');

    const broken = path.join(fixture, 'broken.js');
    const following = path.join(fixture, 'following.js');
    fs.writeFileSync(broken, `throw new Error('APC intentional functional-test failure');`);
    fs.writeFileSync(following, `document.body.dataset.apcFollowingImport = 'loaded';`);
    await cdp.evaluate(`globalThis.__apcOriginalConsoleError = console.error; globalThis.__apcImportErrors = []; console.error = (...args) => { globalThis.__apcImportErrors.push(args.map(String).join(' ')); globalThis.__apcOriginalConsoleError(...args); };`);
    try {
      await config.update('apc.imports', [...original, broken, following], vscode.ConfigurationTarget.Global);
      await eventually(() => cdp.evaluate(`document.body.dataset.apcFollowingImport === 'loaded'`), 'One failing script prevented the next import from running');
      await eventually(() => cdp.evaluate(`globalThis.__apcImportErrors.some(message => message.includes('APC import failed:') && message.includes('broken.js') && message.includes('APC intentional functional-test failure'))`), 'Failed import did not report its original source and error');
    } finally {
      await cdp.evaluate(`console.error = globalThis.__apcOriginalConsoleError; document.getElementById('apc-functional-button')?.remove(); delete document.body.dataset.apcFollowingImport;`);
      await config.update('apc.imports', original, vscode.ConfigurationTarget.Global);
    }
    await eventually(async () => (await color()) === 'updated', 'Healthy CSS did not survive an import failure');
    assert.equal(await cdp.evaluate('globalThis.__apcTestRuns'), 1, 'Adding and editing scripts must not re-execute unchanged JS');
    console.log('PASS: imported JS creates a clickable workbench button, atomic JS saves update its behavior, and failed scripts report their source without blocking subsequent imports.');
    console.log('PASS: CSS/JS file URLs, import order, atomic save watching, configuration changes, stylesheet, removal, and no duplicate JS.');
  } finally { cdp.close(); }
};
