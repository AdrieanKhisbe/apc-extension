const assert = require('node:assert/strict');
const vscode = require('vscode');

// VS Code awaits this exported runner in its extension host. The ordered
// application launches live in runTest.js; standalone regressions use node:test.
exports.run = async function () {
  console.log(`Activation regression: VS Code ${vscode.version}, ${process.platform}/${process.arch}`);
  const extension = vscode.extensions.getExtension('drcika.apc-extension');
  assert.ok(extension, 'APC must be discovered by the real extension host');

  // Capture the original activation exception, then exercise the command to
  // reproduce the user-visible symptom. Neither failure is treated as success.
  let activationError;
  try {
    await extension.activate();
  } catch (error) {
    activationError = error;
    console.error('APC activation error:', error);
  }

  if (!activationError) {
    assert.ok(extension.isActive, 'APC must activate successfully');
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('apc.extension.enable'), 'APC enable command must be available');
    assert.ok(commands.includes('apc.extension.disable'), 'APC disable command must be available');
    console.log('CHECKPOINT: APC activated and both commands are available.');
  }

  try {
    await vscode.commands.executeCommand('apc.extension.enable');
  } catch (error) {
    console.error('APC enable command error:', error);
    throw error;
  }

  if (activationError) { throw activationError; }
  assert.ok(extension.isActive, 'APC must activate successfully');
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes('apc.extension.disable'), 'APC disable command must be available');
  console.log('PASS: APC activated and its enable command executed.');
};
