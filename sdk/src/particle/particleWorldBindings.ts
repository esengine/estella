// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { EngineApi } from '../ecs/bridge/engineApi';
import type { CppRegistry } from '../wasm';

/** Bind owner-sensitive calls once. Older single-world cores expose the entity-only forms. */
export function particleWorldBindings(engine: EngineApi, registry: CppRegistry) {
    function bind<A extends unknown[], R>(scoped: ((registry: CppRegistry, ...args: A) => R) | undefined,
                                         legacy: ((...args: A) => R) | undefined) {
        return scoped?.bind(engine, registry) ?? legacy?.bind(engine);
    }
    return {
        aliveCount: bind(engine.particle_getAliveCountInWorld, engine.particle_getAliveCount),
        colorLut: bind(engine.particle_setColorLutInWorld, engine.particle_set_color_lut),
        sizeLut: bind(engine.particle_setSizeLutInWorld, engine.particle_set_size_lut),
        speedLut: bind(engine.particle_setSpeedLutInWorld, engine.particle_set_speed_lut),
        bursts: bind(engine.particle_setBurstsInWorld, engine.particle_set_bursts),
        queryCount: bind(engine.particle_collisionQueryCountInWorld, engine.particle_collisionQueryCount),
        queries: bind(engine.particle_collisionQueriesInWorld, engine.particle_collisionQueries),
        eventCount: bind(engine.particle_collisionEventCountInWorld, engine.particle_collisionEventCount),
        events: bind(engine.particle_collisionEventsInWorld, engine.particle_collisionEvents),
        statsCount: bind(engine.particle_collisionStatsCountInWorld, engine.particle_collisionStatsCount),
        stats: bind(engine.particle_collisionStatsInWorld, engine.particle_collisionStats),
        setBudget: bind(engine.particle_collisionSetBudgetInWorld, engine.particle_collisionSetBudget),
    };
}

export type ParticleWorldBindings = ReturnType<typeof particleWorldBindings>;
