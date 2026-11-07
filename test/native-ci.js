const path = require('node:path');
const { spawn } = require('node:child_process');
const { downloadAndUnzipVSCode } = require('@vscode/test-electron');

(async () => {
  const executable = await downloadAndUnzipVSCode(process.env.VSCODE_VERSION || 'stable');
  const target = process.platform === 'darwin' ? path.resolve(path.dirname(executable), '../..') : executable;
  const child = spawn(process.execPath, [path.join(__dirname, 'native.run.js'), target], { env: process.env, stdio: 'inherit' });
  child.once('error', error => { console.error(error); process.exitCode = 1; });
  child.once('exit', (code, signal) => { process.exitCode = signal ? 1 : code ?? 1; });
})().catch(error => { console.error(error); process.exitCode = 1; });
