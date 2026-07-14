// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The `.esengine/sdk` types staging contract: stamped (re-mirror only
 *        when the editor/SDK changed), candidate-fallback (the in-asar dist is
 *        readable by Node when the unpacked copy is missing), and LOUD when no
 *        source exists — the v0.22.0 silent skip shipped projects whose IDE
 *        could not resolve `esengine` with zero trace (issue #49).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureSdkTypes } from '../electron/syncSdkTypes';

let root: string;
let dist: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-proj-'));
  dist = mkdtempSync(path.join(tmpdir(), 'estella-dist-'));
  writeFileSync(path.join(dist, 'index.d.ts'), 'export declare const x: 1;');
  mkdirSync(path.join(dist, 'physics'));
  writeFileSync(path.join(dist, 'physics', 'index.d.ts'), 'export {};');
  writeFileSync(path.join(dist, 'index.js'), 'js body, never mirrored');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(dist, { recursive: true, force: true });
});

const mirrored = (rel: string): string => path.join(root, '.esengine', 'sdk', rel);

describe('ensureSdkTypes', () => {
  it('mirrors the d.ts tree (layout preserved, js excluded) and stamps it', async () => {
    const res = await ensureSdkTypes(root, [dist], '1.0.0');
    expect(res.staged).toBe(true);
    expect(readFileSync(mirrored('index.d.ts'), 'utf8')).toContain('x: 1');
    expect(existsSync(mirrored('physics/index.d.ts'))).toBe(true);
    expect(existsSync(mirrored('index.js'))).toBe(false);
    expect(existsSync(mirrored('.stamp'))).toBe(true);
  });

  it('a matching stamp skips the re-mirror; a changed SDK restages', async () => {
    await ensureSdkTypes(root, [dist], '1.0.0');
    const mtime = statSync(mirrored('index.d.ts')).mtimeMs;
    expect((await ensureSdkTypes(root, [dist], '1.0.0')).staged).toBe(false);
    expect(statSync(mirrored('index.d.ts')).mtimeMs).toBe(mtime);
    // SDK rebuild (source index.d.ts mtime moves) → stamp differs → restage.
    utimesSync(path.join(dist, 'index.d.ts'), new Date(), new Date(Date.now() + 5000));
    expect((await ensureSdkTypes(root, [dist], '1.0.0')).staged).toBe(true);
    // Editor upgrade restages too.
    expect((await ensureSdkTypes(root, [dist], '2.0.0')).staged).toBe(true);
  });

  it('falls back through the candidate list to the first dist that exists', async () => {
    const missing = path.join(tmpdir(), 'estella-does-not-exist');
    const res = await ensureSdkTypes(root, [missing, dist], '1.0.0');
    expect(res.staged).toBe(true);
    expect(existsSync(mirrored('index.d.ts'))).toBe(true);
  });

  it('NO reachable dist is an error, not a silent skip', async () => {
    const missing = path.join(tmpdir(), 'estella-does-not-exist');
    await expect(ensureSdkTypes(root, [missing], '1.0.0')).rejects.toThrow(/SDK dist not found/);
    expect(existsSync(mirrored('index.d.ts'))).toBe(false);
  });
});
