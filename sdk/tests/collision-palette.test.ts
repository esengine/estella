// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The built-in collision-layer palette: the fixed brush set a TilemapLayer paints
 *        when it references `builtin:collision`. Pins the serialization contract (brush id
 *        → shape) and that the palette IS a valid TilesetModel the collision spawn/overlay
 *        path consumes — render slots empty (nothing draws), plain box merges, rich shapes
 *        spawn one collider each.
 */
import { describe, it, expect } from 'vitest';
import {
  COLLISION_PALETTE_REF, COLLISION_BRUSHES, isCollisionPaletteRef, buildCollisionPaletteModel,
  parseCollisionMaterial, collisionRefWithMaterial,
} from '../src/tilemap/collisionPalette';
import { tileColliderShape } from '../src/tilemap/tiledLoader';

describe('isCollisionPaletteRef', () => {
  it('matches the sentinel ref, alone or in a list', () => {
    expect(isCollisionPaletteRef([COLLISION_PALETTE_REF])).toBe(true);
    expect(isCollisionPaletteRef(['@uuid:abc', COLLISION_PALETTE_REF])).toBe(true);
  });
  it('rejects ordinary tileset refs', () => {
    expect(isCollisionPaletteRef([])).toBe(false);
    expect(isCollisionPaletteRef(['@uuid:abc', 'maps/a.estileset'])).toBe(false);
  });
  it('matches a material-carrying collision ref', () => {
    expect(isCollisionPaletteRef([`${COLLISION_PALETTE_REF}?friction=0.1`])).toBe(true);
  });
});

describe('collision material (encoded in the ref)', () => {
  it('round-trips friction / restitution / density through the ref', () => {
    const m = { friction: 0.1, restitution: 0.4, density: 2 };
    expect(parseCollisionMaterial([collisionRefWithMaterial(m)])).toEqual(m);
  });
  it('a bare ref (or empty material) carries no material', () => {
    expect(collisionRefWithMaterial({})).toBe(COLLISION_PALETTE_REF);
    expect(parseCollisionMaterial([COLLISION_PALETTE_REF])).toEqual({});
  });
  it('parses only finite numeric params, ignoring junk', () => {
    expect(parseCollisionMaterial([`${COLLISION_PALETTE_REF}?friction=0.3&bogus=x&restitution=nope`]))
      .toEqual({ friction: 0.3 });
  });
  it('a material makes even the solid box carry it (leaves the merge set)', () => {
    const model = buildCollisionPaletteModel({ friction: 0.05 });
    expect(model.collidableTileIds).toEqual([]); // no plain box any more
    expect(model.tileShapes.get(1)).toEqual({ shape: { type: 'box' }, friction: 0.05 });
    expect(model.tileShapes.get(8)!.friction).toBe(0.05); // one-way carries it too
  });
});

describe('COLLISION_BRUSHES (serialization contract)', () => {
  it('assigns contiguous 1-based ids in a stable order', () => {
    expect(COLLISION_BRUSHES.map((b) => b.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // The key order is the contract — appending is allowed, renumbering is not.
    expect(COLLISION_BRUSHES.map((b) => b.key)).toEqual([
      'solid', 'rampR', 'rampL', 'halfBottom', 'halfTop', 'halfLeft', 'halfRight', 'oneWay', 'sensor',
    ]);
  });
  it('id 1 is the only plain solid box; one-way/sensor carry modifiers', () => {
    const solid = COLLISION_BRUSHES.find((b) => b.id === 1)!;
    expect(solid.collision).toEqual({ shape: { type: 'box' } });
    expect(COLLISION_BRUSHES.find((b) => b.key === 'oneWay')!.collision.oneWay).toEqual({ nx: 0, ny: 1 });
    expect(COLLISION_BRUSHES.find((b) => b.key === 'sensor')!.collision.sensor).toBe(true);
  });
});

describe('buildCollisionPaletteModel', () => {
  const model = buildCollisionPaletteModel();

  it('has NO render slots or animations (a collision layer never draws)', () => {
    expect(model.slots).toEqual([]);
    expect(model.animations.size).toBe(0);
  });

  it('splits plain box → merge set, rich shapes → per-tile shapes', () => {
    // Only the solid box (id 1) may greedy-merge; slopes/halves/one-way/sensor spawn one each.
    expect(model.collidableTileIds).toEqual([1]);
    expect([...model.tileShapes.keys()].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('every rich brush resolves to a collider shape (consumed by the spawn seam)', () => {
    for (const [id, rc] of model.tileShapes) {
      const shape = tileColliderShape(rc, 32, 32, false, false, false);
      expect(shape.kind, `brush #${id}`).toBeDefined();
    }
    // A ramp is a polygon; a one-way stays a box (its normal rides on the piece, not the shape).
    expect(tileColliderShape(model.tileShapes.get(2)!, 32, 32, false, false, false).kind).toBe('polygon');
    expect(tileColliderShape(model.tileShapes.get(8)!, 32, 32, false, false, false).kind).toBe('box');
  });
});
