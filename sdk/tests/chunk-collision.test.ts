// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Native-path tilemap collision (REARCH_TILEMAP T4): decoding the chunk blob and
 *        deriving merged static colliders from a painted layer's collidable tiles.
 */
import { describe, it, expect, vi } from 'vitest';
import { decodeTilemapChunks, CHUNK_SIZE } from '../src/tilemap/chunkCodec';
import { generateChunkCollision } from '../src/tilemap/tiledLoader';
import { BodyType } from '../src/physics/PhysicsComponents';
import type { World } from '../src/world';
import type { Entity } from '../src/types';

// Build a `tilemap_exportChunks`-format blob (base64url) for the given chunks.
function encodeChunks(chunks: { x: number; y: number; tiles: Uint16Array }[]): string {
  const perChunk = 8 + CHUNK_SIZE * CHUNK_SIZE * 2;
  const buf = new ArrayBuffer(8 + chunks.length * perChunk);
  const dv = new DataView(buf);
  dv.setUint32(0, 0x4d545345, true); // 'ESTM'
  dv.setUint32(4, chunks.length, true);
  let off = 8;
  for (const c of chunks) {
    dv.setInt32(off, c.x, true); off += 4;
    dv.setInt32(off, c.y, true); off += 4;
    for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) { dv.setUint16(off, c.tiles[i], true); off += 2; }
  }
  let bin = '';
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_');
}

interface MockEntity { Transform?: any; RigidBody?: any; BoxCollider?: any }
function createMockWorld(): { world: World; store: Map<number, MockEntity> } {
  let nextId = 1;
  const store = new Map<number, MockEntity>();
  const world = {
    spawn: vi.fn(() => { const id = nextId++ as Entity; store.set(id, {}); return id; }),
    insert: vi.fn((e: Entity, comp: any, data: any) => { (store.get(e) as any)[comp._name] = data; }),
  } as unknown as World;
  return { world, store };
}

describe('decodeTilemapChunks', () => {
  it('round-trips a chunk (coords + tiles)', () => {
    const tiles = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE);
    tiles[0] = 5;
    tiles[CHUNK_SIZE + 1] = 7; // local (1,1)
    const chunks = decodeTilemapChunks(encodeChunks([{ x: 2, y: -1, tiles }]));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ x: 2, y: -1 });
    expect(chunks[0].tiles[0]).toBe(5);
    expect(chunks[0].tiles[CHUNK_SIZE + 1]).toBe(7);
  });

  it('returns [] for empty or wrong-magic blobs', () => {
    expect(decodeTilemapChunks('')).toEqual([]);
    expect(decodeTilemapChunks(btoa('not a tilemap'))).toEqual([]); // valid base64, bad magic
  });
});

describe('generateChunkCollision', () => {
  it('greedy-merges collidable tiles into one centered static box (y grows downward)', () => {
    const { world, store } = createMockWorld();
    const tiles = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE);
    tiles[0] = 1; tiles[1] = 1; // local (0,0)+(1,0) → a 2×1 rect
    const ents = generateChunkCollision(world, [{ x: 0, y: 0, tiles }], new Set([1]), 16, 16, 0, 0);
    expect(ents).toHaveLength(1);
    const e = store.get(ents[0])!;
    // x0..x1 = 0..1, y0..y1 = 0..0 → center ((0+1+1)/2·16, -(0+0+1)/2·16) = (16, -8)
    expect(e.Transform.position).toEqual({ x: 16, y: -8, z: 0 });
    expect(e.BoxCollider.halfExtents).toEqual({ x: 16, y: 8 });
    expect(e.RigidBody.bodyType).toBe(BodyType.Static);
  });

  it('offsets by chunk coords and the tilemap world origin', () => {
    const { world, store } = createMockWorld();
    const tiles = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE);
    tiles[0] = 1; // chunk (1,0) local (0,0) → absolute tile (16,0)
    const ents = generateChunkCollision(world, [{ x: 1, y: 0, tiles }], new Set([1]), 16, 16, 100, 200);
    // cx = 100 + (16+16+1)/2·16 = 364 ; cy = 200 - (0+0+1)/2·16 = 192
    expect(store.get(ents[0])!.Transform.position).toEqual({ x: 364, y: 192, z: 0 });
  });

  it('ignores non-collidable tiles', () => {
    const { world } = createMockWorld();
    const tiles = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE);
    tiles[0] = 2; // not in the collision set
    expect(generateChunkCollision(world, [{ x: 0, y: 0, tiles }], new Set([1]), 16, 16, 0, 0)).toHaveLength(0);
  });
});
