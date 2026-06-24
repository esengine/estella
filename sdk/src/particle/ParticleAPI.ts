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
        this.uploadLut(this.module_.particle_set_color_lut, entity, lut, 4);
    }

    /** Upload an entity's baked size-over-life multiplier LUT (an N-scalar
     *  Float32Array), or null to clear. */
    setSizeLut(entity: Entity, lut: Float32Array | null): void {
        this.uploadLut(this.module_.particle_set_size_lut, entity, lut, 1);
    }

    // Copy a Float32Array into the wasm heap and hand its pointer + element count
    // (length / `stride`) to the C++ setter, then free; null/empty clears.
    private uploadLut(
        fn: ((entity: number, ptr: number, count: number) => void) | undefined,
        entity: Entity,
        lut: Float32Array | null,
        stride: number,
    ): void {
        if (!fn) return;
        if (!lut || lut.length === 0) {
            fn(entity as number, 0, 0);
            return;
        }
        const ptr = this.module_._malloc(lut.length * 4);
        try {
            this.module_.HEAPF32.set(lut, ptr / 4);
            fn(entity as number, ptr, lut.length / stride);
        } finally {
            this.module_._free(ptr);
        }
    }
}

/** Resource handle for the per-app particle API. */
export const Particle = defineResource<ParticleAPI>(null!, 'Particle');
