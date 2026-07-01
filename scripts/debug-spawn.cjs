const cp = require('child_process');
const path = require('path');
const nodePath = path.join('C:\\project\\dist-electron', '..', 'resources', 'node', 'node.exe');
console.log('Resolved:', nodePath);
console.log('Exists:', require('fs').existsSync(nodePath));

const child = cp.spawn(nodePath, ['-e', 'console.log("hello from bundled node")'], { stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', d => console.log('STDOUT:', d.toString().trim()));
child.stderr.on('data', d => console.log('STDERR:', d.toString().trim()));
child.on('error', e => console.log('ERROR:', e.message));
child.on('exit', c => console.log('EXIT CODE:', c));
setTimeout(() => process.exit(0), 3000);
