// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Runtime tile-collision queries: classification against the layer's
 *        resolved collision table over the live tile grid.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tileCollisionAt, isTileSolid, _bindTileCollisionLookup, type LayerCollisionTable } from '../src/tilemap/tileQuery';
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

  it('returns null/false when no lookup is bound or the layer has no table', () => {
    _bindTileCollisionLookup(null);
    expect(tileCollisionAt(0, 0, 0)).toBeNull();
    _bindTileCollisionLookup(() => null);
    expect(isTileSolid(0, 0, 0)).toBe(false);
  });
});
