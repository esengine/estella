/**
 * @file    wasm-scratch.test.ts
 * @brief   withScratch frees every allocation on normal return AND on throw.
 */
import { describe, it, expect } from 'vitest';
import { withScratch, withMalloc, type WasmAllocator } from '../src/wasmScratch';

/** Fake allocator that hands out increasing pointers and records frees. */
function makeAllocator() {
    let next = 8; // non-zero base
    const freed: number[] = [];
    const live = new Set<number>();
    const mod: WasmAllocator = {
        _malloc(size: number) {
            const p = next;
            next += Math.max(size, 1);
            live.add(p);
            return p;
        },
        _free(ptr: number) {
            freed.push(ptr);
            live.delete(ptr);
        },
    };
    return { mod, freed, live };
}

describe('withScratch', () => {
    it('frees a single allocation after normal return', () => {
        const { mod, live } = makeAllocator();
        const r = withScratch(mod, alloc => {
            const p = alloc(64);
            expect(p).toBeGreaterThan(0);
            return p;
        });
        expect(r).toBeGreaterThan(0);
        expect(live.size).toBe(0);
    });

    it('frees all allocations in reverse order', () => {
        const { mod, freed, live } = makeAllocator();
        let a = 0, b = 0, c = 0;
        withScratch(mod, alloc => {
            a = alloc(16);
            b = alloc(16);
            c = alloc(16);
        });
        expect(live.size).toBe(0);
        expect(freed).toEqual([c, b, a]);
    });

    it('frees everything even when the callback throws', () => {
        const { mod, live } = makeAllocator();
        expect(() => {
            withScratch(mod, alloc => {
                alloc(16);
                alloc(16);
                throw new Error('boom');
            });
        }).toThrowError('boom');
        expect(live.size).toBe(0);
    });

    it('propagates the callback return value', () => {
        const { mod } = makeAllocator();
        const r = withScratch(mod, () => 'result');
        expect(r).toBe('result');
    });

    it('withMalloc allocates one buffer and frees it on throw', () => {
        const { mod, live, freed } = makeAllocator();
        expect(() => {
            withMalloc(mod, 128, ptr => {
                expect(ptr).toBeGreaterThan(0);
                throw new Error('mid-use');
            });
        }).toThrowError('mid-use');
        expect(live.size).toBe(0);
        expect(freed.length).toBe(1);
    });
});
