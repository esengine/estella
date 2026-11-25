// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, describe, expect, it, vi } from 'vitest';

// The density map is read through this; a test holds the read to keep a field's new generation from being made.
let held: Promise<void> | null = null;
vi.mock('../src/terrain/layerArrays', async (original) => {
    const real = await original<typeof import('../src/terrain/layerArrays')>();
    return {
        ...real,
        imagePixelsAt: async () => {
            if (held) await held;
            return { width: 1, height: 1, pixels: new Uint8Array([255, 255, 255, 255]) };
        },
    };
});

import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { setEditorMode, setPlayMode } from '../src/ecs/env';
import { Transform, MeshRenderer } from '../src/ecs/component';
import { Assets } from '../src/asset/AssetPlugin';
import { Foliage, FoliagePlugin } from '../src/foliage/foliagePlugin';
import { WorldStreamingSource } from '../src/residency/components';
import { Material } from '../src/render/material';
import { createMockModule } from './mocks/wasm';

const frames = async (app: App, n: number) => { for (let i = 0; i < n; i++) { app.tick(1 / 60); await new Promise((r) => setTimeout(r, 0)); } };

function boot() {
    setDefaultContext(new AppContext()); setEditorMode(false); setPlayMode(false);
    const app = App.new(), module = createMockModule(); app.connectCpp(module.getRegistry(), module);
    let handle = 1;
    app.insertResource(Assets, { createMesh: () => handle++, releaseBuiltMesh: () => {}, onSourceChanged: () => () => {}, sourceIdentity: (p: string) => p } as never);
    app.addPlugin(new FoliagePlugin());
    const source = app.world.spawn();
    app.world.insert(source, Transform); app.world.insert(source, WorldStreamingSource, { ...WorldStreamingSource._default });
    const entity = app.world.spawn(); app.world.insert(entity, Transform);
    app.world.insert(entity, Foliage, { ...Foliage._default, sizeX: 40, sizeZ: 40, cellSize: 20, count: 12, drawDistance: 100,
        castShadows: false, material: 7, densityMap: 'density.png' });
    return { app, entity };
}

afterEach(() => { held = null; vi.restoreAllMocks(); });

function spies() {
    let next = 100;
    const released = new Set<number>();
    vi.spyOn(Material, 'createInstance').mockImplementation(() => next++);
    vi.spyOn(Material, 'release').mockImplementation((h: number) => { released.add(h); });
    vi.spyOn(Material, 'setUniform').mockImplementation(() => {});
    vi.spyOn(Material, 'get').mockImplementation(() => undefined);
    return released;
}

describe('a Foliage that changes its material', () => {
    it('moves the cells standing to the new material at once, and lets the old instance go', async () => {
        const released = spies();
        const { app, entity } = boot();
        await frames(app, 16);
        const cells = () => app.world.getEntitiesWithComponents([MeshRenderer]);
        expect(cells().length).toBeGreaterThan(0);
        const old = app.world.get(cells()[0]!, MeshRenderer).material;
        expect(old).toBe(100);

        // A new material, and its generation held back: the old cells stand on. They draw with the new instance from the frame the
        // material changed, so none is left on an instance whose material may already be gone.
        held = new Promise<void>(() => {});
        app.world.insert(entity, Foliage, { ...app.world.get(entity, Foliage), material: 8, densityMap: 'density2.png' });
        await frames(app, 2);
        expect(cells().length).toBeGreaterThan(0);
        for (const e of cells()) expect(app.world.get(e, MeshRenderer).material).toBe(101);
        await frames(app, 610);
        expect(released.has(old)).toBe(true);
        for (const e of cells()) expect(released.has(app.world.get(e, MeshRenderer).material)).toBe(false);
    }, 30_000);

    it('keeps the old instance, where the cells cannot move to the new look, until no cell standing draws with it', async () => {
        const released = spies();
        const { app, entity } = boot();
        await frames(app, 16);
        const cells = () => app.world.getEntitiesWithComponents([MeshRenderer]);
        const old = app.world.get(cells()[0]!, MeshRenderer).material;

        // No material: the plants are painted in their own colours, a geometry the old cells do not have. They stand on with the old
        // instance, longer than the 600 frames a retired one waited, and it is not let go under them.
        let let_go!: () => void;
        held = new Promise<void>((r) => { let_go = r; });
        app.world.insert(entity, Foliage, { ...app.world.get(entity, Foliage), material: 0, densityMap: 'density2.png' });
        for (let i = 0; i < 700; i += 50) {
            await frames(app, 50);
            for (const e of cells()) {
                const m = app.world.get(e, MeshRenderer).material;
                expect(released.has(m), `cell ${e} draws with instance ${m}, already released`).toBe(false);
            }
        }
        expect(cells().some((e) => app.world.get(e, MeshRenderer).material === old)).toBe(true);

        // Once the new cells stand, nothing draws with the old instance and it is let go.
        let_go(); held = null;
        await frames(app, 40);
        expect(cells().every((e) => app.world.get(e, MeshRenderer).material !== old)).toBe(true);
        await frames(app, 610);
        expect(released.has(old)).toBe(true);
    }, 30_000);
});
