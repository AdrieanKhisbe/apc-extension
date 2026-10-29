import * as vscode from 'vscode';

import { applyButtons, disposeButtons } from './buttons/button';
import * as customizations from './customizations.json';
import { ensurePatch, uninstallPatch, install, appendIframeStyles, disposePatch, updateImports } from './patch';
import { promptRestart } from './utils';

async function changeTheme() {
  const config = vscode.workspace.getConfiguration();
  const apcTheme = config.get<Array<{ color: string; tokens: string[]; }>>('apc.theme');
  const colorCustomizations = config.get<any>('workbench.colorCustomizations') || {};
  const customeTheme = apcTheme || customizations.theme;
  customeTheme.forEach(({ color, tokens }) => {
    tokens.forEach(token => {
      colorCustomizations[token] = color;
    });
  });
  await config.update('workbench.colorCustomizations', colorCustomizations, true);
}

function reportError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  void vscode.window.showErrorMessage(`Apc Extension failed: ${message}`);
}

export async function activate(context: vscode.ExtensionContext) {
  let isRunning = false;
  context.subscriptions.push({ dispose: disposePatch }, { dispose: disposeButtons });
  context.subscriptions.push(vscode.commands.registerCommand('apc.extension.enable', async () => {
    try {
      await install(context);
      await appendIframeStyles();
      await context.globalState.update('isEnabled', true);
      isRunning = true;
      applyButtons(context);
    } catch (error) {
      reportError(error);
      throw error;
    }
  }));
  context.subscriptions.push(vscode.commands.registerCommand('apc.extension.disable', async () => {
    try {
      await uninstallPatch();
      await context.globalState.update('isEnabled', false);
      isRunning = false;
      disposeButtons();
    } catch (error) {
      reportError(error);
      throw error;
    }
  }));

  async function onDidChangeConfiguration(e: vscode.ConfigurationChangeEvent) {
    if (!isRunning || context.globalState.get('isEnabled') !== true) { return; }
    try {
      if (e.affectsConfiguration('apc.theme')) { await changeTheme(); }
      e.affectsConfiguration('apc.buttons') && applyButtons(context);
      if (e.affectsConfiguration('apc.imports') || e.affectsConfiguration('apc.stylesheet')) { await updateImports(context); }
      if (e.affectsConfiguration('apc.iframe.style')) { await appendIframeStyles(); }
      if (e.affectsConfiguration('apc.electron') || e.affectsConfiguration('apc.menubar.compact')) { await promptRestart(); }
    } catch (error) { reportError(error); }
  }
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(onDidChangeConfiguration));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
    if (isRunning) { applyButtons(context); }
  }));

  // Commands remain registered even when the application's layout is unsupported
  // or patching fails. Handle startup failures instead of rejecting activation.
  if (context.globalState.get('isEnabled') !== false) {
    try {
      await ensurePatch(context);
      await appendIframeStyles();
      await context.globalState.update('isEnabled', true);
      isRunning = true;
    } catch (error) { reportError(error); }
  }

  applyButtons(context);
}

export function deactivate() {
  // uninstallPatch();
}
