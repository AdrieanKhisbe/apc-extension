const fs = require('node:fs');
const path = require('node:path');

// Remove stale compiler outputs when source modules are renamed or retired.
fs.rmSync(path.join(__dirname, '../dist'), { recursive: true, force: true });
