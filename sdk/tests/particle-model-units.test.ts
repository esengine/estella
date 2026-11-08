// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it, vi } from 'vitest';
import { World } from '../src/ecs/world';
import { ParticleEmitter, Transform, ensureBuiltinComponentsRegistered } from '../src/ecs/component';
import { ParticleModelUnits, ParticleModelUnitState } from '../src/particle/ParticleModelUnits';
import { createMockModule } from './mocks/wasm';

describe('particle model units', () => {
    it('updates authored sizes and forces without compounding scale or rewriting stable emitters', () => {
        ensureBuiltinComponentsRegistered();
        const module = createMockModule(), world = new World();
        world.connectCpp(module.getRegistry(), module);
        const entity = world.spawn('imported emitter'), state = new ParticleModelUnitState();
        world.insert(entity, Transform, { worldScale: { x: 100, y: 100, z: 100 } });
        world.insert(entity, ParticleEmitter, {});
        world.insert(entity, ParticleModelUnits, { startSizeMin: .25, speedMin: 2, gravity: { x: 0, y: -9.8, z: 0 } });
        state.update(world);
        expect(world.get(entity, ParticleEmitter)).toMatchObject({ startSizeMin: 25, speedMin: 200 });
        expect(world.get(entity, ParticleEmitter).gravity.y).toBeCloseTo(-980);
        const write = vi.spyOn(world, 'set'); state.update(world);
        expect(write).not.toHaveBeenCalled();
        world.set(entity, ParticleModelUnits, { ...world.get(entity, ParticleModelUnits), startSizeMin: .5 });
        state.update(world); expect(world.get(entity, ParticleEmitter).startSizeMin).toBe(50);
        world.set(entity, Transform, { ...world.get(entity, Transform), worldScale: { x: 200, y: 200, z: 200 } });
        state.update(world); expect(world.get(entity, ParticleEmitter)).toMatchObject({ startSizeMin: 100, speedMin: 400 });
        world.remove(entity, ParticleModelUnits); state.update(world);
        world.insert(entity, ParticleModelUnits, { startSizeMin: .5 }); state.update(world);
        expect(world.get(entity, ParticleEmitter).speedMin).toBe(0);
    });
});
