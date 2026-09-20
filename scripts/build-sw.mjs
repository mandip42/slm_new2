/**
 * Generate public/sw.js from scripts/sw.template.js.
 *
 * Two things are injected:
 *   - a cache version derived from the package version and the build time, so a
 *     deploy always invalidates the old cache
 *   - the precache URL list, read from src/lib/routes.ts so that adding a screen
 *     automatically makes it available offline
 *
 * The route list is imported by transpiling the TypeScript module with esbuild
 * and evaluating it, rather than by pattern-matching the source. That keeps the
 * two in sync by construction.
 */

import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function loadRoutes() {
  const result = await build({
    entryPoints: [path.join(root, 'src/lib/routes.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    target: ['es2022'],
    logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  const loaded = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  return loaded.PRECACHE_ROUTES;
}

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const routes = await loadRoutes();

const staticAssets = [
  '/manifest.webmanifest',
  '/worklets/meter-processor.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/icon.svg',
];

const precache = [...new Set([...routes, ...staticAssets])];

// A stable-per-build version: the package version plus a build timestamp.
const version = `${pkg.version}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;

const template = await readFile(path.join(root, 'scripts/sw.template.js'), 'utf8');
const output = template
  .replace('__SW_VERSION__', version)
  .replace('__PRECACHE_URLS__', JSON.stringify(precache, null, 2));

if (output.includes('__SW_VERSION__') || output.includes('__PRECACHE_URLS__')) {
  throw new Error('Service worker template placeholders were not all replaced');
}

await mkdir(path.join(root, 'public'), { recursive: true });
await writeFile(path.join(root, 'public/sw.js'), output, 'utf8');

console.log(
  `[build-sw] wrote public/sw.js (version ${version}, ${precache.length} precached URLs)`
);
