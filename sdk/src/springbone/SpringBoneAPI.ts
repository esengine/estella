// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { flushEngineStamps } from '../ecs/engineStamps';
import type { CppRegistry } from '../wasm';
import type { EngineApi } from '../ecs/bridge/engineApi';
import type { Entity } from '../types';
import { defineResource } from '../ecs/resource';

/** One simulated point of a chain. */
export interface SpringBoneParticle {
    /** Where the simulation has it, in world units. */
    position: [number, number, number];
    /** Where the animation puts it. */
    pose: [number, number, number];
    /** The index of its parent particle, -1 for the chain's root. */
    parent: number;
}

/**
 * Per-app secondary-motion API. Wraps the C++ registry-scoped spring-bone system, so two App instances (editor tabs) simulate
 * independent chains.
 *
 * Consumed as a resource: declare `Res(SpringBone)` as a system param, or grab it with `app.getResource(SpringBone)`.
 */
export class SpringBoneAPI {
    private readonly module_: NonNullable<EngineApi>;
    private readonly registry_: CppRegistry;

    /** @param module whichever engine core is present (see ecs/engineApi.ts). */
    constructor(module: NonNullable<EngineApi>, registry: CppRegistry) {
        this.module_ = module;
        this.registry_ = registry;
    }

    /** Advance every chain: step the springs toward the pose the animation gave, then turn the bones to match. */
    update(dt: number): void {
        // The update composes world transforms from the write stamps, so what scripts wrote reaches the engine first.
        flushEngineStamps(this.registry_);
        this.module_.springbone_update?.(this.registry_, dt);
    }

    /**
     * A chain as the engine has it now, for an editor to draw: each particle's simulated position, the position the animation gives it, and
     * its parent's index (-1 for the root). Empty when the chain has not been stepped yet.
     */
    snapshot(root: Entity): SpringBoneParticle[] {
        const count = this.module_.springbone_snapshot?.(this.registry_, root as number) ?? 0;
        if (!count) return [];
        const ptr = this.module_.springbone_snapshotDataInWorld
            ? this.module_.springbone_snapshotDataInWorld(this.registry_)
            : this.module_.springbone_snapshotData?.();
        const heap = this.module_.HEAPF32;
        if (!ptr || !heap) return [];
        const out: SpringBoneParticle[] = [];
        for (let i = 0; i < count; i++) {
            const k = ptr / 4 + i * 7;
            out.push({
                position: [heap[k]!, heap[k + 1]!, heap[k + 2]!],
                pose: [heap[k + 3]!, heap[k + 4]!, heap[k + 5]!],
                parent: heap[k + 6]!,
            });
        }
        return out;
    }

    /** Give a chain's bones back as the animation had them and forget its state: what ends a preview in an editor. */
    release(root: Entity): void {
        this.module_.springbone_release?.(this.registry_, root as number);
    }

    /** Put a chain back at its animated pose on its next frame: a teleport, a respawn, a pose set by hand. */
    reset(root: Entity): void {
        this.module_.springbone_reset?.(this.registry_, root as number);
    }
}

/** Resource handle for the per-app spring-bone API. */
export const SpringBoneRes = defineResource<SpringBoneAPI>(null!, 'SpringBone');
