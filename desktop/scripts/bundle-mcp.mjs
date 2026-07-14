// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  bundle-mcp.mjs — bundle the MCP front into one self-contained file the
 *        INSTALLED editor ships (dist-electron/mcp/editor-mcp.mjs, asar-unpacked
 *        so plain node can run it). This is how any MCP client reaches an
 *        installed Estella: `node <resources>/app.asar.unpacked/dist-electron/
 *        mcp/editor-mcp.mjs --editor`. The editor stays the single distribution
 *        channel — no npm package to keep in sync.
 */
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [path.join(HERE, 'editor-mcp.mjs')],
  outfile: path.join(HERE, '..', 'dist-electron', 'mcp', 'editor-mcp.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  // Only the dev repo resolves electron (lazy createRequire); the installed
  // flow spawns the editor exe instead, so leave the specifier external.
  external: ['electron'],
  // CJS deps inside the ESM bundle may call require() at runtime.
  banner: {
    js: "import { createRequire as __bundleRequire } from 'node:module'; const require = __bundleRequire(import.meta.url);",
  },
  logLevel: 'warning',
});
console.log('[bundle-mcp] dist-electron/mcp/editor-mcp.mjs written');
