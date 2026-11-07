const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { eventually } = require('./cdp');

exports.run = async function () {
  await vscode.extensions.getExtension('drcika.apc-extension').activate();
  const panels = [];
  let sequence = 0;
  async function inspect() {
    const panel = vscode.window.createWebviewPanel('apc-webview-integration', 'APC webview test', vscode.ViewColumn.One, { enableScripts: true });
    panels.push(panel);
    let result;
    const message = panel.webview.onDidReceiveMessage(value => { result = value; });
    const nonce = `apc-test-${++sequence}`;
    panel.webview.html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'none'; script-src 'nonce-${nonce}';"></head><body>
<script>globalThis.apcUnauthorized = true;</script>
<script nonce="${nonce}">const api = acquireVsCodeApi();
setInterval(() => { let isolated = false; try { void top.document.body; } catch { isolated = true; }
api.postMessage({ marker: getComputedStyle(document.body).getPropertyValue('--apc-webview-test').trim(), unauthorized: !!globalThis.apcUnauthorized, isolated }); }, 100);</script></body></html>`;
    await eventually(() => result, 'Webview did not report its rendered style');
    message.dispose();
    assert.equal(result.unauthorized, false, 'APC styles must not permit unauthorized scripts');
    assert.equal(result.isolated, true, 'Webview must remain isolated from the workbench');
    return result.marker;
  }
  const config = vscode.workspace.getConfiguration();
  const original = config.get('apc.iframe.style');
  const style = path.join(process.env.APC_FIXTURE, 'webview.css');
  const template = process.env.APC_WEBVIEW_TEMPLATE;
  const backup = fs.readFileSync(process.env.APC_WEBVIEW_BACKUP);
  try {
    assert.equal(await inspect(), 'baseline', 'Configured webview CSS must load after startup');
    for (let revision = 1; revision <= 4; revision++) {
      const marker = `updated-${revision}`;
      fs.writeFileSync(style + '.tmp', `body { --apc-webview-test: ${marker}; }`);
      fs.renameSync(style + '.tmp', style);
      await eventually(() => fs.readFileSync(template, 'utf8').includes(`--apc-webview-test: ${marker}`), `Atomic webview CSS save ${revision} did not publish`);
      assert.equal(await inspect(), marker, 'New webviews must receive each successive atomic CSS save');
    }
    await config.update('apc.iframe.style', { body: { '--apc-webview-test': 'object' } }, vscode.ConfigurationTarget.Global);
    await eventually(() => fs.readFileSync(template, 'utf8').includes('--apc-webview-test: object'), 'Webview stylesheet object was not published');
    assert.equal(await inspect(), 'object');
    await config.update('apc.iframe.style', undefined, vscode.ConfigurationTarget.Global);
    await eventually(() => fs.readFileSync(template).equals(backup), 'Removing webview settings must restore the exact template');
    assert.equal(await inspect(), '', 'New webviews must no longer receive removed CSS');
    console.log('PASS: webview startup, atomic CSS saves, configuration changes, removal, exact restoration, CSP script controls and origin isolation.');
  } finally {
    panels.forEach(panel => panel.dispose());
    await config.update('apc.iframe.style', original, vscode.ConfigurationTarget.Global);
    await eventually(() => !fs.readFileSync(template).equals(backup), 'Restored webview setting was not republished');
  }
};
