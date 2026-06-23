// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    scene-load-failure.test.ts
 * @brief   Scene lifecycle robustness on failure paths:
 *          (1) a load that throws partway must NOT wedge the scene — a retry has
 *              to start fresh (not resolve to undefined forever), and any
 *              entities spawned before the throw must be cleaned up;
 *          (2) a user `cleanup` callback that throws must NOT abort unload's
 *              entity teardown (which would leak the scene's entities).
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

vi.mock('../src/scene', () => ({
    loadSceneWithAssets: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock('../src/customDraw', () => ({
    registerDrawCallback: vi.fn(),
    unregisterDrawCallback: vi.fn(),
}));
vi.mock('../src/postprocess', () => ({
    PostProcess: { bind: vi.fn(), unbind: vi.fn() },
    PostProcessStack: vi.fn(),
}));
vi.mock('../src/material', () => ({
    Material: { release: vi.fn(), createShader: vi.fn() },
    defineResource: vi.fn(),
}));
vi.mock('../src/asset', () => ({
    Assets: {
        releaseTexture: vi.fn(),
        releaseFont: vi.fn(),
        releaseMaterial: vi.fn(),
        releaseAll: vi.fn(),
    },
    discoverSceneAssets: vi.fn().mockReturnValue({ textures: [], fonts: [], spines: [], audios: [], unresolved: [] }),
    preloadSceneAssets: vi.fn().mockResolvedValue({ loadedTextures: new Set(), loadedFonts: new Set(), loadedMaterials: new Set(), missing: [] }),
}));

import { SceneManagerState } from '../src/sceneManager';

const SCENE_DATA = { version: '1.0', name: 'Test', entities: [] };

function createMockApp() {
    const entities = new Map<number, Map<symbol, any>>();
    let nextEntity = 1;
    const resources = new Map<any, any>();

    const world = {
        spawn: vi.fn(() => {
            const e = nextEntity++;
            entities.set(e, new Map());
            return e;
        }),
        despawn: vi.fn((e: number) => entities.delete(e)),
        valid: vi.fn((e: number) => entities.has(e)),
        has: vi.fn((e: number, comp: symbol) => entities.get(e)?.has(comp) ?? false),
        get: vi.fn((e: number, comp: symbol) => entities.get(e)?.get(comp)),
        insert: vi.fn((e: number, comp: symbol, data: any) => {
            if (!entities.has(e)) entities.set(e, new Map());
            entities.get(e)!.set(comp, data);
        }),
        set: vi.fn((e: number, comp: symbol, data: any) => {
            if (!entities.has(e)) entities.set(e, new Map());
            entities.get(e)!.set(comp, data);
        }),
        remove: vi.fn((e: number, comp: symbol) => {
            entities.get(e)?.delete(comp);
        }),
    };

    return {
        world,
        liveEntityCount: () => entities.size,
        hasResource: vi.fn((key: any) => resources.has(key)),
        getResource: vi.fn((key: any) => resources.get(key)),
        addSystemToSchedule: vi.fn(),
    };
}

describe('SceneManager load-failure recovery', () => {
    let app: ReturnType<typeof createMockApp>;
    let manager: SceneManagerState;

    beforeEach(() => {
        app = createMockApp();
        manager = new SceneManagerState(app as any);
    });

    it('a scene that fails to load can be retried — it does not wedge forever', async () => {
        let attempts = 0;
        manager.register({
            name: 'flaky',
            data: SCENE_DATA,
            setup: () => { attempts++; if (attempts === 1) throw new Error('transient load failure'); },
        });

        // First attempt fails...
        await expect(manager.load('flaky')).rejects.toThrow(/transient load failure/);

        // ...and a retry must start FRESH and succeed. Before the fix the stuck
        // status==='loading' instance (whose loadPromise was deleted) made every
        // retry resolve to `undefined`, so the scene could never be loaded again.
        const ctx = await manager.load('flaky');
        expect(ctx).toBeDefined();
        expect(ctx.name).toBe('flaky');
        expect(attempts).toBe(2);
    });

    it('loadAdditive has the same retry recovery', async () => {
        let attempts = 0;
        manager.register({
            name: 'flaky-add',
            data: SCENE_DATA,
            setup: () => { attempts++; if (attempts === 1) throw new Error('transient'); },
        });

        await expect(manager.loadAdditive('flaky-add')).rejects.toThrow(/transient/);
        const ctx = await manager.loadAdditive('flaky-add');
        expect(ctx).toBeDefined();
        expect(attempts).toBe(2);
    });

    it('despawns entities spawned before the throw (no orphan leak)', async () => {
        const spawned: number[] = [];
        manager.register({
            name: 'partial',
            data: SCENE_DATA,
            setup: (ctx) => {
                spawned.push(ctx.spawn(), ctx.spawn());
                throw new Error('failed after spawning');
            },
        });

        await expect(manager.load('partial')).rejects.toThrow(/failed after spawning/);

        expect(spawned).toHaveLength(2);
        for (const e of spawned) expect(app.world.despawn).toHaveBeenCalledWith(e);
        expect(app.liveEntityCount()).toBe(0); // nothing left orphaned
    });
});

describe('SceneManager unload teardown robustness', () => {
    let app: ReturnType<typeof createMockApp>;
    let manager: SceneManagerState;

    beforeEach(() => {
        app = createMockApp();
        manager = new SceneManagerState(app as any);
    });

    it('still despawns the scene entities when a cleanup callback throws', async () => {
        const spawned: number[] = [];
        manager.register({
            name: 'leaky',
            data: SCENE_DATA,
            setup: (ctx) => { spawned.push(ctx.spawn(), ctx.spawn()); },
            cleanup: () => { throw new Error('cleanup blew up'); },
        });
        await manager.load('leaky');
        expect(app.liveEntityCount()).toBe(2);

        // A throwing cleanup must not abort teardown (which would leak entities).
        await expect(manager.unload('leaky')).resolves.toBeUndefined();

        for (const e of spawned) expect(app.world.despawn).toHaveBeenCalledWith(e);
        expect(app.liveEntityCount()).toBe(0);
    });
});
