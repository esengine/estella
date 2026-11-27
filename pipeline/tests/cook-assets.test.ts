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
import { cookAssets } from '../src/assets/cookAssets';
import type { TextureCookDecision } from '../src/assets/textureCookDecision';
import { decodePngImage } from '../src/assets/atlasPacker';
import { encodeRgbaPng } from '../src/assets/png';
import { encodeGrey16 } from '../src/assets/png16';
import { readKtx2Layout } from '../src/assets/ktx2Mips';
import { contentHashHex } from '../../sdk/src/asset/contentHash';
import { noisePng } from './fixtures/solidPng.mjs';

interface AssetManifest {
  version: string;
  entries: Array<{ uuid: string; path: string; type: string; contentHash?: string; size?: number; compressedFormats?: string[]; cook?: TextureCookDecision }>;
}

import { scanAssetDatabase, updateAssetIndex } from '../src/assets/assetDb';
import type { CookManifest } from '../src/assets/cookAssets';

let root: string;

const USED_TEX = '11111111-1111-4111-8111-111111111111';
const ORPHAN_TEX = '22222222-2222-4222-8222-222222222222';
const STRAY_TEX = '99999999-9999-4999-8999-999999999999';
const ENTRY_SCENE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORPHAN_SCENE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LOCALE_TABLE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

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
  // Referenced by nothing — but locale tables load by code (Text carries keys,
  // not paths), so the cook force-includes them instead of culling.
  writeAsset('assets/i18n/zh-CN.eslocale', 'locale', LOCALE_TABLE,
    JSON.stringify({ version: 1, locale: 'zh-CN', entries: { play: '开始' } }));
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

/** A solid RGBA PNG of an exact size — block alignment is a cook decision, so a
 *  test that wants a texture compressed has to ask for whole 4x4 blocks. */
function solidPng(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PNG } = require('pngjs') as typeof import('pngjs');
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) png.data.set(rgba, i * 4);
  return PNG.sync.write(png);
}

describe('cookAssets (A4)', () => {
  it('rejects a scene in a newer format only when it is included in the cook', async () => {
    const entry = 'assets/scenes/main.esscene';
    const future = 'assets/scenes/orphan.esscene';
    const file = path.join(root, future);
    const original = readFileSync(file, 'utf8');
    writeFileSync(file, JSON.stringify({ version: '999.0', name: 'Future', entities: [] }));
    try {
      const culled = await cookAssets(root, { entryScenes: [entry], outDir: 'build/format-culled' });
      expect(culled.ok).toBe(true);
      expect(culled.unused).toContain(ORPHAN_SCENE);

      const included = await cookAssets(root, { entryScenes: [entry, future], outDir: 'build/format-included' });
      expect(included.ok).toBe(false);
      expect(included.failed).toEqual([expect.stringMatching(/orphan\.esscene: Scene format version 999 is newer/i)]);
      expect(existsSync(path.join(included.outDir, future))).toBe(false);
      const manifest = JSON.parse(readFileSync(included.manifestPath!, 'utf8')) as CookManifest;
      expect(manifest.entries.some(e => e.uuid === ORPHAN_SCENE)).toBe(false);
    } finally {
      writeFileSync(file, original);
    }
  });

  it('includes assets reachable from the entry scene and culls the rest', async () => {
    const res = await cookAssets(root, { entryScenes: ['assets/scenes/main.esscene'], outDir: 'build' });
    expect(res.ok).toBe(true);

    // Reachable: the entry scene + its texture, plus the force-included locale table.
    expect(res.included.sort()).toEqual([ENTRY_SCENE, USED_TEX, LOCALE_TABLE].sort());
    // Culled: the orphan scene, its texture, and the totally-unreferenced one.
    expect(res.unused.sort()).toEqual([ORPHAN_SCENE, ORPHAN_TEX, STRAY_TEX].sort());
  });

  it('retains a labeled document and its dependencies, and follows sidecar-only membership edits', async () => {
    const file = path.join(root, 'assets/scenes/orphan.esscene.meta');
    const original = readFileSync(file, 'utf8');
    const tag = (labels: unknown[]) => writeFileSync(file, JSON.stringify({ ...JSON.parse(original), labels }));
    try {
      tag([' encounter ', null, 'encounter', '']);
      const { index } = await scanAssetDatabase(root, { write: false });
      expect(index.entries.find(e => e.uuid === ORPHAN_SCENE)?.labels).toEqual(['encounter']);
      const options = { entryScenes: ['assets/scenes/main.esscene'], outDir: 'build/label-case' };
      const cooked = await cookAssets(root, options);
      expect(cooked.inclusion['assets/scenes/orphan.esscene']).toEqual({ reason: 'label' });
      expect(cooked.inclusion['assets/textures/orphan.png']).toEqual({ reason: 'dependency', via: 'assets/scenes/orphan.esscene' });
      expect(cooked.unused).toContain(STRAY_TEX);
      const manifest = JSON.parse(readFileSync(cooked.manifestPath!, 'utf8')) as CookManifest;
      expect(manifest.entries.find(e => e.uuid === ORPHAN_SCENE)?.labels).toEqual(['encounter']);
      tag([]);
      const changed = await updateAssetIndex(root, index, ['assets/scenes/orphan.esscene.meta'], { write: false });
      expect(changed.fullRescan).toBe(false);
      expect(changed.index.entries.find(e => e.uuid === ORPHAN_SCENE)?.labels).toBeUndefined();
      expect((await cookAssets(root, options)).unused).toEqual(expect.arrayContaining([ORPHAN_SCENE, ORPHAN_TEX]));
    } finally {
      writeFileSync(file, original);
    }
  });

  it('stages reachable files + writes a runtime manifest; excludes culled files', async () => {
    const res = await cookAssets(root, { entryScenes: ['assets/scenes/main.esscene'], outDir: 'build' });

    expect(existsSync(path.join(res.outDir, 'assets/textures/used.png'))).toBe(true);
    expect(existsSync(path.join(res.outDir, 'assets/scenes/main.esscene'))).toBe(true);
    expect(existsSync(path.join(res.outDir, 'assets/i18n/zh-CN.eslocale'))).toBe(true);
    // Culled assets are not staged.
    expect(existsSync(path.join(res.outDir, 'assets/textures/orphan.png'))).toBe(false);
    expect(existsSync(path.join(res.outDir, 'assets/textures/stray.png'))).toBe(false);

    const manifest = JSON.parse(readFileSync(res.manifestPath!, 'utf8')) as AssetManifest;
    expect(manifest.version).toBe('1.0');
    const paths = manifest.entries.map((e) => e.path).sort();
    expect(paths).toEqual(['assets/i18n/zh-CN.eslocale', 'assets/scenes/main.esscene', 'assets/textures/used.png']);
  });

  it('fails when a required scene is missing from the asset index', async () => {
    const res = await cookAssets(root, { entryScenes: ['assets/scenes/missing.esscene'], outDir: 'build' });
    expect(res.ok).toBe(false);
    expect(res.failed).toEqual([expect.stringMatching(/assets\/scenes\/missing\.esscene: required scene is missing from the asset index/i)]);
    // Scene-reachable set is empty; the locale table still force-includes.
    expect(res.included).toEqual([LOCALE_TABLE]);
  });

  it('fails when a required scene has metadata for the wrong asset type', async () => {
    const scenePath = 'assets/scenes/orphan.esscene';
    const metaPath = path.join(root, scenePath + '.meta');
    const original = readFileSync(metaPath, 'utf8');
    writeFileSync(metaPath, JSON.stringify({ ...JSON.parse(original), type: 'json' }));
    try {
      const res = await cookAssets(root, { entryScenes: [scenePath], outDir: 'build/wrong-scene-type' });
      expect(res.ok).toBe(false);
      expect(res.failed).toEqual([expect.stringMatching(/orphan\.esscene: expected scene metadata, found "json"/i)]);
      expect(res.included).not.toContain(ORPHAN_SCENE);
    } finally {
      writeFileSync(metaPath, original);
    }
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
      rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  it('content-addresses leaf assets (<hash><ext>), dedups identical bytes, keeps scenes by name', async () => {
    const r = mkdtempSync(path.join(tmpdir(), 'estella-cook-ca-'));
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
      wa('t/b.png', 'texture', B, 'SAME-BYTES'); // byte-identical to a
      wa('t/c.png', 'texture', C, 'OTHER-BYTES');
      wa('s/main.esscene', 'scene', SC, JSON.stringify({
        version: '1.0', name: 's', entities: [A, B, C].map((u, i) => ({
          id: i + 1, name: `E${i}`, parent: null, children: [],
          components: [{ type: 'Sprite', data: { texture: `@uuid:${u}` } }],
        })),
      }));
      const res = await cookAssets(r, { entryScenes: ['s/main.esscene'], outDir: 'out', contentAddressed: true });
      const m = JSON.parse(readFileSync(res.manifestPath!, 'utf8')) as AssetManifest;
      const byUuid = (u: string) => m.entries.find((e) => e.uuid === u)!;

      // Leaf textures are content-addressed; scene keeps its logical name.
      expect(byUuid(A).path).toMatch(/^assets\/[0-9a-f]{16}\.png$/);
      expect(byUuid(SC).path).toBe('s/main.esscene');

      // Byte-identical leaves collapse to one path (and one staged file); distinct content does not.
      expect(byUuid(A).path).toBe(byUuid(B).path);
      expect(byUuid(A).path).not.toBe(byUuid(C).path);
      expect(existsSync(path.join(res.outDir, byUuid(A).path))).toBe(true);
      expect(existsSync(path.join(res.outDir, byUuid(C).path))).toBe(true);
    } finally {
      rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  it('on Auto, compresses what a mesh draws to KTX2 + records compressedFormats, and ships a sprite\'s image', async () => {
    const r = mkdtempSync(path.join(tmpdir(), 'estella-cook-ktx2-'));
    try {
      const TEX = '77777777-7777-4777-8777-777777777777';
      const SC = '88888888-8888-4888-8888-888888888888';
      // 64x64: a block-compressed texture must be whole 4x4 blocks, so a source
      // that is not (logo.png is 70x70) is shipped raw by design — see below.
      // Noise: a build keeps whichever came out smaller, and PNG wins on flat art.
      const png = noisePng(64, 64);
      const wa = (rel: string, type: string, uuid: string, body: Buffer | string): void => {
        const abs = path.join(r, rel);
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, body);
        writeFileSync(`${abs}.meta`, JSON.stringify({ uuid, version: '2.0', type, importer: {} }));
      };
      const SPRITE = '77777777-7777-4777-8777-777777777779';
      wa('t/logo.png', 'texture', TEX, png);
      wa('t/sprite.png', 'texture', SPRITE, png);
      wa('s/main.esscene', 'scene', SC, JSON.stringify({
        version: '1.0', name: 's', entities: [
          { id: 1, name: 'E', parent: null, children: [], components: [{ type: 'MeshRenderer', data: { mesh: 'builtin:cube', texture: `@uuid:${TEX}` } }] },
          { id: 2, name: 'S', parent: null, children: [], components: [{ type: 'Sprite', data: { texture: `@uuid:${SPRITE}` } }] },
        ],
      }));
      const res = await cookAssets(r, { entryScenes: ['s/main.esscene'], outDir: 'out', compressTextures: true });
      const m = JSON.parse(readFileSync(res.manifestPath!, 'utf8')) as AssetManifest;
      const tex = m.entries.find((e) => e.uuid === TEX)!;

      // The PNG was encoded to KTX2: extension, compressedFormats, and a valid container.
      expect(tex.path).toMatch(/\.ktx2$/);
      expect(tex.compressedFormats).toEqual(['astc-4x4', 'etc2-rgba8', 's3tc-dxt5']);
      const bytes = readFileSync(path.join(res.outDir, tex.path));
      const magic = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
      expect(magic.every((b, i) => bytes[i] === b)).toBe(true);

      // The same image on a sprite, also on Auto: shipped as its file, and said why.
      const sprite = m.entries.find((e) => e.uuid === SPRITE)!;
      expect(sprite.path).toMatch(/\.png$/);
      expect((sprite as { cook?: { reason?: string } }).cook?.reason).toBe('auto-2d');
    } finally {
      rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  }, 30_000);

  it('honors per-texture compress=false: ships the raw PNG even when the build compresses', async () => {
    const r = mkdtempSync(path.join(tmpdir(), 'estella-cook-texopt-'));
    try {
      const TEX = '77777777-7777-4777-8777-777777777771';
      const SC = '88888888-8888-4888-8888-888888888881';
      const png = readFileSync(path.resolve(__dirname, '../../examples/hello-world/assets/textures/logo.png'));
      const abs = path.join(r, 't/logo.png');
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, png);
      // Per-asset opt-out — the same switch audio clips already have.
      writeFileSync(`${abs}.meta`, JSON.stringify({ uuid: TEX, version: '2.0', type: 'texture', importer: { compress: false } }));
      const sc = path.join(r, 's/main.esscene');
      mkdirSync(path.dirname(sc), { recursive: true });
      writeFileSync(sc, JSON.stringify({ version: '1.0', name: 's', entities: [{ id: 1, name: 'E', parent: null, children: [], components: [{ type: 'Sprite', data: { texture: `@uuid:${TEX}` } }] }] }));
      writeFileSync(`${sc}.meta`, JSON.stringify({ uuid: SC, version: '2.0', type: 'scene', importer: {} }));

      const res = await cookAssets(r, { entryScenes: ['s/main.esscene'], outDir: 'out', compressTextures: true });
      const m = JSON.parse(readFileSync(res.manifestPath!, 'utf8')) as AssetManifest;
      const tex = m.entries.find((e) => e.uuid === TEX)!;
      expect(tex.path).toMatch(/\.png$/);          // NOT .ktx2 — the asset opted out
      expect(tex.compressedFormats).toBeUndefined();
    } finally {
      rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  }, 30_000);

  it('downscales a texture to its Max Size at cook (longest side capped)', async () => {
    const r = mkdtempSync(path.join(tmpdir(), 'estella-cook-maxsize-'));
    try {
      const TEX = '77777777-7777-4777-8777-777777777772';
      const SC = '88888888-8888-4888-8888-888888888882';
      const png = readFileSync(path.resolve(__dirname, '../../examples/hello-world/assets/textures/logo.png'));
      const src = decodePngImage('src', png);
      expect(Math.max(src.width, src.height)).toBeGreaterThan(64); // fixture is larger than the cap
      const abs = path.join(r, 't/logo.png');
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, png);
      // maxSize + compress:false → ships a SHRUNK PNG we can measure directly.
      writeFileSync(`${abs}.meta`, JSON.stringify({ uuid: TEX, version: '2.0', type: 'texture', importer: { compress: false, maxSize: 64 } }));
      const sc = path.join(r, 's/main.esscene');
      mkdirSync(path.dirname(sc), { recursive: true });
      writeFileSync(sc, JSON.stringify({ version: '1.0', name: 's', entities: [{ id: 1, name: 'E', parent: null, children: [], components: [{ type: 'Sprite', data: { texture: `@uuid:${TEX}` } }] }] }));
      writeFileSync(`${sc}.meta`, JSON.stringify({ uuid: SC, version: '2.0', type: 'scene', importer: {} }));

      const res = await cookAssets(r, { entryScenes: ['s/main.esscene'], outDir: 'out', compressTextures: true });
      const m = JSON.parse(readFileSync(res.manifestPath!, 'utf8')) as AssetManifest;
      const tex = m.entries.find((e) => e.uuid === TEX)!;
      const shrunk = decodePngImage('out', readFileSync(path.join(res.outDir, tex.path)));
      expect(Math.max(shrunk.width, shrunk.height)).toBeLessThanOrEqual(64);
      expect(Math.max(shrunk.width, shrunk.height)).toBeGreaterThan(32); // scaled to fit, not over-shrunk
    } finally {
      rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  }, 30_000);

  it('ships a texture that is not whole 4x4 blocks raw, and says why', async () => {
    const r = mkdtempSync(path.join(tmpdir(), 'estella-cook-block-'));
    try {
      const TEX = '77777777-7777-4777-8777-777777777779';
      const SC = '88888888-8888-4888-8888-888888888889';
      // 70x70 — what hello-world ships, and what made every desktop package draw
      // nothing: WebGPU refuses an ASTC texture that is not whole blocks.
      const abs = path.join(r, 't/odd.png');
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, solidPng(70, 70, [10, 200, 40, 255]));
      writeFileSync(`${abs}.meta`, JSON.stringify({ uuid: TEX, version: '2.0', type: 'texture', importer: { compress: 'on' } }));
      const sc = path.join(r, 's/main.esscene');
      mkdirSync(path.dirname(sc), { recursive: true });
      writeFileSync(sc, JSON.stringify({ version: '1.0', name: 's', entities: [{ id: 1, name: 'E', parent: null, children: [], components: [{ type: 'Sprite', data: { texture: `@uuid:${TEX}` } }] }] }));
      writeFileSync(`${sc}.meta`, JSON.stringify({ uuid: SC, version: '2.0', type: 'scene', importer: {} }));

      const res = await cookAssets(r, { entryScenes: ['s/main.esscene'], outDir: 'out', compressTextures: true });
      const m = JSON.parse(readFileSync(res.manifestPath!, 'utf8')) as AssetManifest;
      const tex = m.entries.find((e) => e.uuid === TEX)!;
      expect(tex.path).toMatch(/\.png$/);
      expect(tex.compressedFormats).toBeUndefined();
      expect(res.warnings.some((w) => w.includes('70x70') && w.includes('multiple of 4'))).toBe(true);
      // The manifest carries the decision, not just its consequence: an absent
      // `compressedFormats` cannot say whether the build, the asset or the image
      // is why, and those are three different things to go and change.
      expect(tex.cook).toEqual({ requested: 'uastc', selected: 'raw', reason: 'not-block-aligned' });
    } finally {
      rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  it('applies a per-platform texture override: one asset, smaller raw PNG for WeChat vs KTX2 for web', async () => {
    const r = mkdtempSync(path.join(tmpdir(), 'estella-cook-platov-'));
    try {
      const TEX = '77777777-7777-4777-8777-777777777773';
      const SC = '88888888-8888-4888-8888-888888888883';
      // Noise: the platform override is the subject, so the default side has to
      // be a texture a build would really compress.
      const png = noisePng(64, 64);
      const abs = path.join(r, 't/logo.png');
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, png);
      // Default: compress (KTX2). WeChat override: ship a small raw PNG instead.
      writeFileSync(`${abs}.meta`, JSON.stringify({
        uuid: TEX, version: '2.0', type: 'texture',
        importer: { compress: 'on', overrides: { wechat: { enabled: true, compress: 'off', maxSize: 64 } } },
      }));
      const sc = path.join(r, 's/main.esscene');
      mkdirSync(path.dirname(sc), { recursive: true });
      writeFileSync(sc, JSON.stringify({ version: '1.0', name: 's', entities: [{ id: 1, name: 'E', parent: null, children: [], components: [{ type: 'Sprite', data: { texture: `@uuid:${TEX}` } }] }] }));
      writeFileSync(`${sc}.meta`, JSON.stringify({ uuid: SC, version: '2.0', type: 'scene', importer: {} }));

      const web = await cookAssets(r, { entryScenes: ['s/main.esscene'], outDir: 'out-web', compressTextures: true, platform: 'web' });
      const wechat = await cookAssets(r, { entryScenes: ['s/main.esscene'], outDir: 'out-wx', compressTextures: true, platform: 'wechat' });
      const texOf = (res: Awaited<ReturnType<typeof cookAssets>>) =>
        (JSON.parse(readFileSync(res.manifestPath!, 'utf8')) as AssetManifest).entries.find((e) => e.uuid === TEX)!;

      expect(texOf(web).path).toMatch(/\.ktx2$/);        // web: default → compressed
      const wx = texOf(wechat);
      expect(wx.path).toMatch(/\.png$/);                 // wechat override: raw PNG…
      const shrunk = decodePngImage('wx', readFileSync(path.join(wechat.outDir, wx.path)));
      expect(Math.max(shrunk.width, shrunk.height)).toBeLessThanOrEqual(64); // …downscaled to its cap
    } finally {
      rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  }, 30_000);

  it('follows PATH refs: scene → material (project path) → shader + texture (dir-relative)', async () => {
    const r = mkdtempSync(path.join(tmpdir(), 'estella-cook-pathref-'));
    try {
      const SC = 'aaaa1111-1111-4111-8111-111111111111';
      const MAT = 'aaaa2222-2222-4222-8222-222222222222';
      const SHADER = 'aaaa3333-3333-4333-8333-333333333333';
      const TEX = 'aaaa4444-4444-4444-8444-444444444444';
      const ORPHAN = 'aaaa5555-5555-4555-8555-555555555555';
      const LEGACY = 'aaaa6666-6666-4666-8666-666666666666';
      const wa = (rel: string, type: string, uuid: string, body: string): void => {
        const abs = path.join(r, rel);
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, body);
        writeFileSync(`${abs}.meta`, JSON.stringify({ uuid, version: '2.0', type, importer: {} }));
      };
      // The real-content shape: the scene names the material by PROJECT PATH (no
      // @uuid:), and the material names its shader + texture RELATIVE to itself.
      wa('assets/materials/m.esmaterial', 'material', MAT, JSON.stringify({
        version: '1.0', type: 'material', shader: 'm.esshader',
        properties: { u_mask: 'green.png', u_roughness: 'rough.png', u_mode: 'additive' },
      }));
      wa('assets/materials/m.esshader', 'shader', SHADER,
        '#pragma shader "M"\n#pragma fragment\nvoid main() {}\n#pragma end\n');
      wa('assets/materials/green.png', 'texture', TEX, 'G');
      wa('green.png', 'texture', ORPHAN, 'O');
      wa('rough.png', 'texture', LEGACY, 'R');
      wa('s/main.esscene', 'scene', SC, JSON.stringify({
        version: '1.0', name: 's', entities: [
          { id: 1, name: 'E', parent: null, children: [], components: [{ type: 'Sprite', data: { material: 'assets/materials/m.esmaterial' } }] },
        ],
      }));

      const res = await cookAssets(r, { entryScenes: ['s/main.esscene'], outDir: 'out' });
      expect(res.included.sort()).toEqual([SC, MAT, SHADER, TEX, LEGACY].sort());
      expect(res.unused).toEqual([ORPHAN]);
      // A twin-less shader ships GL-only: the cook says so.
      expect(res.warnings.some((w) => w.includes('no WGSL twin'))).toBe(true);

      // Content addressing renames the physical file but keeps the LOGICAL
      // identity in sourcePath — what path refs name at runtime.
      const ca = await cookAssets(r, { entryScenes: ['s/main.esscene'], outDir: 'out-ca', contentAddressed: true });
      const m = JSON.parse(readFileSync(ca.manifestPath!, 'utf8')) as AssetManifest & {
        entries: Array<{ uuid: string; path: string; sourcePath: string }>;
      };
      const mat = m.entries.find((e) => e.uuid === MAT)!;
      expect((mat as { sourcePath?: string }).sourcePath).toBe('assets/materials/m.esmaterial');
      expect(mat.path).toMatch(/^assets\/[0-9a-f]{16}\.esmaterial$/);

      // The staged material's RELATIVE refs were rewritten to logical project
      // paths (content addressing destroys the directory structure relative
      // resolution relies on); non-asset strings pass through untouched.
      const stagedMat = JSON.parse(readFileSync(path.join(ca.outDir, mat.path), 'utf8')) as {
        shader: string; properties: Record<string, string>;
      };
      expect(stagedMat.shader).toBe('assets/materials/m.esshader');
      expect(stagedMat.properties.u_mask).toBe('assets/materials/green.png');
      expect(stagedMat.properties.u_roughness).toBe('/rough.png');
      expect(stagedMat.properties.u_mode).toBe('additive');
    } finally {
      rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  it('bare uuid refs (anim-frame form) create edges only when they name a real asset', async () => {
    const r = mkdtempSync(path.join(tmpdir(), 'estella-cook-bareuuid-'));
    try {
      const SC = 'bbbb1111-1111-4111-8111-111111111111';
      const CLIP = 'bbbb2222-2222-4222-8222-222222222222';
      const FRAME = 'bbbb3333-3333-4333-8333-333333333333';
      const NOT_AN_ASSET = 'bbbb9999-9999-4999-8999-999999999999'; // uuid-shaped entity id
      const wa = (rel: string, type: string, uuid: string, body: string): void => {
        const abs = path.join(r, rel);
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, body);
        writeFileSync(`${abs}.meta`, JSON.stringify({ uuid, version: '2.0', type, importer: {} }));
      };
      wa('a/frame.png', 'texture', FRAME, 'F');
      wa('a/idle.esanim', 'animclip', CLIP, JSON.stringify({
        version: '1.0', frames: [FRAME], sourceId: NOT_AN_ASSET,
      }));
      wa('s/main.esscene', 'scene', SC, JSON.stringify({
        version: '1.0', name: 's', entities: [
          { id: 1, name: 'E', parent: null, children: [], components: [{ type: 'SpriteAnimator', data: { clip: 'a/idle.esanim' } }] },
        ],
      }));
      const res = await cookAssets(r, { entryScenes: ['s/main.esscene'], outDir: 'out' });
      expect(res.included.sort()).toEqual([SC, CLIP, FRAME].sort());
    } finally {
      rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });
});

describe('cookAssets — auto-atlas (<name>.atlas folder convention)', () => {
  const TEX_A = 'cccc1111-1111-4111-8111-111111111111';
  const TEX_B = 'cccc2222-2222-4222-8222-222222222222';
  const LOOSE = 'cccc3333-3333-4333-8333-333333333333';
  const SCENE = 'cccc4444-4444-4444-8444-444444444444';

  function makeAtlasProject(): string {
    const r = mkdtempSync(path.join(tmpdir(), 'estella-cook-atlas-'));
    const wa = (rel: string, type: string, uuid: string, body: string | Buffer): void => {
      const abs = path.join(r, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, body);
      writeFileSync(`${abs}.meta`, JSON.stringify({ uuid, version: '2.0', type, importer: {} }));
    };
    wa('assets/sprites/heroes.atlas/a.png', 'texture', TEX_A, solidPng(4, 4, [255, 0, 0, 255]));
    wa('assets/sprites/heroes.atlas/b.png', 'texture', TEX_B, solidPng(4, 4, [0, 255, 0, 255]));
    wa('assets/textures/loose.png', 'texture', LOOSE, solidPng(2, 2, [0, 0, 255, 255]));
    wa('assets/scenes/main.esscene', 'scene', SCENE, JSON.stringify({
      version: '1.0', name: 's', entities: [
        { id: 1, name: 'A', parent: null, children: [], components: [{ type: 'Sprite', data: { texture: `@uuid:${TEX_A}` } }] },
        { id: 2, name: 'B', parent: null, children: [], components: [{ type: 'Sprite', data: { texture: `@uuid:${TEX_B}` } }] },
        { id: 3, name: 'L', parent: null, children: [], components: [{ type: 'Sprite', data: { texture: `@uuid:${LOOSE}` } }] },
      ],
    }));
    return r;
  }

  it('packs icons used by prefab rich text and instance overrides, leaving unrelated images out', async () => {
    const r = makeAtlasProject();
    try {
      const prefab = 'assets/label.esprefab', id = 'cccc5555-5555-4555-8555-555555555555';
      writeFileSync(path.join(r, prefab), JSON.stringify({ version: '2', name: 'Label', rootEntityId: 'root', entities: [{
        prefabEntityId: 'root', name: 'Label', parent: null, children: [], components: [
          { type: 'Text', data: { richText: false, content: '<img src="assets/sprites/heroes.atlas/a.png"/>' } },
        ],
      }] }));
      writeFileSync(path.join(r, prefab + '.meta'), JSON.stringify({ uuid: id, version: '2.0', type: 'prefab', importer: {} }));
      const override = (propertyName: string, value: unknown) => ({ type: 'property', prefabEntityId: 'root', componentType: 'Text', propertyName, value });
      const instance = (id: number, overrides: unknown[]) => ({ id, name: 'Label', parent: null, prefab, overrides });
      const scene = 'assets/scenes/main.esscene';
      writeFileSync(path.join(r, scene), JSON.stringify({ version: 4, name: 'main', entities: [
        instance(1, [override('richText', true)]),
        instance(2, [override('richText', true), override('content', `<img src="@uuid:${TEX_B}"/>`)]),
      ] }));
      const res = await cookAssets(r, { entryScenes: [scene], outDir: 'out', atlasTextures: true });
      expect(res.ok).toBe(true);
      const manifest = JSON.parse(readFileSync(res.manifestPath!, 'utf8')) as CookManifest;
      const frames = manifest.entries.filter(e => e.atlas);
      expect(frames.map(e => e.uuid).sort()).toEqual([TEX_A, TEX_B]);
      expect(new Set(frames.map(e => e.path)).size).toBe(1);
      expect(manifest.entries.some(e => e.uuid === LOOSE)).toBe(false);
    } finally { rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
  });

  it('packs atlas-folder PNGs into one staged page with frame metadata', async () => {
    const r = makeAtlasProject();
    try {
      const res = await cookAssets(r, { entryScenes: ['assets/scenes/main.esscene'], outDir: 'out', atlasTextures: true });
      expect(res.ok).toBe(true);
      const manifest = JSON.parse(readFileSync(res.manifestPath!, 'utf8')) as {
        entries: Array<{ uuid: string; path: string; sourcePath: string;
          atlas?: { page: number; frame: { x: number; y: number; width: number; height: number }; pageWidth: number; pageHeight: number } }>;
      };
      const a = manifest.entries.find((e) => e.uuid === TEX_A)!;
      const b = manifest.entries.find((e) => e.uuid === TEX_B)!;
      const loose = manifest.entries.find((e) => e.uuid === LOOSE)!;

      // Both frames point at the SAME page file; the loose texture stages standalone.
      expect(a.path).toBe('assets/sprites/heroes.atlas.page0.png');
      expect(b.path).toBe(a.path);
      expect(a.sourcePath).toBe('assets/sprites/heroes.atlas/a.png');
      expect(loose.path).toBe('assets/textures/loose.png');
      expect(loose.atlas).toBeUndefined();
      expect(existsSync(path.join(res.outDir, a.path))).toBe(true);
      // Frame sources are not staged as standalone files.
      expect(existsSync(path.join(res.outDir, 'assets/sprites/heroes.atlas/a.png'))).toBe(false);

      // Distinct frames inside a shared page whose size both entries agree on.
      expect(a.atlas!.pageWidth).toBe(b.atlas!.pageWidth);
      expect(a.atlas!.frame).not.toEqual(b.atlas!.frame);

      // Decode the staged page: each frame's pixels are its source's color.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PNG } = require('pngjs') as typeof import('pngjs');
      const page = PNG.sync.read(readFileSync(path.join(res.outDir, a.path)));
      expect(page.width).toBe(a.atlas!.pageWidth);
      const at = (f: { x: number; y: number }) => [...page.data.subarray((f.y * page.width + f.x) * 4, (f.y * page.width + f.x) * 4 + 4)];
      expect(at(a.atlas!.frame)).toEqual([255, 0, 0, 255]);
      expect(at(b.atlas!.frame)).toEqual([0, 255, 0, 255]);
      const frame = a.atlas!.frame;
      expect(at({ x: frame.x + frame.width, y: frame.y })).toEqual([255, 0, 0, 255]);
    } finally {
      rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  it('keeps each source’s transparent colour settings when repeat-wrapped images share a page', async () => {
    const r = makeAtlasProject();
    try {
      const dir = path.join(r, 'assets/sprites/heroes.atlas');
      const red = [245, 10, 9, 255], blue = [4, 5, 250, 255], clear = [17, 22, 99, 0];
      const row = Uint8Array.from([...clear, ...red, ...blue]);
      for (const [name, uuid, importer] of [
        ['a', TEX_A, { wrapMode: 'repeat' }],
        ['b', TEX_B, { wrapMode: 'repeat', alphaIsTransparency: false }],
      ] as const) {
        const file = path.join(dir, name + '.png');
        writeFileSync(file, encodeRgbaPng(3, 1, row));
        writeFileSync(file + '.meta', JSON.stringify({ uuid, version: '2.0', type: 'texture', importer }));
      }
      const res = await cookAssets(r, { entryScenes: ['assets/scenes/main.esscene'], outDir: 'out', atlasTextures: true });
      expect(res.ok).toBe(true);
      const { entries } = JSON.parse(readFileSync(res.manifestPath!, 'utf8')) as CookManifest;
      const a = entries.find(e => e.uuid === TEX_A)!, b = entries.find(e => e.uuid === TEX_B)!;
      expect(a.path).toBe(b.path);
      const page = decodePngImage(a.path, readFileSync(path.join(res.outDir, a.path)));
      const at = (frame: { x: number; y: number }, dx: number) => {
        const offset = 4 * (frame.y * page.width + frame.x + dx);
        return [...page.rgba.subarray(offset, offset + 4)];
      };
      const repeated = a.atlas!.frame, preserved = b.atlas!.frame;
      expect(at(repeated, 0)).toEqual([245, 10, 9, 0]);
      expect(at(repeated, -1)).toEqual(blue);
      expect(at(repeated, repeated.width)).toEqual(at(repeated, 0));
      expect(at(preserved, 0)).toEqual(clear);
      expect(at(preserved, -1)).toEqual(blue);
      expect(at(preserved, preserved.width)).toEqual(clear);
    } finally { rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
  });

  it.each([
    ['explicit defaults', { filterMode: 'linear', sRGB: true, mipmaps: true }, true],
    ['nearest filtering', { filterMode: 'nearest' }, false],
    ['repeat wrapping', { wrapMode: 'repeat' }, false],
    ['linear data', { sRGB: false }, false],
    ['a single mip level', { mipmaps: false }, false],
    ['nine-slice borders', { sliceBorder: { left: 1, right: 2 } }, false],
  ] as const)('packs %s on a page compatible with its settings', async (_name, importer, shared) => {
    const r = makeAtlasProject();
    try {
      const meta = path.join(r, 'assets/sprites/heroes.atlas/b.png.meta');
      writeFileSync(meta, JSON.stringify({ ...JSON.parse(readFileSync(meta, 'utf8')), importer }));
      const cooked = await cookAssets(r, { entryScenes: ['assets/scenes/main.esscene'], outDir: 'out', atlasTextures: true });
      expect(cooked.ok).toBe(true);
      const { entries } = JSON.parse(readFileSync(cooked.manifestPath!, 'utf8')) as CookManifest;
      const a = entries.find(e => e.uuid === TEX_A)!, b = entries.find(e => e.uuid === TEX_B)!;
      expect(a.atlas?.page).toBe(0);
      expect(b.atlas?.page).toBe(shared ? 0 : 1);
      expect(a.path === b.path).toBe(shared);
      for (const entry of [a, b]) expect(existsSync(path.join(cooked.outDir, entry.path))).toBe(true);
    } finally { rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
  });

  it('encodes each atlas page with its authored colour space and mip levels', async () => {
    const r = makeAtlasProject();
    try {
      for (const [name, importer] of [['a', { compress: 'on' }], ['b', { compress: 'on', sRGB: false, mipmaps: false }]] as const) {
        const meta = path.join(r, `assets/sprites/heroes.atlas/${name}.png.meta`);
        writeFileSync(meta, JSON.stringify({ ...JSON.parse(readFileSync(meta, 'utf8')), importer }));
      }
      const cooked = await cookAssets(r, { entryScenes: ['assets/scenes/main.esscene'], outDir: 'out',
        atlasTextures: true, compressTextures: true, contentAddressed: true });
      expect(cooked.ok).toBe(true);
      const { entries } = JSON.parse(readFileSync(cooked.manifestPath!, 'utf8')) as CookManifest;
      const layout = (uuid: string) => {
        const entry = entries.find(e => e.uuid === uuid)!;
        expect(entry.atlas).toBeDefined();
        return readKtx2Layout(readFileSync(path.join(cooked.outDir, entry.path)))!;
      };
      const colour = layout(TEX_A), linear = layout(TEX_B);
      expect(colour.srgb).toBe(true);
      expect(colour.levels.length).toBeGreaterThan(1);
      expect(linear.srgb).toBe(false);
      expect(linear.levels).toHaveLength(1);
    } finally { rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
  });

  it('preserves data samples and 16-bit images in an atlas directory', async () => {
    const r = makeAtlasProject();
    try {
      const dir = path.join(r, 'assets/sprites/heroes.atlas');
      const meta = path.join(dir, 'a.png.meta');
      writeFileSync(meta, JSON.stringify({ ...JSON.parse(readFileSync(meta, 'utf8')), importer: { use: 'data', compress: 'on' } }));
      const wide = encodeGrey16({ width: 2, height: 2, data: new Uint16Array([129, 250, 258, 65535]) });
      writeFileSync(path.join(dir, 'b.png'), wide);
      const cooked = await cookAssets(r, { entryScenes: ['assets/scenes/main.esscene'], outDir: 'out',
        atlasTextures: true, compressTextures: true, contentAddressed: true });
      expect(cooked.ok).toBe(true);
      const { entries } = JSON.parse(readFileSync(cooked.manifestPath!, 'utf8')) as CookManifest;
      for (const [uuid, name] of [[TEX_A, 'a.png'], [TEX_B, 'b.png']]) {
        const entry = entries.find(e => e.uuid === uuid)!;
        expect(entry.atlas).toBeUndefined();
        expect(readFileSync(path.join(cooked.outDir, entry.path))).toEqual(readFileSync(path.join(dir, name)));
      }
    } finally { rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
  });

  it('preserves full mesh UVs when a texture is also used by a sprite in an atlas folder', async () => {
    const r = makeAtlasProject();
    try {
      const scenePath = 'assets/scenes/main.esscene', file = path.join(r, scenePath);
      const scene = JSON.parse(readFileSync(file, 'utf8'));
      scene.entities[1].components.push({ type: 'MeshRenderer', data: { texture: `@uuid:${TEX_B}` } });
      writeFileSync(file, JSON.stringify(scene));
      const res = await cookAssets(r, { entryScenes: [scenePath], outDir: 'out', atlasTextures: true, contentAddressed: true });
      expect(res.ok).toBe(true);
      const { entries } = JSON.parse(readFileSync(res.manifestPath!, 'utf8')) as CookManifest;
      const sprite = entries.find(e => e.uuid === TEX_A)!, shared = entries.find(e => e.uuid === TEX_B)!;
      expect(sprite.atlas).toBeDefined();
      expect(shared.atlas).toBeUndefined();
      expect(shared.path).not.toBe(sprite.path);
      const actual = readFileSync(path.join(r, 'out', shared.path));
      expect(actual).toEqual(readFileSync(path.join(r, 'assets/sprites/heroes.atlas/b.png')));
    } finally { rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
  });

  it('stages atlas-folder textures standalone when atlasTextures is off', async () => {
    const r = makeAtlasProject();
    try {
      const res = await cookAssets(r, { entryScenes: ['assets/scenes/main.esscene'], outDir: 'out' });
      const manifest = JSON.parse(readFileSync(res.manifestPath!, 'utf8')) as {
        entries: Array<{ uuid: string; path: string; atlas?: unknown }>;
      };
      const a = manifest.entries.find((e) => e.uuid === TEX_A)!;
      expect(a.path).toBe('assets/sprites/heroes.atlas/a.png');
      expect(a.atlas).toBeUndefined();
    } finally {
      rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  it('content-addressed staging names the page by its hash, shared by both frames', async () => {
    const r = makeAtlasProject();
    try {
      const res = await cookAssets(r, {
        entryScenes: ['assets/scenes/main.esscene'], outDir: 'out',
        atlasTextures: true, contentAddressed: true,
      });
      const manifest = JSON.parse(readFileSync(res.manifestPath!, 'utf8')) as {
        entries: Array<{ uuid: string; path: string; contentHash: string; sourcePath: string; atlas?: unknown }>;
      };
      const a = manifest.entries.find((e) => e.uuid === TEX_A)!;
      const b = manifest.entries.find((e) => e.uuid === TEX_B)!;
      expect(a.path).toBe(`assets/${a.contentHash}.png`);
      expect(b.path).toBe(a.path);
      expect(a.sourcePath).toBe('assets/sprites/heroes.atlas/a.png');
      expect(existsSync(path.join(res.outDir, a.path))).toBe(true);
    } finally {
      rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });
});

/**
 * What a shared asset costs: once. A texture both the main scene and a subpackage
 * scene use is staged in the main package — copying it per subpackage would bill
 * a player twice for one image, and a size report reading that would be right
 * about the files and wrong about the game.
 */
describe('an asset two groups share', () => {
  let shared: string;
  const SHARED_TEX = '33333333-3333-4333-8333-333333333333';
  const LEVEL2_SCENE = '44444444-4444-4444-8444-444444444444';
  const MAIN_SCENE = '55555555-5555-4555-8555-555555555555';

  beforeAll(() => {
    shared = mkdtempSync(path.join(tmpdir(), 'estella-cook-shared-'));
    const write = (rel: string, type: string, uuid: string, body = ''): void => {
      const abs = path.join(shared, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, body);
      writeFileSync(`${abs}.meta`, JSON.stringify({ uuid, version: '2.0', type, importer: {} }));
    };
    write('assets/textures/shared.png', 'texture', SHARED_TEX, 'SHARED');
    write('assets/scenes/main.esscene', 'scene', MAIN_SCENE, sprite(SHARED_TEX));
    // The subpackage's own scene uses the same texture, which lives outside it.
    write('assets/level2/level2.esscene', 'scene', LEVEL2_SCENE, sprite(SHARED_TEX));
    mkdirSync(path.join(shared, '.esengine'), { recursive: true });
    writeFileSync(path.join(shared, '.esengine', 'asset-groups.json'),
      JSON.stringify({ version: '1.0', groups: { level2: { folder: 'assets/level2', mode: 'subpackage' } } }));
  });

  afterAll(() => rmSync(shared, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

  it('stages it once, in the package that is always there', async () => {
    const outDir = path.join(shared, '.cook-shared');
    const res = await cookAssets(shared, { entryScenes: ['assets/scenes/main.esscene'], outDir });
    expect(res.ok).toBe(true);
    const manifest = JSON.parse(readFileSync(path.join(outDir, 'assets.manifest.json'), 'utf8')) as AssetManifest;
    const staged = manifest.entries.filter((e) => e.uuid === SHARED_TEX);
    expect(staged).toHaveLength(1);
    // Not under subpackages/: a file inside one is absent until that package is
    // fetched, and the main scene needs this texture on the first frame.
    expect(staged[0]!.path.startsWith('subpackages/')).toBe(false);
    // And the subpackage scene did come along — the group is force-included, so
    // this is a shared asset rather than one the walk never reached.
    expect(manifest.entries.some((e) => e.uuid === LEVEL2_SCENE)).toBe(true);
  });
});
