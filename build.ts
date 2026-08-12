#!/usr/bin/env bun
/**
 * Minimal, environment-robust build for the Spartan project (VM variant).
 *
 * The elizaOS CLI `start` runs this before launching the agent. On this VM the
 * original build.ts was unreliable for two reasons that DON'T affect the agent
 * runtime: (1) it shelled out to `bunx vite` for a redundant front-end (the
 * standard @elizaos/client web UI is already bundled into @elizaos/server), and
 * that ran under the system Node 16 (vite needs Node 20+, crypto.getRandomValues);
 * (2) it hard-exited on any `tsc` type error.
 *
 * The runtime only needs the ESM node bundle at dist/index.js, so this build
 * produces exactly that with Bun.build and nothing else.
 */

import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';

const NODE_OUTDIR = 'dist';

async function build() {
  const start = performance.now();
  console.log('🚀 Building Spartan project (node bundle only)...');

  if (existsSync(NODE_OUTDIR)) {
    await rm(NODE_OUTDIR, { recursive: true, force: true });
    console.log(`✓ Cleaned ${NODE_OUTDIR}/`);
  }

  console.log('📦 Bundling with Bun…');
  const result = await Bun.build({
    entrypoints: ['./src/index.ts'],
    outdir: `./${NODE_OUTDIR}`,
    target: 'node',
    format: 'esm',
    sourcemap: true,
    minify: false,
    external: [
      'dotenv',
      'fs',
      'path',
      'https',
      'node:*',
      '@elizaos/core',
      '@elizaos/plugin-bootstrap',
      '@elizaos/plugin-sql',
      '@elizaos/cli',
      'zod',
    ],
    naming: {
      entry: '[dir]/[name].[ext]',
    },
  });

  if (!result.success) {
    console.error('✗ Bun build failed:', result.logs);
    return false;
  }

  const totalSize = result.outputs.reduce((sum, o) => sum + o.size, 0);
  const sizeMB = (totalSize / 1024 / 1024).toFixed(2);
  const elapsed = ((performance.now() - start) / 1000).toFixed(2);
  console.log(`✓ Built ${result.outputs.length} file(s) - ${sizeMB}MB`);
  console.log(`✅ Build complete! (${elapsed}s)`);
  return true;
}

build()
  .then((success) => {
    if (!success) process.exit(1);
  })
  .catch((error) => {
    console.error('Build script error:', error);
    process.exit(1);
  });
