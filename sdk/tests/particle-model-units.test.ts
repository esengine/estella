// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { World } from '../src/ecs/world';
import { ParticleEmitter, Transform, ensureBuiltinComponentsRegistered } from '../src/ecs/component';
import { ParticleModelUnits, ParticleModelUnitState } from '../src/imported-scene/particleModelUnits';
import { createMockModule } from './mocks/wasm';
import { serializeEntityComponents } from '../src/scene/scene';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe('particle model units', () => {
    it('updates authored sizes and forces without compounding scale or rewriting stable emitters', () => {
        ensureBuiltinComponentsRegistered();
        const module = createMockModule(), world = new World();
        world.connectCpp(module.getRegistry(), module);
        const entity = world.spawn('imported emitter'), state = new ParticleModelUnitState(world);
        world.insert(entity, Transform, { worldScale: { x: 100, y: 100, z: 100 } });
        world.insert(entity, ParticleEmitter, {});
        world.insert(entity, ParticleModelUnits, { startSizeMin: .25, speedMin: 2, gravity: { x: 0, y: -9.8, z: 0 } });
        state.update();
        expect(world.get(entity, ParticleEmitter)).toMatchObject({ startSizeMin: 25, speedMin: 200 });
        expect(world.get(entity, ParticleEmitter).gravity.y).toBeCloseTo(-980);
        const write = vi.spyOn(world, 'set'); state.update();
        expect(write).not.toHaveBeenCalled();
        world.set(entity, ParticleModelUnits, { ...world.get(entity, ParticleModelUnits), startSizeMin: .5 });
        state.update(); expect(world.get(entity, ParticleEmitter).startSizeMin).toBe(50);
        world.set(entity, Transform, { ...world.get(entity, Transform), worldScale: { x: 200, y: 200, z: 200 } });
        state.update(); expect(world.get(entity, ParticleEmitter)).toMatchObject({ startSizeMin: 100, speedMin: 400 });
        world.remove(entity, ParticleModelUnits); state.update();
        world.insert(entity, ParticleModelUnits, { startSizeMin: .5 }); state.update();
        expect(world.get(entity, ParticleEmitter).speedMin).toBe(0);
    });

    it('preserves pending textures and applies unchanged units to a replacement emitter', () => {
        ensureBuiltinComponentsRegistered();
        const module = createMockModule(), world = new World();
        world.connectCpp(module.getRegistry(), module);
        const entity = world.spawn('imported emitter'), state = new ParticleModelUnitState(world);
        world.insert(entity, Transform, { worldScale: { x: 8, y: 8, z: 8 } });
        world.insert(entity, ParticleModelUnits, { speedMin: 2 });
        world.insertWithUnresolvedAssets(entity, ParticleEmitter, {}, new Map([['texture', 'assets/sparks.png']]));
        state.update();
        const saved = () => serializeEntityComponents(world, entity).find(c => c.type === 'ParticleEmitter')!.data;
        expect.soft(saved()).toMatchObject({ speedMin: 16, texture: 'assets/sparks.png' });
        world.remove(entity, ParticleEmitter);
        world.insert(entity, ParticleEmitter, { rate: 5 });
        state.update();
        expect(world.get(entity, ParticleEmitter)).toMatchObject({ speedMin: 16, rate: 5 });
    });

    it.skipIf(!HAS_WASM)('keeps an imported crowd of emitters aligned with the parent model scale', async () => {
        const app = App.new(), module = await loadWasmModule(), registry = new module.Registry();
        app.connectCpp(registry, module, { ownedRegistry: true });
        const world = app.world, state = new ParticleModelUnitState(world);
        try {
            const root = world.spawn();
            world.insert(root, Transform, { scale: { x: 2, y: 2, z: 2 } });
            const emitters = Array.from({ length: 2048 }, () => {
                const entity = world.spawn();
                world.insert(entity, Transform);
                world.insert(entity, ParticleEmitter);
                world.insert(entity, ParticleModelUnits, { speedMin: 3 });
                world.setParent(entity, root);
                return entity;
            });
            const update = () => state.update();
            for (let i = 0; i < 12; i++) update();
            if (process.env.ESTELLA_BENCH_PARTICLE_MODEL_UNITS === '1') {
                const elapsed = Array.from({ length: 21 }, () => {
                    const start = performance.now(); update(); return performance.now() - start;
                }).sort((a, b) => a - b);
                console.log(`${emitters.length} particle emitters, steady frame median ${elapsed[10].toFixed(3)} ms`);
            }
            const read = vi.spyOn(world, 'get');
            try {
                update();
                expect(read).not.toHaveBeenCalled();
            } finally { read.mockRestore(); }
            expect(emitters.every(entity => world.get(entity, ParticleEmitter).speedMin === 6)).toBe(true);
            world.update(root, Transform, data => { data.scale.x = -4; });
            update();
            expect(emitters.every(entity => world.get(entity, ParticleEmitter).speedMin === 12)).toBe(true);
            world.update(emitters[0], ParticleModelUnits, data => { data.speedMin = 6; });
            update();
            expect(world.get(emitters[0], ParticleEmitter).speedMin).toBe(24);
            expect(world.get(emitters[1], ParticleEmitter).speedMin).toBe(12);
            world.remove(emitters[0], ParticleEmitter);
            world.insert(emitters[0], ParticleEmitter, { rate: 5 });
            update();
            expect(world.get(emitters[0], ParticleEmitter)).toMatchObject({ speedMin: 24, rate: 5 });
        } finally { app.quit({ keepRenderer: true }); }
    });
});
