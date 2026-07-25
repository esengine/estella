// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The native heap is what makes a `…Ptr` argument mean the same thing on a device
// as it does on the web: an offset into memory both sides can see. These drive the
// SDK half against a mock host arena — the same shape the real host exposes
// (native/host/bindings/HeapBindings.cpp) — so the marshalling that physics,
// tilemaps and particles rely on is checked without a device.
import { describe, it, expect } from 'vitest';
import { createNativeHeap, hasHeapBindings, HEAP_BINDINGS } from '../src/ecs/nativeHeap';

/** A mock host arena: one buffer plus a bump allocator, offsets never 0. */
function mockHost(bytes = 1024): Record<string, unknown> {
    const buffer = new ArrayBuffer(bytes);
    let next = 8;
    const live = new Set<number>();
    return {
        [HEAP_BINDINGS.heap]: () => buffer,
        [HEAP_BINDINGS.malloc]: (size: number) => {
            const offset = next;
            next += Math.ceil(size / 8) * 8;
            if (next > bytes) return 0;
            live.add(offset);
            return offset;
        },
        [HEAP_BINDINGS.free]: (offset: number) => { live.delete(offset); },
        __live: live,
    };
}

describe('createNativeHeap', () => {
    it('is absent until the host binds all three globals', () => {
        expect(hasHeapBindings({})).toBe(false);
        expect(createNativeHeap({})).toBeNull();
        const partial = mockHost();
        delete partial[HEAP_BINDINGS.free];
        expect(hasHeapBindings(partial)).toBe(false);
    });

    it('views every element type over the one arena', () => {
        const heap = createNativeHeap(mockHost())!;
        expect(heap.HEAPU8.buffer).toBe(heap.HEAPF32.buffer);
        expect(heap.HEAPU8.byteLength).toBe(1024);
        expect(heap.HEAPF32.length).toBe(256);
        expect(heap.HEAPU16.length).toBe(512);
        expect(heap.HEAPF64.length).toBe(128);
    });

    it('round-trips a float buffer through an offset, the way an entry point reads it', () => {
        const heap = createNativeHeap(mockHost())!;
        const tiles = new Float32Array([1.5, -2.25, 3, 4]);
        const ptr = heap._malloc(tiles.length * 4);
        expect(ptr).toBeGreaterThan(0);
        heap.HEAPF32.set(tiles, ptr / 4);
        // What the C++ side does with (ptr, count): read from the shared arena.
        expect(Array.from(heap.HEAPF32.subarray(ptr / 4, ptr / 4 + tiles.length)))
            .toEqual([1.5, -2.25, 3, 4]);
        heap._free(ptr);
    });

    it('writes through the arena are visible to the host, not to a copy', () => {
        const host = mockHost();
        const heap = createNativeHeap(host)!;
        const ptr = heap._malloc(4);
        heap.HEAPU32[ptr / 4] = 0xdeadbeef;
        // The host's own view of the same memory (it handed us its buffer).
        const hostView = new Uint32Array((host[HEAP_BINDINGS.heap] as () => ArrayBuffer)());
        expect(hostView[ptr / 4]).toBe(0xdeadbeef);
    });

    it('answers 0 when the arena is full, which reads as null', () => {
        const heap = createNativeHeap(mockHost(64))!;
        expect(heap._malloc(4096)).toBe(0);
    });

    it('frees what it allocated', () => {
        const host = mockHost();
        const heap = createNativeHeap(host)!;
        const ptr = heap._malloc(16);
        expect((host.__live as Set<number>).has(ptr)).toBe(true);
        heap._free(ptr);
        expect((host.__live as Set<number>).has(ptr)).toBe(false);
    });
});
