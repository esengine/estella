// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The box an editor outlines is the box the renderer draws.
 *
 * Two derivations of it agree on a plain sprite and part company the moment a
 * pivot or a parent scale is involved — which is the case a selection outline
 * sitting beside its sprite is made of. One definition, these claims.
 */
import { describe, expect, it } from 'vitest';
import { entityWorldBox, entityBoxCorners, uiNodeWorldBox, meshWorldBox } from '../src/ecs/entityBox';
import { Transform, Sprite, Mesh2D } from '../src/ecs/component';
import { UINode } from '../src/ui/core/ui-node';
import type { Entity } from '../src/types';

interface Comp { name: string }

/** A world of hand-written component values — the three reads the box takes. */
function fakeWorld(rows: Record<number, Record<string, unknown>>) {
    const nameOf = (c: unknown): string => (c as Comp & { _name?: string })._name ?? (c as { name?: string }).name ?? '';
    return {
        valid: (e: Entity) => rows[e as unknown as number] !== undefined,
        has: (e: Entity, c: unknown) => rows[e as unknown as number]?.[nameOf(c)] !== undefined,
        get: (e: Entity, c: unknown) => rows[e as unknown as number]?.[nameOf(c)],
    } as never;
}

const T = (x: number, y: number, sx = 1, sy = 1, angle = 0) => ({
    worldPosition: { x, y, z: 0 },
    worldScale: { x: sx, y: sy, z: 1 },
    worldRotation: { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) },
});

/** The engine side of a mesh box: the bounds of whichever geometry is live. */
const meshBounds = (b: { minX: number; minY: number; maxX: number; maxY: number } | null) => ({
    getCppRegistry: () => ({}),
    getWasmModule: () => ({ mesh2d_localBounds: () => b }),
});

/** The engine side of a UI box: a resolved layout size, in the core's own tables. */
const layout = (w: number, h: number) => ({
    getCppRegistry: () => ({}),
    getWasmModule: () => ({ uiNode_computedWidth: () => w, uiNode_computedHeight: () => h }),
});

const name = (c: unknown): string => (c as { _name?: string })._name ?? (c as { name: string }).name;
const ent = (n: number) => n as unknown as Entity;

describe('an entity world box', () => {
    it('is the sprite size taken through the WORLD scale', () => {
        // A parent scale reaches the drawn size, so it has to reach the box: this
        // is the case where "size alone" and "size × world scale" diverge.
        const world = fakeWorld({
            1: { [name(Transform)]: T(10, 20, 2, 3), [name(Sprite)]: { size: { x: 100, y: 50 }, pivot: { x: 0.5, y: 0.5 } } },
        });
        const box = entityWorldBox(world, ent(1));
        expect(box).toEqual({ cx: 10, cy: 20, hw: 100, hh: 75, rot: 0 });
    });

    it('puts the centre off the transform when the pivot is off-centre', () => {
        // A bottom-left pivot means the position is the sprite's CORNER; a box
        // centred on the position would sit a half-sprite down and left of it.
        const world = fakeWorld({
            1: { [name(Transform)]: T(0, 0), [name(Sprite)]: { size: { x: 100, y: 40 }, pivot: { x: 0, y: 0 } } },
        });
        const box = entityWorldBox(world, ent(1))!;
        expect(box.cx).toBeCloseTo(50);
        expect(box.cy).toBeCloseTo(20);
    });

    it('orbits that off-centre box around the position when rotated', () => {
        const world = fakeWorld({
            1: { [name(Transform)]: T(0, 0, 1, 1, Math.PI / 2), [name(Sprite)]: { size: { x: 100, y: 40 }, pivot: { x: 0, y: 0 } } },
        });
        const box = entityWorldBox(world, ent(1))!;
        // The +50,+20 offset turned a quarter-turn about the transform position.
        expect(box.cx).toBeCloseTo(-20);
        expect(box.cy).toBeCloseTo(50);
    });

    it('has no box for a UI node, which is hit-tested in its own space', () => {
        const world = fakeWorld({ 1: { [name(Transform)]: T(0, 0), [name(UINode)]: {} } });
        expect(entityWorldBox(world, ent(1))).toBeNull();
    });

    it('reports nothing for an entity that draws nothing, unless given an icon size', () => {
        const world = fakeWorld({ 1: { [name(Transform)]: T(5, 5) } });
        expect(entityWorldBox(world, ent(1))).toBeNull();
        expect(entityWorldBox(world, ent(1), { iconHalf: 24 })).toEqual({ cx: 5, cy: 5, hw: 24, hh: 24, rot: 0 });
    });

    it('has no box for an entity that is not there', () => {
        expect(entityWorldBox(fakeWorld({}), ent(9))).toBeNull();
    });

    it('is not where a UI node is: that box comes from the layout', () => {
        const rows = { 1: { [name(Transform)]: T(0, 0, 2, 1), [name(UINode)]: {} } };
        const world = { ...fakeWorld(rows) as object, ...layout(120, 40) } as never;
        expect(entityWorldBox(world, ent(1))).toBeNull();
        // Scaled like any other box, centred on the transform: layout gives size,
        // the transform gives place.
        expect(uiNodeWorldBox(world, ent(1))).toEqual({ cx: 0, cy: 0, hw: 120, hh: 20, rot: 0 });
    });

    it('has no UI box for something that is not a laid-out UI node', () => {
        const sprite = { 1: { [name(Transform)]: T(0, 0), [name(Sprite)]: { size: { x: 10, y: 10 } } } };
        expect(uiNodeWorldBox({ ...fakeWorld(sprite) as object, ...layout(120, 40) } as never, ent(1))).toBeNull();
        // A node the layout has not sized yet has no box to outline or hit-test.
        const node = { 1: { [name(Transform)]: T(0, 0), [name(UINode)]: {} } };
        expect(uiNodeWorldBox({ ...fakeWorld(node) as object, ...layout(0, 0) } as never, ent(1))).toBeNull();
    });

    it('walks its corners counter-clockwise from the local -x,-y', () => {
        const corners = entityBoxCorners({ cx: 0, cy: 0, hw: 2, hh: 1, rot: 0 });
        expect(corners).toEqual([
            { x: -2, y: -1 },
            { x: 2, y: -1 },
            { x: 2, y: 1 },
            { x: -2, y: 1 },
        ]);
    });
});

describe('a mesh world box', () => {
    it('is the geometry the engine reports, through the world scale', () => {
        // A Mesh2D has no size field: the extent lives in its vertices, and for
        // resident geometry not even in the component. Only the engine can say.
        const world = {
            ...fakeWorld({ 1: { [name(Transform)]: T(10, 20, 2, 3), [name(Mesh2D)]: {} } }),
            ...meshBounds({ minX: -50, minY: -10, maxX: 50, maxY: 10 }),
        } as never;
        expect(meshWorldBox(world, ent(1))).toEqual({ cx: 10, cy: 20, hw: 100, hh: 30, rot: 0 });
    });

    it('follows geometry authored off the origin', () => {
        const world = {
            ...fakeWorld({ 1: { [name(Transform)]: T(0, 0), [name(Mesh2D)]: {} } }),
            ...meshBounds({ minX: 100, minY: 0, maxX: 300, maxY: 40 }),
        } as never;
        expect(meshWorldBox(world, ent(1))).toEqual({ cx: 200, cy: 20, hw: 100, hh: 20, rot: 0 });
    });

    it('has none when the mesh draws nothing, and none for a non-mesh', () => {
        const empty = {
            ...fakeWorld({ 1: { [name(Transform)]: T(0, 0), [name(Mesh2D)]: {} } }),
            ...meshBounds(null),
        } as never;
        expect(meshWorldBox(empty, ent(1))).toBeNull();
        const sprite = {
            ...fakeWorld({ 1: { [name(Transform)]: T(0, 0), [name(Sprite)]: { size: { x: 4, y: 4 } } } }),
            ...meshBounds({ minX: -1, minY: -1, maxX: 1, maxY: 1 }),
        } as never;
        expect(meshWorldBox(sprite, ent(1))).toBeNull();
    });
});
