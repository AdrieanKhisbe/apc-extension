const assert = require('node:assert/strict');
const fs = require('node:fs');
const vscode = require('vscode');
const { connect, eventually } = require('./cdp');

exports.run = async function () {
  assert.equal(vscode.extensions.getExtension('drcika.apc-extension'), undefined, 'Restoration control must not load APC as a fresh install');
  const cdp = await connect(process.env.APC_CDP_PORT);
  try {
    await eventually(() => cdp.evaluate(`!!document.querySelector('.monaco-workbench')`), 'Restored workbench did not start');
    assert.equal(await cdp.evaluate('typeof globalThis.__apcModernImports'), 'undefined');
    assert.equal(await cdp.evaluate('typeof globalThis.__apcTestRuns'), 'undefined');
    assert.equal(await cdp.evaluate(`getComputedStyle(document.body).getPropertyValue('--apc-test-color').trim()`), '');
    assert.equal(fs.readFileSync(process.env.APC_HTML, 'base64'), process.env.APC_ORIGINAL_HTML, 'Disabled startup must not reinstall the patch');
    console.log('PASS: restored editor starts without APC renderer code or customizations.');
  } finally { cdp.close(); }
};
