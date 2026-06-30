// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  load()/loadAdditive() forward an onProgress callback to the scene loader,
 *        so a loading screen can track per-asset progress through the manager.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/scene', () => ({
    // Invoke the caller's onProgress so we can assert the manager forwarded it.
    loadSceneWithAssets: vi.fn((_w: unknown, _d: unknown, opts: { onProgress?: (l: number, t: number) => void }) => {
        opts?.onProgress?.(3, 3);
        return Promise.resolve(new Map());
    }),
}));
vi.mock('../src/customDraw', () => ({ registerDrawCallback: vi.fn(), unregisterDrawCallback: vi.fn() }));
vi.mock('../src/postprocess', () => ({ PostProcess: { bind: vi.fn(), unbind: vi.fn() }, PostProcessStack: vi.fn() }));
vi.mock('../src/material', () => ({ Material: { release: vi.fn(), createShader: vi.fn() }, defineResource: vi.fn() }));

import { SceneManagerState } from '../src/sceneManager';

function createMockApp() {
    const entities = new Map<number, Map<symbol, unknown>>();
    let next = 1;
    const world = {
        spawn: vi.fn(() => { const e = next++; entities.set(e, new Map()); return e; }),
        despawn: vi.fn((e: number) => entities.delete(e)),
        valid: vi.fn((e: number) => entities.has(e)),
        has: vi.fn(() => false),
        get: vi.fn(() => undefined),
        insert: vi.fn(),
        set: vi.fn(),
        remove: vi.fn(),
    };
    return { world, hasResource: vi.fn(() => false), getResource: vi.fn(), addSystemToSchedule: vi.fn() };
}

const sceneData = { version: '1.0', name: 'lvl', entities: [] };

describe('SceneManager load progress forwarding', () => {
    it('load() forwards onProgress to the scene loader', async () => {
        const manager = new SceneManagerState(createMockApp() as never);
        manager.register({ name: 'lvl', data: sceneData });
        const cb = vi.fn();
        await manager.load('lvl', cb);
        expect(cb).toHaveBeenCalledWith(3, 3);
    });

    it('loadAdditive() forwards onProgress to the scene loader', async () => {
        const manager = new SceneManagerState(createMockApp() as never);
        manager.register({ name: 'lvl2', data: { ...sceneData, name: 'lvl2' } });
        const cb = vi.fn();
        await manager.loadAdditive('lvl2', cb);
        expect(cb).toHaveBeenCalledWith(3, 3);
    });

    it('load() without a callback still loads', async () => {
        const manager = new SceneManagerState(createMockApp() as never);
        manager.register({ name: 'lvl3', data: { ...sceneData, name: 'lvl3' } });
        await expect(manager.load('lvl3')).resolves.toBeDefined();
    });
});
