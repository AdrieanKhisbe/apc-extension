import * as vscode from 'vscode';

import { applyButtons, disposeButtons } from './buttons/button';
import { createThemeManager, ThemeManager } from './theme';
import { ensurePatch, uninstallPatch, install, disposePatch, updateImports } from './patch';

function reportError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  void vscode.window.showErrorMessage(`Apc Extension failed: ${message}`);
}

type RuntimeState = { isRunning: boolean; theme: ThemeManager };

async function apcEnable(context: vscode.ExtensionContext, state: RuntimeState, startup = false) {
  let installed = false;
  const wasRunning = state.isRunning;
  try {
    await (startup ? ensurePatch(context) : install(context));
    installed = true;
    await state.theme.apply();
    await context.globalState.update('isEnabled', true);
    state.isRunning = true;
    applyButtons(context);
  } catch (error) {
    if (installed && !wasRunning) {
      try { await uninstallPatch(); await state.theme.restore(); }
      catch (rollbackError) { reportError(rollbackError); }
    }
    reportError(error);
    throw error;
  }
}

async function apcDisable(context: vscode.ExtensionContext, state: RuntimeState) {
  const wasRunning = state.isRunning;
  // Restoration can emit broad configuration events. Close the runtime gate
  // before awaiting it so those events cannot enqueue a fresh theme application.
  state.isRunning = false;
  try {
    await uninstallPatch();
    await state.theme.restore();
    await context.globalState.update('isEnabled', false);
    state.isRunning = false;
    disposeButtons();
  } catch (error) {
    state.isRunning = wasRunning;
    reportError(error);
    throw error;
  }
}

export async function activate(context: vscode.ExtensionContext) {
  const state: RuntimeState = { isRunning: false, theme: createThemeManager(context) };
  context.subscriptions.push({ dispose: disposePatch }, { dispose: disposeButtons });
  context.subscriptions.push(vscode.commands.registerCommand('apc.extension.enable', () => apcEnable(context, state)));
  context.subscriptions.push(vscode.commands.registerCommand('apc.extension.disable', () => apcDisable(context, state)));

  async function onDidChangeConfiguration(e: vscode.ConfigurationChangeEvent) {
    if (!state.isRunning || context.globalState.get('isEnabled') !== true) { return; }
    try {
      if (e.affectsConfiguration('apc.theme')) { await state.theme.apply(); }
      if (e.affectsConfiguration('apc.buttons')) { applyButtons(context); }
      const patchSettings = ['apc.imports', 'apc.stylesheet', 'apc.iframe.style', 'apc.electron', 'apc.menubar.compact',
        'apc.font.family', 'apc.monospace.font.family', 'apc.parts.font.family', 'apc.listRow',
        'apc.header', 'apc.sidebar.titlebar', 'apc.activityBar', 'apc.statusBar'];
      if (patchSettings.some(key => e.affectsConfiguration(key))) { await updateImports(context); }
    } catch (error) { reportError(error); }
  }
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(onDidChangeConfiguration));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
    if (state.isRunning) { applyButtons(context); }
  }));

  // Commands remain registered even when the application's layout is unsupported
  // or patching fails. Handle startup failures instead of rejecting activation.
  if (context.globalState.get('isEnabled') !== false) {
    try { await apcEnable(context, state, true); }
    catch { /* apcEnable reports startup failures; commands remain available. */ }
  }
}

export function deactivate() {
  // uninstallPatch();
}
