// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The ship manifest is a packaged build's ONLY channel for the `.meta`.
 *
 * The cook records each asset's importer block, but assembling the addressable
 * manifest used to drop it — so a shipped game had no filter/wrap/sRGB and no
 * 9-slice border, and a frame that sliced correctly in the editor stretched in
 * the build. What ships is the PARSED runtime half: the renderer needs how the
 * texture is sampled, never the cook's own knobs.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildAddressableManifest, addrType, LOADER_TYPE_OF_META_TYPE, UNLOADED_META_TYPES, UNLOADED_TYPE,
} from '../src/assets/addressableManifest';
import type { AddressableManifest } from '../../sdk/src/asset/AddressableManifest';
import { EXT_TO_TYPE, SUFFIX_TO_TYPE, metaTypeForContent } from '../../tools/assetMetaTable.js';
import { Assets } from '../../sdk/src/asset/Assets';
import { setPlatform } from '../../sdk/src/platform/base';
import { initResourceManager, shutdownResourceManager } from '../../sdk/src/wasm/resourceManager';
import { indexPackagedManifest } from '../../sdk/src/runtime/packagedRuntime';
import { registerAiSupport } from '../../sdk/src/ai/aiSupport';
import { registerSkeletalAnimationSupport } from '../../sdk/src/animation/skeletalAnimationSupport';
import { registerScriptGraphSupport } from '../../sdk/src/logic/logicSupport';
import { registerTerrainSupport } from '../../sdk/src/terrain/terrainSupport';
import { registerTilemapSupport } from '../../sdk/src/tilemap/tilemapSupport';
import { registerTimelineSupport } from '../../sdk/src/timeline/timelineSupport';
import { registerWorldGenSupport } from '../../sdk/src/worldgen/worldgenSupport';

const SLICED = {
  uuid: 'A0C281AF-F1E6-43F1-9561-834D9AFB25B5',
  path: 'assets/ui/Button_Red.png',
  type: 'texture',
  size: 100,
  importer: {
    maxSize: 2048, compress: true, compressFormat: 'uastc',
    filterMode: 'linear', wrapMode: 'clamp', sRGB: true,
    sliceBorder: { left: 23, right: 24, top: 25, bottom: 29 },
  },
};
const PLAIN = {
  uuid: 'B0000000-0000-4000-8000-000000000000',
  path: 'assets/ui/Background.png',
  type: 'texture',
  size: 100,
  // Cook-only knobs plus an all-zero border: nothing the renderer acts on.
  importer: {
    maxSize: 2048, compress: true, compressFormat: 'uastc',
    sliceBorder: { left: 0, right: 0, top: 0, bottom: 0 },
  },
};

describe('buildAddressableManifest — texture import settings', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'estella-manifest-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  const build = async (entries: unknown[]): Promise<AddressableManifest> => {
    await writeFile(path.join(dir, 'assets.manifest.json'), JSON.stringify({ entries }));
    return JSON.parse(await buildAddressableManifest(dir)) as AddressableManifest;
  };

  it('ships the parsed settings, not the raw importer block', async () => {
    const manifest = await build([SLICED]);
    const asset = manifest.groups.main.assets[SLICED.uuid.toLowerCase()];

    expect(asset.textureImport).toEqual({
      filter: 'linear', wrap: 'clamp', srgb: true,
      sliceBorder: { left: 23, right: 24, top: 25, bottom: 29 },
    });
    // The cook's own settings stay behind — they mean nothing to a renderer.
    expect(JSON.stringify(asset)).not.toContain('maxSize');
    expect(JSON.stringify(asset)).not.toContain('compressFormat');
  });

  it('ships each source record’s labels even when staged bytes are shared', async () => {
    const manifest = await build([
      { ...SLICED, path: 'ca/shared.png', sourcePath: SLICED.path, labels: ['hud', 'stage'] },
      { ...PLAIN, path: 'ca/shared.png', sourcePath: PLAIN.path, labels: ['stage'] },
    ]);
    const assets = manifest.groups.main.assets;
    expect(assets[SLICED.uuid.toLowerCase()].labels).toEqual(['hud', 'stage']);
    expect(assets[PLAIN.uuid.toLowerCase()].labels).toEqual(['stage']);
    const catalog = indexPackagedManifest(manifest).catalog!;
    expect(catalog.getByLabel('stage')).toEqual([SLICED.path, PLAIN.path]);
    for (const ref of catalog.getByLabel('stage')) expect(catalog.getEntry(ref)?.buildPath).toBe('ca/shared.png');
    const runtime = Assets.create({ backend: {} as never, catalog, manifest, module: null });
    const next = structuredClone(manifest);
    next.groups.main.assets[SLICED.uuid.toLowerCase()].labels = ['title'];
    runtime.setManifest(next);
    expect(runtime.catalog.getAllLabels().sort()).toEqual(['stage', 'title']);
    expect(runtime.catalog.getByLabel('stage')).toEqual([PLAIN.path]);
    expect((await runtime.loadByLabel('hud')).scope.size).toBe(0);
  });

  it('omits the field for an asset whose importer says nothing renderable', async () => {
    const manifest = await build([PLAIN]);
    const asset = manifest.groups.main.assets[PLAIN.uuid.toLowerCase()];

    expect(asset.textureImport).toBeUndefined();
  });

  it('preloads staged legacy sprite clips and timelines through their own loaders', async () => {
    const sprite = { ...SLICED, type: 'animation', sourcePath: 'assets/art/idle.ESANIM', path: 'ca/sprite.bin' };
    const timeline = { ...PLAIN, type: 'animation', sourcePath: 'assets/camera/intro.estimeline', path: 'ca/camera.bin' };
    const manifest = await build([sprite, timeline]);
    const records = manifest.groups.main.assets;
    expect(records[sprite.uuid.toLowerCase()].type).toBe('anim-clip');
    expect(records[timeline.uuid.toLowerCase()].type).toBe('timeline');
    const { catalog } = indexPackagedManifest(manifest);
    const assets = Assets.create({ backend: {} as never, catalog, manifest, module: null });
    const loads: Array<[string, string]> = [];
    for (const type of ['anim-clip', 'timeline']) {
      assets.register({ type, extensions: [], load: async file => { loads.push([type, file]); return {}; }, unload() {} });
    }
    try {
      const refs = [sprite, timeline].map(entry => `@uuid:${entry.uuid.toLowerCase()}`);
      expect((await assets.preload(refs, undefined, { maxConcurrent: 1 })).failed).toEqual([]);
      expect(loads).toEqual([['anim-clip', sprite.path], ['timeline', timeline.path]]);
    } finally { assets.releaseAll(); }
  });

  it('is answerable by every ref spelling once the runtime indexes it', async () => {
    const manifest = await build([{ ...SLICED, sourcePath: 'assets/ui/Button_Red.png', path: 'ca/9f3a1b.png' }]);
    const { ManifestModel } = await import('../../sdk/src/asset/AddressableManifest');
    const lookup = ManifestModel.fromJson(manifest).textureImportLookup();

    // The uuid, the staged path a content-addressed cook renamed it to, and the
    // authored address a path-style ref still names it by.
    for (const ref of [
      SLICED.uuid.toLowerCase(), `@uuid:${SLICED.uuid.toLowerCase()}`,
      'ca/9f3a1b.png', 'assets/ui/Button_Red.png', '/assets/ui/Button_Red.png',
    ]) {
      expect(lookup(ref)?.sliceBorder, ref).toEqual({ left: 23, right: 24, top: 25, bottom: 29 });
    }
  });
});

describe('buildAddressableManifest — every shipped type names the loader that reads it', () => {
  const mintedMetaTypes = (): Set<string> => new Set([
    ...Object.values(EXT_TO_TYPE),
    ...Object.values(SUFFIX_TO_TYPE),
    metaTypeForContent('data.json', '') ?? '',
    metaTypeForContent('hero.json', '{"skeleton":{"spine":"4.2"}}') ?? '',
  ]);

  const registeredLoaders = (): Assets => {
    registerAiSupport();
    registerSkeletalAnimationSupport();
    registerScriptGraphSupport();
    registerTerrainSupport();
    registerTilemapSupport();
    registerTimelineSupport();
    registerWorldGenSupport();
    return Assets.create({ backend: { fetchBinary: async () => new ArrayBuffer(0), fetchText: async () => '', resolveUrl: (p: string) => p }, module: null as never });
  };

  it('ships every .meta type the table mints as a registered loader type, or as declared unloaded', () => {
    const assets = registeredLoaders();
    const orphans = [...mintedMetaTypes()].filter((meta) => {
      if (UNLOADED_META_TYPES.has(meta)) return addrType(meta) !== UNLOADED_TYPE;
      return assets.getLoader(addrType(meta)) === undefined;
    }).map((meta) => `${meta} -> ${addrType(meta)}`);
    expect(orphans).toEqual([]);
  });

  it('names no .meta type the table never mints', () => {
    const minted = mintedMetaTypes();
    const stale = [...Object.keys(LOADER_TYPE_OF_META_TYPE), ...UNLOADED_META_TYPES].filter((meta) => !minted.has(meta));
    expect(stale).toEqual([]);
  });
});

describe('Assets.preload — a cooked manifest routes each asset to its loader', () => {
  const FONT = { uuid: 'C0000000-0000-4000-8000-000000000001', path: 'ca/1f0e.ttf', sourcePath: 'assets/fonts/Title.ttf', type: 'font', size: 4 };
  const BITMAP_FONT = { uuid: 'C0000000-0000-4000-8000-000000000002', path: 'ca/2b7c.fnt', sourcePath: 'assets/fonts/Pixel.fnt', type: 'bitmapfont', size: 4 };
  const CLIP = { uuid: 'C0000000-0000-4000-8000-000000000003', path: 'ca/3d9a.esanim', sourcePath: 'assets/anim/walk.esanim', type: 'animclip', size: 4 };
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'estella-manifest-'));
    setPlatform({ name: 'web', registerFont: async () => {} } as never);
    initResourceManager({} as never);
  });
  afterEach(async () => {
    shutdownResourceManager();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it('preloads a shipped outline font and anim clip through their own loaders', async () => {
    await writeFile(path.join(dir, 'assets.manifest.json'), JSON.stringify({ entries: [FONT, BITMAP_FONT, CLIP] }));
    const manifest = JSON.parse(await buildAddressableManifest(dir)) as AddressableManifest;
    const shipped = manifest.groups.main.assets;
    expect(shipped[FONT.uuid.toLowerCase()].type).toBe('font');
    expect(shipped[BITMAP_FONT.uuid.toLowerCase()].type).toBe('font');
    expect(shipped[CLIP.uuid.toLowerCase()].type).toBe('anim-clip');

    const files: Record<string, string> = {
      [CLIP.path]: JSON.stringify({ version: '1.0', type: 'animation-clip', fps: 12, loop: true, frames: [] }),
    };
    const fetched: string[] = [];
    const index = indexPackagedManifest(manifest);
    const assets = Assets.create({
      backend: {
        fetchBinary: async (p: string) => { fetched.push(p); return new ArrayBuffer(4); },
        fetchText: async (p: string) => { fetched.push(p); return files[p] ?? ''; },
        resolveUrl: (p: string) => p,
      },
      catalog: index.catalog,
      manifest,
      module: null as never,
    });
    assets.setAssetRefResolver(index.resolvePath);

    const { failed } = await assets.preload([`@uuid:${FONT.uuid.toLowerCase()}`, `@uuid:${CLIP.uuid.toLowerCase()}`]);
    expect(failed).toEqual([]);
    expect(fetched.sort()).toEqual([CLIP.path, FONT.path].sort());
  });
});
