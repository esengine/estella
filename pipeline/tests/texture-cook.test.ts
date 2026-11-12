// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The editor and a build ask one function for a texture's compressed form, through
 * one cache: what the editor compressed is what a later export ships, byte for
 * byte, without encoding it again.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cookTexture, loadTextureEncoder } from '../src/assets/textureCook';
import { cookAssets } from '../src/assets/cookAssets';
import { readKtx2Layout } from '../src/assets/ktx2Mips';
import { noisePng, solidPng } from './fixtures/solidPng.mjs';
import { decodePngImage, encodeRgbaPng } from '../src/assets/atlasPacker';

describe('a texture compressed for the editor', () => {
  it('is pending until compressed, then answered from the cache a build reads', async () => {
    const r = mkdtempSync(path.join(tmpdir(), 'estella-texcook-'));
    try {
      const TEX = '71717171-7171-4717-8717-717171717171';
      const SC = '81818181-8181-4818-8818-818181818181';
      const png = noisePng(64, 64);
      const abs = path.join(r, 't/noise.png');
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, png);
      writeFileSync(`${abs}.meta`, JSON.stringify({ uuid: TEX, version: '2.0', type: 'texture', importer: { compress: 'on' } }));
      const encoder = await loadTextureEncoder();
      const ask = (cachedOnly: boolean) => cookTexture({
        root: r, path: 't/noise.png', data: new Uint8Array(png), ext: '.png', importer: { compress: 'on' },
        encoder, compressTextures: true, atlasTextures: false, drawnIn3D: false, cachedOnly,
      });

      const cold = await ask(true);
      expect(cold.pending).toBe(true);
      expect(cold.ext).toBe('.png');
      const cacheDir = path.join(r, '.esengine/cache/cook');
      expect(() => readdirSync(cacheDir)).toThrow();   // asking did not encode

      const made = await ask(false);
      expect(made.ext).toBe('.ktx2');
      const warm = await ask(true);
      expect(warm.pending).toBeUndefined();
      expect(Buffer.from(warm.data).equals(Buffer.from(made.data))).toBe(true);

      const sc = path.join(r, 's/main.esscene');
      mkdirSync(path.dirname(sc), { recursive: true });
      writeFileSync(sc, JSON.stringify({ version: '1.0', name: 's', entities: [
        { id: 1, name: 'E', parent: null, children: [], components: [{ type: 'Sprite', data: { texture: `@uuid:${TEX}` } }] },
      ] }));
      writeFileSync(`${sc}.meta`, JSON.stringify({ uuid: SC, version: '2.0', type: 'scene', importer: {} }));
      const entries = readdirSync(cacheDir).length;
      const res = await cookAssets(r, { entryScenes: ['s/main.esscene'], outDir: 'out', compressTextures: true });
      const m = JSON.parse(readFileSync(res.manifestPath!, 'utf8')) as { entries: Array<{ uuid: string; path: string }> };
      const shipped = readFileSync(path.join(res.outDir, m.entries.find((e) => e.uuid === TEX)!.path));
      expect(shipped.equals(Buffer.from(made.data))).toBe(true);
      expect(readdirSync(cacheDir).length).toBe(entries);   // the build encoded nothing new
    } finally {
      rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  }, 60_000);

  it('on Auto, ships flat art as its file and compresses what a mesh draws, whatever the bytes', async () => {
    const r = mkdtempSync(path.join(tmpdir(), 'estella-texcook-auto-'));
    try {
      // A solid colour: PNG writes almost nothing, the KTX2 a byte a pixel.
      const flat = new Uint8Array(solidPng(64, 64, [40, 90, 200, 255]));
      const encoder = await loadTextureEncoder();
      const ask = (drawnIn3D: boolean) => cookTexture({
        root: r, path: 'sky.png', data: flat, ext: '.png', importer: {},
        encoder, compressTextures: true, atlasTextures: false, drawnIn3D,
      });
      const sprite = await ask(false);
      expect(sprite.ext).toBe('.png');
      expect(sprite.cook.reason).toBe('auto-2d');
      const onMesh = await ask(true);
      expect(onMesh.ext).toBe('.ktx2');
      expect(onMesh.data.byteLength).toBeGreaterThan(flat.byteLength);   // bigger, and still what ships
    } finally {
      rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  }, 60_000);

  it('stays an image where its settings keep it raw, made at most once', async () => {
    const r = mkdtempSync(path.join(tmpdir(), 'estella-texcook-raw-'));
    try {
      // An image with an alpha channel may need its clear texels filled: that is
      // made once, in the background for the editor, and answered from the cache after.
      const ask = (cachedOnly: boolean) => cookTexture({
        root: r, path: 'lightmap.png', data: new Uint8Array(noisePng(64, 64)), ext: '.png',
        importer: { compress: false }, encoder: null,
        compressTextures: true, atlasTextures: false, drawnIn3D: true, cachedOnly,
      });
      const made = await ask(false);
      expect(made.ext).toBe('.png');
      const out = await ask(true);
      expect(out.ext).toBe('.png');
      expect(out.pending).toBeUndefined();
    } finally {
      rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  }, 60_000);

  it('a build says what a mesh\'s Original-image texture costs, and leaves a lightmap out', async () => {
    const r = mkdtempSync(path.join(tmpdir(), 'estella-texcook-hint-'));
    try {
      const ids = { wall: '71717171-7171-4717-8717-7171717171a1', light: '71717171-7171-4717-8717-7171717171a2',
                    scene: '81818181-8181-4818-8818-8181818181a1' };
      const put = (rel: string, body: Buffer | string, meta: object) => {
        const abs = path.join(r, rel);
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, body);
        writeFileSync(`${abs}.meta`, JSON.stringify(meta));
      };
      put('t/wall.png', noisePng(64, 64), { uuid: ids.wall, version: '2.0', type: 'texture', importer: { compress: 'off' } });
      put('t/light.png', noisePng(64, 64), { uuid: ids.light, version: '2.0', type: 'texture', importer: { compress: 'off', sRGB: false } });
      put('s/main.esscene', JSON.stringify({ version: '1.0', name: 's', entities: [
        { id: 1, name: 'W', parent: null, children: [], components: [
          { type: 'MeshRenderer', data: { mesh: 'builtin:cube', texture: `@uuid:${ids.wall}` } },
          { type: 'MeshLightmap', data: { lightmap: `@uuid:${ids.light}` } }] },
      ] }), { uuid: ids.scene, version: '2.0', type: 'scene', importer: {} });
      const res = await cookAssets(r, { entryScenes: ['s/main.esscene'], outDir: 'out', compressTextures: true });
      const said = res.warnings.filter((w) => w.includes('ship as their original image'));
      expect(said).toHaveLength(1);
      expect(said[0]).toContain('t/wall.png');
      expect(said[0]).not.toContain('t/light.png');
    } finally {
      rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  }, 60_000);
});

describe('a PNG of 16 bits a channel', () => {
  it('ships as the file it is, whatever its size and settings: every other path would decode it to 8 bits', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'estella-png16-'));
    try {
      // A 16-bit grey PNG, 4 x 4, written by hand: the IHDR says depth 16, and the cook must not look further than that.
      const { deflateSync, crc32 } = await import('node:zlib');
      const chunk = (type: string, body: Buffer): Buffer => {
        const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1');
        const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
        return Buffer.concat([head, body, tail]);
      };
      const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(4096, 0); ihdr.writeUInt32BE(4, 4); ihdr[8] = 16; ihdr[9] = 0;
      const rows = Buffer.alloc(4 * (1 + 4096 * 2));
      for (let i = 0; i < rows.length; i++) rows[i] = i % (1 + 4096 * 2) === 0 ? 0 : (i * 37) & 255;
      const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
      const out = await cookTexture({
        root, path: 'assets/height.png', data: png, ext: '.png', platform: 'web', importer: { maxSize: 2048 },
        compressTextures: true, atlasTextures: false, resizeTextures: true, drawnIn3D: true, encoder: null,
      } as Parameters<typeof cookTexture>[0]);
      expect(out.ext).toBe('.png');
      expect(Buffer.from(out.data).equals(png)).toBe(true);
      expect(out.cook.selected).toBe('raw');
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });
});

describe('a texture a component reads as numbers', () => {
  it('is found, while its Use is still Colour, from the Terrain that names it as its heightmap', async () => {
    const { numberTexturesMarkedColour } = await import('../src/assets/dataTextureAudit');
    const scene = JSON.stringify({ entities: [
      { components: [{ type: 'Terrain', data: { heightmap: 'assets/height.png', splatmap: 'assets/colour.png' } }] },
      { components: [{ type: 'Terrain', data: { heightmap: '@uuid:h2' } }, { type: 'MeshRenderer', data: { texture: 'assets/colour.png' } }] },
      { components: [{ type: 'Terrain', data: { heightmap: 'assets/marked.png' } }] },
    ] });
    const importers: Record<string, Record<string, unknown>> = { 'assets/marked.png': { use: 'data' }, 'assets/height.png': { maxSize: 2048 } };
    const findings = await numberTexturesMarkedColour({
      documents: ['assets/scenes/a.esscene'], readText: async () => scene,
      resolveRef: (ref) => (ref === '@uuid:h2' ? 'assets/other.png' : ref.startsWith('@uuid:') ? null : ref),
      importer: (p) => importers[p],
    });
    expect(findings.map((f) => f.texture)).toEqual(['assets/height.png', 'assets/other.png']);
    expect(findings[0]!.readBy[0]).toEqual({ document: 'assets/scenes/a.esscene', component: 'Terrain', field: 'heightmap' });
  });

  it('marked Data ships uncapped by default, and at its own depth when its Max Size caps it', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'estella-numbers-'));
    try {
      const { encodeGrey16, decodeGrey16 } = await import('../src/assets/png16');
      const { DATA_TEXTURE_IMPORTER } = await import('../src/project/importSettings');
      // A ramp of 16-bit heights no 8-bit image can hold: 64 x 64, every sample its own value.
      const ramp = new Uint16Array(64 * 64).map((_, i) => 1000 + i * 13);
      const png = encodeGrey16({ width: 64, height: 64, data: ramp });
      expect(decodeGrey16(png)!.data).toEqual(ramp);
      const base = { root, path: 'assets/height.png', data: png, ext: '.png', platform: 'web', compressTextures: true, atlasTextures: false,
        resizeTextures: true, drawnIn3D: true, encoder: null } as Parameters<typeof cookTexture>[0];
      // Data: no cap unless one is stated, never encoded.
      const kept = await cookTexture({ ...base, importer: { ...DATA_TEXTURE_IMPORTER } });
      expect(Buffer.from(kept.data).equals(Buffer.from(png))).toBe(true);
      expect(kept.cook.selected).toBe('raw');
      // Data with a cap: half the samples a side, still 16 bits, each the mean of the four it covers.
      const capped = await cookTexture({ ...base, importer: { ...DATA_TEXTURE_IMPORTER, maxSize: 32 } });
      const small = decodeGrey16(capped.data)!;
      expect([small.width, small.height]).toEqual([32, 32]);
      expect(small.data[0]).toBe(Math.round((ramp[0]! + ramp[1]! + ramp[64]! + ramp[65]!) / 4));
      // Not marked: shipped as it is, and the build says so.
      const unmarked = await cookTexture({ ...base, importer: { maxSize: 32 } });
      expect(Buffer.from(unmarked.data).equals(Buffer.from(png))).toBe(true);
      expect(unmarked.warnings.join(' ')).toMatch(/Use is Colour/);
      // An 8-bit image marked Data is capped as numbers too: shrunk, never filled or encoded.
      const eight = await cookTexture({ ...base, data: noisePng(96, 96), importer: { ...DATA_TEXTURE_IMPORTER, maxSize: 32 } });
      expect(decodePngImage('h', eight.data).width).toBe(32);
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  it('is adopted as Data when its file is a PNG of 16 bits a sample', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'estella-adopt16-'));
    try {
      const { encodeGrey16 } = await import('../src/assets/png16');
      const { adoptOrphan } = await import('../src/assets/assetMeta');
      const file = path.join(root, 'height.png'), flat = path.join(root, 'flat.png');
      writeFileSync(file, encodeGrey16({ width: 8, height: 8, data: new Uint16Array(64).fill(40000) }));
      writeFileSync(flat, solidPng(8, 8, [10, 20, 30, 255]));
      await adoptOrphan(file);
      await adoptOrphan(flat);
      const importer = (f: string) => JSON.parse(readFileSync(f + '.meta', 'utf8')).importer;
      expect(importer(file)).toMatchObject({ use: 'data', maxSize: 0, compress: 'off', sRGB: false });
      expect(importer(flat).use).toBe('colour');
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });
});

describe('a cutout texture the cook ships', () => {
  it('has the colour of its solid texels carried into its clear ones, and a texture that is no cutout keeps what is under its alpha', async () => {
    // Green on the left, and white under alpha 0 on the right: the white a mip would average in at the leaf's edge.
    const rgba = new Uint8Array(8 * 8 * 4);
    for (let i = 0; i < 64; i++) rgba.set(i % 8 < 4 ? [20, 160, 30, 255] : [255, 255, 255, 0], i * 4);
    const png = encodeRgbaPng(8, 8, rgba);
    const cook = (importer: Record<string, unknown>) => cookTexture({
      root: '.', path: 'leaf.png', data: new Uint8Array(png), ext: '.png', importer, encoder: null,
      compressTextures: false, atlasTextures: false, drawnIn3D: true,
    });
    const cutout = await cook({ compress: false, mipmaps: true, mipCoverage: 0.5 });
    expect(cutout.ext).toBe('.png');
    const out = decodePngImage('leaf.png', cutout.data);
    // A clear texel beside the leaf is green and still clear; a solid one is exactly as it was.
    expect([...out.rgba.slice(5 * 4, 5 * 4 + 4)]).toEqual([20, 160, 30, 0]);
    expect([...out.rgba.slice(0, 4)]).toEqual([20, 160, 30, 255]);
    // No cutout, but a colour image: its clear texels are filled too, solid ones kept.
    const plain = decodePngImage('leaf.png', (await cook({ compress: false, mipmaps: true })).data);
    expect([...plain.rgba.slice(5 * 4, 5 * 4 + 4)]).toEqual([20, 160, 30, 0]);
    // Unless the importer says its RGB under alpha is data.
    const kept = await cook({ compress: false, mipmaps: true, alphaIsTransparency: false });
    expect(Buffer.from(kept.data).equals(Buffer.from(png))).toBe(true);
  });
});

describe('a UASTC texture the cook ships', () => {
  it('is zstd-supercompressed, smaller than plain UASTC, and decodes to the same pixels', async () => {
    const r = mkdtempSync(path.join(tmpdir(), 'estella-texcook-zstd-'));
    try {
      const png = solidPng(128, 128, [200, 90, 40, 255]);
      const encoder = await loadTextureEncoder();
      const cooked = await cookTexture({
        root: r, path: 't/flat.png', data: new Uint8Array(png), ext: '.png', importer: { compress: 'on' },
        encoder, compressTextures: true, atlasTextures: false, drawnIn3D: false,
      });
      expect(cooked.ext).toBe('.ktx2');
      const layout = readKtx2Layout(cooked.data)!;
      const plain = await encoder.module.encodeToKtx2({ type: encoder.module.ImageType.PNG, data: new Uint8Array(png) },
        { mode: 'uastc', srgb: layout.srgb });
      expect(layout.scheme).toBe(2);
      expect(cooked.data.length).toBeLessThan(plain.length);
      const [a, b] = await Promise.all([encoder.module.transcodeKtx2ToRgba(cooked.data), encoder.module.transcodeKtx2ToRgba(plain)]);
      expect(Buffer.from(a.pixels).equals(Buffer.from(b.pixels))).toBe(true);
    } finally {
      rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });
});

describe('a colour image with clear texels', () => {
  it('ships with its clear texels filled from their neighbours, edges kept, opaque and data images untouched', async () => {
    const r = mkdtempSync(path.join(tmpdir(), 'estella-bleed-'));
    try {
      // 4x1: white solid, white half-clear edge, then two clear texels whose RGB is black.
      const rgba = new Uint8Array([255, 255, 255, 255, 255, 255, 255, 128, 0, 0, 0, 0, 0, 0, 0, 0]);
      const png = encodeRgbaPng(4, 1, rgba);
      const ask = (importer: Record<string, unknown>, data = png) => cookTexture({
        root: r, path: 'ui/panel.png', data, ext: '.png', importer,
        encoder: null, compressTextures: false, atlasTextures: false, drawnIn3D: false,
      });
      const out = await ask({});
      expect(out.ext).toBe('.png');
      expect(out.cacheFile).toBeDefined();
      const px = decodePngImage('ui/panel.png', out.data).rgba;
      expect(Array.from(px.subarray(0, 8))).toEqual([255, 255, 255, 255, 255, 255, 255, 128]);   // solid and edge as painted
      expect(Array.from(px.subarray(8, 11))).toEqual([255, 255, 255]);   // clear: no longer black
      expect(px[11]).toBe(0);                                              // and still clear

      const opaque = encodeRgbaPng(2, 1, new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]));
      const same = await ask({}, opaque);
      expect(Buffer.from(same.data).equals(Buffer.from(opaque))).toBe(true);
      expect(same.cacheFile).toBeUndefined();

      const data = await ask({ sRGB: false });   // a data texture: its RGB is not a colour
      expect(Buffer.from(data.data).equals(Buffer.from(png))).toBe(true);

      // Premultiplied art (no channel above alpha): its clear RGB must stay 0.
      const pma = encodeRgbaPng(3, 1, new Uint8Array([200, 200, 200, 255, 100, 100, 100, 128, 0, 0, 0, 0]));
      const kept = await ask({}, pma);
      expect(Buffer.from(kept.data).equals(Buffer.from(pma))).toBe(true);
    } finally {
      rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });
});
