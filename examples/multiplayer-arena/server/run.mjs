// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Build-and-run for the arena's dedicated server.
 *
 * The gameplay under `src/` is TypeScript that imports the bare specifier
 * `esengine`, exactly like the code the browser runs. A server is the same
 * project pointed at a different SDK build, so this does what every other
 * Estella export already does: bundle the entry with esbuild and alias
 * `esengine` at the SDK flavour this platform needs — here `index.node.js`,
 * the headless one.
 *
 * Aliasing BOTH `esengine` and `esengine/node` to the same file is not a
 * detail: two SDK copies would mean two component registries, and the
 * handshake's schema check would reject the server's own clients.
 *
 *   node server/run.mjs [--port 8080] [--host 127.0.0.1] [--fps 60]
 *                       [--sdk <dir>] [--wasm <dir>] [--build-only]
 *
 * `--sdk` and `--wasm` default to what the editor stages inside the project
 * (`.esengine/sdk`, `.esengine/play/wasm`), falling back to the engine repo's
 * own build outputs when this example is run from a checkout.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const REPO = path.resolve(PROJECT, '..', '..');

const argv = process.argv.slice(2);
function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
}
/**
 * SDK and wasm are resolved as a PAIR, never independently: they carry a shared
 * ABI layout hash and the engine refuses a module built from another component
 * schema. A fresh SDK beside a wasm an old editor session staged is the easy
 * mistake, and it dies at boot with a hash mismatch, not anywhere useful.
 */
const PAIRS = [
  // What the editor stages inside a project when it opens it.
  { sdk: path.join(PROJECT, '.esengine', 'sdk'), wasm: path.join(PROJECT, '.esengine', 'play', 'wasm') },
  // Running this example from an engine checkout.
  { sdk: path.join(REPO, 'sdk', 'dist'), wasm: path.join(REPO, 'build', 'wasm', 'web') },
];
const pair = PAIRS.find((c) => existsSync(path.join(c.sdk, 'index.node.js')) && existsSync(path.join(c.wasm, 'esengine.wasm')))
  ?? PAIRS[PAIRS.length - 1];

const sdkDir = path.resolve(flag('sdk', pair.sdk));
const wasmDir = path.resolve(flag('wasm', pair.wasm));

for (const [what, dir, needs] of [
  ['SDK', sdkDir, 'index.node.js'],
  ['engine wasm', wasmDir, 'esengine.wasm'],
]) {
  if (existsSync(path.join(dir, needs))) continue;
  console.error(`arena server: no ${what} at ${dir} (looked for ${needs}).`);
  console.error(`  Open the project in the editor once, or pass --${what === 'SDK' ? 'sdk' : 'wasm'} <dir>.`);
  process.exit(2);
}

const sdkEntry = path.join(sdkDir, 'index.node.js');
const outfile = path.join(PROJECT, '.esengine', 'cache', 'server.mjs');

const { build } = await import('esbuild');
await build({
  entryPoints: [path.join(HERE, 'main.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  logLevel: 'info',
  // `ws` is CommonJS: the bundle calls `require('events')` and an ESM output has
  // no `require`. Building one from this module's URL is the esbuild recipe —
  // only node builtins reach it, everything else is already inlined.
  banner: {
    js: "import { createRequire as __estellaCreateRequire } from 'node:module';\n"
      + 'const require = __estellaCreateRequire(import.meta.url);',
  },
  // One SDK instance, whichever specifier reached it.
  alias: { esengine: sdkEntry, 'esengine/node': sdkEntry },
  // `ws` is a real dependency of the server (and only of the server): resolve it
  // from the server's own install first, then from the engine checkout.
  nodePaths: [
    path.join(HERE, 'node_modules'),
    path.join(REPO, 'node_modules'),
    path.join(REPO, 'sdk', 'node_modules'),
  ].filter((p) => existsSync(p)),
});

if (argv.includes('--build-only')) {
  console.log(`arena server: built ${outfile}`);
  process.exit(0);
}

// The wasm directory is resolved against the server process's cwd, so pass it
// absolute and let the child run wherever it likes.
const passthrough = ['port', 'host', 'fps'].flatMap((name) => {
  const value = flag(name, null);
  return value === null ? [] : [`--${name}`, value];
});
const child = spawn(process.execPath, [outfile, '--wasm', wasmDir, ...passthrough], { stdio: 'inherit' });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
