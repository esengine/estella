// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { defineComponent, Sprite, Transform } from '../src/ecs/component';
import { Changed, Mut, Query, QueryInstance, Removed } from '../src/ecs/query';
import { ResourceStorage } from '../src/ecs/resource';
import { defineSystem, SystemRunner } from '../src/ecs/system';
import { World } from '../src/ecs/world';
import type { Entity } from '../src/types';
import { log } from '../src/util/logger';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';
import { createMockModule } from './mocks/wasm';

function gate() {
    let open!: () => void;
    const wait = new Promise<void>(resolve => { open = resolve; });
    return { open, wait };
}

function spawnAt(world: World, x: number) {
    const entity = world.spawn();
    world.insert(entity, Transform, { position: { x, y: 0, z: 0 } });
    return entity;
}

describe.skipIf(!HAS_WASM)('queries across invocations and entity populations', () => {
    let engine: ESEngineModule;
    beforeAll(async () => { engine = await loadWasmModule(); });

    it.each(['borrowed', 'owned'])('drops rows kept across a %s registry restart', async ownership => {
        const app = App.new(), world = app.world, old = new engine.Registry(), next = new engine.Registry();
        const owned = ownership === 'owned', entered = gate(), resume = gate();
        const errors = vi.spyOn(log, 'error');
        app.connectCpp(old, engine, { ownedRegistry: owned });
        const source = spawnAt(world, 12);
        let matches = -1;
        app.addSystem(defineSystem([Query(Mut(Transform))], async query => {
            const [, transform] = query.single()!;
            entered.open(); await resume.wait;
            transform.position.x = 777;
            matches = query.count();
        }));
        const tick = app.tick(1 / 60);
        try {
            await entered.wait;
            if (owned) app.quit({ keepRenderer: true });
            app.connectCpp(next, engine);
            const fresh = spawnAt(world, 99);
            resume.open(); await tick;
            expect(fresh).toBe(source);
            expect(matches).toBe(0);
            expect(next.getTransform(fresh).position.x).toBe(99);
            if (!owned) expect(old.getTransform(source).position.x).toBe(12);
            expect(errors).not.toHaveBeenCalled();
        } finally {
            resume.open(); await tick; errors.mockRestore();
            app.quit({ keepRenderer: true });
            if (!owned) old.delete();
            next.delete();
        }
    });

    it.each(['iterator', 'forEach'])('retires an open %s inside its callback, including its iteration guard', entry => {
        const world = new World(), old = new engine.Registry(), next = new engine.Registry();
        world.connectCpp(old, engine);
        try {
            const a = spawnAt(world, 11), b = spawnAt(world, 22), visited: Entity[] = [];
            const descriptor = Query(Mut(Transform)), query = new QueryInstance(world, descriptor);
            let finishFresh: (() => void) | undefined;
            function visit(e: Entity, row: { position: { x: number } }) {
                visited.push(e); row.position.x = 77;
                if (visited.length > 1) return;
                world.connectCpp(next, engine);
                expect(spawnAt(world, 31)).toBe(a);
                expect(spawnAt(world, 32)).toBe(b);
                const current = new QueryInstance(world, Query(Transform))[Symbol.iterator]();
                current.next(); finishFresh = () => { current.return?.(); };
            }
            if (entry === 'iterator') { for (const [e, row] of query) visit(e, row); }
            else query.forEach(visit);
            query.settleKeptRows();
            expect(visited).toEqual([a]);
            expect(world.isIterating()).toBe(true);
            finishFresh!();
            expect(world.isIterating()).toBe(false);
            expect([old.getTransform(a).position.x, next.getTransform(a).position.x]).toEqual([11, 31]);
            expect(query.toArray()).toEqual([]);
            expect(query.single()).toBeNull();
            expect(query.isEmpty()).toBe(true);
        } finally { world.disconnectCpp(); old.delete(); next.delete(); }
    });

    it('rebuilds cached getters, setters and change filters for the next run on a replacement registry', () => {
        const world = new World(), old = new engine.Registry(), next = new engine.Registry();
        const runner = new SystemRunner(world, new ResourceStorage()), seen: number[] = [];
        const system = defineSystem([Query(Mut(Transform), Changed(Transform))], q => {
            q.forEach((_e, transform) => { seen.push(transform.position.x); transform.position.x++; });
        });
        world.connectCpp(old, engine);
        try {
            world.enableChangeTracking(Transform);
            const entity = spawnAt(world, 12); runner.run(system);
            world.connectCpp(next, engine); expect(spawnAt(world, 99)).toBe(entity);
            runner.run(system);
            expect(seen).toEqual([12, 99]);
            expect([old.getTransform(entity).position.x, next.getTransform(entity).position.x]).toEqual([13, 100]);
        } finally { world.disconnectCpp(); old.delete(); next.delete(); }
    });

    it('ends a pending iterator on an in-place registry reset and preserves a fresh walk', () => {
        const world = new World(), module = createMockModule(), reg = module.getRegistry();
        let epoch = 0;
        module.registry_entityChangeResetEpoch = () => epoch;
        world.connectCpp(reg, module);
        try {
            const source = spawnAt(world, 1);
            const stale = new QueryInstance(world, Query(Mut(Transform))), iterator = stale[Symbol.iterator]();
            iterator.next().value![1].position.x = 77;
            Object.assign(reg, createMockModule().getRegistry()); epoch++;
            expect(spawnAt(world, 99)).toBe(source);
            const fresh = new QueryInstance(world, Query(Transform))[Symbol.iterator]();
            fresh.next();
            expect(iterator.next().done).toBe(true);
            iterator.return?.(); stale.settleKeptRows();
            expect(world.isIterating()).toBe(true);
            fresh.return?.();
            expect(world.get(source, Transform).position.x).toBe(99);
        } finally { world.disconnectCpp(); }
    });

    it('keeps mutable rows separate for two simultaneous runs of the same system', async () => {
        const world = new World(), reg = new engine.Registry(), runner = new SystemRunner(world, new ResourceStorage());
        const gates = [gate(), gate()]; let calls = 0;
        world.connectCpp(reg, engine);
        try {
            const entity = spawnAt(world, 1);
            const system = defineSystem([Query(Mut(Transform))], async q => {
                const n = calls++, [, row] = q.single()!;
                row.position.x = 20 + n;
                await gates[n]!.wait;
                row.position.x = 30 + n;
            });
            const first = runner.run(system), second = runner.run(system);
            gates[0]!.open(); await first;
            expect(reg.getTransform(entity).position.x).toBe(30);
            gates[1]!.open(); await second;
            expect(reg.getTransform(entity).position.x).toBe(31);
        } finally { for (const g of gates) g.open(); world.disconnectCpp(); reg.delete(); }
    });

    it('leaves another walk guarded when a parked iterator closes and when a nested system finishes', async () => {
        const world = new World(), reg = new engine.Registry(), runner = new SystemRunner(world, new ResourceStorage());
        const resume = gate();
        world.connectCpp(reg, engine);
        try {
            spawnAt(world, 1);
            const parked = runner.run(defineSystem([Query(Transform)], async query => {
                for (const _ of query) { await resume.wait; break; }
            }));
            expect(world.isIterating()).toBe(false);
            const external = new QueryInstance(world, Query(Transform))[Symbol.iterator]();
            external.next();
            runner.run(defineSystem([Query(Transform)], q => { q.single(); }));
            expect(() => world.spawn()).toThrow(/iteration/);
            resume.open(); await parked;
            expect(() => world.spawn()).toThrow(/iteration/);
            external.return?.();
            expect(world.isIterating()).toBe(false);
        } finally { resume.open(); world.disconnectCpp(); reg.delete(); }
    });

    it('ends multi-component write-back if a sprite asset observer changes the registry', () => {
        const world = new World(), old = new engine.Registry(), next = new engine.Registry();
        world.connectCpp(old, engine);
        try {
            const original = spawnAt(world, 12);
            world.insert(original, Sprite);
            const starts: string[] = [];
            world.setAssetFieldResolver(() => { starts.push('load'); });
            const off = world.onAssetFieldsChanged((_e, component) => {
                if (component !== Sprite) return;
                off();
                world.connectCpp(next, engine);
                expect(spawnAt(world, 99)).toBe(original);
            });
            const query = new QueryInstance(world, Query(Mut(Sprite), Mut(Transform)));
            query.forEach((_entity, sprite, transform) => {
                Object.assign(sprite, { texture: 'old.png' });
                transform.position.x = 777;
            });
            expect(starts).toEqual([]);
            expect([old.getTransform(original).position.x, next.getTransform(original).position.x]).toEqual([12, 99]);
            expect(next.hasSprite(original)).toBe(false);
        } finally { world.disconnectCpp(); old.delete(); next.delete(); }
    });

    it('releases only the failing invocation’s walks and can retry after a setter throws', () => {
        const world = new World(), reg = new engine.Registry(), runner = new SystemRunner(world, new ResourceStorage());
        world.connectCpp(reg, engine);
        try {
            const entity = spawnAt(world, 1);
            const external = new QueryInstance(world, Query(Transform))[Symbol.iterator]();
            external.next();
            const system = defineSystem([Query(Mut(Transform)), Removed(Transform)], query => {
                const row = query[Symbol.iterator]().next().value!;
                row[1].position.x++;
            });
            const mark = vi.spyOn(world, 'markChanged').mockImplementationOnce(() => { throw new Error('failed write'); });
            try {
                expect(() => runner.run(system)).toThrow('failed write');
                expect(world.isIterating()).toBe(true);
                external.return?.();
                expect(world.isIterating()).toBe(false);
                runner.run(system);
                expect(world.isIterating()).toBe(false);
                expect(reg.getTransform(entity).position.x).toBe(3);
                expect(world.removedReaderCount(Transform)).toBe(1);
            } finally { mark.mockRestore(); }
        } finally { runner.reset(); world.disconnectCpp(); reg.delete(); }
    });

    it.each(['iterator', 'forEach'])('keeps the outer mutable row during a nested %s walk', entry => {
        const world = new World(), reg = new engine.Registry();
        world.connectCpp(reg, engine);
        try {
            const a = spawnAt(world, 1), b = spawnAt(world, 2);
            const q = new QueryInstance(world, Query(Mut(Transform)));
            if (entry === 'iterator') {
                for (const [e, row] of q) {
                    if (e !== a) continue;
                    for (const [inner, other] of q) if (inner === b) other.position.x = 32;
                    row.position.x = 31;
                    break;
                }
            } else {
                q.forEach((e, row) => {
                    if (e !== a) return;
                    q.forEach((inner, other) => { if (inner === b) other.position.x = 32; });
                    row.position.x = 31;
                });
            }
            q.settleKeptRows();
            expect([reg.getTransform(a).position.x, reg.getTransform(b).position.x]).toEqual([31, 32]);
        } finally { world.disconnectCpp(); reg.delete(); }
    });

    it('keeps a parked removal reader and its open iterator in their original population', async () => {
        const world = new World(), old = new engine.Registry(), next = new engine.Registry();
        const runner = new SystemRunner(world, new ResourceStorage()), resume = gate();
        const marker = defineComponent('RemovalPopulation', { value: 0 });
        let run = 0, after: Entity[] = [], rest: Entity[] = [];
        const system = defineSystem([Removed(marker)], async removed => {
            if (run++ !== 1) return;
            const iter = removed[Symbol.iterator]();
            iter.next();
            await resume.wait;
            after = removed.toArray();
            for (let step = iter.next(); !step.done; step = iter.next()) rest.push(step.value);
        });
        world.connectCpp(old, engine);
        try {
            await runner.run(system);
            for (let i = 0; i < 2; i++) {
                const e = world.spawn(); world.insert(e, marker); world.remove(e, marker);
            }
            const first = runner.run(system);
            world.connectCpp(next, engine);
            expect(world.removedReaderCount(marker)).toBe(0);
            await runner.run(system);
            const fresh = world.spawn(); world.insert(fresh, marker); world.remove(fresh, marker);
            resume.open(); await first;
            expect(after).toEqual([]); expect(rest).toEqual([]);
            expect(world.removedReaderCount(marker)).toBe(1);
        } finally { resume.open(); runner.reset(); world.disconnectCpp(); old.delete(); next.delete(); }
    });

    it('retains each overlapping removal window until its own run acknowledges it', async () => {
        const world = new World(), runner = new SystemRunner(world, new ResourceStorage()), resume = gate();
        const marker = defineComponent('OverlappingRemovalWindow', { value: 0 });
        const seen: Entity[][] = []; let runs = 0;
        const system = defineSystem([Removed(marker)], async removed => {
            const n = runs++;
            if (n === 1) await resume.wait;
            seen[n] = removed.toArray();
        });
        function remove() {
            const e = world.spawn(); world.insert(e, marker); world.remove(e, marker); return e;
        }
        try {
            await runner.run(system);
            const a = remove(), b = remove();
            const first = runner.run(system);
            await runner.run(system);
            const c = remove();
            await runner.run(system);
            resume.open(); await first;
            await runner.run(system);
            expect(seen).toEqual([[], [a, b, c], [a, b], [c], []]);
            expect(world.removedReaderCount(marker)).toBe(1);
        } finally { resume.open(); runner.reset(); }
        expect(world.removedReaderCount(marker)).toBe(0);
    });
});

it('keeps the epoch through heap growth, reads both words and retires a saturated population', () => {
    const module = createMockModule(), world = new World();
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 3 });
    module.HEAPU32 = new Uint32Array(memory.buffer);
    const word = 8;
    module.registry_entityChangeResetEpochAddress = () => word * Uint32Array.BYTES_PER_ELEMENT;
    const scalar = vi.fn(() => 0);
    module.registry_entityChangeResetEpoch = scalar;
    world.connectCpp(module.getRegistry(), module);
    try {
        const initial = world.entityLifetime;
        memory.grow(1);
        module.HEAPU32 = new Uint32Array(memory.buffer);
        expect(world.entityLifetime).toBe(initial);
        module.HEAPU32[word + 1] = 1;
        const changed = world.entityLifetime;
        expect(changed).not.toBe(initial);
        expect(world.entityLifetime).toBe(changed);
        module.HEAPU32[word] = 0xffffffff;
        module.HEAPU32[word + 1] = 0x1fffff;
        expect(world.entityLifetime).not.toBe(world.entityLifetime);
        expect(scalar).not.toHaveBeenCalled();
    } finally { world.disconnectCpp(); }
});
