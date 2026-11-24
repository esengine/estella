// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { AotEvents } from '../src/ecs/aot/AotEvents';
import { AotResources } from '../src/ecs/aot/AotResources';
import { WasmPoolMemory } from '../src/ecs/WasmPoolMemory';
import { resourceBitSource, resourceLayout } from '../src/ecs/resourceShapes';
import { FakeEngine } from './fakeEngine';

class GrowingHeap extends FakeEngine {
    grow(): void {
        this.memory.grow(1);
        this.HEAPU8 = new Uint8Array(this.memory.buffer);
    }
}

describe('compiled frame data across engine memory growth', () => {
    it('mirrors all resource fields across a getter that grows the heap', () => {
        const heap = new GrowingHeap();
        const value = { x: 3, get y() { heap.grow(); return 7; } };
        const resources = new AotResources(new WasmPoolMemory(heap), () => value, new Map([['Step', ['x', 'y']]]));
        try {
            const address = resources.addressOf('Step')!;
            expect([...new Float64Array(heap.memory.buffer, address, 2)]).toEqual([3, 7]);
        } finally { resources.dispose(); }
    });

    it('keeps an outer resource snapshot when a field reads the same mirror again', () => {
        const heap = new GrowingHeap();
        let nested = false;
        const value = {
            get x() { return nested ? 91 : 1; },
            get y(): number {
                if (nested) return 92;
                nested = true;
                try {
                    const at = resources.addressOf('Step')!;
                    expect([...new Float64Array(heap.memory.buffer, at, 2)]).toEqual([91, 92]);
                } finally { nested = false; }
                return 2;
            },
        };
        const resources = new AotResources(new WasmPoolMemory(heap), () => value, new Map([['Step', ['x', 'y']]]));
        try {
            const at = resources.addressOf('Step')!;
            expect([...new Float64Array(heap.memory.buffer, at, 2)]).toEqual([1, 2]);
        } finally { resources.dispose(); }
    });

    it('copies a compiled resource back after growth and while an earlier setter grows the heap', () => {
        const heap = new GrowingHeap();
        let x = 1;
        const value = { get x() { return x; }, set x(v: number) { x = v; heap.grow(); }, y: 2 };
        const resources = new AotResources(new WasmPoolMemory(heap), () => value, new Map([['Step', ['x', 'y']]]));
        try {
            const address = resources.addressOf('Step')!;
            heap.grow();
            new Float64Array(heap.memory.buffer, address, 2).set([5, 9]);
            resources.writeBack('Step');
            expect([x, value.y]).toEqual([5, 9]);
        } finally { resources.dispose(); }
    });

    it('keeps input bits when the input service grows the heap while answering', () => {
        const heap = new GrowingHeap();
        const keys = resourceBitSource('Input', 'keyDown')!.keys;
        const pressed = keys[9];
        const input = { isKeyDown(key: unknown) {
            if (key !== pressed) return false;
            heap.grow(); return true;
        } };
        const resources = new AotResources(new WasmPoolMemory(heap), () => input);
        try {
            const address = resources.addressOf('Input')!;
            const member = resourceLayout('Input')!.find(field => field.name === 'keyDown')!;
            expect(heap.HEAPU8[address + member.offset + 1]).toBe(2);
        } finally { resources.dispose(); }
    });

    it('keeps event fields when a nested getter grows the heap', () => {
        const heap = new GrowingHeap();
        const payload = { speed: 4, motion: { get distance() { heap.grow(); return 12; } } };
        const events = new AotEvents(new WasmPoolMemory(heap), () => ({ read: () => [payload], send() {} }));
        try {
            const rows = events.rowsFor('Move', ['speed', 'motion.distance']);
            expect([...new Float64Array(heap.memory.buffer, rows[0]![1], 2)]).toEqual([4, 12]);
        } finally { events.dispose(); }
    });

    it('releases only the nested reader’s payloads when event sampling re-enters', () => {
        const heap = new GrowingHeap(), freed: number[] = [];
        const memory = new WasmPoolMemory(heap);
        const events = new AotEvents({
            alloc: n => memory.alloc(n), current: b => memory.current(b), release: b => { freed.push(b.byteOffset); memory.release(b); },
        }, name => ({ read: () => name === 'inner' ? [{ x: 7 }] : [{ x: 3 }, { get x() {
            const nested = events.beginCall();
            const rows = events.rowsFor('inner', ['x']);
            events.release(nested);
            expect(freed).toEqual([rows[0]![1]]);
            return 5;
        } }], send() {} }));
        try {
            const outer = events.beginCall(), rows = events.rowsFor('outer', ['x']);
            expect(rows.map(r => new Float64Array(heap.memory.buffer, r[1], 1)[0])).toEqual([3, 5]);
            events.release(outer);
            expect(freed.slice(1)).toEqual(rows.map(row => row[1]));
        } finally { events.dispose(); }
    });
});
