import type { ESEngineModule, CppRegistry } from '../wasm';
import type { Entity } from '../types';
import { defineResource } from '../resource';

/**
 * Per-app particle API. Wraps the C++ registry-scoped particle system
 * so two App instances (e.g. editor tabs previewing different scenes)
 * can drive independent simulations without cross-talk.
 *
 * Consumed as a resource: declare `Res(Particle)` as a system param, or
 * grab it with `app.getResource(Particle)` outside ECS code.
 */
export class ParticleAPI {
    private readonly module_: ESEngineModule;
    private readonly registry_: CppRegistry;

    constructor(module: ESEngineModule, registry: CppRegistry) {
        this.module_ = module;
        this.registry_ = registry;
    }

    update(dt: number): void {
        this.module_.particle_update?.(this.registry_, dt);
    }

    play(entity: Entity): void {
        this.module_.particle_play?.(this.registry_, entity as number);
    }

    stop(entity: Entity): void {
        this.module_.particle_stop?.(this.registry_, entity as number);
    }

    reset(entity: Entity): void {
        this.module_.particle_reset?.(this.registry_, entity as number);
    }

    getAliveCount(entity: Entity): number {
        return this.module_.particle_getAliveCount?.(entity as number) ?? 0;
    }
}

/** Resource handle for the per-app particle API. */
export const Particle = defineResource<ParticleAPI>(null!, 'Particle');
