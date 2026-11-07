const { withBackgroundEditor } = require('./background-editor');
// Standalone real-editor coverage for the webview patch preparation module.
// The shared installation transaction/watcher is covered by the parent harness.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { downloadAndUnzipVSCode, runTests } = require('@vscode/test-electron');

async function main() {
  const root = path.resolve(__dirname, '..');
  const version = process.env.VSCODE_VERSION || '1.140.0';
  const executable = process.env.APC_WEBVIEW_EXECUTABLE || await downloadAndUnzipVSCode({ version, cachePath: path.join(root, '.vscode-test', 'webview-editor') });
  assert.ok(path.resolve(executable).startsWith(path.join(root, '.vscode-test') + path.sep), 'Use a disposable editor inside this checkout test cache');
  const appRoot = process.platform === 'darwin' ? path.resolve(path.dirname(executable), '../Resources/app') : path.join(path.dirname(executable), 'resources/app');
  return withBackgroundEditor(appRoot, async () => {
  const template = path.join(appRoot, 'out/vs/workbench/contrib/webview/browser/pre/index.html');
  const original = fs.readFileSync(template);
  const profile = fs.mkdtempSync(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'apc-wv-'));
  const output = path.join(root, '.vscode-test', 'runs', `webview-${version}`);
  fs.mkdirSync(output, { recursive: true });
  const backup = path.join(profile, 'original.html'); fs.writeFileSync(backup, original);
  const driver = path.join(profile, 'driver'); fs.mkdirSync(driver);
  fs.writeFileSync(path.join(driver, 'package.json'), JSON.stringify({ name: 'apc-webview-test', publisher: 'apc-tests', version: '0.0.0', engines: { vscode: '^1.92.0' },
    contributes: { customEditors: [{ viewType: 'apc-tests.custom', displayName: 'APC lifecycle editor', selector: [{ filenamePattern: '*.apcfixture' }], priority: 'option' }], views: { explorer: [{ id: 'apc-tests.view', name: 'APC lifecycle view', type: 'webview' }] }, configuration: { properties: { 'apc.iframe.style': { type: ['object', 'string'] } } } } }));
  try {
    for (const phase of ['baseline', 'installed', 'file-updated', 'restored']) {
      await runTests({ vscodeExecutablePath: executable, extensionDevelopmentPath: driver,
        extensionTestsPath: path.join(__dirname, 'webview.editor.js'),
        extensionTestsEnv: { APC_WEBVIEW_PHASE: phase, APC_WEBVIEW_OUTPUT: path.join(output, phase + '.json'), APC_WEBVIEW_ORIGINAL: backup, APC_WEBVIEW_STYLE: path.join(profile, 'style.css') },
        launchArgs: [`--user-data-dir=${profile}/user-data`, `--extensions-dir=${profile}/extensions`, '--disable-extensions', '--disable-gpu', '--skip-welcome', '--skip-release-notes', '--disable-updates'] });
    }
    assert.deepEqual(fs.readFileSync(template), original, 'Removing webview configuration must restore exact template bytes');
    console.log(`PASS: webview lifecycle, three CSP policies and exact restoration on VS Code ${version}`);
  } finally {
    fs.writeFileSync(template, original);
    const logs = path.join(profile, 'user-data/logs');
    if (fs.existsSync(logs)) { fs.cpSync(logs, path.join(output, 'logs'), { recursive: true }); }
    fs.rmSync(profile, { recursive: true, force: true });
  }
  });
}

main().catch(error => { console.error(error); process.exitCode = 1; });
