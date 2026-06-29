// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Asset cook (REARCH_ASSETS.md A4). From an entry scene, walk the
 *        AssetDatabase dep graph to the reachable assets, stage them + emit the
 *        runtime manifest, and cull anything unreferenced.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cookAssets } from '../electron/cookAssets';
import { contentHashHex } from '../../sdk/src/asset/contentHash';

interface AssetManifest {
  version: string;
  entries: Array<{ uuid: string; path: string; type: string; contentHash?: string; size?: number }>;
}

let root: string;

const USED_TEX = '11111111-1111-4111-8111-111111111111';
const ORPHAN_TEX = '22222222-2222-4222-8222-222222222222';
const STRAY_TEX = '99999999-9999-4999-8999-999999999999';
const ENTRY_SCENE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORPHAN_SCENE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function writeAsset(rel: string, type: string, uuid: string, body = ''): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  writeFileSync(`${abs}.meta`, JSON.stringify({ uuid, version: '2.0', type, importer: {} }));
}

const sprite = (texUuid: string) =>
  JSON.stringify({
    version: '1.0',
    name: 's',
    entities: [
      { id: 1, name: 'S', parent: null, children: [], components: [{ type: 'Sprite', data: { texture: `@uuid:${texUuid}` } }] },
    ],
  });

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-cook-'));
  writeAsset('assets/textures/used.png', 'texture', USED_TEX, 'USED');
  writeAsset('assets/textures/orphan.png', 'texture', ORPHAN_TEX, 'ORPHAN');
  writeAsset('assets/textures/stray.png', 'texture', STRAY_TEX, 'STRAY'); // referenced by nobody
  writeAsset('assets/scenes/main.esscene', 'scene', ENTRY_SCENE, sprite(USED_TEX));
  writeAsset('assets/scenes/orphan.esscene', 'scene', ORPHAN_SCENE, sprite(ORPHAN_TEX));
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('cookAssets (A4)', () => {
  it('includes assets reachable from the entry scene and culls the rest', async () => {
    const res = await cookAssets(root, { entryScenes: ['assets/scenes/main.esscene'], outDir: 'build' });
    expect(res.ok).toBe(true);

    // Reachable: the entry scene + its texture.
    expect(res.included.sort()).toEqual([ENTRY_SCENE, USED_TEX].sort());
    // Culled: the orphan scene, its texture, and the totally-unreferenced one.
    expect(res.unused.sort()).toEqual([ORPHAN_SCENE, ORPHAN_TEX, STRAY_TEX].sort());
  });

  it('stages reachable files + writes a runtime manifest; excludes culled files', async () => {
    const res = await cookAssets(root, { entryScenes: ['assets/scenes/main.esscene'], outDir: 'build' });

    expect(existsSync(path.join(res.outDir, 'assets/textures/used.png'))).toBe(true);
    expect(existsSync(path.join(res.outDir, 'assets/scenes/main.esscene'))).toBe(true);
    // Culled assets are not staged.
    expect(existsSync(path.join(res.outDir, 'assets/textures/orphan.png'))).toBe(false);
    expect(existsSync(path.join(res.outDir, 'assets/textures/stray.png'))).toBe(false);

    const manifest = JSON.parse(readFileSync(res.manifestPath!, 'utf8')) as AssetManifest;
    expect(manifest.version).toBe('1.0');
    const paths = manifest.entries.map((e) => e.path).sort();
    expect(paths).toEqual(['assets/scenes/main.esscene', 'assets/textures/used.png']);
  });

  it('warns when an entry scene is not a tracked asset', async () => {
    const res = await cookAssets(root, { entryScenes: ['assets/scenes/missing.esscene'], outDir: 'build' });
    expect(res.warnings.some((w) => w.includes('missing.esscene'))).toBe(true);
    expect(res.included).toEqual([]);
  });

  it('records a contentHash + size for each staged asset', async () => {
    const res = await cookAssets(root, { entryScenes: ['assets/scenes/main.esscene'], outDir: 'build' });
    const manifest = JSON.parse(readFileSync(res.manifestPath!, 'utf8')) as AssetManifest;
    for (const e of manifest.entries) {
      expect(e.contentHash, e.path).toMatch(/^[0-9a-f]{16}$/);
      expect(e.size, e.path).toBeGreaterThan(0);
    }
    // The hash is over the exact staged bytes; 'USED' is the used.png body.
    const tex = manifest.entries.find((e) => e.path === 'assets/textures/used.png')!;
    expect(tex.contentHash).toBe(contentHashHex(new TextEncoder().encode('USED')));
    expect(tex.size).toBe(4);
  });

  it('is deterministic: re-cooking yields identical content hashes', async () => {
    const a = await cookAssets(root, { entryScenes: ['assets/scenes/main.esscene'], outDir: 'build' });
    const b = await cookAssets(root, { entryScenes: ['assets/scenes/main.esscene'], outDir: 'build2' });
    const hashes = (p: string) =>
      JSON.parse(readFileSync(p, 'utf8')).entries
        .map((e: { path: string; contentHash: string }) => `${e.path}=${e.contentHash}`)
        .sort();
    expect(hashes(a.manifestPath!)).toEqual(hashes(b.manifestPath!));
  });

  it('gives identical bytes one hash (dedup foundation), distinct bytes distinct hashes', async () => {
    const r = mkdtempSync(path.join(tmpdir(), 'estella-cook-dedup-'));
    try {
      const A = '33333333-3333-4333-8333-333333333333';
      const B = '44444444-4444-4444-8444-444444444444';
      const C = '55555555-5555-4555-8555-555555555555';
      const SC = '66666666-6666-4666-8666-666666666666';
      const wa = (rel: string, type: string, uuid: string, body: string): void => {
        const abs = path.join(r, rel);
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, body);
        writeFileSync(`${abs}.meta`, JSON.stringify({ uuid, version: '2.0', type, importer: {} }));
      };
      wa('t/a.png', 'texture', A, 'SAME-BYTES');
      wa('t/b.png', 'texture', B, 'SAME-BYTES'); // byte-identical to a, different uuid+path
      wa('t/c.png', 'texture', C, 'OTHER-BYTES');
      wa('s/main.esscene', 'scene', SC, JSON.stringify({
        version: '1.0', name: 's', entities: [A, B, C].map((u, i) => ({
          id: i + 1, name: `E${i}`, parent: null, children: [],
          components: [{ type: 'Sprite', data: { texture: `@uuid:${u}` } }],
        })),
      }));
      const res = await cookAssets(r, { entryScenes: ['s/main.esscene'], outDir: 'out' });
      const m = JSON.parse(readFileSync(res.manifestPath!, 'utf8')) as AssetManifest;
      const h = (p: string) => m.entries.find((e) => e.path === p)!.contentHash;
      expect(h('t/a.png')).toBe(h('t/b.png'));     // identical content → one physical identity
      expect(h('t/a.png')).not.toBe(h('t/c.png')); // different content → different identity
    } finally {
      rmSync(r, { recursive: true, force: true });
    }
  });
});
