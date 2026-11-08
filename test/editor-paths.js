const fs = require('node:fs');
const path = require('node:path');

// Downloaded Windows archives can have a launcher at the root and the real
// runtime under a 10-character commit directory. Never guess between runtimes.
function appRoot(executable, platform = process.platform) {
  const directory = path.dirname(executable);
  const roots = platform === 'darwin' ? [path.resolve(directory, '../Resources/app')] : [path.join(directory, 'resources/app')];
  if (platform === 'win32') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && /^[0-9a-f]{10}$/.test(entry.name)) { roots.push(path.join(directory, entry.name, 'resources/app')); }
    }
  }
  const matches = roots.filter(root => fs.existsSync(path.join(root, 'out/main.js')));
  if (matches.length !== 1) { throw new Error(`Expected one VS Code runtime for ${executable}, found ${matches.length}`); }
  return matches[0];
}
module.exports = { appRoot };
