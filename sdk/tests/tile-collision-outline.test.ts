// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Editor tile-collision overlay geometry (unified-collision Phase 1b): the pure
 *        world-space outline projection that lets a tile's collision (slopes / circles /
 *        one-way / sensors) be seen in the scene viewport without entering Play. Asserts
 *        it mirrors the runtime spawn — the same merged boxes + flip-aware rich shapes.
 */
import { describe, it, expect } from 'vitest';
import { tileColliderShape, oneWayNormalWorld } from '../src/tilemap/tiledLoader';
import { tileCollisionOutlines } from '../src/tilemap/tileCollisionOutline';
import { resolveTilesetModel, type ResolvedTileCollision, type TilesetModel } from '../src/tilemap/tilesetResolve';
import { parseTileset } from '../src/tilemap/tilesetAsset';
import { encodeTile } from '../src/tilemap/tileBits';
import { CHUNK_SIZE } from '../src/tilemap/chunkCodec';
import type { DecodedChunk } from '../src/tilemap/chunkCodec';

/** A 16×16 chunk with cell index → raw tile value. */
function chunk(x: number, y: number, cells: Record<number, number>): DecodedChunk {
  const tiles = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE);
  for (const [i, v] of Object.entries(cells)) tiles[Number(i)] = v;
  return { x, y, tiles };
}

/** A one-tile model keyed at global id 1 (the tile the tests place). */
function modelOf(collision: ResolvedTileCollision['shape'], extra: Partial<ResolvedTileCollision> = {}): TilesetModel {
  // Round-trip through the real resolver so the tests exercise the same split
  // (plain box → collidableTileIds; rich → tileShapes) the runtime resolve does.
  const model: TilesetModel = { slots: [], animations: new Map(), collidableTileIds: [], tileShapes: new Map() };
  model.tileShapes.set(1, { shape: collision, ...extra });
  return model;
}

describe('tileColliderShape (shared tile→geometry seam)', () => {
  it('box → full-cell half extents, no offset (flip-symmetric)', () => {
    const s = tileColliderShape({ shape: { type: 'box' } }, 16, 16, true, true, true);
    expect(s).toEqual({ kind: 'box', halfExtents: { x: 8, y: 8 }, offset: { x: 0, y: 0 } });
  });

  it('circle → radius = r·tileW, centre offset via the flip transform', () => {
    const s = tileColliderShape({ shape: { type: 'circle', cx: 0.5, cy: 0.5, r: 0.5 } }, 16, 16, false, false, false);
    expect(s).toEqual({ kind: 'circle', radius: 8, offset: { x: 0, y: 0 } });
  });

  it('circle offset follows a horizontal flip', () => {
    // Centre at the tile's left quarter → flipH sends it to the right quarter.
    const s = tileColliderShape({ shape: { type: 'circle', cx: 0.25, cy: 0.5, r: 0.25 } }, 16, 16, true, false, false);
    expect(s.kind).toBe('circle');
    if (s.kind === 'circle') expect(s.offset.x).toBeCloseTo(4); // (0.75-0.5)·16
  });

  it('polygon → local px vertices from the flip-aware transform', () => {
    const s = tileColliderShape({ shape: { type: 'polygon', points: [[0, 0], [1, 0], [1, 0.5]] } }, 16, 16, false, false, false);
    expect(s.kind).toBe('polygon');
    if (s.kind === 'polygon') expect(s.vertices[0]).toEqual({ x: -8, y: 8 }); // top-left pixel → local top-left
  });
});

describe('tileCollisionOutlines', () => {
  it('merges plain solid boxes into one rect outline (matching the native spawn)', () => {
    const asset = parseTileset({
      texture: '@uuid:x', tileWidth: 16, tileHeight: 16, columns: 4,
      tiles: { 2: { collision: { type: 'box' } } },
    });
    const model = resolveTilesetModel([{ asset, textureHandle: 1 }]);
    // Two adjacent solid-box cells (global id 2) → one 2×1 merged rect.
    const pieces = tileCollisionOutlines([chunk(0, 0, { 0: encodeTile(2), 1: encodeTile(2) })], model, 16, 16, 0, 0);
    expect(pieces).toHaveLength(1);
    const p = pieces[0];
    expect(p.sensor).toBe(false);
    expect(p.oneWay).toBeNull();
    // Same centre/extents generateChunkCollision spawns: centre (16,-8), half (16,8).
    expect(p.center).toEqual({ x: 16, y: -8 });
    expect(p.polylines).toHaveLength(1);
    const ring = p.polylines[0];
    expect(ring).toHaveLength(5); // 4 corners + closing point
    expect(ring[0]).toEqual({ x: 0, y: -16 });
    expect(ring[2]).toEqual({ x: 32, y: 0 });
  });

  it('emits a polygon ring per placed slope cell at the cell centre', () => {
    const model = modelOf({ type: 'polygon', points: [[0, 1], [1, 1], [1, 0]] });
    const pieces = tileCollisionOutlines([chunk(0, 0, { 0: encodeTile(1) })], model, 16, 16, 0, 0);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].center).toEqual({ x: 8, y: -8 }); // cell (0,0) centre, world y-up
    expect(pieces[0].polylines[0]).toHaveLength(4); // 3 verts + close
    expect(pieces[0].circles).toHaveLength(0);
  });

  it('emits a circle for a circle-collision tile', () => {
    const model = modelOf({ type: 'circle', cx: 0.5, cy: 0.5, r: 0.5 });
    const pieces = tileCollisionOutlines([chunk(0, 0, { 0: encodeTile(1) })], model, 16, 16, 0, 0);
    expect(pieces[0].circles).toEqual([{ c: { x: 8, y: -8 }, r: 8 }]);
    expect(pieces[0].polylines).toHaveLength(0);
  });

  it('carries the sensor flag and the normalized one-way normal', () => {
    const model = modelOf({ type: 'box' }, { sensor: true, oneWay: { nx: 0, ny: 1 } });
    const pieces = tileCollisionOutlines([chunk(0, 0, { 0: encodeTile(1) })], model, 16, 16, 0, 0);
    expect(pieces[0].sensor).toBe(true);
    expect(pieces[0].oneWay).toEqual({ nx: 0, ny: 1 });
  });

  it('reorients the one-way normal for a flipped cell (matches oneWayNormalWorld)', () => {
    const model = modelOf({ type: 'box' }, { oneWay: { nx: 0, ny: 1 } });
    const raw = encodeTile(1, { flipH: false, flipV: true, flipD: false });
    const pieces = tileCollisionOutlines([chunk(0, 0, { 0: raw })], model, 16, 16, 0, 0);
    const n = oneWayNormalWorld(0, 1, false, true, false);
    expect(pieces[0].oneWay).toEqual({ nx: n.x, ny: n.y });
    expect(pieces[0].oneWay).toEqual({ nx: 0, ny: -1 });
  });

  it('offsets outlines by the layer world origin', () => {
    const model = modelOf({ type: 'circle', cx: 0.5, cy: 0.5, r: 0.5 });
    const pieces = tileCollisionOutlines([chunk(1, 0, { 0: encodeTile(1) })], model, 16, 16, 100, 200);
    // chunk (1,0) local (0,0) → absolute tile (16,0): cx = 100 + (16+0.5)·16 = 364, cy = 200 - 0.5·16 = 192
    expect(pieces[0].circles[0].c).toEqual({ x: 364, y: 192 });
  });

  it('is empty when the model has no collision', () => {
    const model: TilesetModel = { slots: [], animations: new Map(), collidableTileIds: [], tileShapes: new Map() };
    expect(tileCollisionOutlines([chunk(0, 0, { 0: encodeTile(1) })], model, 16, 16, 0, 0)).toEqual([]);
  });
});
