// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Produces the two cooked builds headless-hotupdate-verify.mjs drives — a
 *        shipped build of examples/hot-update-demo (green CDN art) and a "CDN
 *        update" of the same project with the remote art swapped to red (a
 *        different content hash → a new url + manifest revision). Guarded by
 *        ESTELLA_HOTUPDATE_FIXTURE; the verify:render:hotupdate script sets it.
 *        Proves a hot update end-to-end: change a `remote`-group asset, re-cook,
 *        and the shipped runtime fetches the new content — no re-ship.
 */
import { describe, it, expect } from 'vitest';
import { writeFileSync, cpSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportGame } from '../electron/exportGame';
import { solidPng } from '../scripts/solidPng.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE = path.resolve(HERE, '..', '..', 'examples', 'hot-update-demo');
const ROOT = path.resolve(HERE, '..', '.hotupdate-verify');
const BUILD = path.join(ROOT, 'build');
const CDN = path.join(ROOT, 'cdn');
const REDSRC = path.join(ROOT, 'red-src');

const opts = (root: string, outDir: string) => ({
  root,
  entryScene: 'assets/scenes/main.esscene',
  gameHostEntry: path.resolve(HERE, '..', 'src', 'gameHost.ts'),
  scriptsEntry: 'src/main.ts',
  sdkDistDir: path.resolve(HERE, '..', '..', 'sdk', 'dist'),
  wasmDir: path.resolve(HERE, '..', '..', 'build', 'wasm', 'web'),
  outDir,
  title: 'Hot Update Demo',
  contentAddressed: true,
});

describe.skipIf(!process.env.ESTELLA_HOTUPDATE_FIXTURE)('hot-update verify fixture', () => {
  it('cooks a shipped build (green CDN art) + a CDN update (red CDN art)', async () => {
    rmSync(ROOT, { recursive: true, force: true });

    // 1. Ship build: the example exactly as committed — green art in remote/cdn/.
    const build = await exportGame(opts(EXAMPLE, BUILD));
    expect(build.ok, build.errors.join('; ')).toBe(true);

    // 2. CDN update: the SAME project but the remote art is now RED. A different
    //    hash → a new content-addressed url + a new manifest revision, so the
    //    runtime's diff sees exactly one changed asset.
    cpSync(EXAMPLE, REDSRC, {
      recursive: true,
      filter: (s) => !s.includes(`${path.sep}.esengine`) && !s.includes('node_modules'),
    });
    writeFileSync(path.join(REDSRC, 'remote', 'cdn', 'art.png'), solidPng(64, 64, [220, 40, 40, 255]));
    const cdn = await exportGame(opts(REDSRC, CDN));
    expect(cdn.ok, cdn.errors.join('; ')).toBe(true);
  }, 180_000);
});
