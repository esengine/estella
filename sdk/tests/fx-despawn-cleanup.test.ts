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
import { setEditorMode, setPlayMode } from '../src/ecs/env';
import { createMockModule } from './mocks/wasm';
import { MeshRendererPlugin, MeshRenderers } from '../src/render/meshRenderer';
import { ParticlePlugin } from '../src/particle/ParticlePlugin';
import { loadSceneData, serializeScene } from '../src/scene/scene';
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
    it('MeshRenderer: despawn drops the authored geometry entry', () => {
        const { app, module } = bootApp();
        withAllocator(module);
        (module as unknown as Record<string, unknown>).meshRenderer_setGeometry = vi.fn();

        app.addPlugin(new MeshRendererPlugin());
        const api = app.getResource(MeshRenderers);
        const e = app.world.spawn();
        api.setGeometry(e, { positions: [0, 0, 1, 0, 0, 1], indices: [0, 1, 2] });
        expect(api.getGeometry(e)).toBeDefined();

        app.world.despawn(e);
        expect(api.getGeometry(e)).toBeUndefined();
    });

    it('Particle: despawn clears the emitter LUTs and leaves the other emitter authored', () => {
        const { app, module } = bootApp();
        withAllocator(module);
        const setColor = vi.fn(), setSize = vi.fn(), setBursts = vi.fn();
        Object.assign(module, {
            HEAPF32: new Float32Array(module.HEAPU8!.buffer),
            particle_set_color_lut: setColor, particle_set_size_lut: setSize, particle_set_bursts: setBursts,
        });
        app.addPlugin(new ParticlePlugin());
        const fields = { colorGradient: { stops: [{ t: 0, color: { r: 1, g: 1, b: 1, a: 1 } }] },
            sizeCurve: { keys: [{ time: 0, value: 1 }] }, bursts: [{ time: 0, count: 4 }] };
        const entities = [1, 2].map(id => ({ id, name: 'effect ' + id, parent: null, children: [],
            components: [{ type: 'ParticleEmitter', data: fields }] }));
        const loaded = loadSceneData(app.world, { version: 4, name: 'particles', entities });
        const first = loaded.get(1)!;
        for (const setter of [setColor, setSize, setBursts]) {
            expect(setter).toHaveBeenCalledTimes(2);
            setter.mockClear();
        }

        app.world.despawn(first);

        for (const setter of [setColor, setSize, setBursts]) {
            expect(setter.mock.calls).toEqual([[first, 0, 0]]);
        }
        const saved = serializeScene(app.world).entities;
        expect(saved).toHaveLength(1);
        expect(saved[0].components.find(c => c.type === 'ParticleEmitter')?.data).toMatchObject(fields);
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
