// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from 'esengine';
import { loadWork } from 'esengine';
import { attachModelBakes, createModelBakes } from '../src/runtime/modelBakes';
import type { BakeAsk } from '../src/runtime/modelBakeWorker';
import type { ModelBakesFile } from '../src/modeling/loadBakeFile';

const SIZE = 16;
const asked: BakeAsk[] = [];
const terminate = vi.fn();
let hold: Promise<void> | null = null;

class FakeWorker {
    terminate = terminate;
    private readonly listeners: ((event: { data: unknown }) => void)[] = [];
    addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
        if (type === 'message') this.listeners.push(listener);
    }
    postMessage(ask: BakeAsk): void {
        asked.push(ask);
        const answer = async (): Promise<void> => {
            if (ask.part === 'maps' && hold) await hold;
            const data = ask.part === 'shape'
                ? { id: ask.id, mesh: new Uint8Array([1, 2, 3]), kept: false }
                : { id: ask.id, maps: (['normal', 'color'] as const).map((name) => ({ name, size: SIZE, rgba: new Uint8Array(SIZE * SIZE * 4).fill(name === 'color' ? 200 : 128) })) };
            for (const listener of this.listeners) listener({ data });
        };
        void Promise.resolve().then(answer);
    }
}

const FILE: ModelBakesFile = {
    models: [{
        source: 'assets/models/hull.esmodel',
        text: '{"normalBake":{"size":1024}}',
        products: { mesh: 'assets/models/hull.esmesh', color: 'assets/models/hull_color.png', normal: 'assets/models/hull_normal.png', emissive: 'assets/models/hull_emissive.png' },
    }],
} as ModelBakesFile;

const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const mapsAsked = (): number => asked.filter((ask) => ask.part === 'maps').length;

function served() {
    const bakes = createModelBakes(FILE, 'blob:bake-worker', 1024, 4);
    const source = bakes.serve({ backend: {} as Backend, decodePixels: async (_path: string) => ({ width: 1, height: 1, pixels: new Uint8Array(4) }) });
    return { bakes, decode: (path: string, ...rest: unknown[]) => (source.decodePixels as (path: string, ...rest: unknown[]) => Promise<{ width: number; height: number; pixels: Uint8Array; sourceWidth?: number; sourceHeight?: number }>)(path, ...rest) };
}

describe('a model baked at load, once the game lets its maps go', () => {
    beforeEach(() => {
        asked.length = 0;
        hold = null;
        vi.stubGlobal('Worker', FakeWorker);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('ends unfinished work and keeps the replacement game’s model baker installed', async () => {
        terminate.mockClear();
        let open!: () => void;
        hold = new Promise<void>(resolve => { open = resolve; });
        const old = served(), next = served();
        const first = new AbortController(), replacement = new AbortController();
        attachModelBakes(first.signal, old.bakes);
        const pending = old.bakes.work.run();
        attachModelBakes(replacement.signal, next.bakes);
        first.abort();
        await expect(pending).rejects.toThrow('game ended');
        expect(old.bakes.work.pending).toBe(false);
        expect(terminate).toHaveBeenCalledOnce();
        expect(loadWork()).toBe(next.bakes.work);
        await expect(old.decode('assets/models/hull_color.png')).rejects.toThrow('game ended');
        open();
        await next.bakes.work.run();
        replacement.abort();
        expect(terminate).toHaveBeenCalledTimes(2);
        expect(loadWork()).not.toBe(next.bakes.work);
    });

    it('draws a placeholder while it bakes and asks for the map again once it is baked', async () => {
        let open!: () => void;
        hold = new Promise<void>((done) => { open = done; });
        const { bakes, decode } = served();
        const refreshed: string[] = [];
        bakes.refreshWith(async (path) => { refreshed.push(path); });
        expect((await decode('assets/models/hull_color.png')).width).toBe(4);
        open();
        await bakes.work.run();
        await settle();
        expect(refreshed).toEqual(['assets/models/hull_color.png']);
        expect((await decode('assets/models/hull_color.png')).width).toBe(SIZE);
    });

    it('decodes a baked map again after release as the map, read back from the bake, not as a placeholder', async () => {
        const { bakes, decode } = served();
        await bakes.work.run();
        expect(mapsAsked()).toBe(1);
        bakes.work.release();
        const color = await decode('assets/models/hull_color.png');
        expect(color.width).toBe(SIZE);
        expect(color.pixels[0]).toBe(200);
        expect(mapsAsked()).toBe(2);
    });

    it('reads a model back once for all of its maps decoded together, and lets it go again after', async () => {
        vi.useFakeTimers();
        const { bakes, decode } = served();
        const running = bakes.work.run();
        await vi.runAllTimersAsync();
        await running;
        bakes.work.release();
        const [color, normal] = await Promise.all([decode('assets/models/hull_color.png'), decode('assets/models/hull_normal.png')]);
        expect([color.width, normal.width]).toEqual([SIZE, SIZE]);
        expect(normal.pixels[0]).toBe(128);
        expect(mapsAsked()).toBe(2);
        await vi.advanceTimersByTimeAsync(10_000);
        expect((await decode('assets/models/hull_color.png')).width).toBe(SIZE);
        expect(mapsAsked()).toBe(3);
    });

    it('lets the maps of a model baked after release go once its textures are drawn with them', async () => {
        let open!: () => void;
        hold = new Promise<void>((done) => { open = done; });
        const { bakes, decode } = served();
        const refreshed: number[] = [];
        bakes.refreshWith(async (path) => { refreshed.push((await decode(path)).width); });
        expect((await decode('assets/models/hull_color.png')).width).toBe(4);
        bakes.work.release();
        open();
        await bakes.work.run();
        await settle();
        expect(refreshed).toEqual([SIZE]);
        expect(mapsAsked()).toBe(1);
        expect((await decode('assets/models/hull_color.png')).width).toBe(SIZE);
        expect(mapsAsked()).toBe(2);
    });

    it('still draws a placeholder for a map the model never had, without asking for a bake', async () => {
        const { bakes, decode } = served();
        await bakes.work.run();
        bakes.work.release();
        expect((await decode('assets/models/hull_emissive.png')).width).toBe(4);
        expect(mapsAsked()).toBe(1);
    });

    it('decodes a baked map no larger than the edge it is asked for, and says the size it was made from', async () => {
        const { bakes, decode } = served();
        await bakes.work.run();
        const small = await decode('assets/models/hull_color.png', false, 4);
        expect([small.width, small.height, small.sourceWidth, small.sourceHeight]).toEqual([4, 4, SIZE, SIZE]);
        expect(small.pixels.length).toBe(4 * 4 * 4);
        expect(small.pixels[0]).toBe(200);
        const whole = await decode('assets/models/hull_color.png', false, 0);
        expect([whole.width, whole.sourceWidth]).toEqual([SIZE, undefined]);
        bakes.work.release();
        const again = await decode('assets/models/hull_normal.png', false, 8);
        expect([again.width, again.sourceWidth, again.pixels[0]]).toEqual([8, SIZE, 128]);
    });

    it('keeps reporting nothing pending once released', async () => {
        const { bakes } = served();
        await bakes.work.run();
        bakes.work.release();
        expect(bakes.work.pending).toBe(false);
    });
});
