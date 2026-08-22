// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  engineBuild.mjs — is the engine binary the pixel verifiers judge built
 *        from the engine source that is checked out?
 *
 * A stale one does not announce itself. It draws, so every verdict downstream is
 * about an engine nobody has: a shadow fix that landed hours earlier read as a
 * platform-dependent renderer defect, because the scene written to prove the fix
 * was being run against the binary from before it. `desktop/public/wasm` is
 * gitignored, so its build stamp against the source mtimes is the whole answer.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

/** Compiled into the engine wasm. Tool-only trees (tools/*-wasm) are not. */
const ENGINE_SOURCE = ['src'];

function newestSource(root) {
  let newest = { at: 0, file: null };
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      // A generated header is an output of the build, not an input to it: its
      // mtime says when the build last ran, which would make every build stale.
      if (entry.name.includes('.generated.')) continue;
      if (!/\.(c|cc|cpp|h|hpp|inl|esshader|wgsl)$/.test(entry.name)) continue;
      const at = statSync(full).mtimeMs;
      if (at > newest.at) newest = { at, file: path.relative(root, full).split(path.sep).join('/') };
    }
  };
  for (const dir of ENGINE_SOURCE) {
    const abs = path.join(root, dir);
    if (existsSync(abs)) walk(abs);
  }
  return newest;
}

/**
 * When the binary of one build VARIANT was produced, from the manifest, or null
 * when there is nothing to date it by. Per variant, because the variants are
 * separate builds. A schema-1 manifest's single `builtAt` is the fallback: it is
 * honest only for whichever variant was built last.
 */
function variantBuiltAt(wasmDir, variant) {
  const manifest = path.join(wasmDir, 'wasm.manifest.json');
  if (!existsSync(manifest)) return null;
  let m;
  try { m = JSON.parse(readFileSync(manifest, 'utf8')); } catch { return null; }
  const own = m.variants?.[variant]?.builtAt;
  const at = Date.parse(own ?? m.builtAt ?? '');
  return Number.isFinite(at) ? at : null;
}

/**
 * A sentence naming the engine source that outran the binary, or null when the
 * binary is current (or when there is none to judge — that failure speaks for
 * itself downstream). `variant` is the build whose age is in question.
 */
export function staleEngineBuild(root, wasmDir, variant = 'web') {
  const builtAt = variantBuiltAt(wasmDir, variant);
  if (builtAt == null) return null;

  const newest = newestSource(root);
  if (!newest.file || newest.at <= builtAt) return null;
  const hours = Math.round((newest.at - builtAt) / 36e5);
  const behind = hours >= 1 ? `${hours}h` : `${Math.round((newest.at - builtAt) / 6e4)}min`;
  return `the ${variant} engine binary in ${path.relative(root, wasmDir).split(path.sep).join('/')} was built `
    + `${behind} before ${newest.file} was last changed — every pixel verdict below would be `
    + `about an engine this checkout does not have.\nBuild it: node build-tools/cli.js build -t ${variant}`;
}

/** Exit unless the binary is current. `--allow-stale-engine` says you meant it. */
export function requireCurrentEngine(root, wasmDir, argv = process.argv, variant = 'web') {
  if (argv.includes('--allow-stale-engine')) return;
  const stale = staleEngineBuild(root, wasmDir, variant);
  if (!stale) return;
  console.error(`\n✗ ${stale}\n`);
  process.exit(1);
}
