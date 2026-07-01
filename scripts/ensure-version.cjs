const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const homedir = os.homedir();
const npmBinName = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const bundledNpm = path.join(__dirname, '..', 'resources', 'node', npmBinName);
const dir = path.join(homedir, '.openclaw-manager', 'versions', 'v2026.6.11');
const entry = path.join(dir, 'node_modules', 'openclaw', 'openclaw.mjs');

if (!fs.existsSync(entry)) {
  console.log('Installing openclaw v2026.6.11...');
  if (!fs.existsSync(bundledNpm)) {
    throw new Error(`Bundled npm not found at ${bundledNpm}`);
  }
  const sep = process.platform === 'win32' ? ';' : ':';
  const npmDir = path.dirname(bundledNpm);
  const env = {
    ...process.env,
    PATH: `${npmDir}${sep}${process.env.PATH || ''}`,
  };
  execFileSync(
    bundledNpm,
    ['install', 'openclaw@2026.6.11', '--prefix', dir, '--no-save'],
    {
      cwd: dir,
      env,
      stdio: 'inherit',
      timeout: 120000,
      shell: process.platform === 'win32',
    },
  );
  console.log('Done');
} else {
  console.log('Already installed');
}
