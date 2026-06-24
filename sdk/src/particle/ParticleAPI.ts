// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
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

    /**
     * Upload an entity's baked color-over-life LUT (an N×4 RGBA Float32Array) so
     * the sim samples it instead of start/end + easing; pass null to clear. The
     * data is copied into the wasm heap for the call, then freed.
     */
    setColorLut(entity: Entity, lut: Float32Array | null): void {
        const m = this.module_;
        if (!m.particle_set_color_lut) return;
        if (!lut || lut.length === 0) {
            m.particle_set_color_lut(entity as number, 0, 0);
            return;
        }
        const bytes = lut.length * 4;
        const ptr = m._malloc(bytes);
        try {
            m.HEAPF32.set(lut, ptr / 4);
            m.particle_set_color_lut(entity as number, ptr, lut.length / 4);
        } finally {
            m._free(ptr);
        }
    }
}

/** Resource handle for the per-app particle API. */
export const Particle = defineResource<ParticleAPI>(null!, 'Particle');
