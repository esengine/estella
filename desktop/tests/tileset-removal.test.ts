// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { TILE_FLIP_H, CHUNK_SIZE, type DecodedChunk } from 'esengine';
import { remapCellForRemoval, planTilesetRemoval } from '@/tilemap/tilesetRemoval';

// A tileset occupying global ids [5, 9) (span 4): removing it should erase 5..8 and pull
// everything ≥ 9 down by 4, so surviving tiles keep their identity in the new layout.
describe('remapCellForRemoval', () => {
  it('leaves cells below the removed range untouched', () => {
    expect(remapCellForRemoval(3, 5, 4)).toBe(3);
    expect(remapCellForRemoval(0, 5, 4)).toBe(0); // empty stays empty
  });
  it('clears cells that belong to the removed tileset', () => {
    expect(remapCellForRemoval(5, 5, 4)).toBe(0);
    expect(remapCellForRemoval(8, 5, 4)).toBe(0);
  });
  it('shifts cells above the removed range down by span', () => {
    expect(remapCellForRemoval(9, 5, 4)).toBe(5);
    expect(remapCellForRemoval(12, 5, 4)).toBe(8);
  });
  it('preserves flip flags when shifting', () => {
    expect(remapCellForRemoval(9 | TILE_FLIP_H, 5, 4)).toBe(5 | TILE_FLIP_H);
  });
  it('treats the last tileset (span Infinity) as clear-only', () => {
    expect(remapCellForRemoval(4, 5, Infinity)).toBe(4);
    expect(remapCellForRemoval(5, 5, Infinity)).toBe(0);
    expect(remapCellForRemoval(200, 5, Infinity)).toBe(0);
  });
});

/** A one-chunk blob with the given (localIndex → raw) cells at chunk grid (cx, cy). */
function chunk(cx: number, cy: number, cells: Record<number, number>): DecodedChunk {
  const tiles = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE);
  for (const [k, v] of Object.entries(cells)) tiles[Number(k)] = v;
  return { x: cx, y: cy, tiles };
}

describe('planTilesetRemoval', () => {
  it('emits only the changed cells, in world coords, and counts erasures', () => {
    // idx0 (0,0)=3 below → no edit; idx1 (1,0)=6 in range → clear; idx2 (2,0)=10 above → 6;
    // idx17 (1,1)=9|flipH above → 5|flipH.
    const { edits, cleared } = planTilesetRemoval(
      [chunk(0, 0, { 0: 3, 1: 6, 2: 10, 17: 9 | TILE_FLIP_H })], 5, 4,
    );
    expect(cleared).toBe(1);
    expect(edits).toContainEqual({ x: 1, y: 0, tileId: 0 });
    expect(edits).toContainEqual({ x: 2, y: 0, tileId: 6 });
    expect(edits).toContainEqual({ x: 1, y: 1, tileId: 5 | TILE_FLIP_H });
    expect(edits).not.toContainEqual({ x: 0, y: 0, tileId: 3 }); // unchanged → not emitted
    expect(edits).toHaveLength(3);
  });

  it('maps chunk grid coords to world tile coords', () => {
    const { edits } = planTilesetRemoval([chunk(1, -1, { 0: 9 })], 5, 4);
    expect(edits).toEqual([{ x: CHUNK_SIZE, y: -CHUNK_SIZE, tileId: 5 }]);
  });

  it('is a no-op when nothing references the removed range', () => {
    const { edits, cleared } = planTilesetRemoval([chunk(0, 0, { 0: 1, 1: 2 })], 5, 4);
    expect(edits).toHaveLength(0);
    expect(cleared).toBe(0);
  });
});
