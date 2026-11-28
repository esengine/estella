// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  One hit test for both realms.
 *
 * The editor's viewport and a running game ask the same question of the same
 * boxes, and asked it twice: the answers had drifted to where a model was
 * clickable in one and a point in the other.
 */
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { CameraViewAPI, presentedCameraView } from '../src/camera/Camera';
import { CameraCommit } from '../src/camera/CameraCommit';
import { pickEntityByRay, pickEntitiesByBounds, pickEntitiesByRay, type PickWorld } from '../src/ecs/entityPick';
import { Transform, Sprite, MeshRenderer, ShapeRenderer, SortingGroup, Parent } from '../src/ecs/component';
import { q } from '../src/math/quat';
import { ortho, perspective } from '../src/math/mat4';
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

it('keeps area hits in storage order and reads sorting groups only for masked drawables', () => {
    const world: PickWorld = fakeWorld({
        1: { Transform: T(0, 0), Sprite: sprite(1), Parent: { entity: ent(5) } },
        2: { Transform: T(0, 0), MeshRenderer: { layer: 1 } },
        3: { Transform: T(0, 0), Parent: { entity: ent(5) } },
        4: { Transform: T(200, 0), Sprite: sprite(1) },
        5: { SortingGroup: { layer: 3, order: 2, enabled: true } },
    }, { 2: { minX: -2, minY: -2, minZ: -2, maxX: 2, maxY: 2, maxZ: 2 } });
    const read = vi.spyOn(world, 'get');
    const pick = (cullingMask?: number) => pickEntitiesByBounds(world, box => box.cx < 100, {
        cullingMask, iconHalf: 8,
    });
    expect(pick()).toEqual([ent(1), ent(2), ent(3)]);
    expect(read.mock.calls.filter(([, component]) => component === SortingGroup)).toHaveLength(0);
    expect(pick(1 << 1)).toEqual([ent(2), ent(3)]);
    expect(pick(1 << 3)).toEqual([ent(1), ent(3)]);
    expect(read.mock.calls.filter(([, component]) => component === SortingGroup)).toHaveLength(2);
});

it.skipIf(!HAS_WASM)('reads live nesting during masked area selection without retained component snapshots', async () => {
    const core = await loadWasmModule();
    const app = App.new();
    const registry = new core.Registry();
    app.connectCpp(registry, core, { ownedRegistry: true });
    const world = app.world;
    try {
        const outer = world.spawn(), inner = world.spawn();
        world.insert(outer, SortingGroup, { layer: 4 });
        world.insert(inner, SortingGroup, { layer: 2 });
        world.setParent(inner, outer);
        const a = world.spawn(), b = world.spawn();
        for (const entity of [a, b]) {
            world.insert(entity, Transform);
            world.insert(entity, Sprite, { size: { x: 4, y: 4 }, layer: 1 });
            world.setParent(entity, inner);
        }
        core.transform_update(registry);
        const read = vi.spyOn(world, 'get');
        const hits = pickEntitiesByBounds(world, (_box, entity) => {
            if (entity === b) world.update(outer, SortingGroup, group => { group.enabled = false; });
            return true;
        }, { cullingMask: 1 << 2 });
        expect(hits).toEqual([b]);
        expect(read.mock.calls.filter(([, component]) => component === Parent || component === SortingGroup)).toHaveLength(0);
    } finally { app.quit({ keepRenderer: true }); }
});

it.skipIf(!HAS_WASM)('tracks parent, sorting group and mesh reads during a speculative pick', async () => {
    const core = await loadWasmModule();
    const app = App.new();
    const registry = new core.Registry();
    app.connectCpp(registry, core, { ownedRegistry: true });
    const world = app.world;
    try {
        app.addPlugin(meshRendererPlugin);
        const group = world.spawn(), child = world.spawn();
        world.insert(group, SortingGroup, { layer: 2 });
        world.insert(child, Transform);
        world.insert(child, MeshRenderer);
        world.setParent(child, group);
        app.getResource(MeshRenderers).setGeometry(child, { positions: [-2, -2, 2, -2, 0, 2], indices: [0, 1, 2] });
        core.transform_update(registry);
        const record = vi.fn();
        world.openSpeculation({ record });
        try {
            expect(pickEntityByRay(world, down(0, 0), { cullingMask: 1 << 2 })).toBe(child);
            const reads = record.mock.calls.map(([, entity, component]) => [entity, name(component)]);
            expect(reads).toEqual(expect.arrayContaining([
                [child, 'MeshRenderer'], [child, 'Transform'], [child, 'Parent'], [group, 'SortingGroup'],
            ]));
        } finally { world.closeSpeculation(); }
    } finally { app.quit({ keepRenderer: true }); }
});

describe('picking entities by ray', () => {
    it('keeps the same first hit in a dense mixed 2D and 3D scene', () => {
        const rows: Record<number, Record<string, unknown>> = {};
        const local = { minX: -18, minY: -18, minZ: -2, maxX: 18, maxY: 18, maxZ: 2 };
        const meshes: Record<number, typeof local> = {};
        for (let i = 1; i <= 8192; i++) {
            const x = ((i * 13) % 137) - 68, y = ((i * 31) % 151) - 75, z = (i * 43) % 127;
            rows[i] = { Transform: T(x, y, z) };
            if (i % 2) rows[i].Sprite = { ...sprite(i % 11), order: i % 17 };
            else {
                rows[i].MeshRenderer = { layer: i % 11, opaque: i % 4 === 0 };
                meshes[i] = local;
                if (i % 8 === 0) (rows[i].Transform as ReturnType<typeof T>).worldRotation = q.axis('y', 0.27);
            }
        }
        const world = fakeWorld(rows, meshes);
        const rays = [down(0, 0), down(-21, 18), down(64, 48), down(150, 150)];
        const options = { ySortLayers: 1 << 3 };
        const expected = rays.map(ray => pickEntitiesByRay(world, ray, options)[0] ?? null);
        expect(expected.slice(0, 3).every(hit => hit !== null)).toBe(true);
        expect(expected[3]).toBeNull();
        const pick = () => rays.map(ray => pickEntityByRay(world, ray, options));
        expect(pick()).toEqual(expected);
        if (process.env.ESTELLA_BENCH_PICK === '1') {
            for (let warm = 0; warm < 12; warm++) pick();
            const elapsed = Array.from({ length: 15 }, () => {
                const start = performance.now();
                const hits = pick();
                const ms = performance.now() - start;
                expect(hits).toEqual(expected);
                return ms;
            }).sort((a, b) => a - b);
            console.log(`4 rays / 8192 entities, median ${elapsed[7].toFixed(2)} ms`);
        }
    });

    it('picks a rotated mirrored shape through the same bounds for rays and area selection', () => {
        const world = fakeWorld({
            1: { Transform: { ...T(10, 20), worldScale: { x: -2, y: -3, z: 1 }, worldRotation: q.axis('z', Math.PI / 2) },
                ShapeRenderer: { size: { x: 20, y: 10 }, layer: 1 } },
        });
        const ray = down(22, 38);
        const options = { iconHalf: 2 };
        expect(pickEntitiesByRay(world, ray, options)).toEqual([ent(1)]);
        expect(pickEntityByRay(world, ray, options)).toBe(ent(1));
        expect(pickEntitiesByBounds(world, box => box.hw === 20 && box.hh === 15, options)).toEqual([ent(1)]);
        expect(pickEntitiesByRay(world, down(26, 38), options)).toEqual([]);
    });
    it('resolves masked mesh layers and fallback sprites through live sorting groups', () => {
        const world: PickWorld = fakeWorld({
            1: { Transform: T(0, 0), MeshRenderer: { layer: 1 } },
            2: { Transform: T(0, 0), MeshRenderer: { layer: 1 }, Parent: { entity: ent(5) } },
            3: { Transform: T(0, 0), MeshRenderer: { layer: 1 }, Sprite: sprite(2) },
            4: { Transform: T(0, 0) },
            5: { SortingGroup: { layer: 2, order: 2, enabled: true }, Parent: { entity: ent(2) } },
        }, {
            1: { minX: -2, minY: -2, minZ: -2, maxX: 2, maxY: 2, maxZ: 2 },
            2: { minX: -2, minY: -2, minZ: -2, maxX: 2, maxY: 2, maxZ: 2 },
        });
        const opts = { cullingMask: 1 << 2, iconHalf: 8 };
        const ray = down(0, 0);
        expect(pickEntitiesByRay(world, ray, opts)).toEqual([ent(4), ent(2), ent(3)]);
        expect(pickEntityByRay(world, ray, { ...opts, iconHalf: 0 })).toBe(ent(2));
    });

    it('keeps the same first hit across opaque ties, group overrides and blended layer rules', () => {
        const bounds = { minX: -2, minY: -2, minZ: -2, maxX: 2, maxY: 2, maxZ: 2 };
        const world: PickWorld = fakeWorld({
            1: { Transform: T(0, 0, 20), MeshRenderer: { layer: 1, opaque: true } },
            2: { Transform: T(0, 0, 10), MeshRenderer: { layer: 5, opaque: true } },
            3: { Transform: T(0, 0, 20), MeshRenderer: { layer: 2, opaque: true } },
            4: { Transform: T(0, -5, 15), Sprite: sprite(1), Parent: { entity: ent(6) } },
            5: { Transform: T(0, 5, -15), Sprite: sprite(3) },
            6: { SortingGroup: { layer: 2, order: 0, enabled: true } },
        }, { 1: bounds, 2: bounds, 3: bounds });
        const ray = down(0, 0);
        expect(pickEntityByRay(world, ray, { cullingMask: 0b110 })).toBe(ent(4));
        expect(pickEntityByRay(world, ray, { pickable: id => id < ent(4) })).toBe(ent(3));
        for (const options of [{}, { depthLayers: 0b1010 }, { cullingMask: 0b110, ySortLayers: 0b100 }, { cullingMask: 0 }]) {
            expect(pickEntityByRay(world, ray, options)).toBe(pickEntitiesByRay(world, ray, options)[0] ?? null);
            const clipped = { ...ray, maxDistance: 900 };
            expect(pickEntityByRay(world, clipped, options)).toBeNull();
        }
    });
    it.each(['orthographic', 'perspective'] as const)('uses the drawn depth range for %s camera picks', projection => {
        const origin = { x: 1e8, y: -1e8, z: 1e8 };
        const matrix = projection === 'orthographic'
            ? ortho(-4, 4, -4, 4, 1, 9).slice()
            : perspective(Math.PI / 2, 1, 1, 9).slice();
        const app = App.new();
        Object.assign(app.getResource(CameraCommit), {
            valid: true,
            viewProjection: new Float32Array(16), rebasedProjection: { origin, viewProjection: matrix },
            vpX: 0, vpY: 0, vpW: 200, vpH: 200,
        });
        const ray = presentedCameraView(app).screenRay(150, 100)!;
        const xAt = (depth: number) => origin.x + (projection === 'orthographic' ? 2 : depth / 2);
        expect(ray.maxDistance).toBeCloseTo(Math.hypot(xAt(9) - xAt(1), 8));
        const meshBounds = { minX: -1, maxX: 1, minY: -1, maxY: 1, minZ: -1, maxZ: 1 };
        const world = fakeWorld({
            1: { Transform: T(xAt(6), origin.y, origin.z - 6), Sprite: sprite(0) },
            2: { Transform: T(xAt(9.5), origin.y, origin.z - 9.5), MeshRenderer: { layer: 1 } },
            3: { Transform: T(xAt(11), origin.y, origin.z - 11), Sprite: sprite(5) },
            4: { Transform: T(xAt(0.5), origin.y, origin.z - 0.5), Sprite: sprite(5) },
            5: { Transform: T(xAt(9), origin.y, origin.z - 9), Sprite: sprite(0) },
        }, { 2: meshBounds });
        expect(pickEntitiesByRay(world, ray)).toEqual([ent(2), ent(1), ent(5)]);
        expect(pickEntitiesByRay(world, { origin: ray.origin, dir: ray.dir })).toEqual([ent(3), ent(2), ent(1), ent(5)]);
    });

    it('keeps the ray pointing into the scene when a distant far plane rounds to infinity', () => {
        const camera = new CameraViewAPI(App.new(), () => ({
            viewProjection: perspective(Math.PI / 2, 1, 1, 1e9),
            vpX: 0, vpY: 0, vpW: 200, vpH: 200,
        }));
        const ray = camera.screenRay(150, 100)!;
        const world = fakeWorld({ 1: { Transform: T(100, 0, -200), Sprite: sprite(0) } });
        expect(pickEntitiesByRay(world, ray)).toEqual([ent(1)]);
    });

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

    it.skipIf(!HAS_WASM)('orders meshes under an active mirrored parent using engine bounds', async () => {
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
            const ray = { origin: { x: 20, y: -1, z: 2 }, dir: { x: -1, y: 0, z: 0 } };
            const options = { fallbackPickable: () => false };
            const pick = () => pickEntitiesByRay(world, ray, options);
            const read = vi.spyOn(world, 'get');
            expect(pick()).toEqual([near, far]);
            expect(pickEntityByRay(world, ray, options)).toBe(near);
            expect(read.mock.calls.filter(([, component]) => component === Transform)).toHaveLength(0);
            read.mockRestore();
            const record = vi.fn();
            world.openSpeculation({ record });
            try {
                expect(pick()).toEqual([near, far]);
                expect(record).toHaveBeenCalledWith(world, near, Transform);
                expect(record).toHaveBeenCalledWith(world, far, Transform);
            } finally { world.closeSpeculation(); }
            registry.setEntityEnabled(parent, false);
            expect(world.valid(near)).toBe(true);
            expect(pick()).toEqual([]);
            registry.setEntityEnabled(far, false);
            registry.setEntityEnabled(parent, true);
            expect(pick()).toEqual([near]);
            registry.setEntityEnabled(far, true);
            expect(pick()).toEqual([near, far]);
        } finally { app.quit({ keepRenderer: true }); }
    });

    it('picks each visible renderer on a mixed entity and reports that entity once', () => {
        const bounds = { minX: 28, minY: -2, minZ: -2, maxX: 32, maxY: 2, maxZ: 2 };
        const smallSprite = (layer: number) => ({ ...sprite(layer), size: { x: 12, y: 12 } });
        const world = fakeWorld({
            1: { Transform: T(0, 0), MeshRenderer: { opaque: true, layer: 1 }, Sprite: smallSprite(3),
                ShapeRenderer: { size: { x: 80, y: 6 }, layer: 4 } },
            2: { Transform: T(0, 0), Sprite: smallSprite(2) },
        }, { 1: bounds });
        const layers = (layer: number) => ({ cullingMask: 1 << layer });
        expect(pickEntitiesByRay(world, down(0, 0), layers(3))).toEqual([ent(1)]);
        expect(pickEntityByRay(world, down(30, 0), layers(1))).toBe(ent(1));
        expect(pickEntityByRay(world, down(39, 0), layers(4))).toBe(ent(1));
        expect(pickEntityByRay(world, down(39, 0), layers(1))).toBeNull();
        expect(pickEntitiesByRay(world, down(0, 0))).toEqual([ent(1), ent(2)]);
        expect(pickEntitiesByRay(world, down(30, 0))).toEqual([ent(1)]);
        expect(pickEntitiesByBounds(world, box => box.cx + box.hw >= 39, layers(4))).toEqual([ent(1)]);
        expect(pickEntitiesByBounds(world, () => true)).toEqual([ent(1), ent(2)]);
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

    it('skips disabled draws and uses the remaining visible renderer on the entity', () => {
        const bounds = { minX: 40, minY: -2, minZ: -2, maxX: 42, maxY: 2, maxZ: 2 };
        const world = fakeWorld({
            1: { Transform: T(0, 0), MeshRenderer: { enabled: false, opaque: true, layer: 12 }, Sprite: sprite(1) },
            2: { Transform: T(0, 0), Sprite: { ...sprite(12), enabled: false },
                ShapeRenderer: { size: { x: 8, y: 8 }, layer: 2, enabled: true } },
            3: { Transform: T(0, 0), Sprite: { ...sprite(12), enabled: false } },
            4: { Transform: T(0, 0), ShapeRenderer: { size: { x: 8, y: 8 }, layer: 12, enabled: false } },
            5: { Transform: T(0, 0), MeshRenderer: { enabled: false, opaque: true, layer: 12 } },
        }, { 1: bounds, 5: bounds });
        expect(pickEntitiesByRay(world, down(0, 0), { iconHalf: 8 })).toEqual([ent(2), ent(1)]);
        expect(pickEntitiesByRay(world, down(0, 0), { cullingMask: 1 << 1 })).toEqual([ent(1)]);
        expect(pickEntitiesByRay(world, down(0, 0), { iconHalf: 8, iconPickable: id => id === ent(5) }))
            .toEqual([ent(5), ent(2), ent(1)]);
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

    it('asks about fallback bounds only for selectable entities without a mesh box', () => {
        const bounds = { minX: -2, minY: -2, minZ: -2, maxX: 2, maxY: 2, maxZ: 2 };
        const world = fakeWorld({
            1: { Transform: T(0, 0), MeshRenderer: {} },
            2: { Transform: T(0, 0), MeshRenderer: {} },
            3: { Transform: T(0, 0), Sprite: sprite(3) },
            4: { Transform: T(0, 0), MeshRenderer: {} },
        }, { 1: bounds, 4: bounds });
        const fallbackPickable = vi.fn(entity => entity === ent(3));
        const hits = pickEntitiesByRay(world, down(0, 0), {
            iconHalf: 24, pickable: entity => entity !== ent(4), fallbackPickable,
        });
        expect(hits).toEqual([ent(3), ent(1)]);
        expect(fallbackPickable.mock.calls).toEqual([[ent(2)], [ent(3)]]);
    });

    it('keeps only layers visible to the camera, including group overrides and layerless draws', () => {
        const bounds = { minX: -2, minY: -2, minZ: -2, maxX: 2, maxY: 2, maxZ: 2 };
        const world = fakeWorld({
            1: { Transform: T(0, 0, 8), MeshRenderer: { opaque: true, layer: 3 }, Parent: { entity: ent(5) } },
            2: { Transform: T(0, 0), Sprite: sprite(31) },
            3: { Transform: T(0, 0), Sprite: sprite(32) },
            4: { Transform: T(0, 0), Sprite: sprite(3), Parent: { entity: ent(5) } },
            5: { SortingGroup: { layer: 1, enabled: true, order: 0 } },
            6: { Transform: T(0, 0) },
            7: { Transform: T(0, 0, -8), MeshRenderer: { opaque: true, layer: 31 } },
        }, { 1: bounds, 7: bounds });
        expect(pickEntitiesByRay(world, down(0, 0), { cullingMask: 0x80000000, iconHalf: 8 }))
            .toEqual([ent(6), ent(3), ent(2), ent(7)]);
        expect(pickEntitiesByRay(world, down(0, 0), { cullingMask: 0 }))
            .toEqual([ent(3)]);
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
