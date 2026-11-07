import * as vscode from 'vscode';

type ButtonConfig = {
  text: string;
  tooltip?: string;
  vscommand?: string;
  command?: string;
  priority?: number;
  alignment?: vscode.StatusBarAlignment; // ??
};

let subscriptions: any[] = [];

function processScm(statusBarButton: vscode.StatusBarItem) {
  const extension = vscode.extensions?.getExtension('vscode.git');
  if (!extension) { return; }
  let disposed = false;
  const lifecycle: vscode.Disposable[] = [];
  subscriptions.push({ dispose() {
    disposed = true;
    lifecycle.forEach(subscription => subscription.dispose());
  } });
  function connect(api: any) {
    if (disposed) { return; }
    const git = api?.getAPI?.(1);
    if (!git) { return; }
    const repositories = new Map<any, vscode.Disposable>();

    function updateStatusBar() {
      let totalChanges = 0;
      git.repositories.forEach((repository: any) => {
        totalChanges += repository.state.workingTreeChanges.length;
      });
      statusBarButton.text = `$(source-control) ${totalChanges}`;
      statusBarButton.show();
    }

    function refreshRepositories() {
      for (const [repository, subscription] of repositories) {
        if (!git.repositories.includes(repository)) { subscription.dispose(); repositories.delete(repository); }
      }
      for (const repository of git.repositories) {
        if (!repositories.has(repository)) { repositories.set(repository, repository.state.onDidChange(updateStatusBar)); }
      }
      updateStatusBar();
    }
    lifecycle.push(git.onDidOpenRepository(refreshRepositories), git.onDidCloseRepository(refreshRepositories), { dispose() {
      repositories.forEach(subscription => subscription.dispose());
      repositories.clear();
    } });
    refreshRepositories();
  }
  if (extension.isActive === false) {
    void Promise.resolve(extension.activate()).then(connect).catch(error => console.warn('APC SCM button could not activate Git:', error));
  } else { connect(extension.exports); }
}

function createTerminalCommand(command: string) {
  return async () => {
    const terminal = vscode.window.createTerminal();
    terminal.sendText(command);
    terminal.show();
  };
}

function addButton(context: vscode.ExtensionContext, button: ButtonConfig) {
  const statusBarButton = vscode.window.createStatusBarItem(button.alignment, button.priority);
  if (button.command) {
    const commandName = `apc.${button.command.replace(/\s/g, '.')}`;
    subscriptions.push(vscode.commands.registerCommand(commandName, createTerminalCommand(button.command)));
    statusBarButton.command = commandName;
  } else {
    statusBarButton.command = button.vscommand;
  }
  statusBarButton.text = button.text;
  statusBarButton.tooltip = button.tooltip;
  statusBarButton.show();

  if (button.vscommand === 'workbench.view.scm') {
    processScm(statusBarButton);
  }
  return statusBarButton;
}

let buttons: Array<vscode.StatusBarItem> | undefined = undefined;

export function disposeButtons() {
  // Shared by rebuild, disable, and extension disposal so commands and SCM
  // listeners are released together with their status bar items.
  if (buttons) { buttons.forEach(button => button.dispose()); }
  buttons = undefined;
  subscriptions.forEach(subs => subs.dispose());
  subscriptions = [];
}

export function applyButtons(context: vscode.ExtensionContext) {
  disposeButtons();

  const config = vscode.workspace.getConfiguration('apc').get<Array<ButtonConfig>>('buttons');
  buttons = config?.map(button => addButton(context, button));
}
