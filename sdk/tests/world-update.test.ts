// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  `world.update` — the contract, including the parts that look wrong.
 *
 * Reporting unconditionally and not rolling back on a throw are deliberate:
 * both trade a cheap false positive for the one failure this path exists to
 * remove, a change nothing observes.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { App } from '../src/app/app';
import { World } from '../src/ecs/world';
import { defineComponent, Name, Transform } from '../src/ecs/component';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';

const Flat = defineComponent('WuFlat', { v: 0, w: 0 });
const Nested = defineComponent('WuNested', { inner: { x: 0 }, tag: 'a' });

/** A world, an entity carrying `component`, and the tick to ask changes since. */
function fixture<T>(component: Parameters<World['insert']>[1], initial: T) {
    const world = new World();
    world.enableChangeTracking(component);
    const entity = world.spawn();
    world.insert(entity, component, initial as never);
    world.advanceTick();
    return { world, entity, since: world.getWorldTick() - 1 };
}

const observed = (f: ReturnType<typeof fixture>, c: Parameters<World['insert']>[1]) =>
    f.world.isChangedSince(f.entity, c, f.since);

describe('world.update', () => {
    it('edits a script component in place and reports it', () => {
        const f = fixture(Flat, { v: 1, w: 1 });
        f.world.update(f.entity, Flat, (d) => { d.v = 5; });
        expect(f.world.get(f.entity, Flat).v).toBe(5);
        expect(observed(f, Flat)).toBe(true);
    });

    it('reaches a nested field', () => {
        const f = fixture(Nested, { inner: { x: 1 }, tag: 'a' });
        f.world.update(f.entity, Nested, (d) => { d.inner.x = 5; });
        expect(f.world.get(f.entity, Nested).inner.x).toBe(5);
        expect(observed(f, Nested)).toBe(true);
    });

    it('reports even when the callback writes nothing', () => {
        const f = fixture(Flat, { v: 1, w: 1 });
        f.world.update(f.entity, Flat, () => { /* reads only */ });
        expect(observed(f, Flat)).toBe(true);
    });

    it('keeps what a throwing callback wrote, and still reports it', () => {
        const f = fixture(Flat, { v: 1, w: 1 });
        expect(() => f.world.update(f.entity, Flat, (d) => {
            d.v = 9;
            throw new Error('boom');
        })).toThrow('boom');
        expect(f.world.get(f.entity, Flat).v).toBe(9);
        expect(observed(f, Flat)).toBe(true);
    });

    it('refuses an entity that does not carry the component', () => {
        const world = new World();
        const entity = world.spawn();
        expect(() => world.update(entity, Flat, () => { /* never runs */ }))
            .toThrow('does not carry it');
    });

    it('keeps the name index in step', () => {
        const world = new World();
        const entity = world.spawn();
        world.insert(entity, Name, { value: 'before' });
        world.update(entity, Name, (d) => { d.value = 'after'; });
        expect(world.findEntityByName('after')).toBe(entity);
        expect(world.findEntityByName('before')).toBe(null);
    });
});

describe.skipIf(!HAS_WASM)('world.update on engine-backed components', () => {
    let module: ESEngineModule;
    beforeAll(async () => { module = await loadWasmModule(); });

    it('stores a projection edit and reports it', () => {
        const app = App.new();
        app.connectCpp(new module.Registry() as unknown as CppRegistry, module);
        const world = app.world;
        world.enableChangeTracking(Transform);
        const entity = world.spawn();
        world.insert(entity, Transform, { position: { x: 1, y: 0, z: 0 } });
        world.advanceTick();
        const since = world.getWorldTick() - 1;

        world.update(entity, Transform, (d) => { d.position.x = 42; });

        expect(world.get(entity, Transform).position.x).toBe(42);
        expect(world.isChangedSince(entity, Transform, since)).toBe(true);
        world.disconnectCpp();
    });
});
