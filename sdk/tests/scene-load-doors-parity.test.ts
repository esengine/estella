// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  load() and loadAdditive() are one path, and must stay one.
 *
 * They were two copies of forty lines differing in three, which is how the fix
 * for re-loading a SLEPT scene reached only one of them: additive flipped the
 * status bit without the restore, so those entities stayed Disabled forever and
 * wake() — which requires status 'sleeping' — became a permanent no-op.
 *
 * Everything here is asserted of BOTH doors from one table. Adding a third
 * entry point means adding it to the table, and a behaviour that diverges again
 * fails on the door that lost it rather than on nobody.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

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
vi.mock('../src/asset', () => ({
    Assets: {
        releaseTexture: vi.fn(), releaseFont: vi.fn(),
        releaseMaterial: vi.fn(), releaseAll: vi.fn(),
    },
    discoverSceneAssets: vi.fn().mockReturnValue({ textures: [], fonts: [], spines: [], audios: [], unresolved: [] }),
    preloadSceneAssets: vi.fn().mockResolvedValue({
        loadedTextures: new Set(), loadedFonts: new Set(), loadedMaterials: new Set(), missing: [],
    }),
}));

import { SceneManagerState } from '../src/scene/sceneManager';
import { Disabled } from '../src/ecs/component';

const SCENE_DATA = { version: '1.0', name: 'Test', entities: [] };

function createMockApp() {
    const entities = new Map<number, Map<symbol, unknown>>();
    let nextEntity = 1;
    const resources = new Map<unknown, unknown>();
    const world = {
        spawn: vi.fn(() => { const e = nextEntity++; entities.set(e, new Map()); return e; }),
        despawn: vi.fn((e: number) => entities.delete(e)),
        valid: vi.fn((e: number) => entities.has(e)),
        has: vi.fn((e: number, c: symbol) => entities.get(e)?.has(c) ?? false),
        get: vi.fn((e: number, c: symbol) => entities.get(e)?.get(c)),
        insert: vi.fn((e: number, c: symbol, d: unknown) => { entities.get(e)?.set(c, d); }),
        set: vi.fn((e: number, c: symbol, d: unknown) => { entities.get(e)?.set(c, d); }),
        remove: vi.fn((e: number, c: symbol) => { entities.get(e)?.delete(c); }),
    };
    return {
        world,
        hasResource: vi.fn((k: unknown) => resources.has(k)),
        getResource: vi.fn((k: unknown) => resources.get(k)),
        addSystemToSchedule: vi.fn(),
    };
}

/** Every public door onto the load path, and what it is supposed to adopt into. */
const DOORS = [
    { name: 'load', open: (m: SceneManagerState, s: string) => m.load(s), adopts: 'active' },
    { name: 'loadAdditive', open: (m: SceneManagerState, s: string) => m.loadAdditive(s), adopts: 'additive' },
] as const;

describe.each(DOORS)('$name', (door) => {
    let app: ReturnType<typeof createMockApp>;
    let manager: SceneManagerState;

    beforeEach(() => {
        app = createMockApp();
        manager = new SceneManagerState(app as never);
    });

    /** A scene with one entity, so sleep/wake has something observable to do. */
    async function loadWithEntity(name: string): Promise<number> {
        let entity = 0;
        manager.register({ name, data: SCENE_DATA, setup: (ctx) => { entity = ctx.spawn(); } });
        await door.open(manager, name);
        return entity;
    }

    it('restores a slept scene rather than flipping its status bit', async () => {
        const entity = await loadWithEntity('napping');
        manager.sleep('napping');
        expect(manager.isSleeping('napping'), 'sleep did not take').toBe(true);
        expect(app.world.has(entity, Disabled as never), 'sleep did not disable').toBe(true);

        await door.open(manager, 'napping');

        expect(manager.isSleeping('napping'), 'still registered as sleeping').toBe(false);
        expect(
            app.world.has(entity, Disabled as never),
            'the entity is still Disabled — the status bit was flipped without the restore',
        ).toBe(false);
    });

    it('restores a paused scene', async () => {
        await loadWithEntity('halted');
        manager.pause('halted');
        expect(manager.isPaused('halted')).toBe(true);

        await door.open(manager, 'halted');

        expect(manager.isPaused('halted'), 'still registered as paused').toBe(false);
    });

    it('adopts the scene into its own set', async () => {
        await loadWithEntity('fresh');
        expect(manager.isActive('fresh')).toBe(door.adopts === 'active');
    });

    it('joins an in-flight load instead of starting a second one', async () => {
        let setups = 0;
        manager.register({ name: 'shared', data: SCENE_DATA, setup: () => { setups++; } });
        const [a, b] = await Promise.all([door.open(manager, 'shared'), door.open(manager, 'shared')]);
        expect(setups, 'the scene was set up twice').toBe(1);
        expect(a).toBe(b);
    });

    it('recovers from a failed load on retry', async () => {
        let attempts = 0;
        manager.register({
            name: 'flaky',
            data: SCENE_DATA,
            setup: () => { attempts++; if (attempts === 1) throw new Error('transient'); },
        });
        await expect(door.open(manager, 'flaky')).rejects.toThrow(/transient/);
        expect(await door.open(manager, 'flaky')).toBeDefined();
        expect(attempts).toBe(2);
    });
});
