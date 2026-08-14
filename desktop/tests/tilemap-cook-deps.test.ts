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
import { cookAssets } from '../../pipeline/src/assets/cookAssets';

let root: string;

const TILES_TEX = '11111111-1111-4111-8111-111111111111';
const PROPS_TEX = '22222222-2222-4222-8222-222222222222';
const TILEMAP = '33333333-3333-4333-8333-333333333333';
const SCENE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function writeAsset(rel: string, type: string, uuid: string, body = ''): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  writeFileSync(`${abs}.meta`, JSON.stringify({ uuid, version: '2.0', type, importer: {} }));
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
  writeAsset('assets/maps/level.tmj', 'tilemap', TILEMAP, tmj);
  writeAsset('assets/scenes/main.esscene', 'scene', SCENE, scene);
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
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
});
