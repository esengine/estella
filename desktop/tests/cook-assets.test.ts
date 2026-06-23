// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
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

interface AssetManifest {
  version: string;
  entries: Array<{ uuid: string; path: string; type: string }>;
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
});
