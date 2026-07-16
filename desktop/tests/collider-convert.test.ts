// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Collider shape conversion (unified-collision Phase 4): Box↔Circle↔Polygon
 *        conversion preserves material / sensor / filter / enable and re-derives geometry
 *        so the shape stays where it was drawn (offset ↔ polygon-vertex / AABB centre).
 */
import { describe, it, expect } from 'vitest';
import { convertColliderData, COMP_COLLIDER_SHAPE, COLLIDER_SHAPE_COMP } from '@/engine/colliderConvert';

const boxDef = { halfExtents: { x: 0.5, y: 0.5 }, offset: { x: 0, y: 0 }, radius: 0.05, density: 1, friction: 0.3, restitution: 0, isSensor: false, enabled: true, categoryBits: 1, maskBits: 65535 };
const circleDef = { radius: 0.5, offset: { x: 0, y: 0 }, density: 1, friction: 0.3, restitution: 0, isSensor: false, enabled: true, categoryBits: 1, maskBits: 65535 };
const polyDef = { vertices: [] as Array<{ x: number; y: number }>, radius: 0.05, density: 1, friction: 0.3, restitution: 0, isSensor: false, enabled: true, categoryBits: 1, maskBits: 65535 };

describe('collider shape maps', () => {
  it('the three convertible shapes round-trip name ↔ kind', () => {
    expect(COMP_COLLIDER_SHAPE.BoxCollider).toBe('box');
    expect(COMP_COLLIDER_SHAPE.CircleCollider).toBe('circle');
    expect(COMP_COLLIDER_SHAPE.PolygonCollider).toBe('polygon');
    expect(COMP_COLLIDER_SHAPE.ChainCollider).toBeUndefined(); // not offered
    expect(COLLIDER_SHAPE_COMP.polygon).toBe('PolygonCollider');
  });
});

describe('convertColliderData — geometry preservation', () => {
  const box = { ...boxDef, halfExtents: { x: 2, y: 1 }, offset: { x: 1, y: 0.5 } };

  it('box → circle: radius covers the box (max half extent), offset kept', () => {
    const r = convertColliderData('BoxCollider', 'CircleCollider', box, circleDef);
    expect(r.radius).toBe(2);
    expect(r.offset).toEqual({ x: 1, y: 0.5 });
  });

  it('box → polygon: four corners with the offset baked in, no offset field', () => {
    const r = convertColliderData('BoxCollider', 'PolygonCollider', box, polyDef);
    expect(r.vertices).toEqual([{ x: -1, y: -0.5 }, { x: 3, y: -0.5 }, { x: 3, y: 1.5 }, { x: -1, y: 1.5 }]);
    expect(r.offset).toBeUndefined();
  });

  it('circle → box: square half extents = radius, offset kept', () => {
    const c = { ...circleDef, radius: 1.5, offset: { x: -2, y: 0 } };
    const r = convertColliderData('CircleCollider', 'BoxCollider', c, boxDef);
    expect(r.halfExtents).toEqual({ x: 1.5, y: 1.5 });
    expect(r.offset).toEqual({ x: -2, y: 0 });
  });

  it('circle → polygon: sampled to 16 vertices, first at +radius', () => {
    const c = { ...circleDef, radius: 1, offset: { x: 0, y: 0 } };
    const r = convertColliderData('CircleCollider', 'PolygonCollider', c, polyDef);
    expect((r.vertices as unknown[]).length).toBe(16);
    expect((r.vertices as Array<{ x: number; y: number }>)[0]).toEqual({ x: 1, y: 0 });
  });

  it('polygon → box: AABB centre becomes the offset, AABB half the extents', () => {
    const poly = { ...polyDef, vertices: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }] };
    const r = convertColliderData('PolygonCollider', 'BoxCollider', poly, boxDef);
    expect(r.offset).toEqual({ x: 2, y: 1 });
    expect(r.halfExtents).toEqual({ x: 2, y: 1 });
  });

  it('polygon → circle: radius = farthest vertex from the AABB centre', () => {
    const poly = { ...polyDef, vertices: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }] };
    const r = convertColliderData('PolygonCollider', 'CircleCollider', poly, circleDef);
    expect(r.offset).toEqual({ x: 2, y: 1 });
    expect(r.radius as number).toBeCloseTo(Math.sqrt(5)); // (2,1)→(0,0) = √5
  });
});

describe('convertColliderData — material / sensor / filter carried across', () => {
  it('keeps density / friction / restitution / isSensor / categoryBits / maskBits / enabled', () => {
    const box = { ...boxDef, density: 3, friction: 0.8, restitution: 0.9, isSensor: true, categoryBits: 4, maskBits: 8, enabled: false };
    const r = convertColliderData('BoxCollider', 'PolygonCollider', box, polyDef);
    expect(r).toMatchObject({ density: 3, friction: 0.8, restitution: 0.9, isSensor: true, categoryBits: 4, maskBits: 8, enabled: false });
  });

  it('a field the target lacks (box radius/offset) is dropped, not forced onto polygon', () => {
    const r = convertColliderData('BoxCollider', 'PolygonCollider', boxDef, polyDef);
    expect('offset' in r).toBe(false); // polygon has no offset default → never added
  });
});
