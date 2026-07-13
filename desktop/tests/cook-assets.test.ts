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
  entries: Array<{ uuid: string; path: string; type: string; contentHash?: string; size?: number; compressedFormats?: string[] }>;
}

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
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('cookAssets (A4)', () => {
  it('includes assets reachable from the entry scene and culls the rest', async () => {
    const res = await cookAssets(root, { entryScenes: ['assets/scenes/main.esscene'], outDir: 'build' });
    expect(res.ok).toBe(true);

    // Reachable: the entry scene + its texture, plus the force-included locale table.
    expect(res.included.sort()).toEqual([ENTRY_SCENE, USED_TEX, LOCALE_TABLE].sort());
    // Culled: the orphan scene, its texture, and the totally-unreferenced one.
    expect(res.unused.sort()).toEqual([ORPHAN_SCENE, ORPHAN_TEX, STRAY_TEX].sort());
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

  it('warns when an entry scene is not a tracked asset', async () => {
    const res = await cookAssets(root, { entryScenes: ['assets/scenes/missing.esscene'], outDir: 'build' });
    expect(res.warnings.some((w) => w.includes('missing.esscene'))).toBe(true);
    // Scene-reachable set is empty; the locale table still force-includes.
    expect(res.included).toEqual([LOCALE_TABLE]);
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
      rmSync(r, { recursive: true, force: true });
    }
  });

  it('compresses raster textures to KTX2 (compressTextures) + records compressedFormats', async () => {
    const r = mkdtempSync(path.join(tmpdir(), 'estella-cook-ktx2-'));
    try {
      const TEX = '77777777-7777-4777-8777-777777777777';
      const SC = '88888888-8888-4888-8888-888888888888';
      const png = readFileSync(path.resolve(__dirname, '../../examples/hello-world/assets/textures/logo.png'));
      const wa = (rel: string, type: string, uuid: string, body: Buffer | string): void => {
        const abs = path.join(r, rel);
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, body);
        writeFileSync(`${abs}.meta`, JSON.stringify({ uuid, version: '2.0', type, importer: {} }));
      };
      wa('t/logo.png', 'texture', TEX, png);
      wa('s/main.esscene', 'scene', SC, JSON.stringify({
        version: '1.0', name: 's', entities: [
          { id: 1, name: 'E', parent: null, children: [], components: [{ type: 'Sprite', data: { texture: `@uuid:${TEX}` } }] },
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
    } finally {
      rmSync(r, { recursive: true, force: true });
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
        properties: { u_mask: 'green.png', u_mode: 'additive' },
      }));
      wa('assets/materials/m.esshader', 'shader', SHADER,
        '#pragma shader "M"\n#pragma fragment\nvoid main() {}\n#pragma end\n');
      wa('assets/materials/green.png', 'texture', TEX, 'G');
      wa('assets/materials/orphan.png', 'texture', ORPHAN, 'O');
      wa('s/main.esscene', 'scene', SC, JSON.stringify({
        version: '1.0', name: 's', entities: [
          { id: 1, name: 'E', parent: null, children: [], components: [{ type: 'Sprite', data: { material: 'assets/materials/m.esmaterial' } }] },
        ],
      }));

      const res = await cookAssets(r, { entryScenes: ['s/main.esscene'], outDir: 'out' });
      expect(res.included.sort()).toEqual([SC, MAT, SHADER, TEX].sort());
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
      expect(mat.sourcePath).toBe('assets/materials/m.esmaterial');
      expect(mat.path).toMatch(/^assets\/[0-9a-f]{16}\.esmaterial$/);

      // The staged material's RELATIVE refs were rewritten to logical project
      // paths (content addressing destroys the directory structure relative
      // resolution relies on); non-asset strings pass through untouched.
      const stagedMat = JSON.parse(readFileSync(path.join(ca.outDir, mat.path), 'utf8')) as {
        shader: string; properties: Record<string, string>;
      };
      expect(stagedMat.shader).toBe('assets/materials/m.esshader');
      expect(stagedMat.properties.u_mask).toBe('assets/materials/green.png');
      expect(stagedMat.properties.u_mode).toBe('additive');
    } finally {
      rmSync(r, { recursive: true, force: true });
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
      rmSync(r, { recursive: true, force: true });
    }
  });
});

describe('cookAssets — auto-atlas (<name>.atlas folder convention)', () => {
  const TEX_A = 'cccc1111-1111-4111-8111-111111111111';
  const TEX_B = 'cccc2222-2222-4222-8222-222222222222';
  const LOOSE = 'cccc3333-3333-4333-8333-333333333333';
  const SCENE = 'cccc4444-4444-4444-8444-444444444444';

  function solidPng(width: number, height: number, rgba: [number, number, number, number]): Buffer {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PNG } = require('pngjs') as typeof import('pngjs');
    const png = new PNG({ width, height });
    for (let i = 0; i < width * height; i++) png.data.set(rgba, i * 4);
    return PNG.sync.write(png);
  }

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
    } finally {
      rmSync(r, { recursive: true, force: true });
    }
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
      rmSync(r, { recursive: true, force: true });
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
      rmSync(r, { recursive: true, force: true });
    }
  });
});
