// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The 3D world drives Transform, in the units a scene is authored in.
 *
 * check-physics3d proves the solver; this proves the wiring around it, which is
 * where the units live. A scene is authored in world units and the solver works
 * in metres, so a body that arrives unscaled is a character 180 metres tall
 * falling through a floor 0.1m thick — every number still "works", and nothing
 * behaves.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Transform } from '../src/ecs/component';
import type { TransformData } from '../src/ecs/component.generated';
import {
    RigidBody3D, BoxCollider3D, SphereCollider3D, CapsuleCollider3D, CharacterController3D,
    MeshCollider3D,
} from '../src/physics3d/Physics3DComponents';
import {
    registerMeshCollision, releaseMeshCollision, extractPositions,
} from '../src/asset/meshCollision';
import { stepPhysics3D, DEFAULT_PHYSICS3D_CONFIG } from '../src/physics3d/Physics3DSystem';
import type { Physics3DWasmModule } from '../src/physics3d/Physics3DModule';
import type { App } from '../src/app/app';
import type { Entity } from '../src/types';
import { sceneUses3DPhysics, sceneUsesPhysics } from '../src/runtime/runtimeLoader';
import { Physics3DQueries } from '../src/physics3d/Physics3DQueries';

/** A module that records what it was told, and can be made to answer a readback.
 *  The two readbacks are separate buffers, as they are in the module: sharing one
 *  let the body sweep overwrite what a character had just published. */
function fakeModule(): Physics3DWasmModule & {
    calls: { name: string; args: number[] }[];
    publish(records: number[]): void;
    publishQuery(records: number[]): void;
} {
    const calls: { name: string; args: number[] }[] = [];
    // One heap the module's two pointers index into, as wasm has.
    const combined = new Float32Array(4096);
    const heap = combined.subarray(0, 1024);
    const record = (name: string) => (...args: number[]): number => {
        calls.push({ name, args });
        return calls.length;  // a non-zero body id
    };
    const query = combined.subarray(1024);
    const eventArea = combined.subarray(2048);
    let published = 0;
    let publishedQuery = 0;
    let publishedEvents = 0;
    let scratchTop = 4096;
    return {
        calls,
        publish(records: number[]) {
            heap.set(records, 0);
            published = records.length * 4;
        },
        publishQuery(records: number[]) {
            query.set(records, 0);
            publishedQuery = records.length * 4;
        },
        publishContacts(records: number[]) {
            eventArea.set(records, 0);
            publishedEvents = records.length * 4;
        },
        HEAPF32: combined,
        HEAPU32: new Uint32Array(combined.buffer),
        _physics3d_init: record('init'),
        _physics3d_shutdown: record('shutdown'),
        _physics3d_isReady: () => 1,
        _physics3d_step: record('step'),
        _physics3d_optimize: record('optimize'),
        _physics3d_addBox: record('addBox'),
        _physics3d_addSphere: record('addSphere'),
        _physics3d_addCapsule: record('addCapsule'),
        _physics3d_removeBody: record('removeBody'),
        _physics3d_setTransform: record('setTransform'),
        _physics3d_setLinearVelocity: record('setLinearVelocity'),
        _physics3d_getBodyState: record('getBodyState'),
        _physics3d_raycast: record('raycast'),
        _physics3d_addCharacter: record('addCharacter'),
        _physics3d_removeCharacter: record('removeCharacter'),
        _physics3d_moveCharacter: record('moveCharacter'),
        _physics3d_setCharacterPosition: record('setCharacterPosition'),
        _physics3d_addMeshBody: record('addMeshBody'),
        _physics3d_setLayerMask: record('setLayerMask'),
        // Distinct allocations, as a real heap gives: one address for everything
        // let the index write land on top of the vertex write.
        _malloc: (bytes: number) => { const at = scratchTop; scratchTop += bytes; return at; },
        _free: () => {},
        _physics3d_contactEnters: () => 2048 * 4,
        _physics3d_contactEntersBytes: () => publishedEvents,
        _physics3d_contactExits: () => 0,
        _physics3d_contactExitsBytes: () => 0,
        _physics3d_sensorEnters: () => 0,
        _physics3d_sensorEntersBytes: () => 0,
        _physics3d_sensorExits: () => 0,
        _physics3d_sensorExitsBytes: () => 0,
        _physics3d_transforms: () => 0,
        _physics3d_transformsBytes: () => published,
        // A byte offset past the transform buffer, so the two never alias.
        _physics3d_queryResult: () => 1024 * 4,
        _physics3d_queryResultBytes: () => publishedQuery,
    } as unknown as Physics3DWasmModule & {
        calls: { name: string; args: number[] }[];
        publish(records: number[]): void;
        publishQuery(records: number[]): void;
        publishContacts(records: number[]): void;
    };
}

/** The slice of a World that stepPhysics3D touches. Real components, plain
 *  storage: what is under test is the sync, and a World needs a C++ registry. */
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
        remove(e: Entity, def: unknown): void { store.get(e)?.delete(def); },
        get(e: Entity, def: unknown): unknown { return store.get(e)?.get(def); },
        set(e: Entity, def: unknown, value: unknown): void {
            store.get(e)?.set(def, value as Record<string, unknown>);
        },
        has(e: Entity, def: unknown): boolean { return store.get(e)?.has(def) ?? false; },
        valid(e: Entity): boolean { return store.has(e); },
        queryEntities(defs: unknown[]): Entity[] {
            return [...store.entries()]
                .filter(([, comps]) => defs.every((d) => comps.has(d)))
                .map(([e]) => e);
        },
    };
}

describe('the 3D world and the ECS', () => {
    let world: ReturnType<typeof fakeWorld>;
    let app: App;
    let module: ReturnType<typeof fakeModule>;
    let bodies: Map<Entity, number>;

    beforeEach(() => {
        world = fakeWorld();
        app = { world } as unknown as App;
        module = fakeModule();
        bodies = new Map();
    });

    const spawn = (position = { x: 0, y: 0, z: 0 }): Entity => {
        const e = world.spawn();
        world.insert<TransformData>(e, Transform, {
            position: { ...position },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
            worldPosition: { ...position },
            worldRotation: { x: 0, y: 0, z: 0, w: 1 },
            worldScale: { x: 1, y: 1, z: 1 },
        });
        world.insert(e, RigidBody3D);
        return e;
    };

    const called = (name: string) => module.calls.filter((c) => c.name === name);

    it('registers a body for each shape a scene authors', () => {
        const box = spawn();
        world.insert(box, BoxCollider3D);
        const ball = spawn();
        world.insert(ball, SphereCollider3D);
        const character = spawn();
        world.insert(character, CapsuleCollider3D);

        stepPhysics3D(app, module, bodies, DEFAULT_PHYSICS3D_CONFIG);

        expect(called('addBox')).toHaveLength(1);
        expect(called('addSphere')).toHaveLength(1);
        expect(called('addCapsule')).toHaveLength(1);
        expect(bodies.size).toBe(3);
    });

    it('registers nothing for a body with no shape', () => {
        spawn();
        stepPhysics3D(app, module, bodies, DEFAULT_PHYSICS3D_CONFIG);
        // An extent-less body is a point that falls forever — and, worse, one the
        // readback would then try to write back to a Transform.
        expect(bodies.size).toBe(0);
        expect(called('step')).toHaveLength(1);
    });

    it('sends the solver metres, not world units', () => {
        const e = spawn({ x: 300, y: 150, z: 0 });
        world.insert(e, SphereCollider3D);
        (world.get(e, SphereCollider3D) as { radius: number }).radius = 50;

        stepPhysics3D(app, module, bodies, DEFAULT_PHYSICS3D_CONFIG);

        // 100 world units to the metre: a 50-unit ball is half a metre across and
        // stands 1.5m from the origin.
        const [call] = called('addSphere');
        expect(call!.args[1]).toBeCloseTo(0.5, 6);
        expect(call!.args[2]).toBeCloseTo(3, 6);
        expect(call!.args[3]).toBeCloseTo(1.5, 6);
    });

    it('writes the solver’s answer back in world units', () => {
        const e = spawn();
        world.insert(e, BoxCollider3D);
        stepPhysics3D(app, module, bodies, DEFAULT_PHYSICS3D_CONFIG);

        // (entity, position, rotation) — a body at 2m up and a quarter turn about Y.
        const s = Math.SQRT1_2;
        module.publish([e as number, 0, 2, 0, 0, s, 0, s]);
        stepPhysics3D(app, module, bodies, DEFAULT_PHYSICS3D_CONFIG);

        const t = world.get(e, Transform) as TransformData;
        expect(t.position.y).toBeCloseTo(200, 4);
        expect(t.rotation.y).toBeCloseTo(s, 6);
        expect(t.rotation.w).toBeCloseTo(s, 6);
    });

    it('gives a body back when its component goes', () => {
        const e = spawn();
        world.insert(e, BoxCollider3D);
        stepPhysics3D(app, module, bodies, DEFAULT_PHYSICS3D_CONFIG);
        expect(bodies.size).toBe(1);

        world.remove(e, RigidBody3D);
        stepPhysics3D(app, module, bodies, DEFAULT_PHYSICS3D_CONFIG);
        expect(called('removeBody')).toHaveLength(1);
        expect(bodies.size).toBe(0);
    });

    it('sweeps a character in metres and reads its ground state back', () => {
        const e = world.spawn();
        world.insert<TransformData>(e, Transform, {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
            worldPosition: { x: 0, y: 500, z: 0 },
            worldRotation: { x: 0, y: 0, z: 0, w: 1 },
            worldScale: { x: 1, y: 1, z: 1 },
        });
        world.insert(e, CharacterController3D, {
            radius: 30, halfHeight: 50, velocity: { x: 200, y: 0, z: 0 },
        });

        const characters = new Map<Entity, number>();
        stepPhysics3D(app, module, bodies, DEFAULT_PHYSICS3D_CONFIG, characters);

        const [added] = called('addCharacter');
        expect(added!.args[1]).toBeCloseTo(0.3, 6);   // 30 world units = 0.3m
        expect(added!.args[2]).toBeCloseTo(0.5, 6);
        expect(added!.args[4]).toBeCloseTo(5, 6);     // standing 5m up
        const [moved] = called('moveCharacter');
        expect(moved!.args[1]).toBeCloseTo(2, 6);     // 200 units/s = 2 m/s
        expect(characters.size).toBe(1);

        // Ground state 0 is OnGround; the normal and velocity come back beside it.
        module.publishQuery([1, 2, 3, 0, 0, 1, 0, 2, 0, 0]);
        stepPhysics3D(app, module, bodies, DEFAULT_PHYSICS3D_CONFIG, characters);
        const state = world.get(e, CharacterController3D) as {
            isOnFloor: boolean; floorNormal: { y: number }; realVelocity: { x: number };
        };
        expect(state.isOnFloor).toBe(true);
        expect(state.floorNormal.y).toBeCloseTo(1, 6);
        expect(state.realVelocity.x).toBeCloseTo(200, 4);
        expect((world.get(e, Transform) as TransformData).position.y).toBeCloseTo(200, 4);
    });

    it('hands this step\u2019s contacts to the events resource', () => {
        const e = spawn();
        world.insert(e, BoxCollider3D);
        const events = {
            contactEnters: [], contactExits: [], sensorEnters: [], sensorExits: [],
        };
        // (entityA, entityB, normal, point) — two bodies met head-on at 1m up.
        module.publishContacts([7, 9, 0, 1, 0, 0, 1, 0]);
        stepPhysics3D(app, module, bodies, DEFAULT_PHYSICS3D_CONFIG, new Map(), events);

        expect(events.contactEnters).toHaveLength(1);
        const [hit] = events.contactEnters as Array<Record<string, number>>;
        expect(hit!.entityA).toBe(7);
        expect(hit!.entityB).toBe(9);
        expect(hit!.normalY).toBeCloseTo(1, 6);
        expect(hit!.pointY).toBeCloseTo(1, 6);
    });

    it('collides against a loaded mesh\u2019s own triangles', () => {
        // Two triangles a metre across, as the loader would have kept them.
        registerMeshCollision(77, {
            positions: new Float32Array([0, 0, 0, 100, 0, 0, 0, 0, 100, 100, 0, 100]),
            indices: new Uint32Array([0, 2, 1, 2, 3, 1]),
        });
        const e = spawn();
        world.insert(e, MeshCollider3D, { mesh: 77 });

        stepPhysics3D(app, module, bodies, DEFAULT_PHYSICS3D_CONFIG);

        const [call] = called('addMeshBody');
        expect(call).toBeDefined();
        expect(call!.args[2]).toBe(4);   // four vertices
        expect(call!.args[4]).toBe(6);   // six indices
        // A 100-unit triangle is a metre in the solver.
        expect(module.HEAPF32[(call!.args[1] >> 2) + 3]).toBeCloseTo(1, 6);
        releaseMeshCollision(77);
    });

    it('registers nothing for a mesh collider whose geometry never loaded', () => {
        const e = spawn();
        world.insert(e, MeshCollider3D, { mesh: 999 });
        stepPhysics3D(app, module, bodies, DEFAULT_PHYSICS3D_CONFIG);
        // Handle 999 named a mesh nothing kept triangles for. Registering a body
        // with no shape would put an invisible point in the world.
        expect(called('addMeshBody')).toHaveLength(0);
        expect(bodies.size).toBe(0);
    });

    it('sends a body\u2019s layer to the world', () => {
        const e = spawn();
        world.insert(e, SphereCollider3D);
        (world.get(e, RigidBody3D) as { layer: number }).layer = 5;

        stepPhysics3D(app, module, bodies, DEFAULT_PHYSICS3D_CONFIG);

        // entity, radius, position(3), rotation(4), motion, gravity, damping(2),
        // fixedRotation, then LAYER — a knob nothing forwards does nothing.
        const [call] = called('addSphere');
        expect(call!.args[14]).toBe(5);
    });

    it('leaves a disabled body out of the world', () => {
        const e = spawn();
        world.insert(e, BoxCollider3D);
        (world.get(e, RigidBody3D) as { enabled: boolean }).enabled = false;

        stepPhysics3D(app, module, bodies, DEFAULT_PHYSICS3D_CONFIG);
        expect(bodies.size).toBe(0);
    });
});

describe('a scene asks for the world it needs', () => {
    const sceneWith = (...types: string[]) => ({
        entities: [{ components: types.map((type) => ({ type, data: {} })) }],
    });

    it('sees every 3D component as wanting the 3D world', () => {
        for (const type of ['RigidBody3D', 'BoxCollider3D', 'SphereCollider3D',
                            'CapsuleCollider3D', 'CharacterController3D']) {
            expect(sceneUses3DPhysics(sceneWith(type) as never)).toBe(true);
        }
    });

    it('does not confuse the two worlds', () => {
        // A 2D scene must not drag in a 1.2MB module it has no use for, and a 3D
        // scene must not be served the solver that cannot move it.
        expect(sceneUses3DPhysics(sceneWith('RigidBody', 'BoxCollider') as never)).toBe(false);
        expect(sceneUsesPhysics(sceneWith('RigidBody3D', 'BoxCollider3D') as never)).toBe(false);
    });
});

describe('mesh collision geometry', () => {
    it('pulls positions out of an interleaved buffer', () => {
        // Two vertices, each 20 bytes: position (12) then a colour (8) it ignores.
        const bytes = new Uint8Array(40);
        const view = new DataView(bytes.buffer);
        view.setFloat32(0, 1, true); view.setFloat32(4, 2, true); view.setFloat32(8, 3, true);
        view.setFloat32(20, 4, true); view.setFloat32(24, 5, true); view.setFloat32(28, 6, true);
        const out = extractPositions(bytes, 2, 20, [
            { semantic: 0, offset: 0, type: 0 }, { semantic: 1, offset: 12, type: 0 },
        ]);
        expect(Array.from(out!)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('answers null for geometry with no positions', () => {
        // Nothing can collide against a mesh that never said where its vertices are.
        expect(extractPositions(new Uint8Array(8), 1, 8, [
            { semantic: 3, offset: 0, type: 0 },
        ])).toBeNull();
    });
});

describe('3D spatial queries', () => {
    /** A module that answers one canned result, so the units can be checked. */
    function queryModule(result: number[], hits = 1) {
        const heap = new Float32Array(64);
        heap.set(result, 0);
        const calls: number[][] = [];
        return {
            calls,
            HEAPF32: heap,
            _physics3d_queryResult: () => 0,
            _physics3d_raycast: (...args: number[]) => { calls.push(args); return hits; },
            _physics3d_sphereCast: (...args: number[]) => { calls.push(args); return hits; },
            _physics3d_overlapSphere: (...args: number[]) => { calls.push(args); return hits; },
            _physics3d_overlapBox: (...args: number[]) => { calls.push(args); return hits; },
        } as unknown as Parameters<typeof Physics3DQueries.prototype.raycast> extends never
            ? never : ConstructorParameters<typeof Physics3DQueries>[0] & { calls: number[][] };
    }

    it('asks in metres and answers in world units', () => {
        // A hit 3m along, at 2m up, with an upward normal.
        const module = queryModule([9, 0.5, 0, 2, 0, 0, 1, 0]);
        const q = new Physics3DQueries(module, 100);
        const hit = q.raycast({ x: 0, y: 500, z: 0 }, { x: 0, y: -600, z: 0 });

        expect(module.calls[0]![1]).toBeCloseTo(5, 6);     // 500 units = 5m
        expect(module.calls[0]![4]).toBeCloseTo(-6, 6);
        expect(hit!.y).toBeCloseTo(200, 4);                // 2m = 200 units
        // A normal is a direction: scaling it would leave a unit vector 100 long.
        expect(hit!.normalY).toBeCloseTo(1, 6);
        expect(hit!.entity).toBe(9);
    });

    it('scales a swept sphere’s radius too', () => {
        const module = queryModule([1, 0.25, 0, 0, 0, 0, 1, 0]);
        const q = new Physics3DQueries(module, 100);
        q.sphereCast({ x: 0, y: 0, z: 0 }, 30, { x: 400, y: 0, z: 0 });
        expect(module.calls[0]![3]).toBeCloseTo(0.3, 6);
        expect(module.calls[0]![4]).toBeCloseTo(4, 6);
    });

    it('reads every overlap the world reported', () => {
        const module = queryModule([7, 1, 2, 3, 8, 4, 5, 6], 2);
        const q = new Physics3DQueries(module, 100);
        const hits = q.overlapSphere({ x: 0, y: 0, z: 0 }, 50);
        expect(hits).toHaveLength(2);
        expect(hits[0]!.entity).toBe(7);
        expect(hits[1]!.entity).toBe(8);
        expect(hits[1]!.x).toBeCloseTo(400, 4);
    });

    it('answers an empty list rather than a phantom hit', () => {
        const module = queryModule([7, 1, 2, 3], 0);
        const q = new Physics3DQueries(module, 100);
        expect(q.overlapBox({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 })).toEqual([]);
    });
});
