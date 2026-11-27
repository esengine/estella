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
import { scanAssetDatabase } from '../src/assets/assetDb';
import { cookAssets } from '../src/assets/cookAssets';
import { encodeRgbaPng } from '../src/assets/png';
import { metaTypeForExt } from '../../tools/assetMetaTable.js';

let root: string;

const SPECULAR = '11111111-1111-4111-8111-111111111111';
const ESENV = '22222222-2222-4222-8222-222222222222';
const SKY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CLIP = '33333333-3333-4333-8333-333333333333';
const CONTROLLER = '44444444-4444-4444-8444-444444444444';
const LAYER_CLIP = '88888888-8888-4888-8888-888888888888';
const FRAME = '55555555-5555-4555-8555-555555555555';
const FNT = '66666666-6666-4666-8666-666666666666';
const FNT_PAGE = '77777777-7777-4777-8777-777777777777';
const OLD_FNT = '99999999-9999-4999-8999-999999999999';
const OLD_FNT_PAGE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SCENE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GROOM = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CURVES = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

// A groom names its curves as a sibling file, as Blender's exporter writes it.
// And its cards, the far level of detail, as Create Hair Cards writes them beside it.
const groom = JSON.stringify({ version: 1, type: 'groom', curves: 'fur.escurves', groups: [{}], cards: { mesh: 'fur_Cards.esmesh', material: 'fur_Cards.esmaterial', screenSize: 0.2 } });
const CARDS_MESH = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01';
const CARDS_MATERIAL = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02';

function writeAsset(rel: string, type: string, uuid: string, body: string | Uint8Array = '', projectRoot = root): void {
  const abs = path.join(projectRoot, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  writeFileSync(`${abs}.meta`, JSON.stringify({ uuid, version: '2.0', type, importer: {} }));
}

// The importer writes the atlas as a SIBLING file name, resolved against the
// document — not as a project path.
const esenv = JSON.stringify({
  version: 1, irradiance: new Array(27).fill(0), specular: 'sky_env.png', sky: 'sky_sky.png',
  faceSize: 8, mipCount: 1, maxRange: 8,
});

// A layer's clip is named NOWHERE else — not by the scene, not by the base
// machine. A rewriter that walks `states` and calls that the controller stages
// this one with its authored ref, and the layer is silent in the package only.
const controller = JSON.stringify({
  version: 2, parameters: [], initialState: 'Idle',
  states: [
    { name: 'Idle', clip: 'idle.esanim', loop: true, transitions: [] },
    { name: 'Walk', motion: { kind: 'blend1d', parameter: 'speed', thresholds: [
      { value: 0, motion: { kind: 'sprite', clip: './idle.esanim' } },
      { value: 1, motion: { kind: 'sprite', clip: 'registered' } },
    ] }, transitions: [] },
  ],
  layers: [{
    name: 'Upper', initialState: 'Wave',
    states: [{
      name: 'Wave', transitions: [],
      // A SIBLING name, which is what the editor writes and what staging then
      // moves out from under — the same shape the environment's atlas has.
      motion: { kind: 'timeline', clip: 'wave.estimeline', loop: false },
    }],
  }],
});

const layerClip = JSON.stringify({
  version: '1.2', type: 'timeline', duration: 1, wrapMode: 'once', tracks: [],
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
      components: [{ type: 'Light', data: { type: 2, environment: 'assets/env/sky.esenv' } }],
    },
    {
      id: 2, name: 'Actor', parent: null, children: [],
      components: [{ type: 'UIController', data: { controller: 'assets/anim/player.esanimator' } }],
    },
    {
      id: 3, name: 'Label', parent: null, children: [],
      components: [{ type: 'BitmapText', data: { text: 'A', font: 'assets/fonts/tiny.fnt' } }],
    },
    {
      id: 4, name: 'OldLabel', parent: null, children: [],
      components: [{ type: 'BitmapText', data: { text: 'B', font: 'assets/fonts/old.fnt' } }],
    },
    {
      id: 5, name: 'Fur', parent: null, children: [],
      components: [{ type: 'Groom', data: { groom: `@uuid:${GROOM}` } }],
    },
  ],
});

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-docrefs-'));
  writeAsset('assets/env/sky_env.png', 'texture', SPECULAR, 'PNG');
  writeAsset('assets/env/sky_sky.png', 'texture', SKY, 'PNG');
  writeAsset('assets/env/sky.esenv', 'environment', ESENV, esenv);
  writeAsset('assets/anim/frame0.png', 'texture', FRAME, 'PNG');
  writeAsset('assets/anim/idle.esanim', 'animclip', CLIP, clip);
  writeAsset('assets/anim/wave.estimeline', 'animation', LAYER_CLIP, layerClip);
  writeAsset('assets/anim/player.esanimator', 'animatorcontroller', CONTROLLER, controller);
  writeAsset('assets/fonts/tiny.png', 'texture', FNT_PAGE, 'PNG');
  writeAsset('assets/fonts/tiny.fnt', metaTypeForExt('.fnt')!, FNT, fnt);
  writeAsset('assets/fonts/old.png', 'texture', OLD_FNT_PAGE, 'PNG');
  writeAsset('assets/fonts/old.fnt', 'bitmapFont', OLD_FNT, fnt.replace('tiny.png', 'old.png'));
  writeAsset('assets/fur/fur.escurves', metaTypeForExt('.escurves')!, CURVES, new Uint8Array([1, 2, 3, 4]));
  writeAsset('assets/fur/fur_Cards.esmesh', 'mesh', CARDS_MESH, new Uint8Array([5, 6, 7, 8]));
  writeAsset('assets/fur/fur_Cards.esmaterial', 'material', CARDS_MATERIAL, JSON.stringify({ version: '1.0', type: 'material', shader: 'builtin:hair', properties: {} }));
  writeAsset('assets/fur/fur.esgroom', metaTypeForExt('.esgroom')!, GROOM, groom);
  writeAsset('assets/scenes/main.esscene', 'scene', SCENE, scene);
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
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

  it('links a bitmap font whose .meta carries the type it was minted with before the rename', async () => {
    const { index } = await scanAssetDatabase(root, { write: false });
    expect(index.deps[OLD_FNT]).toContain(OLD_FNT_PAGE);
  });

  it('links animator controller → the clip its state plays', async () => {
    const { index } = await scanAssetDatabase(root, { write: false });
    expect(index.deps[CONTROLLER]).toContain(CLIP);
  });

  it.each([
    ['Sprite', 'path'], ['MeshRenderer', 'path'],
    ['Sprite', 'uuid'], ['MeshRenderer', 'uuid'],
  ])('cooks only material dependency fields for %s with %s references', async (type, refs) => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'estella-material-refs-'));
    const scene = 'assets/main.esscene';
    const child = 'assets/mats/child.esmaterial', base = 'assets/mats/base';
    const detail = 'assets/mats/detail', shader = 'assets/shaders/model';
    const put = (rel: string, type: string, uuid: string, body: string | Uint8Array) => writeAsset(rel, type, uuid, body, projectRoot);
    try {
      put(scene, 'scene', SCENE, JSON.stringify({ version: 4, entities: [{ id: 1, parent: null, children: [],
        components: [{ type, data: { material: child } }],
      }] }));
      put(child, 'material', 'child', JSON.stringify({
        type: 'material', instanceOf: refs === 'uuid' ? '@uuid:base' : './base', shader: '../shaders/old.esshader', properties: {},
      }));
      put(base, 'material', 'base', JSON.stringify({
        type: 'material', shader: refs === 'uuid' ? '@uuid:shader' : '../shaders/model', name: 'unused.png',
        properties: { mainTex: 'detail', tint: { r: 1, description: 'unused.png' } },
      }));
      put(shader, 'shader', 'shader', '#pragma shader "Model"');
      put('assets/shaders/old.esshader', 'shader', 'old-shader', '#pragma shader "Old"');
      const image = encodeRgbaPng(1, 1, new Uint8Array([128, 128, 255, 255]));
      put(detail, 'texture', 'detail', image);
      put('assets/mats/unused.png', 'texture', 'unused', image);
      put('detail', 'texture', 'unrelated', image);

      const fresh = (await scanAssetDatabase(projectRoot, { write: false })).index;
      expect(fresh.deps.child).toEqual(['base']);
      expect(fresh.deps.base).toEqual(['detail', 'shader']);
      const cachePath = path.join(projectRoot, '.esengine/cache/ref-candidates.json');
      const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
      cache.files[child].c.push('../shaders/old.esshader');
      cache.files[base].c.push('unused.png');
      writeFileSync(cachePath, JSON.stringify({ ...cache, version: 6 }));
      const { index } = await scanAssetDatabase(projectRoot, { write: false });
      expect(index.deps.child).toEqual(['base']);
      expect(index.deps.base).toEqual(['detail', 'shader']);

      const cooked = await cookAssets(projectRoot, { entryScenes: [scene], outDir: 'output', contentAddressed: true });
      expect(cooked.ok, cooked.warnings.join('\n')).toBe(true);
      expect(cooked.included.sort()).toEqual([SCENE, 'base', 'child', 'detail', 'shader'].sort());
      const manifest = JSON.parse(readFileSync(cooked.manifestPath!, 'utf8')) as { entries: { uuid: string; path: string }[] };
      const stored = (id: string) => readFileSync(path.join(cooked.outDir, manifest.entries.find(e => e.uuid === id)!.path));
      expect(JSON.parse(stored('child').toString())).toMatchObject({
        instanceOf: refs === 'uuid' ? '@uuid:base' : base, shader: '../shaders/old.esshader',
      });
      expect(JSON.parse(stored('base').toString())).toMatchObject({
        shader: refs === 'uuid' ? '@uuid:shader' : shader, properties: { mainTex: detail },
      });
      expect(stored('detail')).toEqual(Buffer.from(image));
    } finally {
      rmSync(projectRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  it('ships a controller and nested clips selected by older explicit keys and mixed-case paths', async () => {
    const testRoot = mkdtempSync(path.join(tmpdir(), 'estella-indexed-motions-'));
    const put = (rel: string, uuid: string, type: string, data: unknown) => {
      const file = path.join(testRoot, rel);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(data));
      writeFileSync(file + '.meta', JSON.stringify({ version: '2.0', uuid, type, importer: {} }));
    };
    try {
      put('assets/main.esscene', SCENE, 'scene', { version: '1.0', name: 'Actor', entities: [{
        id: 1, name: 'Actor', parent: null, children: [], components: [
          { type: 'Animator', data: { controller: '@uuid:PLAYER' } },
          { type: 'TimelinePlayer', data: { timeline: 'anim/code.pose' } },
        ],
      }] });
      put('assets/anim/player.EsAnimator', 'player', 'animatorcontroller', {
        version: 2, parameters: [], initialState: 'Idle', states: [{ name: 'Idle', transitions: [],
          motion: { kind: 'blend1d', parameter: 'speed', thresholds: [
            { value: 0, motion: { kind: 'sprite', clip: '@uuid:IDLE' } },
            { value: 1, motion: { kind: 'timeline', clip: './walk.EsTimeline' } },
            { value: 2, motion: { kind: 'timeline', clip: 'code.pose' } },
            { value: 3, motion: { kind: 'timeline', clip: 'Poses' } },
          ] },
        }],
      });
      put('assets/anim/idle.esanim', 'idle', 'animclip', { version: '1.2', frames: [] });
      put('assets/anim/walk.EsTimeline', LAYER_CLIP, 'animation', { version: 1, tracks: [] });
      put('assets/anim/code.pose', 'unrelated', 'material', { version: '1.0', shader: 'builtin:standard' });
      put('assets/anim/Poses', 'pose', 'animation', { version: 1, tracks: [] });
      const { index } = await scanAssetDatabase(testRoot, { write: false });
      expect(index.deps[SCENE]).toEqual(['player']);
      expect(index.deps.player).toEqual([LAYER_CLIP, 'idle', 'pose'].sort());
      const cachePath = path.join(testRoot, '.esengine/cache/ref-candidates.json');
      const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
      cache.files['assets/anim/player.EsAnimator'].c = ['@uuid:IDLE'];
      writeFileSync(cachePath, JSON.stringify({ ...cache, version: 3 }));
      const rescanned = await scanAssetDatabase(testRoot, { write: false });
      expect(rescanned.index.deps.player).toEqual(index.deps.player);
      const cooked = await cookAssets(testRoot, { entryScenes: ['assets/main.esscene'], outDir: 'output', contentAddressed: true });
      expect(cooked.ok).toBe(true);
      expect(cooked.inclusion['assets/anim/code.pose']).toBeUndefined();
      expect(cooked.included.sort()).toEqual([SCENE, 'player', 'idle', LAYER_CLIP, 'pose'].sort());
      const manifest = JSON.parse(readFileSync(cooked.manifestPath!, 'utf8')) as { entries: { uuid: string; path: string }[] };
      const controller = manifest.entries.find(e => e.uuid === 'player')!;
      const stored = JSON.parse(readFileSync(path.join(cooked.outDir, controller.path), 'utf8'));
      expect(stored.states[0].motion.thresholds.map((s: { motion: { clip: string } }) => s.motion.clip))
        .toEqual(['@uuid:IDLE', 'assets/anim/walk.EsTimeline', 'code.pose', 'assets/anim/Poses']);
    } finally {
      rmSync(testRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  it('links it to the clip only a LAYER plays', async () => {
    const { index } = await scanAssetDatabase(root, { write: false });
    expect(index.deps[CONTROLLER]).toContain(LAYER_CLIP);
  });

  it('ships both, and the clip\'s own frame through it', async () => {
    const res = await cookAssets(root, { entryScenes: ['assets/scenes/main.esscene'], outDir: 'build' });
    expect(res.ok).toBe(true);
    expect(res.included).toEqual(expect.arrayContaining([SCENE, ESENV, SPECULAR, CONTROLLER, CLIP, LAYER_CLIP, FRAME, FNT, FNT_PAGE, OLD_FNT, OLD_FNT_PAGE, GROOM, CURVES, CARDS_MESH, CARDS_MATERIAL]));
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
    const staged = JSON.parse(readFileSync(path.join(res.outDir, env.path), 'utf8')) as { specular: string; sky: string };
    expect(staged.specular).toBe('assets/env/sky_env.png');
    expect(manifest.entries.some((e) => e.sourcePath === staged.specular)).toBe(true);
    // The sky it draws is the same kind of sibling, and lost the same way.
    expect(staged.sky).toBe('assets/env/sky_sky.png');
    expect(manifest.entries.some((e) => e.sourcePath === staged.sky)).toBe(true);

    // The bitmap font says the same thing in text rather than JSON.
    const font = manifest.entries.find((e) => e.uuid === FNT)!;
    const stagedFnt = readFileSync(path.join(res.outDir, font.path), 'utf8');
    expect(stagedFnt).toContain('file="assets/fonts/tiny.png"');

    // A layer's clip is staged under a name the package has, same as the base
    // machine's. Left as authored it resolves to nothing and the layer poses
    // nothing — in the build only, the editor serving the whole project.
    const ctrl = manifest.entries.find((e) => e.uuid === CONTROLLER)!;
    const stagedCtrl = JSON.parse(readFileSync(path.join(res.outDir, ctrl.path), 'utf8')) as {
      states: { clip?: string; motion?: { thresholds: { motion: { clip: string } }[] } }[];
      layers: { states: { motion: { clip: string } }[] }[];
    };
    const [idle, walk] = stagedCtrl.states;
    expect(idle!.clip).toBe('assets/anim/idle.esanim');
    expect(walk!.motion!.thresholds.map(stop => stop.motion.clip)).toEqual(['assets/anim/idle.esanim', 'registered']);
    const layerRef = stagedCtrl.layers[0]!.states[0]!.motion.clip;
    expect(layerRef).toBe('assets/anim/wave.estimeline');
    expect(manifest.entries.some((e) => e.sourcePath === layerRef)).toBe(true);

    // A groom's curves are the same kind of sibling: left as authored, the strands 404 in the package.
    const fur = manifest.entries.find((e) => e.uuid === GROOM)!;
    const stagedGroom = JSON.parse(readFileSync(path.join(res.outDir, fur.path), 'utf8')) as { curves: string; cards: { mesh: string; material: string } };
    expect(stagedGroom.curves).toBe('assets/fur/fur.escurves');
    expect(stagedGroom.cards).toMatchObject({ mesh: 'assets/fur/fur_Cards.esmesh', material: 'assets/fur/fur_Cards.esmaterial' });
    expect(manifest.entries.some((e) => e.sourcePath === stagedGroom.curves)).toBe(true);

    // And the package is self-consistent: nothing it staged names a path it lacks.
    expect(res.warnings.filter((w) => /does not carry/.test(w))).toEqual([]);
  });

  // The mirror image: a `builtin:` ref names code, so the package is right not to
  // carry it. It has to reach the runtime spelled as authored — rewritten toward a
  // path, it would resolve to a file nothing ever staged.
  it('leaves a built-in mesh ref alone rather than calling it dangling', async () => {
    const lone = mkdtempSync(path.join(tmpdir(), 'estella-builtin-'));
    const prev = root;
    root = lone;
    try {
      writeAsset('assets/scenes/main.esscene', 'scene', SCENE, JSON.stringify({
        version: '1.0', name: 'm',
        entities: [{
          id: 1, name: 'Cube', parent: null, children: [],
          components: [{ type: 'MeshRenderer', data: { mesh: 'builtin:cube', lit: true } }],
        }],
      }));
      const res = await cookAssets(lone, {
        entryScenes: ['assets/scenes/main.esscene'], outDir: 'build', contentAddressed: true,
      });
      expect(res.ok).toBe(true);
      expect(res.warnings.filter((w) => /does not carry/.test(w))).toEqual([]);
      const manifest = JSON.parse(readFileSync(res.manifestPath!, 'utf8')) as {
        entries: Array<{ uuid: string; path: string }>;
      };
      const staged = readFileSync(
        path.join(res.outDir, manifest.entries.find((e) => e.uuid === SCENE)!.path), 'utf8');
      expect(staged).toContain('builtin:cube');
    } finally {
      root = prev;
      rmSync(lone, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  // The backstop for the type nobody has wired up yet: whatever the document is,
  // a path it names that the package does not carry is a 404 waiting to happen.
  it('reports a staged document that names an asset the package lacks', async () => {
    const lone = mkdtempSync(path.join(tmpdir(), 'estella-dangling-'));
    const prev = root;
    root = lone;
    try {
      writeAsset('assets/env/gone.esenv', 'environment', ESENV, JSON.stringify({
        version: 1, irradiance: new Array(27).fill(0), specular: 'nowhere.png',
        faceSize: 8, mipCount: 1, maxRange: 8,
      }));
      writeAsset('assets/scenes/main.esscene', 'scene', SCENE, JSON.stringify({
        version: '1.0', name: 'm',
        entities: [{
          id: 1, name: 'Sky', parent: null, children: [],
          components: [{ type: 'Light', data: { type: 2, environment: 'assets/env/gone.esenv' } }],
        }],
      }));
      const res = await cookAssets(lone, { entryScenes: ['assets/scenes/main.esscene'], outDir: 'build' });
      expect(res.warnings.some((w) => /gone\.esenv: names 'nowhere\.png'/.test(w))).toBe(true);
    } finally {
      root = prev;
      rmSync(lone, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });
});
