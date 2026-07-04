/**
 * rebuild-native.js — Rebuilds native Node.js modules for Electron's ABI
 *
 * WHY THIS IS NEEDED:
 *   - System Node.js uses ABI 127 (Node v22.x)
 *   - Electron 31.x embeds Node.js with ABI 125
 *   - better-sqlite3 is a native (.node) module that must match the runtime ABI
 *   - The controller-node backend spawns with ELECTRON_RUN_AS_NODE=1, so it
 *     runs inside Electron's Node — not system Node
 *   - Without this rebuild, you get:
 *       "The module was compiled against a different Node.js version"
 *       "NODE_MODULE_VERSION 125. This version of Node.js requires NODE_MODULE_VERSION 127"
 *
 * USAGE:
 *   node scripts/rebuild-native.js
 *
 * Run this after:
 *   - npm install in controller-node
 *   - Updating better-sqlite3 version
 *   - Changing Electron version
 */

import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const controllerDir  = resolve(ROOT, 'apps/controller-node');
const electronDir    = resolve(ROOT, 'apps/electron');
const rebuildBin     = resolve(controllerDir, 'node_modules/.bin/electron-rebuild.cmd');
const electronPkgDir = resolve(electronDir,   'node_modules/electron');

// Validate prerequisites
if (!existsSync(rebuildBin)) {
  console.error('✖ @electron/rebuild not found. Run: cd apps/controller-node && npm install');
  process.exit(1);
}
if (!existsSync(electronPkgDir)) {
  console.error('✖ Electron not found at apps/electron/node_modules/electron. Run: cd apps/electron && npm install');
  process.exit(1);
}

// Read the pinned Electron version from electron's own package.json
const electronPkg = JSON.parse(
  (await import('fs')).readFileSync(resolve(electronPkgDir, 'package.json'), 'utf8')
);
const electronVersion = electronPkg.version;

console.log(`\n🔧 Rebuilding better-sqlite3 for Electron ${electronVersion} (ABI 125)...`);
console.log(`   Module dir: ${controllerDir}`);
console.log(`   Electron:   ${electronPkgDir}\n`);

try {
  execSync(
    `"${rebuildBin}" -f -v ${electronVersion} -o better-sqlite3 -m .`,
    { cwd: controllerDir, stdio: 'inherit', shell: true, windowsHide: false }
  );
  console.log('\n✅ better-sqlite3 successfully rebuilt for Electron ABI.');
  console.log('   You can now run: npm run electron:dev\n');
} catch (err) {
  // Check if rebuild actually succeeded by looking at the exit code
  // electron-rebuild returns 0 on success even if it prints to stderr
  if (err.status !== 0) {
    console.error('\n✖ Rebuild failed. See error above.');
    process.exit(1);
  }
  console.log('\n✅ better-sqlite3 successfully rebuilt for Electron ABI.');
  console.log('   You can now run: npm run electron:dev\n');
}
