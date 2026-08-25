// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    script-pool.test.ts
 * @brief   A script component held as rows, and the view onto one.
 *
 * @details Rows exist so a compiled system can be handed an ADDRESS, which a JS
 *          object does not have. Views exist so nothing above has to know.
 *
 *          Both halves are checked here: the bytes sit where the ABI says, and a
 *          component still reads and writes as an object.
 */
import { describe, it, expect } from 'vitest';
import { ScriptPool, poolShape, POOL_SLOT_BYTES } from '../src/ecs/ScriptPool';
import type { Entity } from '../src/types';

const e = (n: number): Entity => n as unknown as Entity;
const DEFAULTS = { speed: 100, directionX: 0, directionY: 0, enabled: true };

describe('which shapes can be rows at all', () => {
    it('takes numbers and booleans, in declaration order', () => {
        expect(poolShape(DEFAULTS)).toEqual([
            { name: 'speed', kind: 'number' },
            { name: 'directionX', kind: 'number' },
            { name: 'directionY', kind: 'number' },
            { name: 'enabled', kind: 'boolean' },
        ]);
    });

    it('refuses anything with no fixed width', () => {
        // Each of these is a component the compiler also refuses, and for the
        // same reason: there is no offset to give it.
        expect(poolShape({ name: 'hero' })).toBeNull();
        expect(poolShape({ target: null })).toBeNull();
        expect(poolShape({ nested: { x: 1 } })).toBeNull();
        expect(poolShape({ path: [1, 2] })).toBeNull();
        expect(poolShape({})).toBeNull();
    });
});

describe('a row, and the view onto it', () => {
    it('seeds from the defaults and lays them out one slot each', () => {
        const pool = new ScriptPool(poolShape(DEFAULTS)!);
        expect(pool.stride).toBe(4 * POOL_SLOT_BYTES);
        const { view, isNew } = pool.put(e(1), DEFAULTS);
        expect(isNew).toBe(true);
        expect(pool.baseOf(e(1))).toBe(0);
        expect({ ...view }).toEqual(DEFAULTS);
    });

    it('a view is LIVE: writing through it changes the bytes', () => {
        const pool = new ScriptPool(poolShape(DEFAULTS)!);
        const { view } = pool.put(e(1), DEFAULTS);
        view['speed'] = 250;
        view['enabled'] = false;
        // Read back through the pool, not through the same object, so this is
        // about the storage rather than about the object remembering.
        expect(pool.buffer[0]).toBe(250);
        expect(pool.buffer[3]).toBe(0);
        expect(pool.get(e(1))!['speed']).toBe(250);
        expect(pool.get(e(1))!['enabled']).toBe(false);
    });

    it('a boolean is 0/1 in the slot and true/false out', () => {
        const pool = new ScriptPool(poolShape(DEFAULTS)!);
        const { view } = pool.put(e(1), DEFAULTS);
        expect(view['enabled']).toBe(true);
        view['enabled'] = false;
        expect(view['enabled']).toBe(false);
        // Not 0: a component that started answering 0 where it answered false
        // would pass `if (c.enabled)` and fail `c.enabled === false`.
        expect(view['enabled']).not.toBe(0);
    });

    it('overwriting names some fields and leaves the rest', () => {
        const pool = new ScriptPool(poolShape(DEFAULTS)!);
        pool.put(e(1), DEFAULTS);
        const { view, isNew } = pool.put(e(1), DEFAULTS, { speed: 7 });
        expect(isNew).toBe(false);
        expect(view['speed']).toBe(7);
        expect(view['directionX']).toBe(0);
        expect(view['enabled']).toBe(true);
    });

    it('the same entity keeps the same object across writes', () => {
        const pool = new ScriptPool(poolShape(DEFAULTS)!);
        const first = pool.put(e(1), DEFAULTS).view;
        const again = pool.put(e(1), DEFAULTS, { speed: 3 }).view;
        // A system that held the component across a `world.set` would otherwise
        // be writing into an object nothing reads.
        expect(again).toBe(first);
        expect(first['speed']).toBe(3);
    });

    it('a freed slot is reused, and the reused row is seeded fresh', () => {
        const pool = new ScriptPool(poolShape(DEFAULTS)!);
        pool.put(e(1), DEFAULTS, { speed: 999 });
        const at = pool.baseOf(e(1));
        expect(pool.delete(e(1))).toBe(true);
        expect(pool.get(e(1))).toBeUndefined();
        expect(pool.has(e(1))).toBe(false);

        pool.put(e(2), DEFAULTS);
        expect(pool.baseOf(e(2))).toBe(at);
        // Left at 999 it would be the previous entity's data under a new name.
        expect(pool.get(e(2))!['speed']).toBe(100);
    });

    it('growing keeps every row, and every view keeps working', () => {
        const pool = new ScriptPool(poolShape(DEFAULTS)!, 2);
        const views: Record<string, unknown>[] = [];
        for (let i = 1; i <= 40; i++) views.push(pool.put(e(i), DEFAULTS, { speed: i }).view);
        expect(pool.size).toBe(40);
        for (let i = 1; i <= 40; i++) {
            expect(pool.get(e(i))!['speed'], `entity ${i}`).toBe(i);
        }
        // The views handed out before the growth still address their own rows.
        views[0]!['speed'] = -1;
        expect(pool.get(e(1))!['speed']).toBe(-1);
        expect(pool.get(e(2))!['speed']).toBe(2);
    });

    it('rows are contiguous, which is the whole reason for them', () => {
        const pool = new ScriptPool(poolShape(DEFAULTS)!);
        for (let i = 1; i <= 4; i++) pool.put(e(i), DEFAULTS, { speed: i * 10 });
        expect([...pool.buffer.slice(0, 16)].filter((_, k) => k % 4 === 0))
            .toEqual([10, 20, 30, 40]);
        expect(pool.baseOf(e(3))! - pool.baseOf(e(2))!).toBe(pool.stride);
    });
});
