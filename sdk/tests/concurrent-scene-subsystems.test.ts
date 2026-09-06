// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Two scenes arriving in one tick install one subsystem between them.
 *
 * Every self-gating install in the runtime loader is a check, an await for the
 * module, then an addPlugin — and both scenes pass the check before either
 * reaches the plugin. Scene switching made that rare; world streaming makes it
 * ordinary, because a source stepping into a corner asks for several cells at
 * once. Nine of them installed the 3D world nine times, and each install
 * replaced the runtime resource the previous one's systems were writing into:
 * 180 colliders live in the ECS and not one of them in the physics world.
 */
import { describe, it, expect } from 'vitest';
import { loadRuntimeScene } from '../src/runtime/runtimeLoader';
import { Physics3DPlugin } from '../src/physics3d/Physics3DPlugin';
import { World } from '../src/ecs/world';
import type { App } from '../src/app/app';
import type { Backend } from '../src/asset/Backend';
import type { ESEngineModule } from '../src/wasm';
import type { SceneData } from '../src/scene/scene';

const fakeModule = { _malloc: () => 0, _free: () => {} } as unknown as ESEngineModule;
const fakeBackend = {
    resolveUrl: (p: string) => p,
    fetchText: async () => '',
    fetchBinary: async () => new ArrayBuffer(0),
} as unknown as Backend;

/** A side-module host that takes a turn to answer — the window the race lives in. */
function makeFakeApp(acquired: string[]) {
    const resources = new Map<unknown, unknown>();
    const plugins: object[] = [];
    const app = {
        world: new World(),
        hasResource: (r: unknown) => resources.has(r),
        getResource: (r: unknown) => resources.get(r),
        insertResource: (r: unknown, v: unknown) => { resources.set(r, v); },
        addPlugin: (p: object) => { plugins.push(p); },
        getPlugin: (kind: abstract new (...args: never[]) => object) =>
            plugins.find((p) => p instanceof kind) ?? null,
        sideModules: {
            acquire: async (id: string) => {
                acquired.push(id);
                await Promise.resolve();
                await Promise.resolve();
                return fakeModule;
            },
        },
    } as unknown as App;
    return { app, plugins };
}

/** A cell's worth of scene: one entity carrying a 3D body. */
const cell = (name: string): SceneData => ({
    version: '1.0',
    name,
    entities: [{
        id: 1, name: 'Prop', parent: null, children: [], visible: true,
        components: [{ type: 'RigidBody3D', data: { bodyType: 0 } }],
    }],
});

const load = (app: App, sceneData: SceneData): Promise<void> => loadRuntimeScene({
    app,
    module: fakeModule,
    sceneData,
    source: {
        backend: fakeBackend,
        decodePixels: () => Promise.reject(new Error('no textures here')),
    },
    spineManager: null,
});

describe('subsystems a scene installs for itself', () => {
    it('are installed once when several cells arrive together', async () => {
        const acquired: string[] = [];
        const { app, plugins } = makeFakeApp(acquired);

        // Concurrently, which is what residency does: one reconciliation asks for
        // every cell that came into range this frame.
        await Promise.all([cell('c0'), cell('c1'), cell('c2'), cell('c3')].map((s) => load(app, s)));

        const installed = plugins.filter((p) => p instanceof Physics3DPlugin);
        expect(installed).toHaveLength(1);
        expect(acquired.filter((id) => id === 'physics3d')).toHaveLength(1);
    });

    it('and a later cell reuses the one already there', async () => {
        const acquired: string[] = [];
        const { app, plugins } = makeFakeApp(acquired);
        await load(app, cell('first'));
        await load(app, cell('second'));
        expect(plugins.filter((p) => p instanceof Physics3DPlugin)).toHaveLength(1);
    });

    it('installs for a cell that needs it even when the one before did not', async () => {
        // The latch must not swallow a decision: the first scene has no bodies,
        // so what it finished tells the second nothing about what IT needs.
        const acquired: string[] = [];
        const { app, plugins } = makeFakeApp(acquired);
        const plain: SceneData = { version: '1.0', name: 'plain', entities: [] };
        await Promise.all([load(app, plain), load(app, cell('withBodies'))]);
        expect(plugins.filter((p) => p instanceof Physics3DPlugin)).toHaveLength(1);
    });
});
