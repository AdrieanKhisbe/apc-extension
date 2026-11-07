const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { eventually } = require('./cdp');

exports.run = async function (expected) {
  const disposables = [];
  const panels = [];
  const reports = {};
  let sequence = 0;
  function report(webview, kind) {
    const messages = [];
    const nonce = `lifecycle-${++sequence}`;
    webview.options = { enableScripts: true };
    disposables.push(webview.onDidReceiveMessage(value => messages.push(value)));
    webview.html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'none'; script-src 'nonce-${nonce}';"></head><body>${kind}
<script>globalThis.unauthorized = true;</script>
<script nonce="${nonce}">const api=acquireVsCodeApi();const boots=(api.getState()?.boots||0)+1;api.setState({boots});setInterval(()=>api.postMessage({kind:${JSON.stringify(kind)},boots,marker:getComputedStyle(document.body).getPropertyValue('--apc-webview-test').trim(),unauthorized:!!globalThis.unauthorized}),100);</script></body></html>`;
    return { messages, wait: () => eventually(() => messages.at(-1), `${kind} did not report after rendering`) };
  }
  function check(message) {
    assert.equal(message.marker, expected, `${message.kind}: APC CSS must survive this lifecycle`);
    assert.equal(message.unauthorized, false, `${message.kind}: unconfigured scripts stay blocked`);
    return message;
  }
  try {
    const retained = vscode.window.createWebviewPanel('apc-retained-fixture', 'APC retained panel', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
    panels.push(retained);
    const retainedReport = report(retained.webview, 'retained-panel');
    const before = check(await retainedReport.wait());
    const textFile = process.env.APC_WEBVIEW_STYLE + '.txt'; fs.writeFileSync(textFile, 'Hide the webview behind a text editor.');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(textFile)), { viewColumn: vscode.ViewColumn.One, preview: false });
    await eventually(() => !retained.visible, 'Retained panel did not become hidden');
    retainedReport.messages.length = 0;
    retained.reveal(vscode.ViewColumn.One);
    const revealed = check(await retainedReport.wait());
    assert.equal(revealed.boots, before.boots, 'A retained panel must preserve its script context');
    retainedReport.messages.length = 0;
    retained.reveal(vscode.ViewColumn.Two);
    await eventually(() => retained.viewColumn === vscode.ViewColumn.Two, 'Panel did not move to the second editor group');
    const moved = check(await retainedReport.wait());
    reports.retained = { before, revealed, moved };

    let custom;
    disposables.push(vscode.window.registerCustomTextEditorProvider('apc-tests.custom', {
      resolveCustomTextEditor(_document, panel) { panels.push(panel); custom = report(panel.webview, 'custom-text-editor'); },
    }));
    const customFile = path.join(path.dirname(process.env.APC_WEBVIEW_STYLE), 'custom.apcfixture'); fs.writeFileSync(customFile, 'custom editor fixture');
    await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(customFile), 'apc-tests.custom', { viewColumn: vscode.ViewColumn.One, preview: false });
    await eventually(() => custom, 'Custom text editor provider was not resolved');
    reports.customEditor = check(await custom.wait());

    let view; let viewReport;
    disposables.push(vscode.window.registerWebviewViewProvider('apc-tests.view', {
      resolveWebviewView(resolved) { view = resolved; viewReport = report(view.webview, 'sidebar-webview'); },
    }, { webviewOptions: { retainContextWhenHidden: true } }));
    await vscode.commands.executeCommand('apc-tests.view.focus');
    await eventually(() => view?.visible && viewReport, 'Sidebar webview provider was not resolved');
    const viewBefore = check(await viewReport.wait());
    await vscode.commands.executeCommand('workbench.action.closeSidebar');
    await eventually(() => !view.visible, 'Sidebar webview did not become hidden');
    viewReport.messages.length = 0;
    await vscode.commands.executeCommand('apc-tests.view.focus');
    const viewRevealed = check(await viewReport.wait());
    assert.equal(viewRevealed.boots, viewBefore.boots, 'Retained sidebar view must preserve its script context');
    reports.sidebarView = { before: viewBefore, revealed: viewRevealed };
    console.log('PASS: retained/revealed/moved panels, custom text editors, and sidebar webview providers preserve APC styles and script CSP.');
    return reports;
  } finally { panels.forEach(panel => panel.dispose()); disposables.forEach(item => item.dispose()); }
};
