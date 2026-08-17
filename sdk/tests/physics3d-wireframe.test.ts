// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A 3D collider can be seen — and what is seen is what collides.
 *
 * The wireframe exists so an author can tell whether a shape is the size and
 * place they meant. That only helps if it draws the shape the SOLVER built, so
 * the shape-selection half of these checks runs the real stepPhysics3D over the
 * same world and asserts the two agree: whichever `add*` the system called is
 * the instance the reader marked active. Restating the priority order here
 * instead would pass happily while the two drifted apart.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Transform } from '../src/ecs/component';
import type { TransformData } from '../src/ecs/component.generated';
import {
    RigidBody3D, BoxCollider3D, SphereCollider3D, CapsuleCollider3D, CharacterController3D,
    MeshCollider3D, ConvexCollider3D,
} from '../src/physics3d/Physics3DComponents';
import {
    readCollider3DShapes, collider3DWireframe, placeCollider3DWireframe,
    type Collider3DShape,
} from '../src/physics3d/ColliderShape3D';
import { registerMeshCollision, releaseMeshCollision } from '../src/asset/meshCollision';
import { stepPhysics3D, DEFAULT_PHYSICS3D_CONFIG } from '../src/physics3d/Physics3DSystem';
import type { Physics3DWasmModule } from '../src/physics3d/Physics3DModule';
import type { World } from '../src/ecs/world';
import type { App } from '../src/app/app';
import type { Entity, Vec3 } from '../src/types';

/** Records which shape the system asked the module to build. */
function fakeModule(): Physics3DWasmModule & { calls: string[] } {
    const calls: string[] = [];
    const heap = new Float32Array(1024);
    const record = (name: string) => (...args: number[]): number => {
        calls.push(name);
        return args.length > 0 ? calls.length : calls.length;
    };
    return {
        calls,
        HEAPF32: heap,
        HEAPU32: new Uint32Array(heap.buffer),
        _physics3d_init: record('init'),
        _physics3d_isReady: () => 1,
        _physics3d_step: record('step'),
        _physics3d_addBox: record('addBox'),
        _physics3d_addSphere: record('addSphere'),
        _physics3d_addCapsule: record('addCapsule'),
        _physics3d_addMeshBody: record('addMeshBody'),
        _physics3d_addConvexBody: record('addConvexBody'),
        _physics3d_removeBody: record('removeBody'),
        _physics3d_addCharacter: record('addCharacter'),
        _physics3d_moveCharacter: record('moveCharacter'),
        _physics3d_removeCharacter: record('removeCharacter'),
        _physics3d_characterStates: () => 0,
        _physics3d_characterStatesBytes: () => 0,
        _physics3d_transforms: () => 0,
        _physics3d_transformsBytes: () => 0,
        _physics3d_contacts: () => 0,
        _physics3d_contactsBytes: () => 0,
        _malloc: () => 4,
        _free: () => undefined,
    } as unknown as Physics3DWasmModule & { calls: string[] };
}

function fakeWorld() {
    const store = new Map<Entity, Map<unknown, Record<string, unknown>>>();
    let next = 1;
    return {
        spawn(): Entity {
            const e = next++ as Entity;
            store.set(e, new Map());
            return e;
        },
        insert<T>(e: Entity, def: unknown, data?: Partial<T>): T {
            const defaults = (def as { _default?: object })._default ?? {};
            const value = structuredClone({ ...defaults, ...(data ?? {}) });
            store.get(e)!.set(def, value as Record<string, unknown>);
            return value as T;
        },
        get(e: Entity, def: unknown): unknown { return store.get(e)?.get(def); },
        has(e: Entity, def: unknown): boolean { return store.get(e)?.has(def) ?? false; },
        valid(e: Entity): boolean { return store.has(e); },
        queryEntities(defs: unknown[]): Entity[] {
            return [...store.entries()]
                .filter(([, comps]) => defs.every((d) => comps.has(d)))
                .map(([e]) => e);
        },
    };
}

/** The module call each collider component turns into, so the two halves can be compared. */
const CALL_FOR: Record<string, string> = {
    BoxCollider3D: 'addBox',
    SphereCollider3D: 'addSphere',
    CapsuleCollider3D: 'addCapsule',
    MeshCollider3D: 'addMeshBody',
    ConvexCollider3D: 'addConvexBody',
};

function bounds(lines: Vec3[][]): { min: Vec3; max: Vec3 } {
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const line of lines) {
        for (const p of line) {
            min.x = Math.min(min.x, p.x); max.x = Math.max(max.x, p.x);
            min.y = Math.min(min.y, p.y); max.y = Math.max(max.y, p.y);
            min.z = Math.min(min.z, p.z); max.z = Math.max(max.z, p.z);
        }
    }
    return { min, max };
}

const size = (lines: Vec3[][]): Vec3 => {
    const b = bounds(lines);
    return { x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: b.max.z - b.min.z };
};

describe('what a 3D collider looks like', () => {
    let world: ReturnType<typeof fakeWorld>;
    let app: App;
    let module: ReturnType<typeof fakeModule>;

    beforeEach(() => {
        world = fakeWorld();
        app = { world } as unknown as App;
        module = fakeModule();
    });

    const spawn = (withBody = true): Entity => {
        const e = world.spawn();
        world.insert<TransformData>(e, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
            worldPosition: { x: 0, y: 0, z: 0 },
            worldRotation: { x: 0, y: 0, z: 0, w: 1 },
            worldScale: { x: 1, y: 1, z: 1 },
        });
        if (withBody) world.insert(e, RigidBody3D);
        return e;
    };

    const read = (e: Entity) => readCollider3DShapes(world as unknown as World, e);

    /** Which component the solver actually built a body from, per the real system. */
    const built = (): string | null => {
        module.calls.length = 0;
        stepPhysics3D(app, module, new Map(), DEFAULT_PHYSICS3D_CONFIG);
        const call = module.calls.find((c) => Object.values(CALL_FOR).includes(c));
        return call ?? null;
    };

    describe('the shape it reports is the shape the world builds', () => {
        it('marks the box active when box and sphere are both authored', () => {
            const e = spawn();
            world.insert(e, SphereCollider3D);
            world.insert(e, BoxCollider3D);

            const active = read(e).filter((i) => i.active);
            expect(active).toHaveLength(1);
            expect(CALL_FOR[active[0]!.component]).toBe(built());
        });

        it('follows the world past a disabled collider to the next one', () => {
            const e = spawn();
            world.insert(e, BoxCollider3D, { enabled: false });
            world.insert(e, SphereCollider3D);

            const active = read(e).filter((i) => i.active);
            expect(active).toHaveLength(1);
            expect(active[0]!.component).toBe('SphereCollider3D');
            expect(built()).toBe('addSphere');
        });

        it('lets a mesh collider shadow a capsule, as the world does', () => {
            registerMeshCollision(4242, {
                positions: new Float32Array([0, 0, 0, 100, 0, 0, 0, 0, 100, 100, 0, 100]),
                indices: new Uint32Array([0, 2, 1, 2, 3, 1]),
            });
            const e = spawn();
            world.insert(e, MeshCollider3D, { mesh: 4242 });
            world.insert(e, CapsuleCollider3D);

            const active = read(e).filter((i) => i.active);
            expect(active.map((i) => i.component)).toEqual(['MeshCollider3D']);
            expect(built()).toBe('addMeshBody');
            releaseMeshCollision(4242);
        });

        it('draws a convex hull as the shape the world builds from it', () => {
            registerMeshCollision(555, {
                positions: new Float32Array([-2, 0, -2, 2, 0, -2, 0, 6, 0, 0, 0, 4]),
                indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
            });
            const e = spawn();
            world.insert(e, ConvexCollider3D, { mesh: 555 });

            const [inst] = read(e);
            expect(inst!.component).toBe('ConvexCollider3D');
            expect(inst!.active).toBe(true);
            expect(CALL_FOR[inst!.component]).toBe(built());
            if (inst!.shape.kind !== 'box') throw new Error('unreachable');
            expect(inst!.shape.halfExtents).toEqual({ x: 2, y: 3, z: 3 });
            releaseMeshCollision(555);
        });

        it('reports no active shape without a rigid body, and the world builds none', () => {
            const e = spawn(false);
            world.insert(e, BoxCollider3D);

            expect(read(e)).toHaveLength(1);          // still authorable, still drawn
            expect(read(e)[0]!.active).toBe(false);
            expect(built()).toBeNull();
        });

        it('reports no active shape for a disabled body', () => {
            const e = spawn();
            world.insert(e, RigidBody3D, { enabled: false });
            world.insert(e, BoxCollider3D);

            expect(read(e)[0]!.active).toBe(false);
            expect(built()).toBeNull();
        });

        it('draws a character beside the body shape rather than instead of it', () => {
            const e = spawn();
            world.insert(e, BoxCollider3D);
            world.insert(e, CharacterController3D);

            const active = read(e).filter((i) => i.active).map((i) => i.component);
            expect(active).toEqual(['BoxCollider3D', 'CharacterController3D']);
        });

        it('carries the sensor flag through, so an overlay can tell them apart', () => {
            const e = spawn();
            world.insert(e, SphereCollider3D, { isSensor: true });
            expect(read(e)[0]!.isSensor).toBe(true);
        });
    });

    describe('the wireframe', () => {
        it('spans exactly the box it describes', () => {
            const shape: Collider3DShape = {
                kind: 'box',
                halfExtents: { x: 10, y: 20, z: 30 },
                center: { x: 0, y: 0, z: 0 },
            };
            expect(size(collider3DWireframe(shape))).toEqual({ x: 20, y: 40, z: 60 });
        });

        it('gives the box its twelve edges', () => {
            const shape: Collider3DShape = {
                kind: 'box', halfExtents: { x: 1, y: 1, z: 1 }, center: { x: 0, y: 0, z: 0 },
            };
            const lines = collider3DWireframe(shape);
            const segments = lines.reduce((n, l) => n + l.length - 1, 0);
            expect(segments).toBe(12);
            const corners = new Set(lines.flat().map((p) => `${p.x},${p.y},${p.z}`));
            expect(corners.size).toBe(8);
        });

        it('keeps every sphere point on the sphere', () => {
            const lines = collider3DWireframe({ kind: 'sphere', radius: 7 });
            for (const p of lines.flat()) {
                expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(7, 5);
            }
            expect(size(lines)).toEqual({ x: 14, y: 14, z: 14 });
        });

        it('is as tall AND as wide as the capsule', () => {
            // Height alone cannot tell radius from halfHeight: 30 + 50 and 50 + 30
            // stand the same. The width is what separates them.
            const lines = collider3DWireframe({ kind: 'capsule', radius: 30, halfHeight: 50 });
            const s = size(lines);
            expect(s.y).toBeCloseTo(2 * (30 + 50), 3);
            expect(s.x).toBeCloseTo(60, 3);
            expect(s.z).toBeCloseTo(60, 3);
        });

        it('bulges only at the caps of the capsule', () => {
            const lines = collider3DWireframe({ kind: 'capsule', radius: 10, halfHeight: 40 });
            for (const p of lines.flat()) {
                const lateral = Math.hypot(p.x, p.z);
                if (Math.abs(p.y) <= 40) expect(lateral).toBeLessThanOrEqual(10.001);
                else {
                    const overshoot = Math.abs(p.y) - 40;
                    expect(lateral ** 2 + overshoot ** 2).toBeLessThanOrEqual(10 ** 2 + 1e-3);
                }
            }
        });

        it('takes the mesh collider from the triangles that will be collided against', () => {
            registerMeshCollision(99, {
                positions: new Float32Array([-4, 0, -2, 6, 8, -2, 6, 0, 10]),
                indices: new Uint32Array([0, 1, 2]),
            });
            const e = spawn();
            world.insert(e, MeshCollider3D, { mesh: 99 });

            const shape = read(e)[0]!.shape;
            expect(shape.kind).toBe('box');
            if (shape.kind !== 'box') throw new Error('unreachable');
            expect(shape.center).toEqual({ x: 1, y: 4, z: 4 });
            expect(shape.halfExtents).toEqual({ x: 5, y: 4, z: 6 });
            releaseMeshCollision(99);
        });

        it('draws nothing for a mesh whose triangles never loaded', () => {
            const e = spawn();
            world.insert(e, MeshCollider3D, { mesh: 12345 });
            expect(read(e)).toHaveLength(0);
        });
    });

    describe('placing it in the world', () => {
        it('turns the box with the entity', () => {
            const shape: Collider3DShape = {
                kind: 'box', halfExtents: { x: 10, y: 20, z: 30 }, center: { x: 0, y: 0, z: 0 },
            };
            const half = Math.PI / 4; // 90° about Y
            const turned = placeCollider3DWireframe(
                collider3DWireframe(shape),
                { x: 0, y: 0, z: 0 },
                { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) },
            );
            const s = size(turned);
            expect(s.x).toBeCloseTo(60, 3);   // the 30-deep half is now the wide one
            expect(s.y).toBeCloseTo(40, 3);
            expect(s.z).toBeCloseTo(20, 3);
        });

        it('lands the shape on the entity', () => {
            const placed = placeCollider3DWireframe(
                collider3DWireframe({ kind: 'sphere', radius: 5 }),
                { x: 100, y: -50, z: 20 },
                { x: 0, y: 0, z: 0, w: 1 },
            );
            const b = bounds(placed);
            expect(b.min).toEqual({ x: 95, y: -55, z: 15 });
            expect(b.max).toEqual({ x: 105, y: -45, z: 25 });
        });
    });
});
