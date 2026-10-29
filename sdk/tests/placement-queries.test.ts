// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The two questions a build mode and an interact button ask: where does a footprint sit on the grid and may it stand there, and what is nearest.
 */
import { describe, expect, it } from 'vitest';
import {
    checkPlacement, gridCellAt, gridCellCentre, snapFootprint, snapToGrid, type PlacementGrid,
} from '../src/gameplay/placement';
import { nearestEntities, nearestMarkers } from '../src/gameplay/nearest';
import { Disabled, Marker, Transform } from '../src/ecs/component';
import type { World } from '../src/ecs/world';
import type { Entity } from '../src/types';

const grid: PlacementGrid = { cellWidth: 32, cellHeight: 32 };
const e = (n: number) => n as unknown as Entity;

describe('snapping to a grid', () => {
    it('finds the cell a point is in, and its middle, with an origin and with negatives', () => {
        expect(gridCellAt(grid, 40, 70)).toEqual({ col: 1, row: 2 });
        expect(gridCellAt(grid, -1, -33)).toEqual({ col: -1, row: -2 });
        expect(gridCellCentre(grid, 1, 2)).toEqual({ x: 48, y: 80 });
        const shifted: PlacementGrid = { cellWidth: 10, cellHeight: 10, originX: 5, originY: -5 };
        expect(gridCellAt(shifted, 5, -5)).toEqual({ col: 0, row: 0 });
        expect(gridCellCentre(shifted, 0, 0)).toEqual({ x: 10, y: 0 });
    });

    it('snaps a point to a cell middle or to the nearest corner', () => {
        expect(snapToGrid(grid, 40, 70)).toEqual({ x: 48, y: 80, col: 1, row: 2 });
        expect(snapToGrid(grid, 40, 70, 'corner')).toEqual({ x: 32, y: 64, col: 1, row: 2 });
        expect(snapToGrid(grid, 50, 81, 'corner')).toEqual({ x: 64, y: 96, col: 2, row: 3 });
    });

    it('snaps a footprint by its middle: odd counts on a cell, even on a corner, each way on its own', () => {
        const wall = snapFootprint(grid, 100, 40, 3, 1);
        expect(wall).toMatchObject({ col: 2, row: 1, cols: 3, rows: 1 });
        // 3 wide centres on the middle of the middle cell, 1 high on the middle of its cell.
        expect(wall.x).toBe(2 * 32 + 48);
        expect(wall.y).toBe(32 + 16);
        const table = snapFootprint(grid, 100, 100, 2, 2);
        expect(table.x % 32).toBe(0);
        expect(table.y % 32).toBe(0);
        expect(table.rect).toEqual({ minX: 64, minY: 64, maxX: 128, maxY: 128 });
        // Dragged a little the same cell, it stays; dragged past half a cell, it moves by one.
        expect(snapFootprint(grid, 102, 100, 2, 2).col).toBe(table.col);
        expect(snapFootprint(grid, 120, 100, 2, 2).col).toBe(table.col + 1);
    });
});

describe('whether a footprint may stand', () => {
    const one = snapFootprint(grid, 48, 48, 1, 1);
    const two = snapFootprint(grid, 64, 64, 2, 2);

    it('is clear with no probes at all', () => {
        expect(checkPlacement(grid, two)).toEqual({ clear: true, blockers: [], blockedCells: [] });
    });

    it('is blocked by what the physics world finds in it, less what is ignored, and asks once with the footprint shrunk a hair', () => {
        const asked: unknown[] = [];
        const physics = { overlapAABB: (min: { x: number; y: number }, max: { x: number; y: number }, mask?: number) => { asked.push([min, max, mask]); return [e(7), e(9)]; } };
        const result = checkPlacement(grid, two, { physics, mask: 0b10, ignore: new Set([e(9)]) });
        expect(result).toEqual({ clear: false, blockers: [e(7)], blockedCells: [] });
        expect(asked).toHaveLength(1);
        const [min, max, mask] = asked[0] as [{ x: number; y: number }, { x: number; y: number }, number];
        expect(min.x).toBeGreaterThan(two.rect.minX);
        expect(max.x).toBeLessThan(two.rect.maxX);
        expect(mask).toBe(0b10);
        expect(checkPlacement(grid, two, { physics, ignore: new Set([e(7), e(9)]) }).clear).toBe(true);
    });

    it('is blocked by a solid tile under any part of a cell it covers, and names the cell', () => {
        // A wall of tiles 8 wide along x = 70 to 78: the footprint (cells 1 and 2, x 32..96) is touched only in its second column.
        const result = checkPlacement(grid, snapFootprint(grid, 64, 64, 2, 2), { solidAt: (x) => x >= 70 && x <= 78 });
        expect(result.clear).toBe(false);
        expect(result.blockedCells.length).toBeGreaterThan(0);
        expect(result.blockedCells.every((c) => c.col === 2)).toBe(true);
        // A tile thinner than the sampling step can slip between the points, which is what the step is for.
        expect(checkPlacement(grid, snapFootprint(grid, 64, 64, 2, 2), { solidAt: (x) => x >= 70 && x <= 70.5, solidStep: 32 }).clear).toBe(true);
        expect(checkPlacement(grid, snapFootprint(grid, 64, 64, 2, 2), { solidAt: (x) => x >= 70 && x <= 70.5, solidStep: 0.25 }).clear).toBe(false);
        expect(checkPlacement(grid, one, { solidAt: () => false }).clear).toBe(true);
    });

    it('is blocked by a cell the game\'s own table says is taken', () => {
        const result = checkPlacement(grid, two, { blocked: (col, row) => col === 2 && row === 2 });
        expect(result).toEqual({ clear: false, blockers: [], blockedCells: [{ col: 2, row: 2 }] });
    });
});

/** A world that holds only what the query reads: which entities carry a component, where each stands, whether it is off. */
function fakeWorld(entities: { id: number; at: [number, number, number]; marker?: { type: string; properties?: Record<string, string> }; off?: boolean }[]): World {
    const byId = new Map(entities.map((x) => [x.id, x]));
    return {
        ensureTransformsComposed() {},
        getEntitiesWithComponents: (components: unknown[]) => entities.filter((x) => !components.includes(Marker) || x.marker).map((x) => e(x.id)),
        has: (entity: Entity, component: unknown) => component === Disabled && byId.get(entity as unknown as number)!.off === true,
        get: (entity: Entity, component: unknown) => {
            const x = byId.get(entity as unknown as number)!;
            if (component === Transform) return { worldPosition: { x: x.at[0], y: x.at[1], z: x.at[2] } };
            return { type: x.marker?.type ?? '', properties: x.marker?.properties ?? {} };
        },
    } as unknown as World;
}

describe('what is nearest', () => {
    const world = fakeWorld([
        { id: 1, at: [10, 0, 0], marker: { type: 'door' } },
        { id: 2, at: [3, 4, 0], marker: { type: 'tree', properties: { kind: 'oak' } } },
        { id: 3, at: [40, 0, 0], marker: { type: 'tree', properties: { kind: 'pine' } } },
        { id: 4, at: [1, 1, 0], marker: { type: 'tree' }, off: true },
        { id: 5, at: [0, 0, 8], marker: { type: 'bed' } },
    ]);

    it('lists what carries the component nearest first, within a radius, with how far', () => {
        const found = nearestEntities(world, Marker, { x: 0, y: 0 });
        expect(found.map((f) => f.entity)).toEqual([e(5), e(2), e(1), e(3)].filter((x) => found.some((f) => f.entity === x)));
        expect(found[0]).toMatchObject({ entity: e(5), distance: 0 });
        expect(found.find((f) => f.entity === e(2))!.distance).toBe(5);
        expect(nearestEntities(world, Marker, { x: 0, y: 0 }, { radius: 6 }).map((f) => f.entity)).toEqual([e(5), e(2)]);
        expect(nearestEntities(world, Marker, { x: 0, y: 0 }, { limit: 1 })).toHaveLength(1);
    });

    it('does not find what is switched off, and can measure on the ground instead', () => {
        expect(nearestEntities(world, Marker, { x: 0, y: 0 }).some((f) => f.entity === e(4))).toBe(false);
        const ground = nearestEntities(world, Marker, { x: 0, y: 0 }, { plane: 'xz', limit: 1 });
        // Seen from above, the bed at z 8 is far (8) and the oak at (3, z 0) is the nearest (3).
        expect(ground[0]).toMatchObject({ entity: e(2), distance: 3 });
    });

    it('takes a filter on the component\'s data', () => {
        const trees = nearestEntities(world, Marker, { x: 0, y: 0 }, { filter: (_e, marker) => marker.type === 'tree' });
        expect(trees.map((f) => f.entity)).toEqual([e(2), e(3)]);
    });

    it('finds markers by type, by several types, and by property', () => {
        expect(nearestMarkers(world, { x: 0, y: 0 }, { type: 'tree' }).map((f) => f.entity)).toEqual([e(2), e(3)]);
        expect(nearestMarkers(world, { x: 0, y: 0 }, { type: ['door', 'bed'] }).map((f) => f.entity)).toEqual([e(5), e(1)]);
        expect(nearestMarkers(world, { x: 0, y: 0 }, { type: 'tree', has: { kind: 'pine' } }).map((f) => f.entity)).toEqual([e(3)]);
        expect(nearestMarkers(world, { x: 0, y: 0 }, { radius: 1 })).toHaveLength(1);
    });
});
