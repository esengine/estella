// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    wasm-pool-memory.test.ts
 * @brief   Component rows on a wasm heap, including the one that grows.
 *
 * @details Growing a wasm memory DETACHES every ArrayBuffer view of it. The
 *          bytes survive at the same offsets — it is the same linear memory —
 *          but a held view silently reads undefined instead of throwing, which
 *          is the worst way for storage to fail.
 *
 *          So the heap here is a real `WebAssembly.Memory` and it is really
 *          grown, mid-life, with rows already in it.
 */
import { describe, it, expect } from 'vitest';
import { ScriptPool, poolShape, POOL_ABSENT } from '../src/ecs/ScriptPool';
import { WasmPoolMemory, type WasmHeap } from '../src/ecs/WasmPoolMemory';
import { entityIndex, type Entity } from '../src/types';

const e = (n: number): Entity => n as unknown as Entity;
const DEFAULTS = { speed: 100, directionX: 0, directionY: 0, enabled: true };

/**
 * An emscripten module as far as a pool is concerned: a bump allocator over a
 * real wasm memory, and a HEAPU8 that is replaced on growth exactly as
 * emscripten's `updateMemoryViews` replaces it.
 */
class FakeModule implements WasmHeap {
    readonly memory: WebAssembly.Memory;
    HEAPU8: Uint8Array;
    private next: number;
    readonly freed: number[] = [];

    /**
     * `growAlways` models the allocator that is hard to be correct against: a
     * real `_malloc` may grow on ANY call, and growth detaches every view. A
     * bump allocator that only grows when it runs out never reaches the
     * interesting ordering, which is how this file first passed a sabotage.
     */
    constructor(pages = 1, private readonly growAlways = false) {
        this.memory = new WebAssembly.Memory({ initial: pages });
        this.HEAPU8 = new Uint8Array(this.memory.buffer);
        this.next = 64;   // nonzero, as a real heap's low addresses are taken
    }

    _malloc(size: number): number {
        if (this.growAlways) this.grow();
        const at = this.next;
        this.next += (size + 15) & ~15;
        while (this.next > this.HEAPU8.byteLength) this.grow();
        return at;
    }

    _free(ptr: number): void {
        this.freed.push(ptr);
    }

    /** What emscripten does: grow, then rebuild the views over the new buffer. */
    grow(): void {
        this.memory.grow(1);
        this.HEAPU8 = new Uint8Array(this.memory.buffer);
    }
}

describe('rows on the engine heap', () => {
    it('allocates at a wasm address, and an address is that address', () => {
        const mod = new FakeModule();
        const pool = new ScriptPool(poolShape(DEFAULTS)!, 4, new WasmPoolMemory(mod));
        pool.put(e(1), DEFAULTS, { speed: 11 });
        pool.put(e(2), DEFAULTS, { speed: 22 });

        // What a compiled system is handed. Reading it out of the heap by that
        // address is exactly what the compiled code does.
        const heap = new Float64Array(mod.memory.buffer);
        for (const [entity, want] of [[1, 11], [2, 22]] as const) {
            expect(heap[pool.address(e(entity))! / 8], `entity ${entity}`).toBe(want);
        }
        expect(pool.address(e(1))).toBeGreaterThanOrEqual(64);
    });

    it('survives a growth that detaches every view of the heap', () => {
        const mod = new FakeModule();
        const pool = new ScriptPool(poolShape(DEFAULTS)!, 4, new WasmPoolMemory(mod));
        for (let i = 1; i <= 4; i++) pool.put(e(i), DEFAULTS, { speed: i });
        const held = pool.get(e(2))!;
        const before = pool.address(e(2));
        const wasBuffer = mod.memory.buffer;

        mod.grow();
        expect(mod.memory.buffer, 'the growth did not actually replace the buffer')
            .not.toBe(wasBuffer);
        // The pool is still holding views of a buffer that no longer exists.
        pool.refresh();

        expect(pool.address(e(2)), 'the bytes did not move, only the buffer did').toBe(before);
        for (let i = 1; i <= 4; i++) {
            expect(pool.get(e(i))!['speed'], `entity ${i} after growth`).toBe(i);
        }
        // The view handed out BEFORE the growth still writes to the right row,
        // because it reads the pool's current storage rather than holding one.
        held['speed'] = 42;
        const heap = new Float64Array(mod.memory.buffer);
        expect(heap[pool.address(e(2))! / 8]).toBe(42);
    });

    it('a growth caused BY the pool does not lose the rows it was copying', () => {
        // The trap the ordering in growRows_ exists for: allocating the wider
        // block grows the heap, detaching the old rows BEFORE they are copied
        // out of. This allocator grows every call, so every doubling meets it.
        const mod = new FakeModule(1, true);
        const pool = new ScriptPool(poolShape(DEFAULTS)!, 2, new WasmPoolMemory(mod));
        for (let i = 1; i <= 64; i++) pool.put(e(i), DEFAULTS, { speed: i * 2 });

        expect(pool.size).toBe(64);
        expect(mod.memory.buffer.byteLength, 'the heap never actually grew')
            .toBeGreaterThan(65536);
        const heap = new Float64Array(mod.memory.buffer);
        for (let i = 1; i <= 64; i++) {
            expect(pool.get(e(i))!['speed'], `entity ${i} value`).toBe(i * 2);
            expect(heap[pool.address(e(i))! / 8], `entity ${i} in the heap`).toBe(i * 2);
        }
        expect(mod.freed.length, 'the old blocks were handed back').toBeGreaterThan(0);
    });

    it('the sparse table lives in the same heap, and resolves there', () => {
        const mod = new FakeModule();
        const pool = new ScriptPool(poolShape(DEFAULTS)!, 4, new WasmPoolMemory(mod));
        for (let i = 1; i <= 5; i++) pool.put(e(i), DEFAULTS, { speed: i });

        const { rows, stride, sparse, sparseCount } = pool.span();
        const table = new Uint32Array(mod.memory.buffer, sparse, sparseCount);
        const heap = new Float64Array(mod.memory.buffer);

        // The two loads a compiled host does, straight out of wasm memory.
        for (let i = 1; i <= 5; i++) {
            const slot = table[entityIndex(e(i))]!;
            expect(slot, `entity ${i}`).not.toBe(POOL_ABSENT);
            expect(heap[(rows + (slot - 1) * stride) / 8], `entity ${i}`).toBe(i);
        }
        // Absent has two forms and a host must take both: a zero in the table,
        // and an index past its end — the table is sized by the entity indices
        // seen, not by the world's. `aot::fromRows` checks the bound first.
        const absent = (id: Entity): boolean => {
            const at = entityIndex(id);
            return at >= sparseCount || table[at] === POOL_ABSENT;
        };
        expect(absent(e(6)), 'a live index the pool never saw').toBe(true);
        expect(absent(e(100000)), 'an index past the table').toBe(true);
        expect(absent(e(3))).toBe(false);
    });
});
