// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  One hit test for both realms.
 *
 * The editor's viewport and a running game ask the same question of the same
 * boxes, and asked it twice: the answers had drifted to where a model was
 * clickable in one and a point in the other.
 */
import { describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { pickEntitiesByRay } from '../src/ecs/entityPick';
import { Transform, Sprite, MeshRenderer, SortingGroup, Parent } from '../src/ecs/component';
import { q } from '../src/math/quat';
import { MeshRenderers, meshRendererPlugin } from '../src/render/meshRenderer';
import type { Entity } from '../src/types';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

const name = (c: unknown): string => (c as { _name?: string })._name ?? (c as { name: string }).name;
const ent = (n: number) => n as unknown as Entity;

/** A world of hand-written component values, plus the list a pick walks. */
function fakeWorld(
    rows: Record<number, Record<string, unknown>>,
    meshBounds: Record<number, { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }> = {},
) {
    return {
        valid: (e: Entity) => rows[e as unknown as number] !== undefined,
        has: (e: Entity, c: unknown) => rows[e as unknown as number]?.[name(c)] !== undefined,
        get: (e: Entity, c: unknown) => rows[e as unknown as number]?.[name(c)],
        getAllEntities: () => Object.keys(rows).map((k) => ent(Number(k))),
        getCppRegistry: () => ({}),
        getWasmModule: () => ({
            meshRenderer_localBounds: (_r: unknown, e: number) => meshBounds[e] ?? null,
        }),
    } as never;
}

const T = (x: number, y: number, z = 0) => ({
    worldPosition: { x, y, z },
    worldScale: { x: 1, y: 1, z: 1 },
    worldRotation: { x: 0, y: 0, z: 0, w: 1 },
});

const sprite = (layer: number) => ({ size: { x: 100, y: 100 }, pivot: { x: 0.5, y: 0.5 }, layer });

const down = (x: number, y: number) => ({ origin: { x, y, z: 1000 }, dir: { x: 0, y: 0, z: -1 } });

describe('picking entities by ray', () => {
    it('returns what the ray meets, ranked the way the frame stacked it', () => {
        const world = fakeWorld({
            1: { [name(Transform)]: T(0, 0), [name(Sprite)]: sprite(0) },
            2: { [name(Transform)]: T(0, 0), [name(Sprite)]: sprite(3) },
        });
        expect(pickEntitiesByRay(world, down(0, 0))).toEqual([ent(2), ent(1)]);
    });

    it('leaves out what the ray misses', () => {
        const world = fakeWorld({
            1: { [name(Transform)]: T(0, 0), [name(Sprite)]: sprite(0) },
            2: { [name(Transform)]: T(400, 0), [name(Sprite)]: sprite(0) },
        });
        expect(pickEntitiesByRay(world, down(0, 0))).toEqual([ent(1)]);
    });

    // The play realm boxed a model by its transform alone, so a click anywhere on
    // an imported mesh landed on whatever was behind it.
    it('takes a mesh by its geometry, in a realm that draws no icons', () => {
        const world = fakeWorld(
            { 1: { [name(Transform)]: T(0, 0), [name(MeshRenderer)]: {} } },
            { 1: { minX: -200, minY: -200, minZ: -200, maxX: 200, maxY: 200, maxZ: 200 } },
        );
        expect(pickEntitiesByRay(world, down(150, 150))).toEqual([ent(1)]);
        expect(pickEntitiesByRay(world, down(250, 0))).toEqual([]);
    });

    it('picks the nearest opaque mesh when seen from the side of mirrored geometry', () => {
        const bounds = { minX: 0, minY: -2, minZ: -2, maxX: 4, maxY: 2, maxZ: 2 };
        const world = fakeWorld({
            1: { Transform: { ...T(8, 0), worldScale: { x: -2, y: 1, z: 1 } }, MeshRenderer: { opaque: true, layer: 0 } },
            2: { Transform: T(-8, 0), MeshRenderer: { opaque: true, layer: 9 } },
        }, { 1: bounds, 2: bounds });
        expect(pickEntitiesByRay(world, { origin: { x: 20, y: 0, z: 0 }, dir: { x: -1, y: 0, z: 0 } }))
            .toEqual([ent(1), ent(2)]);
        expect(pickEntitiesByRay(world, { origin: { x: -20, y: 0, z: 0 }, dir: { x: 1, y: 0, z: 0 } }))
            .toEqual([ent(2), ent(1)]);
    });

    it.skipIf(!HAS_WASM)('orders meshes using bounds from the engine under a mirrored parent', async () => {
        const core = await loadWasmModule();
        const app = App.new();
        const registry = new core.Registry();
        app.connectCpp(registry, core, { ownedRegistry: true });
        app.addPlugin(meshRendererPlugin);
        const world = app.world;
        try {
            const parent = world.spawn();
            world.insert(parent, Transform, { rotation: q.axis('y', Math.PI / 2), scale: { x: -2, y: 1, z: 1 } });
            const mesh = (z: number, layer: number) => {
                const entity = world.spawn();
                world.insert(entity, Transform, { position: { x: 0, y: 0, z } });
                world.insert(entity, MeshRenderer, { opaque: true, layer });
                world.setParent(entity, parent);
                app.getResource(MeshRenderers).setGeometry(entity, {
                    positions: [0, -2, 4, -2, 0, 2], indices: [0, 1, 2],
                });
                return entity;
            };
            const near = mesh(8, 0), far = mesh(-8, 9);
            core.transform_update(registry);
            const hit = pickEntitiesByRay(world, { origin: { x: 20, y: -1, z: 2 }, dir: { x: -1, y: 0, z: 0 } });
            expect(hit).toEqual([near, far]);
        } finally { app.quit({ keepRenderer: true }); }
    });

    it('uses the mesh sorting layer rather than its icon fallback layer', () => {
        const world = fakeWorld({
            1: { Transform: T(0, 0), Sprite: sprite(3) },
            2: { Transform: T(0, 0), MeshRenderer: { layer: 2 } },
            3: { Transform: T(0, 0), MeshRenderer: { layer: 4 } },
        }, { 2: { minX: -2, minY: -2, minZ: -2, maxX: 2, maxY: 2, maxZ: 2 },
            3: { minX: -2, minY: -2, minZ: -2, maxX: 2, maxY: 2, maxZ: 2 } });
        expect(pickEntitiesByRay(world, down(0, 0), { iconHalf: 24 })).toEqual([ent(3), ent(1), ent(2)]);
    });

    it('ranks a blended sprite over the opaque mesh at the same draw order', () => {
        const world = fakeWorld({
            1: { Transform: T(0, 0, 20), MeshRenderer: { opaque: true, layer: 0 } },
            2: { Transform: T(0, 0, 0), Sprite: sprite(0) },
        }, { 1: { minX: -2, minY: -2, minZ: -2, maxX: 2, maxY: 2, maxZ: 2 } });
        expect(pickEntitiesByRay(world, down(0, 0))).toEqual([ent(2), ent(1)]);
    });

    it('only boxes what draws nothing when the realm draws a gizmo for it', () => {
        const world = fakeWorld({ 1: { [name(Transform)]: T(0, 0) } });
        expect(pickEntitiesByRay(world, down(10, 10))).toEqual([]);
        expect(pickEntitiesByRay(world, down(10, 10), { iconHalf: 24 })).toEqual([ent(1)]);
    });

    // A gizmo is drawn over everything, so it is clicked before the sprite it
    // sits on — and only in a realm that draws one.
    it('ranks a gizmo above the sprite beneath it', () => {
        const world = fakeWorld({
            1: { [name(Transform)]: T(0, 0), [name(Sprite)]: sprite(5) },
            2: { [name(Transform)]: T(0, 0) },
        });
        expect(pickEntitiesByRay(world, down(0, 0), { iconHalf: 24 })).toEqual([ent(2), ent(1)]);
    });

    it('drops what the realm refuses to select', () => {
        const world = fakeWorld({
            1: { [name(Transform)]: T(0, 0), [name(Sprite)]: sprite(0) },
            2: { [name(Transform)]: T(0, 0), [name(Sprite)]: sprite(1) },
        });
        const only = pickEntitiesByRay(world, down(0, 0), { pickable: (e) => e === ent(1) });
        expect(only).toEqual([ent(1)]);
    });

    // Depth is the ray's, not the cursor's plane: a sprite well behind another is
    // still under the same pixel, and both were always meant to be reachable.
    it('meets everything along the ray, at whatever depth', () => {
        const world = fakeWorld({
            1: { [name(Transform)]: T(0, 0, 0), [name(Sprite)]: sprite(0) },
            2: { [name(Transform)]: T(0, 0, -900), [name(Sprite)]: sprite(0) },
        });
        expect(pickEntitiesByRay(world, down(0, 0))).toHaveLength(2);
    });
});

/**
 * A click has to land on what the person SEES, so the pick resolves groups the way
 * the renderer does. These pin the two ways that can silently go wrong: reading the
 * member's layer instead of the group's, and dropping the member order that is the
 * only thing separating siblings once the group owns the layer.
 */
describe('picking inside a sorting group', () => {
    const g = (layer: number, order: number) => ({ layer, order, enabled: true });

    it('picks the group member stated on top, not the one with the higher own layer', () => {
        const world = fakeWorld({
            1: { Transform: T(0, 0), SortingGroup: g(2, 0) },
            // Both in the group. The BODY claims a far higher sorting layer of its own,
            // which the group overrides — while the arm is stated above it inside.
            2: { Transform: T(0, 0), Sprite: { ...sprite(30), order: 0 }, Parent: { entity: ent(1) } },
            3: { Transform: T(0, 0), Sprite: { ...sprite(0), order: 1 }, Parent: { entity: ent(1) } },
        });
        expect(pickEntitiesByRay(world, down(0, 0))[0]).toBe(ent(3));
    });

    it('puts a whole group above an outsider the members individually sink below', () => {
        const world = fakeWorld({
            1: { Transform: T(0, 0), SortingGroup: g(5, 4) },
            2: { Transform: T(0, 0), Sprite: { ...sprite(5), order: -120 }, Parent: { entity: ent(1) } },
            // Ungrouped, stated above what the member states for itself — and still below
            // the group the member belongs to.
            9: { Transform: T(0, 0), Sprite: { ...sprite(5), order: 3 } },
        });
        expect(pickEntitiesByRay(world, down(0, 0))[0]).toBe(ent(2));
    });

    it('is unaffected by a group that is disabled', () => {
        const world = fakeWorld({
            1: { Transform: T(0, 0), SortingGroup: { layer: 9, order: 9, enabled: false } },
            2: { Transform: T(0, 0), Sprite: { ...sprite(1), order: 0 }, Parent: { entity: ent(1) } },
            9: { Transform: T(0, 0), Sprite: { ...sprite(2), order: 0 } },
        });
        expect(pickEntitiesByRay(world, down(0, 0))[0]).toBe(ent(9));
    });
});
