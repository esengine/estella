// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeEach, describe, expect, it, vi } from 'vitest';

const clock = { now: 0 };
const dims = new Map<number, { width: number; height: number }>();
let wants = '';

vi.mock('../src/platform', async (original) => ({ ...(await original<typeof import('../src/platform')>()), platformNow: () => clock.now }));
vi.mock('../src/wasm/resourceManager', async (original) => ({
    ...(await original<typeof import('../src/wasm/resourceManager')>()),
    getTextureDimensions: (handle: number) => dims.get(handle) ?? null,
}));
vi.mock('../src/ecs/bridge/engineApi', async (original) => ({
    ...(await original<typeof import('../src/ecs/bridge/engineApi')>()),
    engineApi: () => ({ renderer_takeTextureWants: () => { const said = wants; wants = ''; return said; } }),
}));

const { TextureStreamingPlugin, TextureStreamingRes } = await import('../src/render/textureStreaming');
const { Quality } = await import('../src/render/qualityRuntime');
const { defaultQualityProfile } = await import('../src/render/quality');
const { Assets } = await import('../src/asset/AssetPlugin');

const FILES = new Map<number, number>([[1, 2048], [2, 1024], [3, 512]]);
const DECODES_AT_MOST = new Map<number, number>();
const KNOWN_FULL = new Map<number, number>();

function harness(startedSmall = 0) {
    const profile = { ...defaultQualityProfile('high'), textureStreaming: true, textureStreamingBudget: 0 };
    const resized: [number, number][] = [];
    const bindings = new Map([...FILES.keys()].map(handle => [handle, {}] as const));
    const loader = {
        startedSmall,
        resizableHandles: () => bindings.keys(),
        streamingBinding: (handle: number) => bindings.get(handle),
        fullSize: (handle: number) => { const edge = KNOWN_FULL.get(handle) ?? FILES.get(handle); return edge ? { width: edge, height: edge } : null; },
    };
    const assets = {
        textureResizable: (handle: number) => bindings.has(handle),
        textureFullSize: (handle: number) => loader.fullSize(handle),
        getTextureLoader: () => loader,
        resizeTexture: async (handle: number, edge: number): Promise<{ width: number; height: number } | null> => {
            resized.push([handle, edge]);
            const full = FILES.get(handle)!;
            const size = Math.min(edge === 0 ? full : Math.min(full, edge), DECODES_AT_MOST.get(handle) ?? Infinity);
            if (size === full) KNOWN_FULL.delete(handle);
            dims.set(handle, { width: size, height: size });
            return { width: size, height: size };
        },
    };
    const resources = new Map<unknown, unknown>([[Quality, { profile }], [Assets, assets]]);
    let tick: (() => void) | null = null;
    const app = {
        world: { getEntitiesWithComponents: () => [] },
        insertResource: (res: unknown, value: unknown) => { resources.set(res, value); },
        hasResource: (res: unknown) => resources.has(res),
        getResource: (res: unknown) => resources.get(res),
        addSystemToSchedule: (_schedule: unknown, system: { _fn: () => void }) => { tick = system._fn; },
    };
    new TextureStreamingPlugin().build(app as never);
    const run = async (at: number) => {
        clock.now = at;
        tick!();
        for (let i = 0; i < 10; i++) await Promise.resolve();
    };
    return { profile, resized, run, bindings, assets, state: () => resources.get(TextureStreamingRes) as InstanceType<typeof import('../src/render/textureStreaming').TextureStreaming> };
}

describe('textures streaming shrank, once the quality level stops streaming', () => {
    beforeEach(() => {
        dims.clear();
        for (const [handle, edge] of FILES) dims.set(handle, { width: edge, height: edge });
        wants = '';
        clock.now = 0;
        DECODES_AT_MOST.clear();
        KNOWN_FULL.clear();
    });

    it('are put back at their full size', async () => {
        const { profile, resized, run } = harness();
        wants = '1:100';
        await run(1000);
        wants = '1:100';
        await run(1000 + 3500);
        expect(resized).toEqual([[1, 128]]);
        expect(dims.get(1)!.width).toBe(128);
        profile.textureStreaming = false;
        await run(5000);
        expect(resized).toEqual([[1, 128], [1, 0]]);
        expect(dims.get(1)!.width).toBe(2048);
        await run(6000);
        expect(resized.length).toBe(2);
    });

    it('include the ones that were loaded small while streaming was on', async () => {
        const { profile, resized, run } = harness(2);
        dims.set(2, { width: 256, height: 256 });
        dims.set(3, { width: 256, height: 256 });
        profile.textureStreaming = false;
        await run(1000);
        expect(resized.sort()).toEqual([[2, 0], [3, 0]]);
        expect([dims.get(2)!.width, dims.get(3)!.width]).toEqual([1024, 512]);
        await run(2000);
        expect(resized.length).toBe(2);
    });

    it('are asked once only when one cannot come back at full size', async () => {
        const { profile, resized, run } = harness(1);
        dims.set(2, { width: 256, height: 256 });
        DECODES_AT_MOST.set(2, 256);
        profile.textureStreaming = false;
        await run(1000);
        await run(2000);
        await run(3000);
        expect(resized).toEqual([[2, 0]]);
    });

    it('leave nothing to move when no level ever streamed', async () => {
        const { profile, resized, run } = harness();
        profile.textureStreaming = false;
        await run(1000);
        await run(2000);
        expect(resized).toEqual([]);
    });

    it('drops released handles from the byte budget and from the refused set', async () => {
        const { profile, bindings, run, state } = harness(1);
        dims.set(2, { width: 256, height: 256 });
        DECODES_AT_MOST.set(2, 256);
        profile.textureStreaming = false;
        await run(1000);
        expect(state().refused.has(2)).toBe(true);
        profile.textureStreaming = true;
        wants = '1:2048';
        await run(2000);
        expect(state().bytes().now).toBeGreaterThan(0);
        bindings.delete(1);
        bindings.delete(2);
        await run(3000);
        expect(state().bytes()).toEqual({ now: 0, full: 0 });
        expect(state().refused.size).toBe(0);
    });

    it('lets the new holder restore after the previous holder released during a decode', async () => {
        const { profile, bindings, assets, run, state, resized } = harness(1);
        dims.set(2, { width: 256, height: 256 });
        profile.textureStreaming = false;
        let resume!: () => void;
        const gate = new Promise<void>(resolve => { resume = resolve; });
        const resize = vi.spyOn(assets, 'resizeTexture').mockImplementationOnce(async () => { await gate; return null; });
        await run(1000);
        expect(resize).toHaveBeenCalledWith(2, 0);
        bindings.set(2, {});
        resume();
        await run(1200);
        expect(state().refused.has(2)).toBe(false);
        await run(2000);
        expect(resized).toEqual([[2, 0]]);
    });
});

describe('a texture whose full size the loader learns only after streaming first sees it', () => {
    beforeEach(() => {
        dims.clear();
        for (const [handle, edge] of FILES) dims.set(handle, { width: edge, height: edge });
        wants = '';
        clock.now = 0;
        DECODES_AT_MOST.clear();
        KNOWN_FULL.clear();
    });

    it('is moved to the size its views need once, not back and forth', async () => {
        const { resized, run } = harness();
        KNOWN_FULL.set(1, 4);
        for (const at of [1000, 4500, 5000, 5500, 6000, 9500, 10000, 10500]) {
            wants = '1:100';
            await run(at);
        }
        expect(resized.filter(([handle]) => handle === 1).length).toBeLessThanOrEqual(2);
        expect(dims.get(1)!.width).toBe(128);
    });
});
