const cp = require('child_process');
const nodeExe = 'C:\\project\\resources\\node\\node.exe';

// Compare system node env vs bundled node env
// The issue might be that NODE_OPTIONS or NODE_PATH from system node 
// interferes with bundled node

// Run bundled node with the FULL current process.env (what Electron would pass)
const child = cp.spawn(nodeExe, ['-e', `
  const keys = Object.keys(process.env).filter(k => 
    k.toLowerCase().includes('node') || 
    k.toLowerCase().includes('electron') ||
    k.toLowerCase().includes('npm') ||
    k === 'NODE_OPTIONS' || k === 'NODE_PATH'
  );
  const result = {};
  for (const k of keys) result[k] = process.env[k];
  console.log(JSON.stringify(result));
`], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env }
});

let stdout = '';
child.stdout.on('data', d => stdout += d);
child.on('exit', () => {
  console.log('Bundled node sees these NODE_* vars:');
  try {
    const obj = JSON.parse(stdout.trim());
    console.log(JSON.stringify(obj, null, 2));
  } catch(e) {
    console.log('parse error:', e.message);
    console.log('raw:', stdout);
  }
  process.exit(0);
});
