const cp = require('child_process');
const path = require('path');
const home = require('os').homedir();
const nodeExe = 'C:\\project\\resources\\node\\node.exe';
const entry = path.join(home, '.openclaw-manager', 'versions', 'v2026.6.11', 'node_modules', 'openclaw', 'openclaw.mjs');
const instanceDir = path.join(home, '.openclaw-manager', 'instances', 'e2e-test-611');

console.log('node:', nodeExe, 'exists:', require('fs').existsSync(nodeExe));
console.log('entry:', entry, 'exists:', require('fs').existsSync(entry));
console.log('instanceDir:', instanceDir, 'exists:', require('fs').existsSync(instanceDir));

// Clean up and create config
require('fs').mkdirSync(instanceDir, { recursive: true });
require('fs').writeFileSync(path.join(instanceDir, 'openclaw.json'), JSON.stringify({
  gateway: { mode: 'local', auth: { token: 'test-token' } },
  agents: { defaults: { workspace: 'default' } }
}, null, 2));

const child = cp.spawn(nodeExe, [entry, 'gateway', 'run', '--port', '18999', '--auth', 'token'], {
  cwd: instanceDir,
  env: {
    ...process.env,
    OPENCLAW_STATE_DIR: instanceDir,
    OPENCLAW_CONFIG_PATH: path.join(instanceDir, 'openclaw.json'),
    OPENCLAW_GATEWAY_TOKEN: 'test-token',
    NODE_NO_WARNINGS: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

let stdout = '', stderr = '';
child.stdout.on('data', d => stdout += d);
child.stderr.on('data', d => stderr += d);
child.on('exit', (code, sig) => {
  console.log('EXIT code:', code, 'signal:', sig);
  console.log('STDOUT:', stdout.slice(0, 500));
  console.log('STDERR:', stderr.slice(0, 500));
  process.exit(0);
});
setTimeout(() => {
  console.log('TIMEOUT - process still running');
  console.log('STDOUT:', stdout.slice(0, 300));
  console.log('STDERR:', stderr.slice(0, 300));
  child.kill();
  process.exit(0);
}, 8000);
