const { appRoot: resolveAppRoot } = require('./editor-paths');
const { withBackgroundEditor } = require('./background-editor');
// Standalone real-editor coverage for the webview patch preparation module.
// The shared installation transaction/watcher is covered by the parent harness.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const assert = require('node:assert/strict');
const { downloadAndUnzipVSCode, runTests } = require('@vscode/test-electron');

async function main() {
  const root = path.resolve(__dirname, '..');
  const version = process.env.VSCODE_VERSION || '1.140.0';
  const executable = process.env.APC_WEBVIEW_EXECUTABLE || await downloadAndUnzipVSCode({ version, cachePath: path.join(root, '.vscode-test', 'webview-editor') });
  assert.ok(path.resolve(executable).startsWith(path.join(root, '.vscode-test') + path.sep), 'Use a disposable editor inside this checkout test cache');
  const appRoot = resolveAppRoot(executable);
  return withBackgroundEditor(appRoot, async () => {
  const template = path.join(appRoot, 'out/vs/workbench/contrib/webview/browser/pre/index.html');
  const original = fs.readFileSync(template);
  const profile = fs.mkdtempSync(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'apc-wv-'));
  const output = path.join(root, '.vscode-test', 'runs', `webview-${version}`);
  fs.mkdirSync(output, { recursive: true });
  const backup = path.join(profile, 'original.html'); fs.writeFileSync(backup, original);
  const driver = path.join(profile, 'driver'); fs.mkdirSync(driver);
  fs.writeFileSync(path.join(driver, 'package.json'), JSON.stringify({ name: 'apc-webview-test', publisher: 'apc-tests', version: '0.0.0', main: './extension.cjs', engines: { vscode: '^1.92.0' },
    contributes: { notebooks: [{ type: 'apc-tests.notebook', displayName: 'APC lifecycle notebook', selector: [{ filenamePattern: '*.apcnb' }] }], notebookRenderer: [{ id: 'apc-tests.notebook-renderer', displayName: 'APC lifecycle renderer', entrypoint: './notebook-renderer.mjs', mimeTypes: ['application/x.apc-fixture'], requiresMessaging: 'always' }], customEditors: [{ viewType: 'apc-tests.custom', displayName: 'APC lifecycle editor', selector: [{ filenamePattern: '*.apcfixture' }], priority: 'option' }], views: { explorer: [{ id: 'apc-tests.view', name: 'APC lifecycle view', type: 'webview' }] }, configuration: { properties: { 'apc.iframe.style': { type: ['object', 'string'] } } } } }));
  fs.writeFileSync(path.join(driver, 'extension.cjs'), 'exports.activate = () => {};\n');
  // VS Code scopes renderer messaging to the extension owning the caller file.
  for (const file of ['notebook-renderer.mjs', 'webview.editor.js', 'webview-lifecycles.js', 'markdown-preview.js', 'cdp.js']) {
    fs.copyFileSync(path.join(__dirname, file), path.join(driver, file));
  }
  try {
    for (const phase of ['baseline', 'installed', 'file-updated', 'restored']) {
      const server = net.createServer();
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = server.address().port;
      await new Promise(resolve => server.close(resolve));
      await runTests({ vscodeExecutablePath: executable, extensionDevelopmentPath: driver,
        extensionTestsPath: path.join(driver, 'webview.editor.js'),
        extensionTestsEnv: { APC_CDP_PORT: String(port), APC_SOURCE_ROOT: root, APC_WEBVIEW_PHASE: phase, APC_WEBVIEW_OUTPUT: path.join(output, phase + '.json'), APC_WEBVIEW_ORIGINAL: backup, APC_WEBVIEW_STYLE: path.join(profile, 'style.css') },
        launchArgs: [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}/user-data`, `--extensions-dir=${profile}/extensions`, '--disable-extensions', '--disable-gpu', '--skip-welcome', '--skip-release-notes', '--disable-updates'] });
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
