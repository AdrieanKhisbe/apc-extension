const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { connect, eventually } = require('./cdp');

exports.run = async function (expected) {
  const cdp = await connect(process.env.APC_CDP_PORT);
  const sessions = new Map();
  const config = vscode.workspace.getConfiguration('workbench');
  const originalTheme = config.inspect('colorTheme')?.globalValue;
  const file = vscode.Uri.file(path.join(path.dirname(process.env.APC_WEBVIEW_STYLE), 'preview.md'));
  fs.writeFileSync(file.fsPath, '# APC Markdown fixture\n\nInitial preview content.\n<script>globalThis.apcMarkdownUnsafe=true;</script>');
  // Read the actual built-in preview via CDP. No scripts/styles are injected into
  // Markdown's document and its resource/CSP settings remain at their defaults.
  async function inspect(heading, theme) {
    return eventually(async () => {
      const { targetInfos } = await cdp.send('Target.getTargets');
      for (const target of targetInfos.filter(item => item.type === 'iframe' && item.url.startsWith('vscode-webview:'))) {
        if (!sessions.has(target.targetId)) {
          const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
          sessions.set(target.targetId, sessionId);
        }
        const result = await cdp.send('Runtime.evaluate', { expression: `(() => {
          const documents=[document];for(const frame of document.querySelectorAll('iframe')){try{if(frame.contentDocument)documents.push(frame.contentDocument);}catch{}}
          for(const doc of documents){if(doc.querySelector('h1')?.textContent===${JSON.stringify(heading)}){const win=doc.defaultView;let isolated=false;try{void win.top.document.body;}catch{isolated=true;}return {heading:doc.querySelector('h1').textContent,marker:win.getComputedStyle(doc.body).getPropertyValue('--apc-webview-test').trim(),theme:doc.body.dataset.vscodeThemeKind,unsafe:!!win.apcMarkdownUnsafe,isolated};}}return null;
        })()`, returnByValue: true }, sessions.get(target.targetId));
        if (result.exceptionDetails || !result.result.value) { continue; }
        const value = result.result.value;
        if (theme && value.theme !== theme) { continue; }
        assert.equal(value.marker, expected, 'Built-in Markdown preview must receive the configured webview CSS');
        assert.equal(value.unsafe, false, 'Markdown scripts must remain blocked');
        assert.equal(value.isolated, true, 'Markdown preview must remain isolated from the workbench');
        return value;
      }
      return false;
    }, `Built-in Markdown preview did not render ${heading} with the expected style/theme`);
  }
  try {
    await vscode.extensions.getExtension('vscode.markdown-language-features').activate();
    await vscode.commands.executeCommand('markdown.showPreview', file);
    const initial = await inspect('APC Markdown fixture');
    const document = await vscode.workspace.openTextDocument(file);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(file, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), '# APC Markdown updated\n\nUpdated through the source document.');
    assert.equal(await vscode.workspace.applyEdit(edit), true); await document.save();
    const updated = await inspect('APC Markdown updated');
    await vscode.commands.executeCommand('markdown.preview.refresh');
    const refreshed = await inspect('APC Markdown updated');
    await config.update('colorTheme', 'Default Dark Modern', vscode.ConfigurationTarget.Global);
    const dark = await inspect('APC Markdown updated', 'vscode-dark');
    await config.update('colorTheme', 'Default Light Modern', vscode.ConfigurationTarget.Global);
    const light = await inspect('APC Markdown updated', 'vscode-light');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await vscode.commands.executeCommand('markdown.showPreview', file);
    const reopened = await inspect('APC Markdown updated');
    console.log('PASS: built-in Markdown preview CSS survives source edits, refresh, dark/light changes and reopening without weakening isolation/CSP.');
    return { initial, updated, refreshed, dark, light, reopened };
  } finally {
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await config.update('colorTheme', originalTheme, vscode.ConfigurationTarget.Global);
    for (const sessionId of sessions.values()) { await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {}); }
    cdp.close();
  }
};
