// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The renderer as the cache sees it: targets, bakes by ticket, and a device generation. A bake is drawn when `draw` says so.
const engine = vi.hoisted(() => ({
    generation: 1,
    tickets: new Map<number, number>(),
    next: 1,
    bakes: [] as { target: number; x: number; y: number; w: number; h: number; a: readonly number[]; b: readonly number[]; ticket: number }[],
    released: [] as number[],
    draw(state = 1): void { for (const k of this.tickets.keys()) if (this.tickets.get(k) === 0) this.tickets.set(k, state); },
}));
vi.mock('../src/render/renderer', () => ({
    deviceGeneration: () => engine.generation,
    Renderer: {
        createRenderTarget: () => 7,
        getTargetTexture: () => 70,
        releaseRenderTarget: (h: number) => { engine.released.push(h); },
        bakeMaterial: (_m: number, _s: number, target: number, x: number, y: number, w: number, h: number, a: readonly number[], b: readonly number[]) => {
            const ticket = engine.next++;
            engine.tickets.set(ticket, 0);
            engine.bakes.push({ target, x, y, w, h, a, b, ticket });
            return ticket;
        },
        bakeState: (t: number) => {
            const s = engine.tickets.get(t) ?? -1;
            if (s !== 0) engine.tickets.delete(t);
            return s;
        },
    },
}));
vi.mock('../src/wasm/resourceManager', () => ({
    getResourceManager: () => ({ wrapDeviceTexture: () => 700, releaseTexture: () => {} }),
}));

import { SurfaceCache, type SurfaceRequest } from '../src/terrain/surfaceCache';

const node = (key: string, source = 's'): SurfaceRequest => ({ key, source, x0: 0, z0: 0, size: 32, level: 1, pageX: 4, pageY: 5 });

describe('a terrain\'s baked surface pages', () => {
    beforeEach(() => {
        engine.generation = 1;
        engine.tickets.clear();
        engine.next = 1;
        engine.bakes.length = 0;
        engine.released.length = 0;
    });

    it('bakes a page as two squares side by side, and reads it only once both are drawn', () => {
        const cache = new SurfaceCache(16, 2, 2);
        expect(cache.texture()).toBe(700);
        expect(cache.update([node('a')], 1, 2, 4).size).toBe(0);
        // Two squares of 16 texels and a border each, the second beside the first, halves 0 and 1.
        expect(engine.bakes.map((b) => [b.x, b.y, b.w, b.h, b.a[3]])).toEqual([[0, 0, 18, 18, 0], [18, 0, 18, 18, 1]]);
        expect(engine.bakes[0]!.b).toEqual([4, 5, 1, 16]);
        expect(cache.update([node('a')], 1, 2, 4).size).toBe(0);
        engine.draw();
        expect(cache.update([node('a')], 1, 2, 4)).toEqual(new Map([['a', 0]]));
        // Ready, it is not drawn again.
        cache.update([node('a')], 1, 2, 4);
        expect(engine.bakes).toHaveLength(2);
    });

    it('draws no more pages a frame than its budget, nearest (first) first', () => {
        const cache = new SurfaceCache(16, 2, 2);
        cache.update([node('a'), node('b'), node('c')], 1, 2, 2);
        expect(engine.bakes).toHaveLength(4);
        engine.draw();
        expect([...cache.update([node('a'), node('b'), node('c')], 1, 2, 2).keys()]).toEqual(['a', 'b']);
    });

    it('draws a page again when what it was made from changes, and reads the old one meanwhile not at all', () => {
        const cache = new SurfaceCache(16, 2, 2);
        cache.update([node('a', 'one')], 1, 2, 4);
        engine.draw();
        expect(cache.update([node('a', 'one')], 1, 2, 4).size).toBe(1);
        expect(cache.update([node('a', 'two')], 1, 2, 4).size).toBe(0);
        expect(engine.bakes).toHaveLength(4);
        engine.draw();
        expect(cache.update([node('a', 'two')], 1, 2, 4).size).toBe(1);
        cache.invalidate();
        expect(cache.update([node('a', 'two')], 1, 2, 4).size).toBe(0);
    });

    it('gives the least recently drawn page\'s slot to a new node when the atlas is full, never one drawn this frame', () => {
        const cache = new SurfaceCache(16, 1, 2);
        cache.update([node('a'), node('b')], 1, 2, 4);
        engine.draw();
        cache.update([node('a'), node('b')], 1, 2, 4);
        cache.update([node('b')], 1, 2, 4);
        // a was last drawn a frame before b: c takes its slot, and b keeps its own.
        const got = cache.update([node('b'), node('c')], 1, 2, 4);
        expect(got.get('b')).toBe(1);
        expect(engine.bakes.at(-1)!.y).toBe(0);
        // Every slot in use this frame: a fourth node waits.
        engine.draw();
        expect(cache.update([node('b'), node('c'), node('d')], 1, 2, 4).has('d')).toBe(false);
    });

    it('draws every page again after the device is lost, and gives up on a bake the engine cannot draw', () => {
        const cache = new SurfaceCache(16, 2, 2);
        cache.update([node('a')], 1, 2, 4);
        engine.draw();
        expect(cache.update([node('a')], 1, 2, 4).size).toBe(1);
        engine.generation = 2;
        expect(cache.update([node('a')], 1, 2, 4).size).toBe(0);
        engine.draw(-1);
        cache.update([node('a')], 1, 2, 4);
        expect(cache.failed).toBe(true);
        expect(cache.update([node('a')], 1, 2, 4).size).toBe(0);
        cache.release();
        expect(engine.released).toEqual([7]);
    });
});
