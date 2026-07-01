/**
 * clean.js — Remove all build output folders.
 * Run with: npm run clean
 */

import { rmSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const dirs = [
  'apps/controller-node/dist',
  'apps/desktop-ui/dist',
  'apps/electron/dist',
  'apps/electron/dist-electron',
];

for (const dir of dirs) {
  const full = resolve(ROOT, dir);
  if (existsSync(full)) {
    rmSync(full, { recursive: true, force: true });
    console.log(`✓ removed ${dir}`);
  } else {
    console.log(`  skipped ${dir} (not found)`);
  }
}

console.log('\nClean complete.');
