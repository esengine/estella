import type { ESEngineModule, CppRegistry } from '../wasm';
import type { Entity } from '../types';

let module: ESEngineModule | null = null;
let registry: CppRegistry | null = null;

export function initParticleAPI(m: ESEngineModule, r: CppRegistry): void {
    module = m;
    registry = r;
}

export function shutdownParticleAPI(): void {
    module = null;
    registry = null;
}

export const Particle = {
    update(dt: number): void {
        if (!module || !registry) return;
        module.particle_update?.(registry, dt);
    },

    play(entity: Entity): void {
        if (!module || !registry) return;
        module.particle_play?.(registry, entity as number);
    },

    stop(entity: Entity): void {
        if (!module || !registry) return;
        module.particle_stop?.(registry, entity as number);
    },

    reset(entity: Entity): void {
        if (!module || !registry) return;
        module.particle_reset?.(registry, entity as number);
    },

    getAliveCount(entity: Entity): number {
        if (!module) return 0;
        return module.particle_getAliveCount?.(entity as number) ?? 0;
    },
};
