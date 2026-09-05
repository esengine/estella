// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What `Changed` promises a candidate consumer, beyond what a query needs.
 *
 * Replication discovers dirty state by asking the tracker which entity/component
 * pairs are worth re-inspecting. That only covers a component ARRIVING because
 * every add path records a change as well as an add — `Changed` is not merely
 * the `Changed()` filter's input, it is the candidate contract. Anyone tempted
 * to drop the `recordChanged` on the add path ("it already recorded an add")
 * should fail here.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { App } from '../src/app/app';
import { World } from '../src/ecs/world';
import { defineComponent, Transform } from '../src/ecs/component';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';

const Scr = defineComponent('CandScript', { v: 0, w: 0 });

/** A tracked world one tick past its seed, and the floor a sampler would use. */
function tracked(component: Parameters<World['insert']>[1]) {
    const world = new World();
    world.enableChangeTracking(component);
    world.advanceTick();
    return { world, floor: world.getWorldTick() - 1 };
}

describe('a component ARRIVING is a Changed candidate', () => {
    it('through insert', () => {
        const { world, floor } = tracked(Scr);
        const e = world.spawn();
        expect(world.has(e, Scr)).toBe(false);

        world.insert(e, Scr, { v: 1, w: 1 });

        expect(world.anyChangedSince(Scr, floor)).toBe(true);
        expect(world.isChangedSince(e, Scr, floor)).toBe(true);
    });

    it('through set on an entity that lacks it', () => {
        const { world, floor } = tracked(Scr);
        const e = world.spawn();

        world.set(e, Scr, { v: 2, w: 2 });

        expect(world.anyChangedSince(Scr, floor)).toBe(true);
        expect(world.isChangedSince(e, Scr, floor)).toBe(true);
    });

    it('and an entity that did NOT gain it is not a candidate', () => {
        const { world, floor } = tracked(Scr);
        const gained = world.spawn();
        const bystander = world.spawn();
        world.insert(gained, Scr, { v: 1, w: 1 });

        expect(world.isChangedSince(bystander, Scr, floor)).toBe(false);
    });
});

describe.skipIf(!HAS_WASM)('a builtin component arriving is a Changed candidate', () => {
    let module: ESEngineModule;
    beforeAll(async () => { module = await loadWasmModule(); });

    it('through insert', () => {
        const app = App.new();
        app.connectCpp(new module.Registry() as unknown as CppRegistry, module);
        const world = app.world;
        world.enableChangeTracking(Transform);
        world.advanceTick();
        const floor = world.getWorldTick() - 1;

        const e = world.spawn();
        world.insert(e, Transform, { position: { x: 5, y: 0, z: 0 } });

        expect(world.anyChangedSince(Transform, floor)).toBe(true);
        expect(world.isChangedSince(e, Transform, floor)).toBe(true);
        world.disconnectCpp();
    });
});
