// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    sceneManager-race.test.ts
 * @brief   A load that no longer owns its scene slot must not commit anything.
 *
 *          setup() is user code and may await for as long as it likes; an
 *          unload() during it tears the scene down completely. load() re-checked
 *          the slot afterwards and aborted, but loadAdditive() went straight on
 *          to set `running`, add to `additiveScenes_` and push to `loadOrder_` —
 *          resurrecting a scene that had already been unloaded, with whatever
 *          setup() spawned after the teardown left in the world under it.
 *
 *          The interleaving is driven by hand: setup blocks on a deferred
 *          promise, the test unloads while it is blocked, then releases it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/scene/scene', () => ({
    loadSceneWithAssets: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock('../src/render/customDraw', () => ({
    registerDrawCallback: vi.fn(),
    unregisterDrawCallback: vi.fn(),
}));

vi.mock('../src/postprocess', () => ({
    PostProcess: { bind: vi.fn(), unbind: vi.fn() },
    PostProcessStack: vi.fn(),
}));

vi.mock('../src/render/material', () => ({
    Material: { release: vi.fn(), createShader: vi.fn() },
    defineResource: vi.fn(),
}));

vi.mock('../src/render/draw', () => ({
    Draw: { setLayer: vi.fn(), setDepth: vi.fn(), rect: vi.fn() },
}));

vi.mock('../src/ecs/resource', () => ({
    defineResource: vi.fn((_init: unknown, name?: string) => ({
        _id: Symbol(name ?? 'Resource'), _name: name ?? 'Resource', _default: _init,
    })),
}));

vi.mock('../src/ecs/component', () => ({
    SceneOwner: Symbol('SceneOwner'),
    Disabled: { _id: Symbol('Disabled'), _name: 'Disabled', _builtin: false, _default: {} },
    renderableComponents: () => [],
    defineBuiltin: (name: string) => Symbol(name),
    defineTag: (name: string) => ({ _id: Symbol(name), _name: name, _builtin: false, _default: {} }),
}));

vi.mock('../src/asset/AssetPlugin', () => ({ Assets: Symbol('Assets') }));

vi.mock('../src/defaults', () => ({
    RuntimeConfig: {
        sceneTransitionDuration: 0.5,
        sceneTransitionColor: { r: 0, g: 0, b: 0, a: 1 },
    },
}));

import { SceneManagerState, SceneLoadCancelled } from '../src/scene/sceneManager';

interface Deferred {
    promise: Promise<void>;
    resolve: () => void;
}

function deferred(): Deferred {
    let resolve!: () => void;
    const promise = new Promise<void>((res) => { resolve = res; });
    return { promise, resolve };
}

function createMockApp() {
    const alive = new Set<number>();
    let next = 1;
    const world = {
        spawn: vi.fn(() => { const e = next++; alive.add(e); return e; }),
        despawn: vi.fn((e: number) => { alive.delete(e); }),
        valid: vi.fn((e: number) => alive.has(e)),
        has: vi.fn(() => false),
        get: vi.fn(() => undefined),
        insert: vi.fn(),
        set: vi.fn(),
        remove: vi.fn(),
    };
    return {
        world,
        hasResource: vi.fn(() => false),
        getResource: vi.fn(() => undefined),
        addSystemToSchedule: vi.fn(),
        removeSystem: vi.fn(),
        _alive: alive,
    };
}

describe('a load unloaded mid-setup commits nothing', () => {
    let app: ReturnType<typeof createMockApp>;
    let manager: SceneManagerState;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createMockApp();
        manager = new SceneManagerState(app as any);
    });

    /**
     * Registers `name` with a setup() that blocks until `gate` opens. `reached`
     * settles once setup is actually running — without waiting for it the unload
     * lands in the earlier asset-load window instead, which the code has always
     * checked, and the test would pass while proving nothing.
     */
    function registerBlockingScene(name: string, onSetup?: (ctx: any) => void): { gate: Deferred; reached: Deferred } {
        const gate = deferred();
        const reached = deferred();
        manager.register({
            name,
            data: { version: '1.0', name, entities: [] } as any,
            setup: async (ctx: any) => {
                reached.resolve();
                await gate.promise;
                onSetup?.(ctx);
            },
        });
        return { gate, reached };
    }

    it('loadAdditive: unload during setup leaves no trace of the scene', async () => {
        const { gate, reached } = registerBlockingScene('ui');

        const loading = manager.loadAdditive('ui');
        const rejected = expect(loading).rejects.toBeInstanceOf(SceneLoadCancelled);

        await reached.promise;
        await manager.unload('ui');
        gate.resolve();
        await rejected;

        expect(manager.isLoaded('ui')).toBe(false);
        expect(manager.getLoadOrder()).not.toContain('ui');
        expect(manager.getActiveScenes()).not.toContain('ui');
        expect(manager.getSceneStatus('ui')).toBeNull();
        expect(manager.getScene('ui')).toBeNull();
    });

    it('load: unload during setup leaves no trace either', async () => {
        const { gate, reached } = registerBlockingScene('main');

        const loading = manager.load('main');
        const rejected = expect(loading).rejects.toBeInstanceOf(SceneLoadCancelled);

        await reached.promise;
        await manager.unload('main');
        gate.resolve();
        await rejected;

        expect(manager.isLoaded('main')).toBe(false);
        expect(manager.getLoadOrder()).not.toContain('main');
        expect(manager.getActive()).toBeNull();
    });

    it('loadAdditive: entities setup spawned after the teardown are not left behind', async () => {
        let spawned: number | null = null;
        const { gate, reached } = registerBlockingScene('ui', (ctx) => { spawned = ctx.spawn(); });

        const loading = manager.loadAdditive('ui');
        const rejected = expect(loading).rejects.toBeInstanceOf(SceneLoadCancelled);

        await reached.promise;
        await manager.unload('ui');
        gate.resolve();
        await rejected;

        expect(spawned).not.toBeNull();
        // unload() had already run: nothing else will ever come back for this one.
        expect(app._alive.has(spawned!)).toBe(false);
    });

    it('a load nobody interrupted still commits', async () => {
        const { gate, reached } = registerBlockingScene('ui');
        const loading = manager.loadAdditive('ui');
        await reached.promise;
        gate.resolve();
        await loading;

        expect(manager.isLoaded('ui')).toBe(true);
        expect(manager.getLoadOrder()).toContain('ui');
        expect(manager.getSceneStatus('ui')).toBe('running');
    });

    it('the slot is free for a fresh load after the cancelled one', async () => {
        const { gate, reached } = registerBlockingScene('ui');
        const loading = manager.loadAdditive('ui');
        const rejected = expect(loading).rejects.toBeInstanceOf(SceneLoadCancelled);
        await reached.promise;
        await manager.unload('ui');
        gate.resolve();
        await rejected;

        // Re-register without the gate so the retry completes on its own.
        manager.register({
            name: 'ui',
            data: { version: '1.0', name: 'ui', entities: [] } as any,
        });
        await manager.loadAdditive('ui');
        expect(manager.getSceneStatus('ui')).toBe('running');
    });
});
