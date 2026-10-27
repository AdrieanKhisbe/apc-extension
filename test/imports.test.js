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
    console.log('PASS: CSS/JS file URLs, import order, atomic save watching, configuration changes, stylesheet, removal, and no duplicate JS.');
  } finally { cdp.close(); }
};
