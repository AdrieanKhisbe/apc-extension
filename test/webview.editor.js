const vscode = require('vscode');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { prepareWebview, getWebviewStyleFiles } = require('../dist/webview');
const { eventually } = require('./cdp');

exports.run = async () => {
  const phase = process.env.APC_WEBVIEW_PHASE;
  const file = require('node:path').join(vscode.env.appRoot, 'out/vs/workbench/contrib/webview/browser/pre/index.html');
  const original = fs.readFileSync(process.env.APC_WEBVIEW_ORIGINAL, 'utf8');
  const originals = new Map([[file, original]]);
  const settings = vscode.workspace.getConfiguration();
  const reports = [];
  const expected = { baseline: '', installed: 'installed', 'file-updated': 'file-updated', restored: '' }[phase];
  const script = `<script nonce="fixture-script">const api = acquireVsCodeApi(); addEventListener('message', event => { if (event.data === 'remove-default-style') document.getElementById('_defaultStyles')?.remove(); }); setInterval(() => api.postMessage({ generation: document.body.dataset.fixtureGeneration, marker: getComputedStyle(document.body).getPropertyValue('--apc-webview-test').trim(), owned: getComputedStyle(document.body).getPropertyValue('--owned-style').trim(), csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]').content, blockedScriptRan: !!globalThis.__blockedScriptRan, topDocumentAccessible: (() => { try { return !!top.document.body; } catch { return false; } })(), theme: document.body.dataset.vscodeThemeKind }), 150);</script>`;
  for (const policy of ["'unsafe-inline'", "'nonce-owned-style'", "'none'"]) {
    const csp = `default-src 'none'; script-src 'nonce-fixture-script'; style-src ${policy};`;
    const html = `<html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><style nonce="owned-style">body { --owned-style: works; }</style></head><body data-fixture-generation="initial">Webview fixture<script>globalThis.__blockedScriptRan = true;</script>${script}</body></html>`;
    const panel = vscode.window.createWebviewPanel('apc-webview-fixture', 'APC webview test', vscode.ViewColumn.One, { enableScripts: true });
    const messages = [];
    const listener = panel.webview.onDidReceiveMessage(message => messages.push(message));
    const wait = predicate => eventually(() => messages.find(predicate), `No webview report for ${phase} ${policy}: ${JSON.stringify(messages)}`);
    try {
      panel.webview.html = html;
      const initial = await wait(message => message.csp === csp);
      assert.equal(initial.marker, expected);
      assert.equal(initial.blockedScriptRan, false, 'Unconfigured inline scripts remain blocked');
      assert.equal(initial.topDocumentAccessible, false, 'Webview cannot access workbench DOM');
      assert.equal(initial.owned, policy === "'none'" ? '' : 'works');
      await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default Light Modern', vscode.ConfigurationTarget.Global);
      const themed = await wait(message => message.theme === 'vscode-light');
      assert.equal(themed.marker, expected);
      let removed;
      if (expected) {
        messages.length = 0; await panel.webview.postMessage('remove-default-style');
        removed = await wait(message => message.marker === '');
      }
      messages.length = 0; panel.webview.html = html.replace('data-fixture-generation="initial"', 'data-fixture-generation="recreated"');
      const recreated = await wait(message => message.csp === csp && message.generation === 'recreated');
      assert.equal(recreated.marker, expected);
      reports.push({ policy, initial, themed, removed, recreated });
    } finally { listener.dispose(); panel.dispose(); }
  }
  const lifecycles = await require('./webview-lifecycles').run(expected);
  const publish = () => {
    const changes = prepareWebview({}, originals);
    for (const [target, text] of changes) { fs.writeFileSync(target, text); }
  };
  if (phase === 'baseline') {
    await settings.update('apc.iframe.style', { body: { '--apc-webview-test': 'installed' } }, vscode.ConfigurationTarget.Global);
    publish(); assert.notEqual(fs.readFileSync(file, 'utf8'), original);
  } else if (phase === 'installed') {
    const style = process.env.APC_WEBVIEW_STYLE;
    fs.writeFileSync(style, 'body { --apc-webview-test: file-initial; }');
    await settings.update('apc.iframe.style', style, vscode.ConfigurationTarget.Global);
    assert.deepEqual([...getWebviewStyleFiles()], [style]);
    publish();
    const before = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(style + '.tmp', 'body { --apc-webview-test: file-updated; }'); fs.renameSync(style + '.tmp', style);
    publish(); assert.notEqual(fs.readFileSync(file, 'utf8'), before, 'Atomic file save is read on refresh');
  } else if (phase === 'file-updated') {
    await settings.update('apc.iframe.style', undefined, vscode.ConfigurationTarget.Global);
    publish(); assert.equal(fs.readFileSync(file, 'utf8'), original);
  } else { assert.equal(fs.readFileSync(file, 'utf8'), original); }
  fs.writeFileSync(process.env.APC_WEBVIEW_OUTPUT, JSON.stringify({ phase, vscode: vscode.version, platform: process.platform, arch: process.arch, reports, lifecycles }, null, 2));
  console.log(`PASS: real webview policies, theme, recreation and ${phase} lifecycle`);
};
