const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { downloadAndUnzipVSCode, runTests } = require('@vscode/test-electron');

async function main() {
  const root = path.resolve(__dirname, '..');
  const version = process.env.VSCODE_VERSION || '1.140.0';
  const runs = path.join(root, '.vscode-test', 'runs');
  fs.mkdirSync(runs, { recursive: true });
  const run = fs.mkdtempSync(path.join(runs, 'activation-'));

  // Always download a disposable editor: APC can modify its application files.
  // A separate profile on the user's installed editor would not isolate that.
  const vscodeExecutablePath = await downloadAndUnzipVSCode(version);
  // macOS IPC socket paths have a 103-character limit. Keep profiles short,
  // then copy their logs back into the checkout for CI artifact collection.
  const profile = fs.mkdtempSync(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'apc-'));
  console.log(`Testing VS Code ${version}; isolated data: ${profile}`);
  try {
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath: root,
      extensionTestsPath: path.join(__dirname, 'activation.test.js'),
      launchArgs: [
        `--user-data-dir=${path.join(profile, 'user-data')}`,
        `--extensions-dir=${path.join(profile, 'extensions')}`,
        '--disable-extensions',
        '--disable-gpu',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-updates',
      ],
    });
  } finally {
    const logs = path.join(profile, 'user-data', 'logs');
    if (fs.existsSync(logs)) {
      fs.cpSync(logs, path.join(run, 'logs'), { recursive: true });
    }
    fs.rmSync(profile, { recursive: true, force: true });
    console.log(`Editor logs: ${run}`);
  }
}

main().catch(error => {
  console.error('VS Code activation test failed:', error);
  process.exitCode = 1;
});
