import * as vscode from 'vscode';

import { applyButtons, disposeButtons } from './buttons/button';
import * as customizations from './customizations.json';
import { ensurePatch, uninstallPatch, install, disposePatch, updateImports } from './patch';
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

type RuntimeState = { isRunning: boolean };

async function apcEnable(context: vscode.ExtensionContext, state: RuntimeState) {
  try {
    await install(context);
    await context.globalState.update('isEnabled', true);
    state.isRunning = true;
    applyButtons(context);
  } catch (error) {
    reportError(error);
    throw error;
  }
}

async function apcDisable(context: vscode.ExtensionContext, state: RuntimeState) {
  try {
    await uninstallPatch();
    await context.globalState.update('isEnabled', false);
    state.isRunning = false;
    disposeButtons();
  } catch (error) {
    reportError(error);
    throw error;
  }
}

export async function activate(context: vscode.ExtensionContext) {
  const state: RuntimeState = { isRunning: false };
  context.subscriptions.push({ dispose: disposePatch }, { dispose: disposeButtons });
  context.subscriptions.push(vscode.commands.registerCommand('apc.extension.enable', () => apcEnable(context, state)));
  context.subscriptions.push(vscode.commands.registerCommand('apc.extension.disable', () => apcDisable(context, state)));

  async function onDidChangeConfiguration(e: vscode.ConfigurationChangeEvent) {
    if (!state.isRunning || context.globalState.get('isEnabled') !== true) { return; }
    try {
      if (e.affectsConfiguration('apc.theme')) { await changeTheme(); }
      if (e.affectsConfiguration('apc.buttons')) { applyButtons(context); }
      const patchSettings = ['apc.imports', 'apc.stylesheet', 'apc.iframe.style', 'apc.electron', 'apc.menubar.compact',
        'apc.font.family', 'apc.monospace.font.family', 'apc.parts.font.family', 'apc.listRow',
        'apc.header', 'apc.sidebar.titlebar', 'apc.activityBar', 'apc.statusBar'];
      if (patchSettings.some(key => e.affectsConfiguration(key))) { await updateImports(context); }
      if (e.affectsConfiguration('apc.electron') || e.affectsConfiguration('apc.menubar.compact')) { await promptRestart(); }
    } catch (error) { reportError(error); }
  }
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(onDidChangeConfiguration));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
    if (state.isRunning) { applyButtons(context); }
  }));

  // Commands remain registered even when the application's layout is unsupported
  // or patching fails. Handle startup failures instead of rejecting activation.
  if (context.globalState.get('isEnabled') !== false) {
    try {
      await ensurePatch(context);
      await context.globalState.update('isEnabled', true);
      state.isRunning = true;
    } catch (error) { reportError(error); }
  }

  applyButtons(context);
}

export function deactivate() {
  // uninstallPatch();
}
