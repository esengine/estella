// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The box an editor outlines is the box the renderer draws.
 *
 * Two derivations of it agree on a plain sprite and part company the moment a
 * pivot or a parent scale is involved — which is the case a selection outline
 * sitting beside its sprite is made of. One definition, these claims.
 */
import { describe, expect, it, vi } from 'vitest';
import { entityWorldBox, entityBoxCorners, entityBoxRayHit, extendEntityBoxBounds, uiNodeWorldBox, meshWorldBox } from '../src/ecs/entityBox';
import { Transform, Sprite, MeshRenderer, ShapeRenderer } from '../src/ecs/component';
import { UINode } from '../src/ui/core/ui-node';
import { framePreview } from '../src/app/previewApp';
import type { App } from '../src/app/app';
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
const meshBounds = (b: { minX: number; minY: number; maxX: number; maxY: number; minZ?: number; maxZ?: number } | null) => ({
    getCppRegistry: () => ({}),
    getWasmModule: () => ({ meshRenderer_localBounds: () => b }),
});

/** The engine side of a UI box: a resolved layout size, in the core's own tables. */
const layout = (w: number, h: number) => ({
    getCppRegistry: () => ({}),
    getWasmModule: () => ({ uiNode_computedWidth: () => w, uiNode_computedHeight: () => h }),
});

const name = (c: unknown): string => (c as { _name?: string })._name ?? (c as { name: string }).name;
const ent = (n: number) => n as unknown as Entity;
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

/** A turn of `rad` about one world axis, as a rotation. */
const turn = (axis: 'x' | 'y' | 'z', rad: number) => ({
    x: axis === 'x' ? Math.sin(rad / 2) : 0,
    y: axis === 'y' ? Math.sin(rad / 2) : 0,
    z: axis === 'z' ? Math.sin(rad / 2) : 0,
    w: Math.cos(rad / 2),
});

it('frames mixed scene geometry and keeps distant UI in its own preview projection', () => {
    const world = {
        ...fakeWorld({
            1: { Transform: T(-100, 20, 2, 1), MeshRenderer: {} },
            2: { Transform: T(200, -80, 1, 2, 0.6), Sprite: { size: { x: 40, y: 15 }, pivot: { x: 0.5, y: 0.5 } } },
            3: { Transform: T(5000, 2000), UINode: {} },
        }) as object,
        getCppRegistry: () => ({}),
        getWasmModule: () => ({
            meshRenderer_localBounds: () => ({ minX: -15, minY: -10, minZ: -25, maxX: 15, maxY: 10, maxZ: 25 }),
            uiNode_computedWidth: () => 80,
            uiNode_computedHeight: () => 40,
        }),
    } as never;
    const app = { world } as unknown as App;
    const scene = framePreview(app, [ent(1), ent(2)], 300, 200)!;
    const withUI = framePreview(app, [ent(1), ent(2), ent(3)], 300, 200)!;
    expect(scene.screen).toBeNull();
    expect(withUI.world).toEqual(scene.world);
    const screen = withUI.screen!;
    expect(screen[0] * 5000 + screen[12]).toBeCloseTo(0, 4);
    expect(screen[5] * 2000 + screen[13]).toBeCloseTo(0, 4);
    for (const box of [meshWorldBox(world, ent(1))!, entityWorldBox(world, ent(2))!]) {
        for (const { x, y, z } of entityBoxCorners(box)) {
            const m = scene.world;
            expect(Math.abs(m[0] * x + m[4] * y + m[8] * z + m[12])).toBeLessThan(1);
            expect(Math.abs(m[1] * x + m[5] * y + m[9] * z + m[13])).toBeLessThan(1);
        }
    }
});

describe('an entity world box', () => {
    it('derives a sprite box without sampling the icon scale and keeps the shape fallback size', () => {
        const world = fakeWorld({
            1: { Transform: T(0, 0, -2, 1), Sprite: { size: { x: 12, y: 8 } } },
            2: { Transform: T(0, 0), ShapeRenderer: { size: { x: 4, y: 4 } } },
        });
        const iconHalf = vi.fn(() => 10);
        expect(entityWorldBox(world, ent(1), { iconHalf })).toMatchObject({ hw: 12, hh: 4, hd: 0 });
        expect(iconHalf).not.toHaveBeenCalled();
        expect(entityWorldBox(world, ent(2), { iconHalf })).toMatchObject({ hw: 10, hh: 10, hd: 0 });
        expect(iconHalf).toHaveBeenCalledTimes(1);
    });
    it('is the sprite size taken through the WORLD scale', () => {
        // A parent scale reaches the drawn size, so it has to reach the box: this
        // is the case where "size alone" and "size × world scale" diverge.
        const world = fakeWorld({
            1: { [name(Transform)]: T(10, 20, 2, 3), [name(Sprite)]: { size: { x: 100, y: 50 }, pivot: { x: 0.5, y: 0.5 } } },
        });
        const box = entityWorldBox(world, ent(1));
        expect(box).toEqual({ cx: 10, cy: 20, cz: 0, hw: 100, hh: 75, hd: 0, rot: { x: 0, y: 0, z: 0, w: 1 } });
    });

    it('keeps a mirrored skeleton extent sized and turns its signed centre offset', () => {
        const world = fakeWorld({ 1: { Transform: T(100, 30, -2, -3, Math.PI / 2) } });
        const box = entityWorldBox(world, ent(1), { iconHalf: 4,
            extentOf: () => ({ x: 10, y: -4, width: 20, height: 12 }) })!;
        expect(box).toMatchObject({ hw: 20, hh: 18, hd: 0 });
        expect(box.cx).toBeCloseTo(106);
        expect(box.cy).toBeCloseTo(-10);
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
        // A cube, not a card: an icon is a marker in space and reads the same from
        // wherever the view has been turned to.
        expect(entityWorldBox(world, ent(1), { iconHalf: 24 }))
            .toEqual({ cx: 5, cy: 5, cz: 0, hw: 24, hh: 24, hd: 24, rot: { x: 0, y: 0, z: 0, w: 1 } });
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
        expect(uiNodeWorldBox(world, ent(1))).toEqual({ cx: 0, cy: 0, cz: 0, hw: 120, hh: 20, hd: 0, rot: { x: 0, y: 0, z: 0, w: 1 } });
    });

    it('has no UI box for something that is not a laid-out UI node', () => {
        const sprite = { 1: { [name(Transform)]: T(0, 0), [name(Sprite)]: { size: { x: 10, y: 10 } } } };
        expect(uiNodeWorldBox({ ...fakeWorld(sprite) as object, ...layout(120, 40) } as never, ent(1))).toBeNull();
        // A node the layout has not sized yet has no box to outline or hit-test.
        const node = { 1: { [name(Transform)]: T(0, 0), [name(UINode)]: {} } };
        expect(uiNodeWorldBox({ ...fakeWorld(node) as object, ...layout(0, 0) } as never, ent(1))).toBeNull();
    });

    it('has eight corners, which for a flat box are its four twice over', () => {
        const flat = entityBoxCorners({ cx: 0, cy: 0, cz: 0, hw: 2, hh: 1, hd: 0, rot: IDENTITY });
        expect(flat).toHaveLength(8);
        expect(new Set(flat.map((c) => `${c.x},${c.y},${c.z}`)).size).toBe(4);
        expect(flat.slice(4)).toEqual(flat.slice(0, 4));
        expect(flat[4]).not.toBe(flat[0]);

        const solid = entityBoxCorners({ cx: 0, cy: 0, cz: 0, hw: 2, hh: 1, hd: 3, rot: IDENTITY });
        expect(new Set(solid.map((c) => `${c.x},${c.y},${c.z}`)).size).toBe(8);
        expect(Math.min(...solid.map((c) => c.z))).toBe(-3);
    });

    it('accumulates the same limits as exact corners of tilted flat and solid boxes', () => {
        const flat = { cx: 5, cy: 1, cz: -3, hw: 7, hh: 3, hd: 0, rot: turn('x', 0.7) };
        const solid = { cx: -8, cy: -4, cz: 3, hw: 4, hh: 3, hd: 1, rot: { x: 0.5, y: 0.5, z: 0.5, w: 0.5 } };
        const bounds = extendEntityBoxBounds(null, flat);
        expect(extendEntityBoxBounds(bounds, solid)).toBe(bounds);
        const corners = [flat, solid].flatMap(entityBoxCorners);
        expect(bounds.minX).toBeCloseTo(Math.min(...corners.map(c => c.x)), 10);
        expect(bounds.minY).toBeCloseTo(Math.min(...corners.map(c => c.y)), 10);
        expect(bounds.minZ).toBeCloseTo(Math.min(...corners.map(c => c.z)), 10);
        expect(bounds.maxX).toBeCloseTo(Math.max(...corners.map(c => c.x)), 10);
        expect(bounds.maxY).toBeCloseTo(Math.max(...corners.map(c => c.y)), 10);
        expect(bounds.maxZ).toBeCloseTo(Math.max(...corners.map(c => c.z)), 10);
    });
});

describe('a mesh world box', () => {
    it('is the geometry the engine reports, through the world scale', () => {
        // A MeshRenderer has no size field: the extent lives in its vertices, and for
        // resident geometry not even in the component. Only the engine can say.
        const world = {
            ...fakeWorld({ 1: { [name(Transform)]: T(10, 20, 2, 3), [name(MeshRenderer)]: {} } }),
            ...meshBounds({ minX: -50, minY: -10, maxX: 50, maxY: 10 }),
        } as never;
        expect(meshWorldBox(world, ent(1))).toEqual({ cx: 10, cy: 20, cz: 0, hw: 100, hh: 30, hd: 0, rot: { x: 0, y: 0, z: 0, w: 1 } });
    });

    it('follows geometry authored off the origin', () => {
        const world = {
            ...fakeWorld({ 1: { [name(Transform)]: T(0, 0), [name(MeshRenderer)]: {} } }),
            ...meshBounds({ minX: 100, minY: 0, maxX: 300, maxY: 40 }),
        } as never;
        expect(meshWorldBox(world, ent(1))).toEqual({ cx: 200, cy: 20, cz: 0, hw: 100, hh: 20, hd: 0, rot: { x: 0, y: 0, z: 0, w: 1 } });
    });

    it('has none when the mesh draws nothing, and none for a non-mesh', () => {
        const empty = {
            ...fakeWorld({ 1: { [name(Transform)]: T(0, 0), [name(MeshRenderer)]: {} } }),
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

// =============================================================================
// Hit testing. A box was a rect with a Z angle, and a click was a point on the
// entity's own z plane — which answers correctly only while the eye is head-on
// and the entity is turned about nothing but z.
// =============================================================================

const ray = (origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }) => {
    const len = Math.hypot(dir.x, dir.y, dir.z);
    return { origin, dir: { x: dir.x / len, y: dir.y / len, z: dir.z / len } };
};

const FLAT = { cx: 0, cy: 0, cz: 0, hw: 50, hh: 20, hd: 0, rot: IDENTITY };
const DOWN_Z = { x: 0, y: 0, z: -1 };

describe('a ray against an entity box', () => {
    it('keeps touching edges for both identity quaternions and resolves a small real turn', () => {
        const nearEdge = { x: 50, y: -20, z: 100 };
        const negated = { ...FLAT, rot: { x: 0, y: 0, z: 0, w: -1 } };
        expect(entityBoxRayHit(FLAT, nearEdge, DOWN_Z)).toBe(100);
        expect(entityBoxRayHit(negated, nearEdge, DOWN_Z)).toBe(100);
        const outside = { x: 50.001, y: -19, z: 100 };
        expect(entityBoxRayHit(FLAT, outside, DOWN_Z)).toBeNull();
        expect(entityBoxRayHit({ ...FLAT, rot: turn('z', 1e-4) }, outside, DOWN_Z)).toBe(100);
    });

    it('hits a flat box through its face and misses beside it', () => {
        expect(entityBoxRayHit(FLAT, { x: 0, y: 0, z: 100 }, DOWN_Z)).toBeCloseTo(100, 6);
        expect(entityBoxRayHit(FLAT, { x: 49, y: 19, z: 100 }, DOWN_Z)).toBeCloseTo(100, 6);
        expect(entityBoxRayHit(FLAT, { x: 51, y: 0, z: 100 }, DOWN_Z)).toBeNull();
        expect(entityBoxRayHit(FLAT, { x: 0, y: 21, z: 100 }, DOWN_Z)).toBeNull();
    });

    // The whole reason the box carries a rotation rather than an angle: turned
    // about y, a wide sprite is edge-on, and a hit test that only knew its z turn
    // would still report the width it no longer covers.
    it('turns with a rotation about x or y, which an angle could not express', () => {
        const edgeOn = { ...FLAT, rot: turn('y', Math.PI / 2) };
        expect(entityBoxRayHit(edgeOn, { x: 40, y: 0, z: 100 }, DOWN_Z)).toBeNull();
        // Straight down the middle it is met at z = +50, where its width went.
        expect(entityBoxRayHit(edgeOn, { x: 0, y: 0, z: 100 }, DOWN_Z)).toBeCloseTo(50, 6);
        // ...and it is now 100 units deep where it was 100 units wide.
        expect(entityBoxRayHit(edgeOn, { x: -400, y: 0, z: 40 }, { x: 1, y: 0, z: 0 })).toBeCloseTo(400, 6);
    });

    it('is the distance to the near face, and zero from inside', () => {
        const solid = { ...FLAT, hd: 10 };
        expect(entityBoxRayHit(solid, { x: 0, y: 0, z: 60 }, DOWN_Z)).toBeCloseTo(50, 6);
        expect(entityBoxRayHit(solid, { x: 0, y: 0, z: 0 }, DOWN_Z)).toBe(0);
    });

    it('misses what is entirely behind the ray', () => {
        expect(entityBoxRayHit(FLAT, { x: 0, y: 0, z: 100 }, { x: 0, y: 0, z: 1 })).toBeNull();
    });

    // A quad has no thickness, so a ray in its plane is in it — which is what a
    // 2D editor asking "is the cursor on this sprite" has always meant.
    it('meets a flat box from within its own plane', () => {
        expect(entityBoxRayHit(FLAT, { x: -100, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBeCloseTo(50, 6);
        expect(entityBoxRayHit(FLAT, { x: -100, y: 0, z: 1 }, { x: 1, y: 0, z: 0 })).toBeNull();
    });

    it('takes the depth a mesh reports, so a model is not a card', () => {
        const world = {
            ...fakeWorld({ 1: { [name(Transform)]: T(0, 0), [name(MeshRenderer)]: {} } }),
            ...meshBounds({ minX: -50, minY: -50, maxX: 50, maxY: 50, minZ: -50, maxZ: 50 }),
        } as never;
        const box = meshWorldBox(world, ent(1))!;
        expect(box.hd).toBe(50);
        // Side-on: nothing a box built from x and y alone could be hit by.
        expect(entityBoxRayHit(box, { x: 500, y: 0, z: 0 }, { x: -1, y: 0, z: 0 })).toBeCloseTo(450, 6);
    });
});

describe('a shape\'s box', () => {
    it('is its size, scaled by the world scale and centred on the entity', () => {
        const world = fakeWorld({ 1: { Transform: T(10, 20, 2, 1), ShapeRenderer: { size: { x: 80, y: 40 } } } });
        const box = entityWorldBox(world, ent(1));
        expect(box).toMatchObject({ cx: 10, cy: 20, hw: 80, hh: 20, hd: 0 });
    });

    it('is never smaller than the icon a click would have hit anyway', () => {
        const world = fakeWorld({ 1: { Transform: T(0, 0), ShapeRenderer: { size: { x: 2, y: 2 } } } });
        const box = entityWorldBox(world, ent(1), { iconHalf: 11 });
        expect(box).toMatchObject({ hw: 11, hh: 11 });
    });
});

describe('a drawn extent the caller supplies', () => {
    it('is scaled by the world scale and centred where the skeleton stands, not on the origin', () => {
        const world = fakeWorld({ 1: { Transform: T(100, 50, 2, 2) } });
        const box = entityWorldBox(world, ent(1), { extentOf: () => ({ x: -10, y: 0, width: 40, height: 120 }) });
        expect(box).toMatchObject({ cx: 100 + 2 * 10, cy: 50 + 2 * 60, hw: 40, hh: 120 });
    });

    it('leaves an entity with no extent where it was, a box the size of its icon', () => {
        const world = fakeWorld({ 1: { Transform: T(0, 0) } });
        expect(entityWorldBox(world, ent(1), { extentOf: () => null })).toBeNull();
        expect(entityWorldBox(world, ent(1), { iconHalf: 11, extentOf: () => null })).toMatchObject({ hw: 11, hh: 11 });
    });
});
