// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A web package carries the part of the SDK its game reaches, in one graph.
 *
 * The copied tree shipped every shared chunk of the SDK beside the page — the whole union of every
 * entry's code, terrain and water in a project with neither. The package now bundles the SDK, the
 * game host and the project's scripts together and lets the bundler drop what none of them reaches.
 *
 * Built from the real SDK: a stub tree cannot be bundled, and this is the claim that the shipped
 * graph keeps ONE copy of the engine for the host and the scripts both.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportGame } from '../src/export/exportGame';
import { OFFICIAL_PACKAGES } from './officialPackagesDir';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOSTS = path.join(HERE, '..', 'src', 'runtime');
const SDK = path.join(HERE, '..', '..', 'sdk', 'dist');
const SCN = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true, maxRetries: 5 }); });

function project(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'estella-web-bundle-'));
  roots.push(root);
  mkdirSync(path.join(root, 'scenes'), { recursive: true });
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'scenes', 'main.esscene'), JSON.stringify({
    version: '1.0', entities: [{ name: 'Root', components: [{ type: 'Transform' }] }],
  }));
  writeFileSync(path.join(root, 'scenes', 'main.esscene.meta'),
    JSON.stringify({ uuid: SCN, version: '2.0', type: 'scene', importer: {} }));
  // The project's own code reaches the SDK by the bare name, like any game.
  writeFileSync(path.join(root, 'src', 'main.ts'),
    "import { defineSystem, Schedule } from 'esengine';\nvoid defineSystem; void Schedule;\nexport const ready = true;\n");
  mkdirSync(path.join(root, '_wasm'), { recursive: true });
  writeFileSync(path.join(root, '_wasm', 'esengine.js'), 'export default () => {};');
  writeFileSync(path.join(root, '_wasm', 'esengine.wasm'), 'ENGINE');
  writeFileSync(path.join(root, '_wasm', 'wasm.manifest.json'), JSON.stringify({ schema: 1 }));
  return root;
}

function jsBytes(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'wasm' && entry.name !== 'assets') total += jsBytes(full); }
    else if (/\.m?js$/.test(entry.name)) total += statSync(full).size;
  }
  return total;
}

const run = (root: string, out: string, bundleEngine: boolean) => exportGame({
  root, entryScene: 'scenes/main.esscene', hostsDir: HOSTS, packagesDir: OFFICIAL_PACKAGES,
  scriptsEntry: 'src/main.ts', sdkDistDir: SDK, wasmDir: path.join(root, '_wasm'),
  outDir: out, platform: 'web', minifyScripts: true, bundleEngine,
});

describe.skipIf(!existsSync(path.join(SDK, 'index.lean.js')))('a web package built from the real SDK', () => {
  it('bundles the SDK with the host and the scripts, and ships no copied tree', async () => {
    const root = project();
    const out = path.join(root, 'dist');
    // The suite runs the copied tree by default; this is the one place that builds the bundled one.
    const saved = process.env.ESTELLA_WEB_BUNDLE_ENGINE;
    delete process.env.ESTELLA_WEB_BUNDLE_ENGINE;
    let res;
    try { res = await run(root, out, true); } finally {
      if (saved !== undefined) process.env.ESTELLA_WEB_BUNDLE_ENGINE = saved;
    }
    expect(res.ok, res.errors.join('; ')).toBe(true);

    expect(existsSync(path.join(out, 'sdk'))).toBe(false);
    expect(existsSync(path.join(out, 'chunks'))).toBe(true);
    const cfg = JSON.parse(readFileSync(path.join(out, 'game.config.json'), 'utf8'));
    expect(cfg.scripts).toBe('scripts.js');

    // Nothing is left for a page to resolve, and the host and the scripts import the SDK from the same chunks:
    // two copies of the core would split every identity-keyed resource between them.
    const html = readFileSync(path.join(out, 'index.html'), 'utf8');
    expect(html).toContain('"imports":{}');
    const game = readFileSync(path.join(out, 'game.js'), 'utf8');
    const scripts = readFileSync(path.join(out, 'scripts.js'), 'utf8');
    for (const text of [game, scripts]) expect(text).not.toMatch(/from\s*["']esengine/);
    const chunkOf = (text: string) => new Set([...text.matchAll(/["']\.\/chunks\/([^"']+)["']/g)].map((m) => m[1]));
    const shared = [...chunkOf(scripts)].filter((c) => chunkOf(game).has(c));
    expect(shared.length, 'scripts.js and game.js import a chunk in common').toBeGreaterThan(0);
  }, 120_000);

  it('ships far less script than the copied tree for the same game', async () => {
    const root = project();
    const bundledOut = path.join(root, 'dist-bundled');
    const copiedOut = path.join(root, 'dist-copied');
    const saved = process.env.ESTELLA_WEB_BUNDLE_ENGINE;
    delete process.env.ESTELLA_WEB_BUNDLE_ENGINE;
    let bundled; let copied;
    try {
      bundled = await run(root, bundledOut, true);
      copied = await run(root, copiedOut, false);
    } finally {
      if (saved !== undefined) process.env.ESTELLA_WEB_BUNDLE_ENGINE = saved;
    }
    expect(bundled.ok, bundled.errors.join('; ')).toBe(true);
    expect(copied.ok, copied.errors.join('; ')).toBe(true);
    expect(existsSync(path.join(copiedOut, 'sdk'))).toBe(true);
    expect(jsBytes(bundledOut)).toBeLessThan(jsBytes(copiedOut) * 0.6);
  }, 180_000);
});
