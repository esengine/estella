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
      writeFileSync(`${abs}.meta`, JSON.stringify({ uuid: TEX, version: '2.0', type: 'texture', importer: {} }));
      const encoder = await loadTextureEncoder();
      const ask = (cachedOnly: boolean) => cookTexture({
        root: r, path: 't/noise.png', data: new Uint8Array(png), ext: '.png', importer: {},
        encoder, compressTextures: true, atlasTextures: false, cachedOnly,
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

  it('keeps the KTX2 for the editor where a build would ship the smaller PNG', async () => {
    const r = mkdtempSync(path.join(tmpdir(), 'estella-texcook-flat-'));
    try {
      // A solid colour: PNG writes almost nothing, the KTX2 a byte a pixel.
      const flat = new Uint8Array(solidPng(64, 64, [40, 90, 200, 255]));
      const encoder = await loadTextureEncoder();
      const ask = (keepCompressed: boolean) => cookTexture({
        root: r, path: 'sky.png', data: flat, ext: '.png', importer: {},
        encoder, compressTextures: true, atlasTextures: false, keepCompressed,
      });
      const build = await ask(false);
      expect(build.ext).toBe('.png');
      expect(build.cook.reason).toBe('bigger-than-raw');
      const editor = await ask(true);
      expect(editor.ext).toBe('.ktx2');
      expect(readdirSync(path.join(r, '.esengine/cache/cook')).length).toBe(1);   // one encode for both
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
        compressTextures: true, atlasTextures: false, cachedOnly: true,
      });
      expect(out.ext).toBe('.png');
      expect(out.pending).toBeUndefined();
    } finally {
      rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  }, 60_000);
});
