// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What an LDtk level has to become for the engine to draw it.
 *
 * The conversion is where a format's assumptions meet another's, so these are
 * the disagreements: layer order, the gid space, flip bits, and where an image
 * path is relative to.
 */
import { describe, it, expect } from 'vitest';
import { tiledFromLdtk, type LdtkProject } from '../src/convert';

const TILESET = {
  uid: 1,
  identifier: 'Terrain',
  relPath: '../art/terrain.png',
  pxWid: 64,
  pxHei: 32,
  tileGridSize: 16,
};

const tile = (x: number, y: number, t: number, f?: number) => ({ px: [x, y] as [number, number], t, ...(f ? { f } : {}) });

const oneLevel = (layerInstances: unknown[]): LdtkProject => ({
  defs: { tilesets: [TILESET] },
  levels: [{ identifier: 'Level_0', layerInstances: layerInstances as never }],
});

const layer = (over: Record<string, unknown> = {}) => ({
  __identifier: 'Ground',
  __type: 'Tiles',
  __gridSize: 16,
  __cWid: 2,
  __cHei: 2,
  __tilesetDefUid: 1,
  gridTiles: [tile(0, 0, 0)],
  ...over,
});

const convert = (p: LdtkProject, path = 'assets/levels/world.ldtk') => tiledFromLdtk(p, path);
const mapOf = (files: { text: string }[], i = 0) => JSON.parse(files[i].text) as Record<string, never>;

describe('an LDtk level as a Tiled map', () => {
  it('lands beside the source, in a folder of its own', () => {
    const files = convert(oneLevel([layer()]));
    expect(files.map((f) => f.path)).toEqual(['assets/levels/world/Level_0.tmj']);
  });

  it('writes one map per level', () => {
    const files = convert({
      defs: { tilesets: [TILESET] },
      levels: [
        { identifier: 'A', layerInstances: [layer()] as never },
        { identifier: 'B', layerInstances: [layer()] as never },
      ],
    });
    expect(files.map((f) => f.path)).toEqual(['assets/levels/world/A.tmj', 'assets/levels/world/B.tmj']);
  });

  it('reverses the layer order, because the two formats stack opposite ways', () => {
    // LDtk lists the topmost layer first; Tiled draws its array in order. Copying
    // the order across puts the background over everything.
    const files = convert(oneLevel([
      layer({ __identifier: 'Foreground' }),
      layer({ __identifier: 'Background' }),
    ]));
    expect((mapOf(files).layers as { name: string }[]).map((l) => l.name)).toEqual(['Background', 'Foreground']);
  });

  it('makes the tileset image relative to the MAP, not to the source', () => {
    // The .ldtk said `../art/terrain.png` from assets/levels; the map lives one
    // folder deeper, so the same image is two levels up.
    const files = convert(oneLevel([layer()]));
    expect((mapOf(files).tilesets as { image: string }[])[0].image).toBe('../../art/terrain.png');
  });

  it('gives each tileset its own gid range, sized by the tiles it holds', () => {
    const second = { ...TILESET, uid: 2, identifier: 'Props', relPath: 'props.png' };
    const files = convert({
      defs: { tilesets: [TILESET, second] },
      levels: [{ identifier: 'L', layerInstances: [layer({ __tilesetDefUid: 2, gridTiles: [tile(0, 0, 0)] })] as never }],
    });
    const sets = mapOf(files).tilesets as { name: string; firstgid: number; tilecount: number }[];
    expect(sets.map((t) => [t.name, t.firstgid, t.tilecount])).toEqual([['Terrain', 1, 8], ['Props', 9, 8]]);
    // …and a tile is placed in the range of ITS tileset, not the first one.
    expect((mapOf(files).layers as { data: number[] }[])[0].data[0]).toBe(9);
  });

  it('skips a tileset with no image rather than reserving gids for it', () => {
    // An internal icon set cannot be drawn; giving it a range would shift every
    // tileset after it and every tile would land on the wrong image.
    const files = convert({
      defs: { tilesets: [{ ...TILESET, uid: 9, relPath: null }, TILESET] },
      levels: [{ identifier: 'L', layerInstances: [layer()] as never }],
    });
    const sets = mapOf(files).tilesets as { firstgid: number }[];
    expect(sets).toHaveLength(1);
    expect(sets[0].firstgid).toBe(1);
  });

  it('carries flips through as the high gid bits Tiled uses', () => {
    const files = convert(oneLevel([layer({ gridTiles: [tile(0, 0, 3, 1), tile(16, 0, 3, 2), tile(0, 16, 3, 3)] })]));
    const data = (mapOf(files).layers as { data: number[] }[])[0].data;
    expect(data[0] >>> 0).toBe((4 | 0x80000000) >>> 0);
    expect(data[1] >>> 0).toBe((4 | 0x40000000) >>> 0);
    expect(data[2] >>> 0).toBe((4 | 0x80000000 | 0x40000000) >>> 0);
  });

  it('puts a tile in the cell its pixel position falls in', () => {
    const files = convert(oneLevel([layer({ gridTiles: [tile(16, 16, 5)] })]));
    expect((mapOf(files).layers as { data: number[] }[])[0].data).toEqual([0, 0, 0, 6]);
  });

  it('lets the last tile in a cell win, the way LDtk draws them', () => {
    const files = convert(oneLevel([layer({ autoLayerTiles: [tile(0, 0, 1), tile(0, 0, 7)], gridTiles: [] })]));
    expect((mapOf(files).layers as { data: number[] }[])[0].data[0]).toBe(8);
  });

  it('drops a layer that holds no tiles — an IntGrid is data, not a picture', () => {
    const files = convert(oneLevel([
      layer({ __identifier: 'Collision', __type: 'IntGrid', gridTiles: [], autoLayerTiles: [] }),
      layer(),
    ]));
    expect((mapOf(files).layers as { name: string }[]).map((l) => l.name)).toEqual(['Ground']);
  });

  it('has nothing to write for a project with no levels', () => {
    expect(convert({ defs: { tilesets: [TILESET] }, levels: [] })).toEqual([]);
  });
});
