// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A faded switch and a plain one differ by the overlay, nothing else.
 *
 * They were two copies of the same swap holding two different locks — the faded
 * path only `isTransitioning`, the plain one only `switching_` — so "one switch
 * at a time" was two invariants that happened to agree. Every claim below is
 * made of both modes from one table; a third transition means a third row.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

vi.mock('../src/scene/scene', () => ({
    loadSceneWithAssets: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock('../src/render/customDraw', () => ({
    registerDrawCallback: vi.fn(), unregisterDrawCallback: vi.fn(),
}));
vi.mock('../src/postprocess', () => ({
    PostProcess: { bind: vi.fn(), unbind: vi.fn() }, PostProcessStack: vi.fn(),
}));
vi.mock('../src/render/material', () => ({
    Material: { release: vi.fn(), createShader: vi.fn() }, defineResource: vi.fn(),
}));
vi.mock('../src/asset', () => ({
    Assets: { releaseTexture: vi.fn(), releaseTyped: vi.fn(), releaseAll: vi.fn() },
    discoverSceneAssets: vi.fn().mockReturnValue({ byType: new Map() }),
    preloadSceneAssets: vi.fn().mockResolvedValue({ missing: [] }),
}));
vi.mock('../src/asset/discoverAssets', () => ({
    discoverSceneAssets: vi.fn(() => ({ byType: new Map() })),
    getAssetPathsByType: vi.fn(() => new Set()),
}));

import { SceneManagerState } from '../src/scene/sceneManager';
import type { TransitionOptions } from '../src/scene/sceneManager';

const SCENE_DATA = { version: '1.0', name: 'T', entities: [] };

function createMockApp() {
    const live = new Set<number>();
    let next = 1;
    const world = {
        spawn: () => { const e = next++; live.add(e); return e; },
        despawn: (e: number) => { live.delete(e); },
        valid: (e: number) => live.has(e),
        has: () => false,
        get: () => ({ scene: '', persistent: false }),
        insert: () => {}, set: () => {}, remove: () => {},
    };
    return {
        world,
        live,
        hasResource: () => false,
        getResource: () => undefined,
        addSystemToSchedule: () => {},
        removeSystem: () => {},
    };
}

/** Both public transitions, and the pumping a fade needs to get through. */
const MODES: Array<{ name: string; options: TransitionOptions }> = [
    { name: 'plain', options: { transition: 'none' } },
    { name: 'fade', options: { transition: 'fade', duration: 0.2 } },
];

describe.each(MODES)('switchTo ($name)', (mode) => {
    let app: ReturnType<typeof createMockApp>;
    let manager: SceneManagerState;

    beforeEach(() => {
        app = createMockApp();
        manager = new SceneManagerState(app as never);
        for (const name of ['alpha', 'beta']) {
            manager.register({ name, data: SCENE_DATA, setup: (ctx) => { ctx.spawn(); } });
        }
    });

    /** Drive the switch to completion — a fade only advances on updateTransition. */
    async function switchAndSettle(to: string): Promise<void> {
        const done = manager.switchTo(to, mode.options);
        for (let i = 0; i < 60 && manager.isTransitioning(); i++) {
            manager.updateTransition(0.05);
            await Promise.resolve();
        }
        await done;
        // The fade resolves on fade-IN completion, one more pump past the swap.
        for (let i = 0; i < 20 && manager.isTransitioning(); i++) {
            manager.updateTransition(0.05);
            await Promise.resolve();
        }
    }

    it('brings the target up as the active scene', async () => {
        await switchAndSettle('alpha');
        expect(manager.isActive('alpha'), 'the target never became active').toBe(true);
        expect(manager.isLoaded('alpha')).toBe(true);
    });

    it('retires the scene that was active', async () => {
        await switchAndSettle('alpha');
        await switchAndSettle('beta');
        expect(manager.isLoaded('beta')).toBe(true);
        expect(manager.isLoaded('alpha'), 'the outgoing scene was left loaded').toBe(false);
        expect(app.live.size, 'the outgoing scene left entities behind').toBe(1);
    });

    it('ignores a second switch while one is in progress', async () => {
        const first = manager.switchTo('alpha', mode.options);
        await manager.switchTo('beta', mode.options);   // must be refused
        for (let i = 0; i < 60 && manager.isTransitioning(); i++) {
            manager.updateTransition(0.05);
            await Promise.resolve();
        }
        await first;
        expect(manager.isLoaded('beta'), 'a concurrent switch was allowed through').toBe(false);
    });

    it('switching to the scene already active leaves it alone', async () => {
        await switchAndSettle('alpha');
        const before = app.live.size;
        await switchAndSettle('alpha');
        expect(manager.isActive('alpha')).toBe(true);
        expect(app.live.size, 'the active scene was torn down and rebuilt').toBe(before);
    });
});
