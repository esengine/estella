// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Runtime tile-collision queries: classification against the layer's
 *        resolved collision table over the live tile grid.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tileCollisionAt, isTileSolid, _bindTileCollisionLookup, type LayerCollisionTable } from '../src/tilemap/tileQuery';
import type { ResolvedTileCollision } from '../src/tilemap/tilesetResolve';
import { TilemapAPI } from '../src/tilemap/tilemapAPI';
import { encodeTile } from '../src/tilemap/tileBits';

const grid = new Map<string, number>();
vi.spyOn(TilemapAPI, 'getTile').mockImplementation(((_layer: number, x: number, y: number) =>
  grid.get(`${x},${y}`) ?? 0) as never);

const TABLE: LayerCollisionTable = {
  boxIds: new Set([1]),
  shapes: new Map([
    [2, { shape: { type: 'circle', cx: 0.5, cy: 0.5, r: 0.5 } }],
    [3, { shape: { type: 'box' }, sensor: true }],
    [4, { shape: { type: 'box' }, oneWay: { nx: 0, ny: 1 } }],
  ]),
};

describe('tileCollisionAt / isTileSolid', () => {
  beforeEach(() => {
    grid.clear();
    _bindTileCollisionLookup(() => TABLE);
  });
  afterEach(() => _bindTileCollisionLookup(null));

  it('classifies plain boxes, rich shapes, sensors, and empties', () => {
    grid.set('0,0', encodeTile(1));
    grid.set('1,0', encodeTile(2));
    grid.set('2,0', encodeTile(3));
    grid.set('3,0', encodeTile(4));
    grid.set('4,0', encodeTile(9)); // decorative tile — no collision entry

    expect(tileCollisionAt(0, 0, 0)).toEqual({ shape: { type: 'box' } });
    expect(tileCollisionAt(0, 1, 0)?.shape.type).toBe('circle');
    expect(tileCollisionAt(0, 5, 0)).toBeNull(); // empty cell
    expect(tileCollisionAt(0, 4, 0)).toBeNull(); // no collision authored

    expect(isTileSolid(0, 0, 0)).toBe(true);
    expect(isTileSolid(0, 2, 0)).toBe(false); // sensor is not solid
    expect(isTileSolid(0, 3, 0)).toBe(true);  // one-way counts as solid
    expect(tileCollisionAt(0, 3, 0)?.oneWay).toEqual({ nx: 0, ny: 1 });
  });

  it('applies cell flips to a one-way normal, matching the spawned collider', () => {
    // Tile 4 is a solid-top one-way platform (normal {0,1}); a vertical flip must
    // put the solid side on the bottom (normal {0,-1}), as the spawn path does.
    grid.set('0,0', encodeTile(4, { flipH: false, flipV: true, flipD: false }));
    expect(tileCollisionAt(0, 0, 0)?.oneWay).toEqual({ nx: 0, ny: -1 });
    // A horizontal flip leaves a vertical normal unchanged.
    grid.set('1,0', encodeTile(4, { flipH: true, flipV: false, flipD: false }));
    expect(tileCollisionAt(0, 1, 0)?.oneWay).toEqual({ nx: 0, ny: 1 });
    // The shared table entry is not mutated by the flip.
    expect(TABLE.shapes.get(4)?.oneWay).toEqual({ nx: 0, ny: 1 });
  });

  it('flips polygon geometry and a circle centre in normalized space', () => {
    _bindTileCollisionLookup(() => ({
      boxIds: new Set<number>(),
      shapes: new Map<number, ResolvedTileCollision>([
        [5, { shape: { type: 'polygon', points: [[0, 1], [1, 1], [0, 0]] } }],
        [6, { shape: { type: 'circle', cx: 0.25, cy: 0.75, r: 0.2 } }],
      ]),
    }));
    // flipH mirrors x (y-down normalized): [0,1]→[1,1], [1,1]→[0,1], [0,0]→[1,0].
    grid.set('0,0', encodeTile(5, { flipH: true, flipV: false, flipD: false }));
    expect(tileCollisionAt(0, 0, 0)?.shape).toEqual({ type: 'polygon', points: [[1, 1], [0, 1], [1, 0]] });
    // circle centre (0.25,0.75) flipH → (0.75,0.75).
    grid.set('1,0', encodeTile(6, { flipH: true, flipV: false, flipD: false }));
    expect(tileCollisionAt(0, 1, 0)?.shape).toEqual({ type: 'circle', cx: 0.75, cy: 0.75, r: 0.2 });
  });

  it('returns null/false when no lookup is bound or the layer has no table', () => {
    _bindTileCollisionLookup(null);
    expect(tileCollisionAt(0, 0, 0)).toBeNull();
    _bindTileCollisionLookup(() => null);
    expect(isTileSolid(0, 0, 0)).toBe(false);
  });
});
