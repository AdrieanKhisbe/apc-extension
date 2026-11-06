const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const Module = require('node:module');
const assert = require('node:assert/strict');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const root = path.resolve(__dirname, '..');
  const executable = process.env.APC_EDITOR;
  assert.ok(executable, 'APC_EDITOR must identify an isolated editor copy');
  const appRoot = path.resolve(executable, '../../Resources/app');
  const version = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'))).version;
  const initial = { 'font.family': 'Georgia', 'parts.font.family': { statusbar: 'monospace' }, listRow: { height: 40, fontSize: 17, lists: ['explorer-folders-view'] }, header: { height: 44 }, 'sidebar.titlebar': { height: 48 }, statusBar: { height: 40 }, activityBar: { size: 68 } };
  const originalLoad = Module._load;
  Module._load = function (name, ...args) {
    return name === 'vscode' ? { version, env: { appRoot }, workspace: { getConfiguration: () => ({ get: key => initial[key] }) } } : originalLoad.call(this, name, ...args);
  };
  const { prepareCustomizations, customizationStyles } = require('../dist/customizations');
  Module._load = originalLoad;
  const changes = prepareCustomizations({ extensionPath: root }, new Map());
  const before = new Map([...changes].map(([file]) => [file, fs.readFileSync(file)]));
  const css = customizationStyles();
  const profile = fs.mkdtempSync(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'apc-layout-'));
  fs.mkdirSync(path.join(profile, 'workspace'));
  for (let i = 0; i < 120; i++) { fs.writeFileSync(path.join(profile, 'workspace', `file-${String(i).padStart(3, '0')}.txt`), `file ${i}`); }
  fs.mkdirSync(path.join(profile, 'driver'));
  fs.writeFileSync(path.join(profile, 'driver/package.json'), JSON.stringify({ name: 'apc-customizations-tests', publisher: 'apc-tests', version: '0.0.0', engines: { vscode: '^1.140.0' } }));
  fs.mkdirSync(path.join(profile, 'user-data/User'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'user-data/User/settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'workbench.secondarySideBar.defaultVisibility': 'hidden' }));
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  try {
    for (const [file, contents] of changes) { fs.writeFileSync(file, `document.head.appendChild(Object.assign(document.createElement('style'),{textContent:${JSON.stringify(css)}}));\n` + contents); }
    await runTests({ vscodeExecutablePath: executable, extensionDevelopmentPath: path.join(profile, 'driver'), extensionTestsPath: path.join(__dirname, 'customizations-editor.js'), extensionTestsEnv: { APC_CDP_PORT: String(port), APC_CUSTOMIZATIONS_RESULTS: path.join(root, '.vscode-test', `customizations-${version}.json`) }, launchArgs: [path.join(profile, 'workspace'), `--user-data-dir=${path.join(profile, 'user-data')}`, `--extensions-dir=${path.join(profile, 'extensions')}`, '--disable-extensions', '--disable-gpu', '--skip-welcome', '--skip-release-notes', '--disable-updates', `--remote-debugging-port=${port}`] });
  } finally {
    for (const [file, bytes] of before) { fs.writeFileSync(file, bytes); }
    for (const [file, bytes] of before) { assert.deepEqual(fs.readFileSync(file), bytes); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
