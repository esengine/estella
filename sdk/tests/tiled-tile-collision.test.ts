// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Tiled per-tile collision import: the collision editor's objectgroup and
 *        the modifier tile properties resolve into the SAME ResolvedTileCollision
 *        model .estileset tiles use, and spawn through the shared per-tile core.
 */
import { describe, it, expect, vi } from 'vitest';
import { parseTmjJson, tiledObjectgroupShape, tiledCollisionMods, generateLayerTileShapes } from '../src/tilemap/tiledLoader';
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

const layerJson = (data: number[], w = 2, h = 1) => ({
  type: 'tilelayer', name: 'ground', width: w, height: h, data, visible: true,
});

function mapJson(tiles: Array<Record<string, unknown>>, data: number[]) {
  return {
    width: 2, height: 1, tilewidth: 16, tileheight: 16, orientation: 'orthogonal',
    layers: [layerJson(data)],
    tilesets: [{
      firstgid: 1, name: 'ts', image: 'a.png', imagewidth: 64, imageheight: 16,
      tilewidth: 16, tileheight: 16, columns: 4, tilecount: 4,
      tiles,
    }],
  };
}

describe('tiledObjectgroupShape', () => {
  it('folds a full-cell rectangle to a merge-eligible box', () => {
    expect(tiledObjectgroupShape([{ x: 0, y: 0, width: 16, height: 16 }], 16, 16)).toEqual({ type: 'box' });
  });
  it('turns a partial rectangle into its 4-corner polygon (normalized)', () => {
    expect(tiledObjectgroupShape([{ x: 0, y: 8, width: 16, height: 8 }], 16, 16)).toEqual({
      type: 'polygon',
      points: [[0, 0.5], [1, 0.5], [1, 1], [0, 1]],
    });
  });
  it('maps an ellipse to the averaged circle', () => {
    expect(tiledObjectgroupShape([{ x: 0, y: 0, width: 16, height: 16, ellipse: true }], 16, 16)).toEqual({
      type: 'circle', cx: 0.5, cy: 0.5, r: 0.5,
    });
  });
  it('offsets polygon points by the object position and normalizes', () => {
    expect(tiledObjectgroupShape(
      [{ x: 0, y: 16, polygon: [{ x: 0, y: 0 }, { x: 16, y: -16 }, { x: 16, y: 0 }] }], 16, 16)).toEqual({
      type: 'polygon', points: [[0, 1], [1, 0], [1, 1]],
    });
  });
  it('skips points and polylines', () => {
    expect(tiledObjectgroupShape([{ x: 1, y: 1, point: true }, { polyline: [{ x: 0, y: 0 }] }], 16, 16)).toBeNull();
  });
});

describe('tiledCollisionMods', () => {
  it('reads oneway/sensor/material from typed tile properties', () => {
    expect(tiledCollisionMods([
      { name: 'oneway', type: 'bool', value: true },
      { name: 'sensor', type: 'bool', value: true },
      { name: 'friction', type: 'float', value: 0.9 },
      { name: 'density', type: 'float', value: 2 },
    ])).toEqual({ oneWay: { nx: 0, ny: 1 }, sensor: true, friction: 0.9, density: 2 });
  });
});

describe('parseTmjJson tile collision', () => {
  it('routes plain full-cell boxes to collisionTileIds and rich shapes to tileShapes', () => {
    const map = parseTmjJson(mapJson([
      { id: 0, objectgroup: { objects: [{ x: 0, y: 0, width: 16, height: 16 }] } },        // gid 1: plain box
      { id: 1, objectgroup: { objects: [{ x: 0, y: 8, width: 16, height: 8 }] } },          // gid 2: half slab
      {
        id: 2,                                                                              // gid 3: one-way box
        objectgroup: { objects: [{ x: 0, y: 0, width: 16, height: 16 }] },
        properties: [{ name: 'oneway', type: 'bool', value: true }],
      },
    ], [1, 2]));

    expect(map.collisionTileIds).toEqual([1]);
    expect(map.tileShapes.get(2)?.shape.type).toBe('polygon');
    expect(map.tileShapes.get(3)).toEqual({ shape: { type: 'box' }, oneWay: { nx: 0, ny: 1 } });
  });

  it('keeps the legacy collision=true property as a plain box', () => {
    const map = parseTmjJson(mapJson([
      { id: 0, properties: [{ name: 'collision', type: 'bool', value: true }] },
    ], [1, 0]));
    expect(map.collisionTileIds).toEqual([1]);
    expect(map.tileShapes.size).toBe(0);
  });
});

describe('generateLayerTileShapes', () => {
  it('spawns one collider per rich tile in a finite layer, sharing the chunk core semantics', () => {
    const map = parseTmjJson(mapJson([
      { id: 1, objectgroup: { objects: [{ x: 0, y: 0, width: 16, height: 16, ellipse: true }] } }, // gid 2: circle
    ], [2, 2]));
    const { world, comps } = mockWorld();
    const spawned = generateLayerTileShapes(
      world, map.layers[0].tiles, 2, 1, map.tileShapes, 16, 16, 0, 0, 100);
    expect(spawned).toHaveLength(2);
    const c = comps.get(spawned[0] as number)!;
    expect(c.get('CircleCollider')).toBeDefined();
    expect(c.get('CircleCollider').radius).toBeCloseTo(8 / 100); // physics units
    expect(c.get('RigidBody')).toBeDefined();
    // Cell 1 sits one tile to the right.
    expect(comps.get(spawned[1] as number)!.get('Transform').position.x).toBeCloseTo(24);
  });
});
