// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Regression: a Spine `.atlas` names its page image(s) as texture dependencies.
 *        The `.atlas` is a TEXT manifest (not JSON), so the dep scan must parse it and
 *        follow atlas → page image — otherwise the cook culls the texture and every
 *        ship target (playable/web/…) requests it as an external file and 404s it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanAssetDatabase } from '../electron/assetDb';
import { cookAssets } from '../electron/cookAssets';

let root: string;

const PAGE_TEX = '11111111-1111-4111-8111-111111111111';
const ATLAS = '22222222-2222-4222-8222-222222222222';
const SKEL = '33333333-3333-4333-8333-333333333333';
const SCENE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function writeAsset(rel: string, type: string, uuid: string, body: string | Uint8Array = ''): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  writeFileSync(`${abs}.meta`, JSON.stringify({ uuid, version: '2.0', type, importer: {} }));
}

// A spine atlas: the page image name sits at column 0, its region properties indented.
// The page ref (`hero.png`) is relative to the atlas file (a sibling under assets/spine/).
const atlas = [
  'hero.png',
  '\tsize: 64, 64',
  '\tfilter: Linear, Linear',
  'region',
  '\tbounds: 0, 0, 32, 32',
  '',
].join('\n');

// The scene references BOTH the skeleton and the atlas (SpineAnimation fields), the way
// discoverSceneAssets pairs them at runtime — so both are reachable directly.
const scene = JSON.stringify({
  version: '1.0', name: 'm',
  entities: [{
    id: 1, name: 'S', parent: null, children: [], components: [{
      type: 'SpineAnimation',
      data: { skeletonPath: 'assets/spine/hero.skel', atlasPath: 'assets/spine/hero.atlas' },
    }],
  }],
});

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-spinecook-'));
  writeAsset('assets/spine/hero.png', 'texture', PAGE_TEX, 'PNG');
  writeAsset('assets/spine/hero.atlas', 'spine', ATLAS, atlas);
  writeAsset('assets/spine/hero.skel', 'spine', SKEL, new Uint8Array([1, 2, 3, 4]));
  writeAsset('assets/scenes/main.esscene', 'scene', SCENE, scene);
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('spine atlas page images are cooked dependencies', () => {
  it('links atlas → page image in the dep scan (a .atlas is text, not JSON)', async () => {
    const { index } = await scanAssetDatabase(root, { write: false });
    expect(index.deps[ATLAS]).toContain(PAGE_TEX);
  });

  it('embeds the atlas page texture (reachable through the atlas — not culled)', async () => {
    const res = await cookAssets(root, { entryScenes: ['assets/scenes/main.esscene'], outDir: 'build' });
    expect(res.ok).toBe(true);
    expect(res.included).toEqual(expect.arrayContaining([SCENE, ATLAS, SKEL, PAGE_TEX]));
    expect(res.unused).not.toEqual(expect.arrayContaining([PAGE_TEX]));
  });
});
