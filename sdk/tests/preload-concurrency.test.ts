// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it, vi } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { defineComponent } from '../src/ecs/component';
import type { SceneData } from '../src/scene/scene';
import { runWithConcurrency } from '../src/util/runWithConcurrency';
import type { ESEngineModule } from '../src/wasm';

const fixtureType = 'preload-fixture';
const fixtureComponent = defineComponent('PreloadFixture', { files: [] as string[] }, {
    discoverAssets: data => (data.files as string[]).map(path => ({ type: fixtureType, path })),
});

function fixture() {
    let active = 0;
    let peak = 0;
    const load = vi.fn(async (path: string) => {
        peak = Math.max(peak, ++active);
        await Promise.resolve();
        active--;
        if (path === 'failed.preloadfixture') throw new Error('missing data');
        return { path };
    });
    const unload = vi.fn();
    const assets = Assets.create({
        backend: { resolveUrl: path => path, fetchText: async () => '', fetchBinary: async () => new ArrayBuffer(0) },
        module: {} as ESEngineModule,
    });
    assets.register({ type: fixtureType, extensions: ['.preloadfixture'], load, unload });
    const files = ['first.preloadfixture', 'second.preloadfixture', 'failed.preloadfixture', 'last.preloadfixture'];
    const scene: SceneData = { version: '1.0', name: 'Concurrent loads', entities: [
        { id: 1, name: 'Assets', parent: null, children: [], components: [
            { type: fixtureComponent._name, data: { files } },
        ] },
    ] };
    return { assets, files, scene, load, unload, peak: () => peak };
}

describe.each(['explicit refs', 'scene dependencies'])('%s preload concurrency', entry => {
    it.each([[4, 4], [2.5, 2], [0, 1], [NaN, 1], [Infinity, 4]])(
        'uses limit %s with %s concurrent loaders and counts every attempted asset', async (maxConcurrent, expectedPeak) => {
            const { assets, files, scene, load, unload, peak } = fixture();
            const progress = vi.fn();
            try {
                const result = entry === 'explicit refs'
                    ? (await assets.preload(files, progress, { maxConcurrent })).failed
                    : await assets.preloadSceneAssets(scene, progress, { maxConcurrent, summary: 'debug' });
                try {
                    expect(load.mock.calls.map(([path]) => path)).toEqual(files);
                    expect(peak()).toBe(expectedPeak);
                    expect(progress.mock.calls).toEqual([[0, 4], [1, 4], [2, 4], [3, 4], [4, 4]]);
                    expect(Array.isArray(result) ? result : result.missing).toEqual([
                        expect.objectContaining({ ref: files[2], type: fixtureType, reason: 'load-failed' }),
                    ]);
                } finally {
                    if (!Array.isArray(result)) result.scope.releaseAll();
                }
                if (!Array.isArray(result)) expect(unload).toHaveBeenCalledTimes(3);
            } finally { assets.releaseAll(); }
        },
    );
});

it('stops dispatching after a worker fails and waits for active tasks to finish', async () => {
    let finish!: () => void;
    const active = new Promise<void>(resolve => { finish = resolve; });
    const error = new Error('task failed');
    const queued = vi.fn(async () => {});
    const settled = vi.fn();
    const work = runWithConcurrency([() => active, async () => { throw error; }, queued], 2);
    void work.then(settled, settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    expect(queued).not.toHaveBeenCalled();
    finish();
    await expect(work).rejects.toBe(error);
    expect(queued).not.toHaveBeenCalled();
});
