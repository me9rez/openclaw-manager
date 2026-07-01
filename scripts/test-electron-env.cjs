// Simulate Electron-like env by filtering for ELECTRON/NODE vars
const electronLikeVars = {};
for (const [k, v] of Object.entries(process.env)) {
  const key = k.toLowerCase();
  if (key.includes('electron') || key.includes('node_') || key.startsWith('npm') || key.startsWith('npx') || key.includes('mise')) {
    electronLikeVars[k] = v;
  }
}
console.log(JSON.stringify(electronLikeVars, null, 2));
