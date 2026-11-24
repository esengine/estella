// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { SpringBone, Transform } from '../src/ecs/component';
import { SpringBoneRes, springBonePlugin } from '../src/springbone';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('spring-bone previews sharing an engine', () => {
    let engine: ESEngineModule;
    const apps: App[] = [];
    beforeAll(async () => { engine = await loadWasmModule(); });
    afterEach(() => { for (const app of apps.splice(0)) app.quit({ keepRenderer: true }); });

    function rig(x: number, bones: number) {
        const app = App.new();
        apps.push(app);
        const registry = new engine.Registry();
        app.connectCpp(registry, engine, { ownedRegistry: true });
        app.addPlugin(springBonePlugin);
        const world = app.world;
        const root = world.spawn();
        world.insert(root, Transform, { position: { x, y: 0, z: 0 } });
        world.insert(root, SpringBone, { endLength: 1, gravity: { x: 0, y: 0, z: 0 } });
        let parent = root;
        for (let i = 1; i < bones; ++i) {
            const child = world.spawn();
            world.insert(child, Transform, { position: { x: 0, y: -1, z: 0 } });
            world.setParent(child, parent);
            parent = child;
        }
        return { app, registry, root, api: app.getResource(SpringBoneRes) };
    }

    it.each([0, 1])('reset, release and retiring world %i preserve the other character', closed => {
        const characters = [rig(-3, 2), rig(7, 3)];
        const [left, right] = characters;
        expect(left.root).toBe(right.root);
        left.api.update(1 / 60);
        expect(right.api.snapshot(right.root)).toEqual([]);
        right.api.update(1 / 60);
        const poses = characters.map(c => c.api.snapshot(c.root));
        expect(poses.map(p => p.length)).toEqual([3, 4]);
        expect(poses.map(p => p[0].position[0])).toEqual([-3, 7]);
        const retiring = characters[closed], peer = characters[1 - closed];
        retiring.api.reset(retiring.root);
        retiring.api.update(1 / 60);
        retiring.api.release(retiring.root);
        expect(retiring.api.snapshot(retiring.root)).toEqual([]);
        expect(peer.api.snapshot(peer.root)).toEqual(poses[1 - closed]);
        retiring.app.quit({ keepRenderer: true });
        const next = rig(12, 2);
        expect(next.root).toBe(retiring.root);
        expect(next.api.snapshot(next.root)).toEqual([]);
        peer.api.update(1 / 60);
        expect(peer.api.snapshot(peer.root)).toEqual(poses[1 - closed]);
    });

    it('holds interleaved readbacks per registry and serves the last snapshot to legacy callers', () => {
        const a = rig(-3, 2), b = rig(7, 3);
        for (const c of [a, b]) c.api.update(1 / 60);
        expect(engine.springbone_snapshot!(a.registry, a.root)).toBe(3);
        expect(engine.springbone_snapshot!(b.registry, b.root)).toBe(4);
        const heap = engine.HEAPF32!;
        expect(engine.springbone_snapshotCountInWorld!(a.registry)).toBe(3);
        expect(engine.springbone_snapshotCountInWorld!(b.registry)).toBe(4);
        expect(heap[engine.springbone_snapshotDataInWorld!(a.registry) / 4]).toBe(-3);
        expect(heap[engine.springbone_snapshotDataInWorld!(b.registry) / 4]).toBe(7);
        expect(engine.springbone_snapshotCount!()).toBe(4);
        expect(engine.springbone_snapshotData!()).toBe(engine.springbone_snapshotDataInWorld!(b.registry));
        b.app.quit({ keepRenderer: true });
        expect(engine.springbone_snapshotCount!()).toBe(0);
        expect(engine.springbone_snapshotData!()).toBe(0);
        expect(engine.springbone_snapshotCountInWorld!(a.registry)).toBe(3);
    });
});
