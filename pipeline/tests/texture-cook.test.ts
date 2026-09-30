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
import { noisePng, solidPng } from './fixtures/solidPng.mjs';

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

  it('stays as it is where its settings keep it raw, and is never pending', async () => {
    const r = mkdtempSync(path.join(tmpdir(), 'estella-texcook-raw-'));
    try {
      const out = await cookTexture({
        root: r, path: 'lightmap.png', data: new Uint8Array(noisePng(64, 64)), ext: '.png',
        importer: { compress: false }, encoder: await loadTextureEncoder(),
        compressTextures: true, atlasTextures: false, drawnIn3D: true, cachedOnly: true,
      });
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
