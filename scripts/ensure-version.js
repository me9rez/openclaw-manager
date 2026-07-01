const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const dir = path.join(require('os').homedir(), '.openclaw-manager', 'versions', 'v2026.6.11');
const entry = path.join(dir, 'node_modules', 'openclaw', 'openclaw.mjs');
if (!fs.existsSync(entry)) {
  console.log('Installing openclaw v2026.6.11...');
  execSync('npm install openclaw@2026.6.11 --prefix "' + dir + '" --no-save', { stdio: 'inherit', timeout: 120000 });
  console.log('Installed.');
} else {
  console.log('Already installed at ' + entry);
}
