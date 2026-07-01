const cp = require('child_process');
const path = require('path');
const home = require('os').homedir();
const fs = require('fs');

const nodeExe = 'C:\\project\\resources\\node\\node.exe';
const entry = path.join(home, '.openclaw-manager', 'versions', 'v2026.6.11', 'node_modules', 'openclaw', 'openclaw.mjs');
const instanceDir = path.join(home, '.openclaw-manager', 'instances', 'test-v24');

fs.mkdirSync(instanceDir, { recursive: true });
fs.writeFileSync(path.join(instanceDir, 'openclaw.json'), JSON.stringify({
  gateway: { mode: 'local', auth: { token: 'test-token' } },
  agents: { defaults: { workspace: 'default' } }
}, null, 2));

console.log('Spawning bundled node v24 + openclaw...');

const child = cp.spawn(nodeExe, [entry, 'gateway', 'run', '--port', '18960', '--auth', 'token'], {
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
child.stdout.on('data', d => { stdout += d; console.log('STDOUT:', d.toString().slice(0, 200)); });
child.stderr.on('data', d => { stderr += d; console.log('STDERR:', d.toString().slice(0, 200)); });
child.on('exit', (code) => { console.log('EXIT:', code); });

setTimeout(() => {
  console.log('\\n=== 8s timeout ===');
  console.log('stdout length:', stdout.length);
  console.log('stderr length:', stderr.length);
  if (stdout) console.log('stdout:', stdout.slice(0, 500));
  if (stderr) console.log('stderr:', stderr.slice(0, 500));
  child.kill();
  process.exit(0);
}, 8000);
