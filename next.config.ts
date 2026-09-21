import type { NextConfig } from 'next';
import os from 'node:os';
import path from 'node:path';

/**
 * Cap build parallelism.
 *
 * Next spawns one page-data worker per logical CPU. On a machine with many cores
 * but a modest paging file that exhausts thread or commit limits and the build
 * dies with a worker crash rather than a useful error. Four workers builds this
 * project in a couple of seconds and is reliable everywhere.
 */
const buildWorkers = Math.max(1, Math.min(4, os.availableParallelism?.() ?? 4));

/**
 * Sonoscope is a fully client-side application: every measurement route is a
 * client component and no microphone audio ever leaves the device. That means
 * the whole app prerenders to static HTML and can be hosted on Vercel with no
 * server runtime.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  turbopack: {
    // Pin the workspace root. Without this, a stray lockfile in a parent
    // directory can make Turbopack choose the home directory as the root.
    root: path.resolve(import.meta.dirname),
  },
  experimental: {
    cpus: buildWorkers,
  },
  async headers() {
    return [
      {
        // The service worker must never be served from a stale HTTP cache,
        // otherwise app updates can never be picked up.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/worklets/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
      },
    ];
  },
};

export default nextConfig;
