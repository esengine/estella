// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  `BoxCollider` against the real engine: a script adds one, sets its size and centre in the node's units, and the engine's box holds
 *        them scaled by the node, with a static body beside it.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ESEngineModule } from '../../src/wasm';
import { World } from '../../src/ecs/world';
import { Transform, ensureBuiltinComponentsRegistered } from '../../src/ecs/component';
import { AppContext, setDefaultContext } from '../../src/ecs/context';
import { BoxCollider3D, RigidBody3D } from '../../src/physics3d/Physics3DComponents';
import { BoxCollider, Node, PhysicsSystem, Vec3, geometry, setCurrentWorld } from '../../src/cocos';
import { HAS_WASM, loadWasmModule } from '../helpers/loadWasm';

describe.skipIf(!HAS_WASM)('BoxCollider on the engine', () => {
    let module: ESEngineModule;
    let registry: InstanceType<ESEngineModule['Registry']> | undefined;
    let world: World | undefined;

    beforeAll(async () => { ensureBuiltinComponentsRegistered(); module = await loadWasmModule(); });
    afterEach(() => {
        setCurrentWorld(null);
        world?.disconnectCpp();
        registry?.delete();
        registry = undefined;
        world = undefined;
    });

    function node(): Node {
        setDefaultContext(new AppContext());
        registry = new module.Registry();
        world = new World();
        world.connectCpp(registry, module);
        setCurrentWorld(world);
        const n = new Node('building');
        world.insert(n._entity, Transform);
        return n;
    }

    it('is made by addComponent with a unit box and a static body', () => {
        const n = node();
        const c = n.addComponent(BoxCollider)!;
        expect(c).toBeInstanceOf(BoxCollider);
        expect(n.getComponent(BoxCollider)).toBe(c);
        expect(world!.get(n._entity, RigidBody3D).bodyType).toBe(0);
        const s = c.size;
        expect([s.x, s.y, s.z]).toEqual([1, 1, 1]);
    });

    it('reads back the size and centre it was given, whatever the node scale', () => {
        const n = node();
        n.setScale(new Vec3(2, 4, 1));
        const c = n.addComponent(BoxCollider)!;
        c.size = new Vec3(1, 1.5, 1);
        c.center = new Vec3(0, 0.75, 0);
        c.isTrigger = true;
        const half = world!.get(n._entity, BoxCollider3D).halfExtents;
        expect([half.x, half.y, half.z]).toEqual([1, 3, 0.5]);
        expect(world!.get(n._entity, BoxCollider3D).center.y).toBe(3);
        expect(world!.get(n._entity, BoxCollider3D).isSensor).toBe(true);
        expect([c.size.x, c.size.y, c.size.z]).toEqual([1, 1.5, 1]);
        expect(c.center.y).toBeCloseTo(0.75, 6);
        expect(c.isTrigger).toBe(true);
    });
});

describe.skipIf(!HAS_WASM)('PhysicsSystem on the engine', () => {
    let module: ESEngineModule;
    let registry: InstanceType<ESEngineModule['Registry']> | undefined;
    let world: World | undefined;
    beforeAll(async () => { ensureBuiltinComponentsRegistered(); module = await loadWasmModule(); });
    afterEach(() => { setCurrentWorld(null); world?.disconnectCpp(); registry?.delete(); registry = undefined; world = undefined; });

    function box(name: string, at: Vec3, size: Vec3, trigger = false): Node {
        const n = new Node(name);
        world!.insert(n._entity, Transform);
        n.setPosition(at);
        const c = n.addComponent(BoxCollider)!;
        c.size = size;
        c.isTrigger = trigger;
        return n;
    }

    it('lists the boxes a ray crosses nearest first and names the face it met', () => {
        setDefaultContext(new AppContext());
        registry = new module.Registry(); world = new World(); world.connectCpp(registry, module); setCurrentWorld(world);
        const far = box('far', new Vec3(0, 0, -10), new Vec3(2, 2, 2));
        const near = box('near', new Vec3(0, 0, -4), new Vec3(2, 2, 2));
        box('aside', new Vec3(8, 0, -4), new Vec3(2, 2, 2));
        const ray = new geometry.Ray(0, 0, 0, 0, 0, -1);
        expect(PhysicsSystem.instance.raycast(ray)).toBe(true);
        const hits = PhysicsSystem.instance.raycastResults;
        expect(hits.map((h) => h.collider.node.name)).toEqual(['near', 'far']);
        expect(hits[0]!.distance).toBeCloseTo(3, 6);
        expect(hits[0]!.hitPoint.z).toBeCloseTo(-3, 6);
        expect(hits[0]!.hitNormal.z).toBeCloseTo(1, 6);
        expect(PhysicsSystem.instance.raycastClosest(ray)).toBe(true);
        expect(PhysicsSystem.instance.raycastClosestResult.collider.node).toBe(near);
        expect(far).toBeTruthy();
    });

    it('skips triggers when asked not to, and boxes behind the origin or past the range', () => {
        setDefaultContext(new AppContext());
        registry = new module.Registry(); world = new World(); world.connectCpp(registry, module); setCurrentWorld(world);
        box('trigger', new Vec3(0, 0, -4), new Vec3(2, 2, 2), true);
        box('behind', new Vec3(0, 0, 6), new Vec3(2, 2, 2));
        const ray = new geometry.Ray(0, 0, 0, 0, 0, -1);
        expect(PhysicsSystem.instance.raycast(ray, 0xffffffff, 100, false)).toBe(false);
        expect(PhysicsSystem.instance.raycast(ray, 0xffffffff, 2, true)).toBe(false);
        expect(PhysicsSystem.instance.raycast(ray, 0xffffffff, 100, true)).toBe(true);
    });
});
