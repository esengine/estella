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
import {
    ScriptPool, poolShape, POOL_SLOT_BYTES, POOL_ABSENT, POOL_NO_OWNER, HEAP_MEMORY,
    type PoolMemory,
} from '../src/ecs/ScriptPool';
import { entityIndex, makeEntity } from '../src/types';
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

/**
 * A wasm host cannot let a pool allocate on the JS heap: compiled code inside
 * the module has no way to reach it. So the rows come out of one block the host
 * owns, and an address is an offset into THAT.
 */
/** Stands in for the wasm heap: one buffer, a bump pointer, nothing freed. */
function heapOf(bytes: number): { memory: PoolMemory; all: Float64Array; used: () => number } {
    const block = new ArrayBuffer(bytes);
    const all = new Float64Array(block);
    let at = 64;   // a nonzero start, so an address that forgot byteOffset is wrong
    return {
        all,
        used: () => at,
        memory: {
            alloc(want) {
                const byteLength = (want + 7) & ~7;
                const out = { buffer: block, byteOffset: at, byteLength };
                at += byteLength;
                return out;
            },
            release: () => { /* a bump allocator frees nothing */ },
        },
    };
}

describe('rows carved out of a host-owned block', () => {
    it('an address is an offset into the block, not into the pool', () => {
        const heap = heapOf(1 << 16);
        const pool = new ScriptPool(poolShape(DEFAULTS)!, 8, heap.memory);
        pool.put(e(1), DEFAULTS, { speed: 11 });
        pool.put(e(2), DEFAULTS, { speed: 22 });

        // baseOf is where the row is inside the pool; address is where it is in
        // the memory a host would hand to compiled code.
        expect(pool.baseOf(e(2))).toBe(pool.stride);
        expect(pool.address(e(2))).toBe(pool.buffer.byteOffset + pool.stride);
        expect(pool.address(e(2))).toBeGreaterThan(pool.baseOf(e(2))!);

        // Read the field back through the BLOCK at that address, which is what
        // the compiled code does.
        for (const [entity, want] of [[1, 11], [2, 22]] as const) {
            const at = pool.address(e(entity))! / POOL_SLOT_BYTES;
            expect(heap.all[at], `entity ${entity} speed`).toBe(want);
        }
    });

    it('growing moves the rows, and the addresses move with them', () => {
        const heap = heapOf(1 << 16);
        const pool = new ScriptPool(poolShape(DEFAULTS)!, 2, heap.memory);
        for (let i = 1; i <= 12; i++) pool.put(e(i), DEFAULTS, { speed: i });
        expect(heap.used()).toBeGreaterThan(64);

        for (let i = 1; i <= 12; i++) {
            const at = pool.address(e(i))! / POOL_SLOT_BYTES;
            expect(heap.all[at], `entity ${i} after growth`).toBe(i);
        }
    });

    it('resolves a row the way a host would, with no call back', () => {
        // One memory, because that is what `span` means: the offsets are into
        // the allocator's block, and only there do rows and table share one
        // address space. The JS heap gives each block its own buffer.
        const heap = heapOf(1 << 20);
        const pool = new ScriptPool(poolShape(DEFAULTS)!, 8, heap.memory);
        for (let i = 1; i <= 6; i++) pool.put(e(i), DEFAULTS, { speed: i * 3 });

        const { rows, stride, sparse, sparseCount } = pool.span();
        const table = new Uint32Array(heap.all.buffer, sparse, sparseCount);

        // Exactly the two loads a host does: one into the table, one into a row.
        for (let i = 1; i <= 6; i++) {
            const slot = table[entityIndex(e(i))]!;
            expect(slot, `entity ${i} present`).not.toBe(POOL_ABSENT);
            const at = (rows + (slot - 1) * stride) / POOL_SLOT_BYTES;
            expect(heap.all[at], `entity ${i} speed`).toBe(i * 3);
        }
        expect(table[entityIndex(e(7))]).toBe(POOL_ABSENT);
    });

    it('the default keeps the rows on the JS heap, where native wants them', () => {
        const pool = new ScriptPool(poolShape(DEFAULTS)!, 4, HEAP_MEMORY);
        pool.put(e(1), DEFAULTS);
        expect(pool.buffer.byteOffset).toBe(0);
        expect(pool.address(e(1))).toBe(pool.baseOf(e(1)));
    });
});

/**
 * What a host is handed so it needs no call to find a row. `span()` is the whole
 * answer: rows at a stride, and a sparse table of slot+1 by entity index — the
 * engine's own sparse-set shape, so C++ resolves a component with two loads.
 */
describe('a pool handed over as memory', () => {
    it('the sparse table says which slot, and zero says absent', () => {
        const pool = new ScriptPool(poolShape(DEFAULTS)!);
        pool.put(e(5), DEFAULTS, { speed: 55 });
        pool.put(e(9), DEFAULTS, { speed: 99 });

        expect(pool.sparseTable[entityIndex(e(5))]).toBe(1);   // slot 0
        expect(pool.sparseTable[entityIndex(e(9))]).toBe(2);   // slot 1
        expect(pool.sparseTable[entityIndex(e(7))]).toBe(POOL_ABSENT);

        pool.delete(e(5));
        expect(pool.sparseTable[entityIndex(e(5))]).toBe(POOL_ABSENT);
    });

    it('a generation bump does not move an entity in the table', () => {
        // The table is indexed by INDEX, as the engine's sparse set is: a recycled
        // id has the same index and a different generation, and looking it up by
        // the raw id would miss.
        const pool = new ScriptPool(poolShape(DEFAULTS)!);
        const first = makeEntity(12, 0);
        const recycled = makeEntity(12, 1);
        pool.put(first, DEFAULTS, { speed: 1 });
        expect(entityIndex(recycled)).toBe(entityIndex(first));
        expect(pool.sparseTable[entityIndex(recycled)]).not.toBe(POOL_ABSENT);
    });

    it('the table grows with the entity index, not with the row count', () => {
        const pool = new ScriptPool(poolShape(DEFAULTS)!, 4);
        pool.put(e(100000), DEFAULTS, { speed: 7 });
        expect(pool.size).toBe(1);
        expect(pool.sparseTable.length).toBeGreaterThan(100000);
        expect(pool.sparseTable[entityIndex(e(100000))]).toBe(1);
    });
});

/**
 * The other direction. The sparse table says which slot an entity is in; a host
 * running a compiled system needs who is in the column at all, and without it
 * has to offer every entity alive — making a system cost the size of the world.
 * Indexed by SLOT, so it is that table read backwards.
 */
describe('a pool that can say who is in it', () => {
    /** The owner column as the host reads it: from the shared block, at the
     *  offset and length `span()` reports. */
    function owners(pool: ScriptPool, all: Float64Array): Uint32Array {
        const { owners: at, ownerCount } = pool.span();
        return new Uint32Array(all.buffer, at, ownerCount);
    }

    it('names the entity in each slot, and only as far as slots were claimed', () => {
        const heap = heapOf(1 << 16);
        const pool = new ScriptPool(poolShape(DEFAULTS)!, 8, heap.memory);
        pool.put(e(5), DEFAULTS);
        pool.put(e(9), DEFAULTS);

        // Two claimed of a capacity of eight: the count is the high-water mark,
        // not the capacity, so a host walks two entries rather than eight.
        expect(pool.span().ownerCount).toBe(2);
        const table = owners(pool, heap.all);
        expect(table[0]).toBe(e(5));
        expect(table[1]).toBe(e(9));
    });

    it('a freed slot becomes a hole rather than shifting the ones above it', () => {
        const heap = heapOf(1 << 16);
        const pool = new ScriptPool(poolShape(DEFAULTS)!, 8, heap.memory);
        for (let i = 1; i <= 3; i++) pool.put(e(i), DEFAULTS);
        pool.delete(e(2));

        // Slots are reused, not compacted — a view holds a slot index and one
        // that moved under it is a bug three frames later. So the column keeps
        // its length and the freed entry says nobody.
        const table = owners(pool, heap.all);
        expect(pool.span().ownerCount).toBe(3);
        expect(table[0]).toBe(e(1));
        expect(table[1]).toBe(POOL_NO_OWNER);
        expect(table[2]).toBe(e(3));

        // And the next put fills the hole, because the free list is LIFO.
        pool.put(e(4), DEFAULTS);
        expect(owners(pool, heap.all)[1]).toBe(e(4));
        expect(pool.span().ownerCount).toBe(3);
    });

    it('survives a growth with every owner intact and the new slots empty', () => {
        const heap = heapOf(1 << 20);
        const pool = new ScriptPool(poolShape(DEFAULTS)!, 2, heap.memory);
        for (let i = 1; i <= 5; i++) pool.put(e(i), DEFAULTS);

        // The column is indexed by slot, so it grows with the rows — read from
        // the block at the NEW offset, since a growth moves it.
        const table = owners(pool, heap.all);
        expect(pool.span().ownerCount).toBe(5);
        for (let i = 1; i <= 5; i++) expect(table[i - 1], `slot ${i - 1}`).toBe(e(i));
    });

    it('the offset it reports is into the same block the rows are in', () => {
        const heap = heapOf(1 << 16);
        const pool = new ScriptPool(poolShape(DEFAULTS)!, 4, heap.memory);
        pool.put(e(3), DEFAULTS, { speed: 12 });

        // What makes the column usable at all: one address space, so the host
        // resolves an owner and then its row with no call back.
        const { owners: at, ownerCount, rows, stride } = pool.span();
        const table = new Uint32Array(heap.all.buffer, at, ownerCount);
        const entity = table[0]!;
        expect(entity).toBe(e(3));
        const slot = pool.sparseTable[entityIndex(entity)]! - 1;
        expect(heap.all[(rows + slot * stride) / POOL_SLOT_BYTES]).toBe(12);
    });
});
