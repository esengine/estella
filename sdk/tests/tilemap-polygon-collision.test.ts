// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import { polygonLocalVerts, generateChunkPolygonCollision } from '../src/tilemap/tiledLoader';
import { resolveTilesetModel } from '../src/tilemap/tilesetResolve';
import { parseTileset } from '../src/tilemap/tilesetAsset';
import { encodeTile } from '../src/tilemap/tileBits';
import { CHUNK_SIZE } from '../src/tilemap/chunkCodec';
import type { World } from '../src/world';
import type { Entity } from '../src/types';

function mockWorld() {
  let nextId = 1;
  const comps = new Map<number, Map<string, any>>();
  const world = {
    spawn: vi.fn(() => { const id = nextId++ as Entity; comps.set(id, new Map()); return id; }),
    insert: vi.fn((e: Entity, c: any, d: any) => { comps.get(e)!.set(c._name, d); }),
  } as unknown as World;
  return { world, comps };
}

describe('resolveTilesetModel polygon shapes', () => {
  it('splits box vs polygon and normalizes polygon points', () => {
    const asset = parseTileset({
      texture: '@uuid:x', tileWidth: 16, tileHeight: 16, columns: 4,
      tiles: {
        2: { collision: { type: 'box' } },
        3: { collision: { type: 'polygon', points: [[0, 0], [16, 0], [16, 8]] } },
      },
    });
    const model = resolveTilesetModel([{ asset, textureHandle: 1 }]);
    expect(model.collidableTileIds).toEqual([2]); // box only
    expect(model.polygonShapes.get(3)).toEqual([[0, 0], [1, 0], [1, 0.5]]); // normalized
    expect(model.polygonShapes.has(2)).toBe(false);
  });

  it('re-keys polygon ids into the global id space across tilesets', () => {
    const a = parseTileset({
      texture: '@uuid:a', tileWidth: 16, tileHeight: 16, columns: 2, tileCount: 4,
      tiles: { 1: { collision: { type: 'polygon', points: [[0, 0], [16, 16], [0, 16]] } } },
    });
    const b = parseTileset({
      texture: '@uuid:b', tileWidth: 16, tileHeight: 16, columns: 2,
      tiles: { 1: { collision: { type: 'polygon', points: [[0, 0], [16, 0], [0, 16]] } } },
    });
    const model = resolveTilesetModel([{ asset: a, textureHandle: 1 }, { asset: b, textureHandle: 2 }]);
    expect(model.polygonShapes.has(1)).toBe(true);  // tileset a, local 1 → global 1
    expect(model.polygonShapes.has(5)).toBe(true);  // tileset b, local 1 → global 1+4 = 5
  });
});

describe('polygonLocalVerts flip transforms', () => {
  // A single corner point at the tile's top-left pixel (0,0).
  const TL = [[0, 0]] as const;

  it('identity puts the top-left pixel at the local top-left', () => {
    expect(polygonLocalVerts(TL, 16, 16, false, false, false)[0]).toEqual({ x: -8, y: 8 });
  });
  it('flipH mirrors to the top-right', () => {
    expect(polygonLocalVerts(TL, 16, 16, true, false, false)[0]).toEqual({ x: 8, y: 8 });
  });
  it('flipV mirrors to the bottom-left', () => {
    expect(polygonLocalVerts(TL, 16, 16, false, true, false)[0]).toEqual({ x: -8, y: -8 });
  });
  it('flipD (anti-diagonal) sends the top-left to the bottom-right', () => {
    // matches the renderer's applyTileFlip swap convention.
    expect(polygonLocalVerts(TL, 16, 16, false, false, true)[0]).toEqual({ x: 8, y: -8 });
  });
});

describe('generateChunkPolygonCollision', () => {
  it('spawns one PolygonCollider per polygon tile at the cell centre', () => {
    const { world, comps } = mockWorld();
    const tiles = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE);
    tiles[0] = encodeTile(3);                 // (0,0) → polygon tile
    tiles[1] = encodeTile(2);                 // (1,0) → not a polygon (ignored here)
    const shapes = new Map<number, [number, number][]>([[3, [[0, 0], [1, 0], [1, 0.5]]]]);
    const ents = generateChunkPolygonCollision(world, [{ x: 0, y: 0, tiles }], shapes, 16, 16, 0, 0);
    expect(ents).toHaveLength(1);
    const c = comps.get(ents[0] as number)!;
    expect(c.get('Transform').position).toMatchObject({ x: 8, y: -8 }); // cell (0,0) centre
    expect(c.get('PolygonCollider').vertices).toHaveLength(3);
    expect(c.get('RigidBody').bodyType).toBeDefined();
  });

  it('flips the polygon when the placed cell carries flip flags', () => {
    const { world, comps } = mockWorld();
    const tiles = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE);
    tiles[0] = encodeTile(1, { flipH: true, flipV: false, flipD: false });
    const shapes = new Map<number, [number, number][]>([[1, [[0, 0]]]]); // top-left point
    const ents = generateChunkPolygonCollision(world, [{ x: 0, y: 0, tiles }], shapes, 16, 16, 0, 0);
    const v = comps.get(ents[0] as number)!.get('PolygonCollider').vertices[0];
    expect(v).toEqual({ x: 8, y: 8 }); // top-left mirrored to top-right under flipH
  });

  it('is a no-op when no placed tile has a polygon shape', () => {
    const { world } = mockWorld();
    const tiles = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE);
    tiles[0] = encodeTile(9);
    const shapes = new Map<number, [number, number][]>([[3, [[0, 0]]]]);
    expect(generateChunkPolygonCollision(world, [{ x: 0, y: 0, tiles }], shapes, 16, 16, 0, 0)).toHaveLength(0);
  });
});
