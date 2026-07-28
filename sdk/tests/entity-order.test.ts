// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '../src/ecs/world';
import { defineComponent, defineBuiltin } from '../src/ecs/component';
import { rankByOrder, reorderMapByRank, reorderSetByRank, UNRANKED } from '../src/ecs/entityOrder';
import type { Entity } from '../src/types';
import { createMockModule } from './mocks/wasm';

describe('World.applyEntityOrder', () => {
    // Iteration order is painter order, so these assertions are draw-order assertions.
    const Script = defineComponent('OrderScript', { v: 0 });
    const Builtin = defineBuiltin('OrderBuiltin', { v: 0 });

    let world: World;

    beforeEach(() => {
        world = new World();
        const mod = createMockModule();
        world.connectCpp(mod.getRegistry(), mod);
    });

    const spawnThree = (): [Entity, Entity, Entity] => {
        const a = world.spawn('a');
        const b = world.spawn('b');
        const c = world.spawn('c');
        for (const e of [a, b, c]) {
            world.insert(e, Script, { v: e });
            world.insert(e, Builtin, { v: e });
        }
        return [a, b, c];
    };

    it('reorders script-component query iteration', () => {
        const [a, b, c] = spawnThree();
        expect(world.getEntitiesWithComponents([Script])).toEqual([a, b, c]);

        world.applyEntityOrder([c, a, b]);

        expect(world.getEntitiesWithComponents([Script])).toEqual([c, a, b]);
    });

    it('reorders builtin-component query iteration', () => {
        const [a, b, c] = spawnThree();
        world.applyEntityOrder([b, c, a]);
        expect(world.getEntitiesWithComponents([Builtin])).toEqual([b, c, a]);
    });

    it('reorders the world entity list itself', () => {
        const [a, b, c] = spawnThree();
        world.applyEntityOrder([c, b, a]);
        expect(world.getAllEntities()).toEqual([c, b, a]);
    });

    it('leaves unlisted entities after the listed ones, in their existing order', () => {
        const [a, b, c] = spawnThree();
        const d = world.spawn('d');
        world.insert(d, Script, { v: d });

        world.applyEntityOrder([d, b]);

        expect(world.getEntitiesWithComponents([Script])).toEqual([d, b, a, c]);
    });

    it('recomputes a query cached before the reorder', () => {
        const [a, b, c] = spawnThree();
        expect(world.getEntitiesWithComponents([Script])).toEqual([a, b, c]);  // seeds the cache
        world.applyEntityOrder([c, b, a]);
        expect(world.getEntitiesWithComponents([Script])).toEqual([c, b, a]);
    });

    it('keeps component values with their entity', () => {
        const [a, , c] = spawnThree();
        world.applyEntityOrder([c, a]);
        expect(world.get(a, Script).v).toBe(a);
        expect(world.get(c, Script).v).toBe(c);
        expect(world.has(a, Builtin)).toBe(true);
    });

    it('is a no-op for an empty order', () => {
        const [a, b, c] = spawnThree();
        world.applyEntityOrder([]);
        expect(world.getEntitiesWithComponents([Script])).toEqual([a, b, c]);
    });

    it('marshals the order to the engine core', () => {
        const mod = createMockModule() as unknown as Record<string, unknown>;
        const heap = new Uint32Array(64);
        const calls: Array<{ count: number; ids: number[] }> = [];
        mod._malloc = () => 16;
        mod._free = () => {};
        mod.HEAPU32 = heap;
        mod.renderer_setEntityDrawOrder = (_reg: unknown, ptr: number, count: number) => {
            calls.push({ count, ids: Array.from(heap.subarray(ptr >> 2, (ptr >> 2) + count)) });
        };
        const w = new World();
        w.connectCpp((mod.getRegistry as () => never)(), mod as never);
        const a = w.spawn();
        const b = w.spawn();

        w.applyEntityOrder([b, a]);

        expect(calls).toEqual([{ count: 2, ids: [b, a] }]);
    });

    it('is ignored during query iteration', () => {
        const [a, b, c] = spawnThree();
        world.beginIteration();
        world.applyEntityOrder([c, b, a]);
        world.endIteration();
        expect(world.getEntitiesWithComponents([Script])).toEqual([a, b, c]);
    });
});

describe('entityOrder helpers', () => {
    const e = (n: number): Entity => n as Entity;

    it('ranks by position, first occurrence wins', () => {
        const rankOf = rankByOrder([e(7), e(3), e(7)]);
        expect(rankOf(e(7))).toBe(0);
        expect(rankOf(e(3))).toBe(1);
        expect(rankOf(e(9))).toBe(UNRANKED);
    });

    it('reorders a map stably, unranked keys last', () => {
        const map = new Map<Entity, string>([[e(1), 'a'], [e(2), 'b'], [e(3), 'c'], [e(4), 'd']]);
        reorderMapByRank(map, rankByOrder([e(3)]));
        expect([...map.keys()]).toEqual([e(3), e(1), e(2), e(4)]);
        expect(map.get(e(3))).toBe('c');
    });

    it('reorders a set stably, unranked entities last', () => {
        const set = new Set<Entity>([e(1), e(2), e(3)]);
        reorderSetByRank(set, rankByOrder([e(2)]));
        expect([...set]).toEqual([e(2), e(1), e(3)]);
    });
});
