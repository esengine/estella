// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { CppRegistry } from '../wasm';
import type { EngineApi } from '../ecs/bridge/engineApi';
import type { Entity } from '../types';
import { defineResource } from '../ecs/resource';
import { ParticleCollisionBridge, type ParticleQueryResolver } from './ParticleCollisionBridge';
import type { ParticleCollisionBudget, ParticleCollisionEventPayload, ParticleCollisionStats } from './collision';

/**
 * Per-app particle API. Wraps the C++ registry-scoped particle system
 * so two App instances (e.g. editor tabs previewing different scenes)
 * can drive independent simulations without cross-talk.
 *
 * Consumed as a resource: declare `Res(Particle)` as a system param, or
 * grab it with `app.getResource(Particle)` outside ECS code.
 */
export class ParticleAPI {
    private readonly module_: NonNullable<EngineApi>;
    private readonly registry_: CppRegistry;
    private readonly collisions_: ParticleCollisionBridge;

    /** @param module whichever engine core is present — the wasm module on the web,
     *  the native host's bindings on a device (see ecs/engineApi.ts). */
    constructor(module: NonNullable<EngineApi>, registry: CppRegistry, resolve?: ParticleQueryResolver) {
        this.module_ = module;
        this.registry_ = registry;
        this.collisions_ = new ParticleCollisionBridge(module,registry,resolve);
    }

    update(dt: number): void {
        this.collisions_.update(dt);
    }

    /** Contacts published by the last completed update, in project world units. */
    get collisionEvents(): readonly ParticleCollisionEventPayload[] { return this.collisions_.events; }
    /** Per-emitter counters from the last update, including fallback reasons. */
    get collisionStats(): readonly ParticleCollisionStats[] { return this.collisions_.stats; }
    /** Provider errors are visible alongside the unavailable/fallback counters. */
    get collisionError(): string | null { return this.collisions_.error; }
    /** Global App caps, independent of each emitter's smaller limits. */
    setCollisionBudget(budget: Partial<ParticleCollisionBudget>): void {
        for (const key of ['queries','events'] as const) {
            const value=budget[key];
            if (value!==undefined) this.collisions_.budget[key]=Number.isFinite(value)?Math.max(0,Math.min(key==='queries'?65536:16384,Math.floor(value))):0;
        }
    }
    /** Draw bounded hit normals without enabling gameplay collision events. */
    get debugNormals(): boolean { return this.collisions_.debug; }
    set debugNormals(enabled: boolean) { this.collisions_.debug=enabled; }
    /** @internal */
    get collisionContacts(): readonly ParticleCollisionEventPayload[] { return this.collisions_.contacts; }

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

    /**
     * Speed-over-life multiplier. Scales how fast a particle travels along the
     * trajectory it already has — gravity, damping and noise still accumulate
     * into its velocity, so this is not a second force system.
     */
    setSpeedLut(entity: Entity, lut: Float32Array | null): void {
        this.uploadLut(this.module_.particle_set_speed_lut, entity, lut, 1);
    }

    /**
     * Burst schedule: each burst releases `count` particles once the emitter has been emitting for `time` seconds
     * (counted from the end of its start delay). A looping emitter repeats the schedule every duration. Null clears.
     */
    setBursts(entity: Entity, bursts: readonly { time: number; count: number }[] | null): void {
        const lut = bursts && bursts.length > 0 ? Float32Array.from(bursts.flatMap((b) => [b.time, b.count])) : null;
        this.uploadLut(this.module_.particle_set_bursts, entity, lut, 2);
    }

    // Copy a Float32Array into the core's heap and hand its offset + element count
    // (length / `stride`) to the C++ setter, then free; null/empty clears. The heap
    // is wasm linear memory on the web and the host's arena on a device — the same
    // call either way (see ecs/nativeHeap.ts).
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
        const { _malloc: malloc, _free: free } = this.module_;
        if (!malloc || !free || !this.module_.HEAPF32) return;   // a core with no heap marshals nothing
        // A caller may borrow the same heap that allocation is about to detach.
        const source = lut.buffer === this.module_.HEAPF32.buffer ? lut.slice() : lut;
        const ptr = malloc(source.length * 4);
        try {
            // Allocation can grow WASM memory and detach the previous heap view.
            this.module_.HEAPF32!.set(source, ptr / 4);
            fn(entity as number, ptr, source.length / stride);
        } finally {
            free(ptr);
        }
    }
}

/** Resource handle for the per-app particle API. */
export const Particle = defineResource<ParticleAPI>(null!, 'Particle');
