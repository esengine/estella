/**
 * @file    scene-transition-errors.test.ts
 * @brief   Fade transitions propagate load/unload errors to the switchTo
 *          promise instead of silently resolving after the visual timer.
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

function waitMicrotask(): Promise<void> {
    return new Promise(r => setTimeout(r, 0));
}

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
        hasResource: vi.fn((key: any) => resources.has(key)),
        getResource: vi.fn((key: any) => resources.get(key)),
        addSystemToSchedule: vi.fn(),
    };
}

describe('SceneManager fade transition error handling', () => {
    let app: ReturnType<typeof createMockApp>;
    let manager: SceneManagerState;

    beforeEach(() => {
        app = createMockApp();
        manager = new SceneManagerState(app as any);
    });

    it('rejects switchTo when the new scene fails to load', async () => {
        manager.register({ name: 'start', data: { version: '1.0', name: 'Test', entities: [] } });
        manager.register({
            name: 'boom',
            data: { version: '1.0', name: 'Test', entities: [] },
            setup: () => { throw new Error('setup blew up'); },
        });
        await manager.load('start');

        const promise = manager.switchTo('boom', { transition: 'fade', duration: 0.1 });
        const recorded: unknown[] = [];
        promise.catch(e => { recorded.push(e); });

        // Drive the transition to and through the loading phase.
        manager.updateTransition(0.06);               // fade-out half → loading
        await new Promise(r => setTimeout(r, 10));    // let async setup fail
        manager.updateTransition(0.0);                // loading sees error → reject

        await waitMicrotask();
        await waitMicrotask();

        expect(recorded).toHaveLength(1);
        expect((recorded[0] as Error).message).toMatch(/setup blew up/);
        // Transition state must be cleared even on failure.
        expect(manager.isTransitioning()).toBe(false);
    });

    it('does not resolve the fade promise while loading is still pending', async () => {
        let finishLoad: (() => void) | null = null;
        let loadStartedResolve!: () => void;
        const loadStarted = new Promise<void>(r => { loadStartedResolve = r; });
        manager.register({
            name: 'slow',
            data: { version: '1.0', name: 'Test', entities: [] },
            setup: () => new Promise<void>(resolveSlow => {
                loadStartedResolve();
                finishLoad = resolveSlow;
            }),
        });
        manager.register({ name: 'start', data: { version: '1.0', name: 'Test', entities: [] } });
        await manager.load('start');

        let resolved = false;
        let rejected = false;
        const promise = manager.switchTo('slow', { transition: 'fade', duration: 0.1 });
        promise.then(() => { resolved = true; }, () => { rejected = true; });

        manager.updateTransition(0.06);          // fade-out → loading
        await loadStarted;                        // ensure setup has begun

        // Even if we drive updateTransition well past the full fade duration,
        // the caller's promise must remain pending until load completes.
        for (let i = 0; i < 5; i++) {
            manager.updateTransition(0.1);
            await waitMicrotask();
        }
        expect(resolved).toBe(false);
        expect(rejected).toBe(false);
        expect(manager.isTransitioning()).toBe(true);

        // Complete the load → loading phase observes success → fade-in begins.
        finishLoad!();
        await waitMicrotask();
        await waitMicrotask();
        manager.updateTransition(0.0);           // loading → fade-in
        manager.updateTransition(0.06);          // fade-in done
        await promise;

        expect(resolved).toBe(true);
        expect(manager.isTransitioning()).toBe(false);
    });
});
