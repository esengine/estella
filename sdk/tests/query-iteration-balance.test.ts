// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    query-iteration-balance.test.ts
 * @brief   beginIteration/endIteration must balance however iteration ends.
 *
 *          While the world is iterating it REFUSES spawn/despawn/remove — the
 *          whole point, since those would resize the arrays being walked. So a
 *          leaked depth does not fail where it happened: forEach's callback
 *          throws, the count is never decremented, and the error surfaces later
 *          as "Cannot spawn entity during query iteration" somewhere entirely
 *          unrelated. SystemRunner resets the depth at each system boundary,
 *          which narrows the blast radius to the rest of that system and does
 *          nothing at all for a forEach called outside one.
 */
import { describe, it, expect } from 'vitest';
import { World } from '../src/ecs/world';
import { Query, QueryInstance, Mut } from '../src/ecs/query';
import { defineComponent } from '../src/ecs/component';

const P = defineComponent('IBPosition', { x: 0 });

function worldWithEntities(n: number): World {
    const world = new World();
    for (let i = 0; i < n; i++) {
        const e = world.spawn();
        world.insert(e, P, { x: i });
    }
    return world;
}

describe('iteration depth balances however iteration ends', () => {
    it('forEach: callback throws', () => {
        const world = worldWithEntities(3);
        expect(() => {
            new QueryInstance(world, Query(P), -1).forEach(() => { throw new Error('boom'); });
        }).toThrow('boom');
        expect(world.isIterating()).toBe(false);
    });

    it('forEach: callback throws on a Mut query', () => {
        const world = worldWithEntities(3);
        expect(() => {
            new QueryInstance(world, Query(Mut(P)), -1).forEach((_e, p) => {
                (p as { x: number }).x = 99;
                throw new Error('boom');
            });
        }).toThrow('boom');
        expect(world.isIterating()).toBe(false);
    });

    it('forEach: the error is the callback\'s, and the world is usable after it', () => {
        const world = worldWithEntities(3);
        try {
            new QueryInstance(world, Query(P), -1).forEach(() => { throw new Error('boom'); });
        } catch { /* a system that logs and carries on */ }
        expect(() => world.spawn()).not.toThrow();
    });

    it('forEach: nesting stays balanced when the inner one throws', () => {
        const world = worldWithEntities(2);
        const outer = new QueryInstance(world, Query(P), -1);
        const inner = new QueryInstance(world, Query(P), -1);
        outer.forEach(() => {
            try {
                inner.forEach(() => { throw new Error('inner'); });
            } catch { /* handled */ }
        });
        expect(world.isIterating()).toBe(false);
    });

    it('for..of: loop body throws', () => {
        const world = worldWithEntities(3);
        expect(() => {
            for (const _row of new QueryInstance(world, Query(P), -1)) {
                throw new Error('boom');
            }
        }).toThrow('boom');
        expect(world.isIterating()).toBe(false);
    });

    it('for..of: break leaves nothing open', () => {
        const world = worldWithEntities(3);
        for (const _row of new QueryInstance(world, Query(P), -1)) break;
        expect(world.isIterating()).toBe(false);
    });

    it('for..of: next() itself throws', () => {
        const world = worldWithEntities(3);
        const q = new QueryInstance(world, Query(P), -1);
        // A getter that fails is the engine's own storage breaking underfoot; the
        // iterator still has to close, or nothing can spawn for the rest of the run.
        (q as unknown as { getters_: unknown[] }).getters_ = [() => { throw new Error('storage'); }];
        expect(() => {
            for (const _row of q) { /* never reached */ }
        }).toThrow('storage');
        expect(world.isIterating()).toBe(false);
    });

    it('a write-back failure does not replace the callback\'s error', () => {
        const world = worldWithEntities(2);
        const q = new QueryInstance(world, Query(Mut(P)), -1);
        (q as unknown as { writeMutBack_: (e: number) => void }).writeMutBack_ = () => {
            throw new Error('write-back');
        };
        expect(() => {
            q.forEach(() => { throw new Error('callback'); });
        }).toThrow('callback');
        expect(world.isIterating()).toBe(false);
    });

    it('forEach: a failing write-back is attempted once, not retried on the way out', () => {
        const world = worldWithEntities(2);
        const q = new QueryInstance(world, Query(Mut(P)), -1);
        const attempts: number[] = [];
        (q as unknown as { writeMutBack_: (e: number) => void }).writeMutBack_ = (e) => {
            attempts.push(e);
            throw new Error('write-back');
        };
        // The callback is clean, so the throw is the write-back's own. Retrying it
        // in the finally would run a write that already failed a second time.
        expect(() => q.forEach(() => { /* no error of its own */ })).toThrow('write-back');
        expect(attempts).toHaveLength(1);
        expect(world.isIterating()).toBe(false);
    });

    it('for..of: a failing write-back is attempted once, not retried by finalize', () => {
        const world = worldWithEntities(3);
        const q = new QueryInstance(world, Query(Mut(P)), -1);
        const attempts: number[] = [];
        (q as unknown as { writeMutBack_: (e: number) => void }).writeMutBack_ = (e) => {
            attempts.push(e);
            throw new Error('write-back');
        };
        expect(() => {
            for (const _row of q) { /* the previous row's write-back throws */ }
        }).toThrow('write-back');
        expect(attempts).toHaveLength(1);
        expect(world.isIterating()).toBe(false);
    });

    it('a write-back failure on a clean run is not swallowed', () => {
        const world = worldWithEntities(2);
        const q = new QueryInstance(world, Query(Mut(P)), -1);
        (q as unknown as { writeMutBack_: (e: number) => void }).writeMutBack_ = () => {
            throw new Error('write-back');
        };
        expect(() => q.forEach(() => { /* no error of its own */ })).toThrow('write-back');
        expect(world.isIterating()).toBe(false);
    });
});
