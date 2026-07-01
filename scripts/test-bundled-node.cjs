const cp = require('child_process');
const nodeExe = 'C:\\project\\resources\\node\\node.exe';

// Test 1: bundled node basic execution
const c1 = cp.spawn(nodeExe, ['-e', 'console.log("hello from v24")'], { stdio: ['ignore', 'pipe', 'pipe'] });
c1.stdout.on('data', d => console.log('Test1 STDOUT:', d.toString().trim()));
c1.stderr.on('data', d => console.log('Test1 STDERR:', d.toString().trim()));
c1.on('exit', c => setTimeout(() => {
  // Test 2: bundled node with --version
  const c2 = cp.spawn(nodeExe, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
  c2.stdout.on('data', d => console.log('Test2 STDOUT:', d.toString().trim()));
  c2.stderr.on('data', d => console.log('Test2 STDERR:', d.toString().trim()));
  c2.on('exit', c2c => setTimeout(() => {
    // Test 3: with both stdout and stderr
    const c3 = cp.spawn(nodeExe, ['-e', 'console.log(\"out\"); console.error(\"err\")'], { stdio: ['ignore', 'pipe', 'pipe'] });
    c3.stdout.on('data', d => console.log('Test3 STDOUT:', d.toString().trim()));
    c3.stderr.on('data', d => console.log('Test3 STDERR:', d.toString().trim()));
    c3.on('exit', () => process.exit(0));
  }, 500));
}, 500));

setTimeout(() => process.exit(0), 10000);
