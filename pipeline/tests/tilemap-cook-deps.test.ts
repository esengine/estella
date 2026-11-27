// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Regression: a Tiled map's tileset images are dependencies. The dep scan must
 *        follow tilemap → tileset image (collapsing the Tiled-relative `../`), and the
 *        cook must rewrite that image ref to a logical project path — otherwise the
 *        single-file playable never embeds the tileset and 404s it as an external file.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cookAssets, type CookManifest } from '../src/assets/cookAssets';
import { encodeRgbaPng } from '../src/assets/png';

let root: string;

const TILES_TEX = '11111111-1111-4111-8111-111111111111';
const PROPS_TEX = '22222222-2222-4222-8222-222222222222';
const TILEMAP = '33333333-3333-4333-8333-333333333333';
const SCENE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NATIVE_TILESET = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const COLLECTION = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const COLLECTION_TILE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const PAINTED_ATLAS = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const tilePng = encodeRgbaPng(16, 16, Uint8Array.from({ length: 16 * 16 * 4 }, (_, i) => i % 4 === 3 ? 255 : i % 251));
const atlasPng = encodeRgbaPng(32, 32, Uint8Array.from({ length: 32 * 32 * 4 }, (_, i) => i % 4 === 3 ? 255 : i % 251));

function writeAsset(rel: string, type: string, uuid: string, body: string | Uint8Array = '', importer = {}): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  writeFileSync(`${abs}.meta`, JSON.stringify({ uuid, version: '2.0', type, importer }));
}

// A .tmj at assets/maps/ whose tilesets reference images in ../textures/ (the Tiled
// convention: relative to the map file, so it climbs out of maps/ into textures/).
const tmj = JSON.stringify({
  type: 'map', version: '1.10', orientation: 'orthogonal', renderorder: 'right-down',
  width: 2, height: 2, tilewidth: 16, tileheight: 16, infinite: false,
  nextlayerid: 2, nextobjectid: 1,
  tilesets: [
    { firstgid: 1, name: 'tiles', image: '../textures/tiles.png', imagewidth: 32, imageheight: 32, tilewidth: 16, tileheight: 16, columns: 2, tilecount: 4, margin: 0, spacing: 0 },
    { firstgid: 5, name: 'props', image: '../textures/props.png', imagewidth: 16, imageheight: 16, tilewidth: 16, tileheight: 16, columns: 1, tilecount: 1, margin: 0, spacing: 0 },
  ],
  layers: [{ type: 'tilelayer', name: 'L', width: 2, height: 2, x: 0, y: 0, opacity: 1, visible: true, data: [1, 2, 5, 4] }],
});

const scene = JSON.stringify({
  version: '1.0', name: 'm',
  entities: [{ id: 1, name: 'T', parent: null, children: [], components: [{ type: 'Tilemap', data: { source: `@uuid:${TILEMAP}` } }] }],
});

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-tmcook-'));
  writeAsset('assets/textures/tiles.png', 'texture', TILES_TEX, 'TILES');
  writeAsset('assets/textures/props.png', 'texture', PROPS_TEX, 'PROPS');
  writeAsset('assets/parts.atlas/single.png', 'texture', COLLECTION_TILE, tilePng, { maxSize: 8, compress: 'on' });
  writeAsset('assets/parts.atlas/paint.png', 'texture', PAINTED_ATLAS, atlasPng, { maxSize: 8, compress: 'on' });
  writeAsset('assets/maps/loose.tsj', 'json', COLLECTION, JSON.stringify({
    name: 'Loose', tilewidth: 16, tileheight: 16, tilecount: 1, columns: 0,
    tiles: [{ id: 0, image: '../parts.atlas/single.png', imagewidth: 16, imageheight: 16 }],
  }));
  writeAsset('assets/maps/level.tmj', 'tilemap', TILEMAP, tmj);
  writeAsset('assets/scenes/main.esscene', 'scene', SCENE, scene);
  writeAsset('assets/maps/ground.estileset', 'tileset', NATIVE_TILESET, JSON.stringify({
    version: '1', texture: '../textures/tiles.png?v=2', tileWidth: 16, tileHeight: 16, columns: 2, tiles: {},
  }));
  writeAsset('assets/scenes/painted.esscene', 'scene', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', JSON.stringify({
    version: 4, name: 'Painted', entities: [{ id: 1, parent: null, children: [], components: [
      { type: 'TilemapLayer', data: { tilesetAsset: `@uuid:${NATIVE_TILESET}` } },
    ] }],
  }));
  const map = JSON.parse(tmj);
  map.tilesets = [{ firstgid: 1, source: './loose.tsj' }];
  writeAsset('assets/maps/loose.tmj', 'tilemap', '99999999-9999-4999-8999-999999999999', JSON.stringify(map));
  writeAsset('assets/maps/paint.estileset', 'tileset', '88888888-8888-4888-8888-888888888888', JSON.stringify({
    version: '1', texture: 'assets/parts.atlas/paint.png', tileWidth: 16, tileHeight: 16, columns: 2, tiles: {},
  }));
  writeAsset('assets/scenes/layout.esscene', 'scene', '77777777-7777-4777-8777-777777777777', JSON.stringify({
    version: 4, name: 'Layout', entities: [
      { id: 1, parent: null, children: [], components: [{ type: 'Tilemap', data: { source: 'assets/maps/loose.tmj' } }] },
      { id: 2, parent: null, children: [], components: [{ type: 'TilemapLayer', data: { tilesetAsset: 'assets/maps/paint.estileset' } }] },
    ],
  }));
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('tilemap tileset images are cooked dependencies', () => {
  it('embeds a tilemap\'s tileset images (dep scan follows the ../ relative image)', async () => {
    const res = await cookAssets(root, { entryScenes: ['assets/scenes/main.esscene'], outDir: 'build' });
    expect(res.ok).toBe(true);
    // Both tileset images are reachable through the tilemap — not culled.
    expect(res.included).toEqual(expect.arrayContaining([SCENE, TILEMAP, TILES_TEX, PROPS_TEX]));
    expect(res.unused).not.toEqual(expect.arrayContaining([TILES_TEX, PROPS_TEX]));
  });

  it('rewrites the cooked .tmj tileset image refs to logical project paths', async () => {
    await cookAssets(root, { entryScenes: ['assets/scenes/main.esscene'], outDir: 'build' });
    const cooked = JSON.parse(readFileSync(path.join(root, 'build', 'assets/maps/level.tmj'), 'utf8'));
    // "../textures/tiles.png" (map-relative) → "assets/textures/tiles.png" (project-relative),
    // so the @uuid-loaded map resolves it to the embedded asset in the single-file playable.
    expect(cooked.tilesets[0].image).toBe('assets/textures/tiles.png');
    expect(cooked.tilesets[1].image).toBe('assets/textures/props.png');
  });

  it('keeps a relative native tileset atlas with a query suffix through content-addressed staging', async () => {
    const cooked = await cookAssets(root, {
      entryScenes: ['assets/scenes/painted.esscene'], outDir: 'build-native', contentAddressed: true,
    });
    expect(cooked.ok, cooked.warnings.join('\n')).toBe(true);
    expect(cooked.included).toEqual(expect.arrayContaining([NATIVE_TILESET, TILES_TEX]));
    const manifest = JSON.parse(readFileSync(cooked.manifestPath!, 'utf8')) as { entries: { uuid: string; path: string }[] };
    const stored = manifest.entries.find(entry => entry.uuid === NATIVE_TILESET)!;
    const tileset = JSON.parse(readFileSync(path.join(cooked.outDir, stored.path), 'utf8'));
    expect(tileset.texture).toBe('assets/textures/tiles.png');
  });

  it.each([true, false])('ships whole original tile images with resize and compression enabled (atlasing: %s)', async atlasTextures => {
    const cooked = await cookAssets(root, {
      entryScenes: ['assets/scenes/layout.esscene'], outDir: `build-layout-${atlasTextures}`,
      atlasTextures, resizeTextures: true, compressTextures: true, contentAddressed: true,
    });
    expect(cooked.ok).toBe(true);
    const { entries } = JSON.parse(readFileSync(cooked.manifestPath!, 'utf8')) as CookManifest;
    for (const [uuid, bytes] of [[COLLECTION_TILE, tilePng], [PAINTED_ATLAS, atlasPng]] as const) {
      const entry = entries.find(asset => asset.uuid === uuid)!;
      expect(entry, uuid).toBeDefined();
      expect(entry.atlas).toBeUndefined();
      expect(entry.path).toMatch(/\.png$/);
      expect(readFileSync(path.join(cooked.outDir, entry.path))).toEqual(Buffer.from(bytes));
    }
  });

  it('fails cooking when the staged map or tileset names a missing local input', async () => {
    const mapPath = 'assets/maps/missing.tmj';
    const collectionPath = 'assets/maps/missing.tsj';
    const nativePath = 'assets/maps/missing.estileset';
    const scenePath = 'assets/scenes/missing-tiles.esscene';
    const missingAtlas = '@uuid:12345678-1234-4234-8234-123456789123';
    writeAsset(mapPath, 'tilemap', '11111111-1111-4111-8111-111111111119', JSON.stringify({ ...JSON.parse(tmj), tilesets: [
      { firstgid: 1, source: 'missing.tsj' }, { firstgid: 2, source: './gone.tsj' },
      { firstgid: 3, image: 'https://example.invalid/tiles.png' },
    ] }));
    writeAsset(collectionPath, 'json', '22222222-2222-4222-8222-222222222229', JSON.stringify({
      columns: 0, tiles: [{ id: 0, image: '../parts.atlas/gone.png?rev=2' }], note: 'unrelated.png',
    }));
    writeAsset(nativePath, 'tileset', '33333333-3333-4333-8333-333333333339', JSON.stringify({
      version: '1', texture: missingAtlas, tileWidth: 16, tileHeight: 16, columns: 1, tiles: {},
    }));
    writeAsset(scenePath, 'scene', '44444444-4444-4444-8444-444444444449', JSON.stringify({
      version: 4, name: 'Missing tiles', entities: [
        { id: 1, parent: null, children: [], components: [{ type: 'Tilemap', data: { source: mapPath } }] },
        { id: 2, parent: null, children: [], components: [{ type: 'TilemapLayer', data: { tilesetAsset: nativePath } }] },
      ],
    }));
    const result = await cookAssets(root, { entryScenes: [scenePath], outDir: 'build-missing', contentAddressed: true });
    expect(result.ok).toBe(false);
    expect(new Set(result.failed)).toEqual(new Set([
      `${mapPath}: tileset source './gone.tsj' is not packaged`,
      `${collectionPath}: tile image '../parts.atlas/gone.png?rev=2' is not packaged`,
      `${nativePath}: tile image '${missingAtlas}' is not packaged`,
    ]));
  });
});
