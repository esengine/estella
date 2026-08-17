// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Regression: an asset named ONLY from inside another asset's document is
 *        still cooked. A baked environment names its reflection atlas and an
 *        animator controller names the clips its states play; nothing in the scene
 *        graph mentions either, so a type left out of the dep scan ships the
 *        document and 404s what it needs — in the build only, since the editor
 *        serves the whole project.
 *
 *        Neither asset here is referenced by the scene as well. That is the point:
 *        examples/sprite-animation happens to list its clips in the scene too, so
 *        the missing controller → clip edge was invisible for as long as it existed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanAssetDatabase } from '../../pipeline/src/assets/assetDb';
import { cookAssets } from '../../pipeline/src/assets/cookAssets';

let root: string;

const SPECULAR = '11111111-1111-4111-8111-111111111111';
const ESENV = '22222222-2222-4222-8222-222222222222';
const CLIP = '33333333-3333-4333-8333-333333333333';
const CONTROLLER = '44444444-4444-4444-8444-444444444444';
const FRAME = '55555555-5555-4555-8555-555555555555';
const FNT = '66666666-6666-4666-8666-666666666666';
const FNT_PAGE = '77777777-7777-4777-8777-777777777777';
const SCENE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function writeAsset(rel: string, type: string, uuid: string, body: string | Uint8Array = ''): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  writeFileSync(`${abs}.meta`, JSON.stringify({ uuid, version: '2.0', type, importer: {} }));
}

// The importer writes the atlas as a SIBLING file name, resolved against the
// document — not as a project path.
const esenv = JSON.stringify({
  version: 1, irradiance: new Array(27).fill(0), specular: 'sky_env.png',
  faceSize: 8, mipCount: 1, maxRange: 8,
});

const controller = JSON.stringify({
  parameters: [], initialState: 'Idle',
  states: [{ name: 'Idle', clip: 'assets/anim/idle.esanim', loop: true, transitions: [] }],
});

// A bitmap font is TEXT, and names its page image the way a spine atlas does:
// as a sibling, resolved against the .fnt's own directory at load.
const fnt = [
  'info face="tiny" size=8',
  'common lineHeight=8 base=8 scaleW=16 scaleH=8 pages=1',
  'page id=0 file="tiny.png"',
  'chars count=1',
  'char id=65 x=0 y=0 width=8 height=8 xoffset=0 yoffset=0 xadvance=8 page=0 chnl=15',
  '',
].join('\n');

const clip = JSON.stringify({
  version: '1.2', name: 'idle', fps: 8,
  frames: [{ texture: 'assets/anim/frame0.png', duration: 1 }],
});

// The scene names the environment and the controller, and NOTHING else.
const scene = JSON.stringify({
  version: '1.0', name: 'm',
  entities: [
    {
      id: 1, name: 'Sky', parent: null, children: [],
      components: [{ type: 'Light2D', data: { type: 2, environment: 'assets/env/sky.esenv' } }],
    },
    {
      id: 2, name: 'Actor', parent: null, children: [],
      components: [{ type: 'UIController', data: { controller: 'assets/anim/player.esanimator' } }],
    },
    {
      id: 3, name: 'Label', parent: null, children: [],
      components: [{ type: 'BitmapText', data: { text: 'A', font: 'assets/fonts/tiny.fnt' } }],
    },
  ],
});

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-docrefs-'));
  writeAsset('assets/env/sky_env.png', 'texture', SPECULAR, 'PNG');
  writeAsset('assets/env/sky.esenv', 'environment', ESENV, esenv);
  writeAsset('assets/anim/frame0.png', 'texture', FRAME, 'PNG');
  writeAsset('assets/anim/idle.esanim', 'animclip', CLIP, clip);
  writeAsset('assets/anim/player.esanimator', 'animatorcontroller', CONTROLLER, controller);
  writeAsset('assets/fonts/tiny.png', 'texture', FNT_PAGE, 'PNG');
  writeAsset('assets/fonts/tiny.fnt', 'bitmapFont', FNT, fnt);
  writeAsset('assets/scenes/main.esscene', 'scene', SCENE, scene);
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('assets named only inside another document are cooked', () => {
  it('links environment → its reflection atlas, resolved as a sibling', async () => {
    const { index } = await scanAssetDatabase(root, { write: false });
    expect(index.deps[ESENV]).toContain(SPECULAR);
  });

  it('links a bitmap font → the page image it names', async () => {
    const { index } = await scanAssetDatabase(root, { write: false });
    expect(index.deps[FNT]).toContain(FNT_PAGE);
  });

  it('links animator controller → the clip its state plays', async () => {
    const { index } = await scanAssetDatabase(root, { write: false });
    expect(index.deps[CONTROLLER]).toContain(CLIP);
  });

  it('ships both, and the clip\'s own frame through it', async () => {
    const res = await cookAssets(root, { entryScenes: ['assets/scenes/main.esscene'], outDir: 'build' });
    expect(res.ok).toBe(true);
    expect(res.included).toEqual(expect.arrayContaining([SCENE, ESENV, SPECULAR, CONTROLLER, CLIP, FRAME, FNT, FNT_PAGE]));
    expect(res.unused).toEqual([]);
  });

  // Shipping the atlas is only half of it: content-addressed staging moves the
  // document away from its sibling, so a ref left as-authored resolves to nothing
  // and the reflection is silently lost. The staged copy must name the asset.
  it('rewrites the staged environment\'s sibling ref to a path the package has', async () => {
    const res = await cookAssets(root, {
      entryScenes: ['assets/scenes/main.esscene'], outDir: 'build-ca', contentAddressed: true,
    });
    expect(res.ok).toBe(true);
    const manifest = JSON.parse(readFileSync(res.manifestPath!, 'utf8')) as {
      entries: Array<{ uuid: string; path: string; sourcePath: string }>;
    };
    const env = manifest.entries.find((e) => e.uuid === ESENV)!;
    const staged = JSON.parse(readFileSync(path.join(res.outDir, env.path), 'utf8')) as { specular: string };
    expect(staged.specular).toBe('assets/env/sky_env.png');
    expect(manifest.entries.some((e) => e.sourcePath === staged.specular)).toBe(true);

    // The bitmap font says the same thing in text rather than JSON.
    const font = manifest.entries.find((e) => e.uuid === FNT)!;
    const stagedFnt = readFileSync(path.join(res.outDir, font.path), 'utf8');
    expect(stagedFnt).toContain('file="assets/fonts/tiny.png"');
  });
});
