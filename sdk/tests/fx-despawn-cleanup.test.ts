// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The FX plugins keep per-entity state outside the ECS (authored
 *        geometry, gradient/curve maps, native trail history). Despawning an
 *        entity must drop that state — the world.onDespawn pattern the
 *        audio/video/spine plugins already follow.
 */
import { describe, it, expect, vi } from 'vitest';
import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { setEditorMode, setPlayMode } from '../src/util/env';
import { createMockModule } from './mocks/wasm';
import { Mesh2DPlugin, Meshes2D } from '../src/render/mesh2d';
import { ParticlePlugin } from '../src/particle/ParticlePlugin';
import { TrailPlugin } from '../src/trail/TrailPlugin';
import { TrailRenderer } from '../src/ecs/component';
import type { ESEngineModule } from '../src/wasm';

// Like bootMockApp, but connects through App so plugins see app.wasmModule.
function bootApp(): { app: App; module: ESEngineModule } {
    setDefaultContext(new AppContext());
    setEditorMode(false);
    setPlayMode(false);
    const app = App.new();
    const module = createMockModule();
    app.connectCpp(module.getRegistry(), module);
    return { app, module };
}

function withAllocator(module: ESEngineModule): void {
    const heap = new Uint8Array(1 << 16);
    let brk = 16;
    const m = module as unknown as Record<string, unknown>;
    m._malloc = (size: number) => { const p = brk; brk = (brk + size + 15) & ~15; return p; };
    m._free = () => {};
    m.HEAPU8 = heap;
}

describe('FX per-entity state on despawn', () => {
    it('Mesh2D: despawn drops the authored geometry entry', () => {
        const { app, module } = bootApp();
        withAllocator(module);
        (module as unknown as Record<string, unknown>).mesh2d_setGeometry = vi.fn();

        app.addPlugin(new Mesh2DPlugin());
        const api = app.getResource(Meshes2D);
        const e = app.world.spawn();
        api.setGeometry(e, { positions: [0, 0, 1, 0, 0, 1], indices: [0, 1, 2] });
        expect(api.getGeometry(e)).toBeDefined();

        app.world.despawn(e);
        expect(api.getGeometry(e)).toBeUndefined();
    });

    it('Particle: despawn drops gradient/size-curve entries and clears the native LUTs', () => {
        const { app, module } = bootApp();
        const setColorLut = vi.fn();
        const setSizeLut = vi.fn();
        const m = module as unknown as Record<string, unknown>;
        m.particle_set_color_lut = setColorLut;
        m.particle_set_size_lut = setSizeLut;

        const plugin = new ParticlePlugin();
        app.addPlugin(plugin);
        const e = app.world.spawn();
        const other = app.world.spawn();
        const gradients = (plugin as unknown as { gradients_: Map<number, unknown> }).gradients_;
        const sizeCurves = (plugin as unknown as { sizeCurves_: Map<number, unknown> }).sizeCurves_;
        gradients.set(e as number, { stops: [{ t: 0, color: { r: 1, g: 1, b: 1, a: 1 } }] });
        gradients.set(other as number, { stops: [{ t: 0, color: { r: 1, g: 1, b: 1, a: 1 } }] });
        sizeCurves.set(e as number, { keys: [{ t: 0, v: 1 }] });

        app.world.despawn(e);

        expect(gradients.has(e as number)).toBe(false);
        expect(sizeCurves.has(e as number)).toBe(false);
        expect(gradients.has(other as number)).toBe(true);
        expect(setColorLut).toHaveBeenCalledWith(e, 0, 0);
        expect(setSizeLut).toHaveBeenCalledWith(e, 0, 0);
    });

    it('Trail: despawn clears native history only for entities with TrailRenderer', () => {
        const { app, module } = bootApp();
        const trailClear = vi.fn();
        (module as unknown as Record<string, unknown>).trail_clear = trailClear;

        app.addPlugin(new TrailPlugin());
        const withTrail = app.world.spawn();
        app.world.insert(withTrail, TrailRenderer);
        const without = app.world.spawn();

        app.world.despawn(without);
        expect(trailClear).not.toHaveBeenCalled();

        app.world.despawn(withTrail);
        expect(trailClear).toHaveBeenCalledTimes(1);
        expect(trailClear.mock.calls[0][1]).toBe(withTrail);
    });
});
