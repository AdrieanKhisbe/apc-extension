const assert = require('node:assert/strict');
const fs = require('node:fs');
const vscode = require('vscode');
const { connect, eventually } = require('./cdp');

exports.run = async function () {
  await vscode.extensions.getExtension('drcika.apc-extension').activate();
  const cdp = await connect(process.env.APC_CDP_PORT);
  try {
    await eventually(() => cdp.evaluate(`globalThis.__apcTestRuns === 1 && getComputedStyle(document.body).getPropertyValue('--apc-test-color').trim() === 'updated'`), 'Imports did not survive reopening the editor');
    await vscode.commands.executeCommand('apc.extension.enable');
    assert.equal(await cdp.evaluate('globalThis.__apcTestRuns'), 1, 'Repeated enable must not re-execute JS');
    await vscode.commands.executeCommand('apc.extension.disable');
    assert.equal(fs.readFileSync(process.env.APC_HTML, 'base64'), process.env.APC_ORIGINAL_HTML);
    console.log('PASS: imports survive reopening; repeated enable and disable restore the original HTML.');
  } finally { cdp.close(); }
};
