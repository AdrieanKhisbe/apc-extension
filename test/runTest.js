const { appRoot: resolveAppRoot } = require('./editor-paths');
const { withBackgroundEditor } = require('./background-editor');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
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
  const appRoot = resolveAppRoot(vscodeExecutablePath);
  return withBackgroundEditor(appRoot, async () => {
  const workbench = ['electron-browser', 'electron-sandbox'].map(kind => path.join(appRoot, 'out/vs/code', kind, 'workbench'))
    .find(base => fs.existsSync(path.join(base, 'workbench.html')));
  assert.ok(workbench, 'Downloaded editor must have a supported workbench');
  const htmlPath = path.join(workbench, 'workbench.html');
  const original = fs.readFileSync(htmlPath);
  const mainPath = path.join(appRoot, 'out/main.js');
  const originalMain = fs.readFileSync(mainPath);
  const implementationPath = path.join(appRoot, 'out/mainImpl.js');
  const originalImplementation = fs.readFileSync(implementationPath);
  const desktopPath = path.join(appRoot, 'out/vs/workbench/workbench.desktop.main.js');
  const originalDesktop = fs.readFileSync(desktopPath);
  const nativeLoaderPath = path.join(appRoot, 'out/apc-native-loader.mjs');
  assert.ok(!fs.existsSync(nativeLoaderPath), 'Downloaded editor has a leftover native bootstrap');
  const webviewPath = path.join(appRoot, 'out/vs/workbench/contrib/webview/browser/pre/index.html');
  const originalWebview = fs.readFileSync(webviewPath);
  const patchDirectory = path.join(workbench, 'apc-extension');
  assert.ok(!fs.existsSync(patchDirectory), 'Downloaded editor has leftover APC files; use a fresh test download');
  const fixture = path.join(profile, 'fixtures');
  fs.mkdirSync(fixture);
  fs.writeFileSync(path.join(fixture, 'style.css'), 'body { --apc-test-color: baseline; }');
  fs.writeFileSync(path.join(fixture, 'first.js'), 'globalThis.__apcTestRuns = (globalThis.__apcTestRuns || 0) + 1; globalThis.__apcOrder = ["first"];');
  fs.writeFileSync(path.join(fixture, 'second.js'), 'globalThis.__apcOrder.push("second");');
  const webviewStyle = path.join(fixture, 'webview.css');
  fs.writeFileSync(webviewStyle, 'body { --apc-webview-test: baseline; }');
  const webviewBackup = path.join(fixture, 'original-webview.html');
  fs.writeFileSync(webviewBackup, originalWebview);
  const { pathToFileURL } = require('node:url');
  const imports = ['style.css', 'first.js', 'second.js'].map(name => pathToFileURL(path.join(fixture, name)).href);
  const external = http.createServer((request, response) => {
    if (request.url === '/script.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end('globalThis.__apcExternalRuns = (globalThis.__apcExternalRuns || 0) + 1;');
    } else if (request.url === '/style.css') {
      response.setHeader('Content-Type', 'text/css');
      response.end('body { --apc-external: loaded; }');
    } else { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => external.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${external.address().port}`;
  imports.push({ href: `${origin}/style.css`, rel: 'stylesheet' }, { src: `${origin}/script.js`, type: 'text/javascript' });
  const driver = path.join(profile, 'restoration-driver');
  fs.mkdirSync(driver);
  fs.writeFileSync(path.join(driver, 'package.json'), JSON.stringify({ name: 'apc-restoration-test', publisher: 'apc-tests', version: '0.0.0', engines: { vscode: '^1.92.0' } }));
  fs.mkdirSync(path.join(profile, 'user-data/User'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'user-data/User/settings.json'), JSON.stringify({
    'apc.imports': imports,
    'apc.buttons': [{ text: 'APC check startup', vscommand: 'apc.test.button' }],
    'apc.iframe.style': webviewStyle,
    'apc.electron': { opacity: 0.95 },
    'apc.menubar.compact': true,
    'apc.font.family': 'Georgia',
    'apc.monospace.font.family': 'monospace',
    'apc.parts.font.family': { statusbar: 'monospace' },
    'apc.statusBar': { height: 30 },
    'apc.activityBar': { size: 56, position: 'bottom' },
  }));
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  console.log(`Testing VS Code ${version}; isolated data: ${profile}`);
  try {
    console.log('Running measured-layout editor suite');
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(__dirname, 'customizations-run.js')], {
        env: { ...process.env, APC_EDITOR: vscodeExecutablePath }, stdio: 'inherit',
      });
      child.once('error', reject);
      child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Measured-layout suite failed: ${signal || code}`)));
    });
    assert.deepEqual(fs.readFileSync(desktopPath), originalDesktop, 'Measured-layout suite must restore the renderer bundle');
    for (const suite of ['activation.test.js', 'imports.test.js', 'public-api.test.js', 'webview.integration.js', 'reload.test.js', 'disabled.test.js']) {
      console.log(`Running real-editor suite: ${suite}`);
      await runTests({
        vscodeExecutablePath,
        // Extension test mode resets application storage to memory on every
        // launch. Do not load APC as a fresh install in the restoration control.
        extensionDevelopmentPath: suite === 'disabled.test.js' ? driver : root,
        extensionTestsPath: path.join(__dirname, suite),
        extensionTestsEnv: { APC_CDP_PORT: String(port), APC_FIXTURE: fixture, APC_HTML: htmlPath, APC_ORIGINAL_HTML: original.toString('base64'), APC_WEBVIEW_TEMPLATE: webviewPath, APC_WEBVIEW_BACKUP: webviewBackup },
        launchArgs: [
          `--user-data-dir=${path.join(profile, 'user-data')}`,
          `--extensions-dir=${path.join(profile, 'extensions')}`,
          '--disable-extensions',
          '--disable-gpu',
          '--skip-welcome',
          '--skip-release-notes',
          '--disable-updates',
          `--remote-debugging-port=${port}`,
        ],
      });
    }
    assert.deepEqual(fs.readFileSync(htmlPath), original, 'Disable must restore the original HTML byte-for-byte');
    assert.deepEqual(fs.readFileSync(mainPath), originalMain, 'Disable must restore main.js');
    assert.deepEqual(fs.readFileSync(implementationPath), originalImplementation, 'Disable must restore mainImpl.js');
    assert.deepEqual(fs.readFileSync(desktopPath), originalDesktop, 'Disable must restore the renderer bundle');
    assert.ok(!fs.existsSync(nativeLoaderPath), 'Disable must remove the native bootstrap');
    assert.deepEqual(fs.readFileSync(webviewPath), originalWebview, 'Disable must restore the exact webview template');
    assert.ok(!fs.existsSync(patchDirectory), 'Disable must remove all modern patch files');
    console.log('Running webview provider lifecycle suite');
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(__dirname, 'webview.run.js')], {
        env: { ...process.env, APC_WEBVIEW_EXECUTABLE: vscodeExecutablePath }, stdio: 'inherit',
      });
      child.once('error', reject);
      child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Webview lifecycle suite failed: ${signal || code}`)));
    });
    assert.deepEqual(fs.readFileSync(webviewPath), originalWebview, 'Provider lifecycle suite must restore the webview template');

  } finally {
    // Also restore the disposable application if a suite fails before disable.
    fs.writeFileSync(htmlPath, original);
    fs.writeFileSync(mainPath, originalMain);
    fs.writeFileSync(implementationPath, originalImplementation);
    fs.writeFileSync(desktopPath, originalDesktop);
    if (fs.existsSync(nativeLoaderPath)) { fs.unlinkSync(nativeLoaderPath); }
    fs.writeFileSync(webviewPath, originalWebview);
    if (fs.existsSync(patchDirectory)) { fs.rmSync(patchDirectory, { recursive: true, force: true }); }
    const logs = path.join(profile, 'user-data', 'logs');
    if (fs.existsSync(logs)) {
      fs.cpSync(logs, path.join(run, 'logs'), { recursive: true });
    }
    fs.rmSync(profile, { recursive: true, force: true });
    await new Promise(resolve => external.close(resolve));
    console.log(`Editor logs: ${run}`);
  }
  });
}

main().catch(error => {
  console.error('VS Code activation test failed:', error);
  process.exitCode = 1;
});
