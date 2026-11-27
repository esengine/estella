// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanAssetDatabase } from '../src/assets/assetDb';
import { cookAssets } from '../src/assets/cookAssets';

let root: string;
const map = 'assets/world/maps/cave.tmj', tileset = 'assets/world/sets/cave.tsj';
const legacySet = 'old-props.tsj', legacyImage = 'old-sign.png';
const local = 'assets/world/sets/stone.png', shared = 'assets/world/props/sign.png';
const material = 'assets/world/sets/stone.esmaterial', scene = 'assets/main.esscene';
const tileImage = '11111111-1111-4111-8111-111111111111';
const grid = '22222222-2222-4222-8222-222222222222';
const mat = '33333333-3333-4333-8333-333333333333';

async function file(relative: string, content: string, uuid?: string, type?: string) {
  const name = path.join(root, relative);
  await mkdir(path.dirname(name), { recursive: true });
  await writeFile(name, content);
  if (uuid) await writeFile(name + '.meta', JSON.stringify({ version: '2.0', uuid, type, importer: {} }));
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'estella-tiled-documents-'));
  await file(map, JSON.stringify({ width: 1, height: 1, tilewidth: 16, tileheight: 16,
    tilesets: [{ firstgid: 1, source: '../sets/cave.tsj' }, { firstgid: 2, source: legacySet }], layers: [] }), grid, 'tilemap');
  // Untyped on disk, as with an artist's first import from Tiled.
  await file(tileset, JSON.stringify({ type: 'tileset', name: 'Cave', image: 'stone.png',
    tiles: [{ id: 1, image: '../props/sign.png' }] }));
  await file(legacySet, JSON.stringify({ type: 'tileset', name: 'Old props',
    tiles: [{ id: 0, image: legacyImage }] }));
  await file(legacyImage, 'old sign');
  await file(local, 'stone', tileImage, 'texture');
  await file(shared, 'sign');
  await file('stone.png', 'unrelated root texture');
  await file(material, JSON.stringify({ version: '1.0', type: 'material', shader: 'builtin:standard',
    properties: { albedo: './stone.png' } }), mat, 'material');
  await file(scene, JSON.stringify({ version: '1.0', name: 'Cave', entities: [{
    id: 1, name: 'Cave', components: [{ type: 'Tilemap', data: { source: '@uuid:' + grid } },
      { type: 'MeshRenderer', data: { material: '@uuid:' + mat } }],
  }] }));
});

afterAll(async () => {
  if (root && path.dirname(root) === path.resolve(tmpdir()) && path.basename(root).startsWith('estella-tiled-documents-')) {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

it('adopts an external tileset and discovers the pages in its own directory for both grid and collection tiles', async () => {
  const { index } = await scanAssetDatabase(root, { write: false });
  const set = index.entries.find(entry => entry.path === tileset);
  expect(set?.type).toBe('json');
  const old = index.entries.find(entry => entry.path === legacySet)!;
  expect(index.deps[grid].sort()).toEqual([set!.uuid, old.uuid].sort());
  expect(index.deps[old.uuid]).toEqual([index.entries.find(entry => entry.path === legacyImage)!.uuid]);
  const sign = index.entries.find(entry => entry.path === shared)!;
  expect(index.deps[set!.uuid].sort()).toEqual([tileImage, sign.uuid].sort());
});

it('resolves a material explicitly naming a sibling even if a root file has the same name', async () => {
  const { index } = await scanAssetDatabase(root, { write: false });
  expect(index.deps[mat]).toEqual([tileImage]);
});

it('ships the referenced pages and writes the same project paths into the staged 2D and 3D documents', async () => {
  const { index } = await scanAssetDatabase(root, { write: false });
  const result = await cookAssets(root, { entryScenes: [scene], outDir: 'cooked', contentAddressed: true });
  expect(result.failed).toEqual([]);
  expect(result.warnings.filter(warning => warning.includes('does not carry'))).toEqual([]);
  const manifest: { entries: { uuid: string; path: string }[] } = JSON.parse(await readFile(result.manifestPath!, 'utf8'));
  const staged = async (name: string) => {
    const id = index.entries.find(entry => entry.path === name)!.uuid;
    const record = manifest.entries.find(entry => entry.uuid === id)!;
    return JSON.parse(await readFile(path.join(result.outDir, record.path), 'utf8'));
  };
  const unrelated = index.entries.find(entry => entry.path === 'stone.png')!;
  expect(result.included).not.toContain(unrelated.uuid);
  expect((await staged(map)).tilesets.map((set: { source: string }) => set.source)).toEqual([tileset, '/' + legacySet]);
  expect(await staged(tileset)).toMatchObject({ image: local, tiles: [{ id: 1, image: shared }] });
  expect(await staged(legacySet)).toMatchObject({ tiles: [{ id: 0, image: '/' + legacyImage }] });
  expect((await staged(material)).properties.albedo).toBe(local);
  expect(JSON.parse(await readFile(path.join(root, tileset), 'utf8')).image).toBe('stone.png');
});
