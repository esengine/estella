// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it, vi } from 'vitest';
import type { App } from '../src/app/app';
import type { ESEngineModule } from '../src/wasm';
import { parseQualityConfig } from '../src/render/quality';
import { holdShaderWarmup, pendingShaders, shadersCompiled, warmShaders } from '../src/render/shaderWarmup';

/** A module whose compile queue drains by one on every read after `drainAfter` reads. */
function moduleWithQueue(initial: number, drainEvery = 1): ESEngineModule {
    let left = initial;
    let reads = 0;
    return {
        renderer_getPendingShaders: () => {
            const now = left;
            if (++reads % drainEvery === 0 && left > 0) --left;
            return now;
        },
    } as unknown as ESEngineModule;
}

function appOf(module: ESEngineModule | null): { app: App; stepFrames: ReturnType<typeof vi.fn> } {
    const stepFrames = vi.fn(async () => {});
    return { app: { wasmModule: module, stepFrames } as unknown as App, stepFrames };
}

describe('shader warm-up', () => {
    it('reports 0 where the core does not compile in the background', () => {
        expect(pendingShaders(null)).toBe(0);
        expect(pendingShaders({} as ESEngineModule)).toBe(0);
        expect(pendingShaders(moduleWithQueue(3))).toBe(3);
        expect(pendingShaders(appOf(moduleWithQueue(2)).app)).toBe(2);
    });

    it('draws frames until the queue is empty and stays quiet for the settle frames', async () => {
        const { app, stepFrames } = appOf(moduleWithQueue(3));
        const seen: number[] = [];
        const result = await warmShaders(app, { settleFrames: 2, onProgress: (n) => seen.push(n) });
        expect(result.timedOut).toBe(false);
        expect(result.pending).toBe(0);
        expect(result.frames).toBe(stepFrames.mock.calls.length);
        expect(seen.slice(-2)).toEqual([0, 0]);
        expect(seen.some((n) => n > 0)).toBe(true);
    });

    it('waits for what is still being made, though nothing is compiling', async () => {
        // Content that arrives later asks for shaders nobody has asked for yet: the queue being empty for a few frames is not the scene being ready.
        const { app, stepFrames } = appOf(moduleWithQueue(0));
        let making = 6;
        const release = holdShaderWarmup(app, () => making > 0);
        stepFrames.mockImplementation(async () => { if (making > 0) --making; });
        const held = await warmShaders(app, { settleFrames: 2 });
        expect(held.timedOut).toBe(false);
        expect(held.frames).toBe(6 + 1);

        // A hold that never lets go is bounded by the timeout, and one taken away holds nothing.
        making = Infinity;
        expect((await warmShaders(app, { timeoutMs: 40 })).timedOut).toBe(true);
        release();
        expect((await warmShaders(app, { settleFrames: 2, timeoutMs: 400 })).frames).toBe(2);

        // A hold that counts says how much is left, for a loading screen to show going down; one that only says yes is one thing.
        let pages = 3;
        const off = [holdShaderWarmup(app, () => pages), holdShaderWarmup(app, () => pages > 1)];
        stepFrames.mockImplementation(async () => { if (pages > 0) --pages; });
        const left: number[] = [];
        await warmShaders(app, { settleFrames: 1, onProgress: (_pending, making) => left.push(making) });
        expect(left).toEqual([3, 1, 0]);
        off.forEach((f) => f());
    });

    it('does nothing where there is nothing to wait for', async () => {
        const { app, stepFrames } = appOf({} as ESEngineModule);
        expect(await warmShaders(app)).toEqual({ frames: 0, ms: 0, pending: 0, timedOut: false });
        expect(stepFrames).not.toHaveBeenCalled();
    });

    it('gives up at the timeout instead of holding the loading screen', async () => {
        const stuck = { renderer_getPendingShaders: () => 2 } as unknown as ESEngineModule;
        const { app } = appOf(stuck);
        const result = await warmShaders(app, { timeoutMs: 40 });
        expect(result.timedOut).toBe(true);
        expect(result.pending).toBe(2);
    });

    it('shadersCompiled resolves true once drained and false on timeout', async () => {
        expect(await shadersCompiled(moduleWithQueue(2), 2000)).toBe(true);
        expect(await shadersCompiled({ renderer_getPendingShaders: () => 1 } as unknown as ESEngineModule, 30)).toBe(false);
        expect(await shadersCompiled(null)).toBe(true);
    });

    it('is configured from the package quality config', () => {
        const off = parseQualityConfig({});
        expect(off?.prewarmShaders).toBeFalsy();
        const on = parseQualityConfig({ asyncShaderCompile: true, prewarmShaders: true, prewarmTimeoutMs: 5000 });
        expect(on?.prewarmShaders).toBe(true);
        expect(on?.prewarmTimeoutMs).toBe(5000);
        expect(parseQualityConfig({ prewarmTimeoutMs: 5 })?.prewarmTimeoutMs).toBe(1000);
    });
});
