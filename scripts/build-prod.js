/**
 * build-prod.js — Production build orchestrator
 *
 * Steps:
 *   1. Clean all dist/ and dist-electron/ output folders
 *   2. Build controller-node TypeScript → dist/
 *   3. Build desktop-ui via Vite → dist/
 *   4. Build electron main process TypeScript → dist/
 *   5. Prune devDependencies from controller-node (smaller bundle)
 *   6. Run electron-builder to create the Windows installer
 *   7. Restore devDependencies so the workspace stays usable
 */

import { execSync } from 'child_process';
import { rmSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function run(label, cmd, cwd = ROOT) {
  console.log(`\n▶ [${label}] ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit', shell: true });
}

function clean(relPath) {
  const full = resolve(ROOT, relPath);
  if (existsSync(full)) {
    rmSync(full, { recursive: true, force: true });
    console.log(`  ✓ removed ${relPath}`);
  }
}

// ── 1. Clean ──────────────────────────────────────────────────────────────────
console.log('\n── Step 1: Clean previous build outputs ──');
clean('apps/controller-node/dist');
clean('apps/desktop-ui/dist');
clean('apps/electron/dist');
clean('apps/electron/dist-electron');

// ── 2. Build backend ──────────────────────────────────────────────────────────
console.log('\n── Step 2: Compile controller-node (TypeScript) ──');
run('controller', 'npm run build', resolve(ROOT, 'apps/controller-node'));

// ── 3. Build frontend ─────────────────────────────────────────────────────────
console.log('\n── Step 3: Build desktop-ui (Vite) ──');
run('desktop-ui', 'npm run build', resolve(ROOT, 'apps/desktop-ui'));

// ── 4. Build electron main ────────────────────────────────────────────────────
console.log('\n── Step 4: Compile electron main process (TypeScript) ──');
run('electron', 'npm run build:electron', resolve(ROOT, 'apps/electron'));

// ── 5. Package with electron-builder ─────────────────────────────────────────
// Note: devDependencies (typescript, tsx, nodemon, @types/*) are excluded from
// the installer by the filter rules in electron-builder.yml — no prune needed here.
// The CI workflow runs `npm prune --omit=dev` before this step for extra savings.
// `npm run build` uses --publish never (local packaging only)
// The CI workflow uses `npm run dist` which adds --publish always
console.log('\n── Step 5: Package application (electron-builder) ──');
run('electron-builder', 'npm run build', resolve(ROOT, 'apps/electron'));
console.log('\n✅ Build complete. Installer is in apps/electron/dist-electron/');
