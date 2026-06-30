// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    sceneStreaming.ts
 * @brief   Proximity-driven scene streaming over the SceneManager primitives.
 *
 * Large/open worlds split into cells, each an additively-loaded scene. A focus
 * point (usually the player/camera) drives which cells are resident: cells within
 * `loadRadius` of the focus are brought in, cells past `unloadRadius` are dropped.
 * The two radii form a hysteresis band so a focus hovering at a boundary does not
 * thrash. This is pure orchestration — it owns no loading itself, only calls the
 * existing `loadAdditive`/`unload`/`sleep`/`wake` primitives.
 */
import { defineResource } from './resource';
import type { Entity } from './types';

/** A streamable cell: an additive scene with a world-space center + radius. */
export interface StreamCell {
    /** Registered scene name (must be a `SceneManager.register`ed scene). */
    scene: string;
    x: number;
    y: number;
    /** Cell radius in world units; distances are measured to the cell edge. */
    radius: number;
}

export interface StreamDecision {
    toActivate: string[];
    toDeactivate: string[];
}

/**
 * Decide which cells cross the load/unload thresholds this tick. A cell becomes
 * active when its edge is within `loadRadius`; an active cell deactivates only
 * once its edge passes `unloadRadius` (hysteresis). Cells inside the band keep
 * their current state. Pure.
 */
export function computeStreaming(
    cells: readonly StreamCell[],
    focusX: number,
    focusY: number,
    loadRadius: number,
    unloadRadius: number,
    active: ReadonlySet<string>,
): StreamDecision {
    const toActivate: string[] = [];
    const toDeactivate: string[] = [];
    for (const c of cells) {
        const edge = Math.max(0, Math.hypot(focusX - c.x, focusY - c.y) - c.radius);
        const isActive = active.has(c.scene);
        if (!isActive && edge <= loadRadius) toActivate.push(c.scene);
        else if (isActive && edge > unloadRadius) toDeactivate.push(c.scene);
    }
    return { toActivate, toDeactivate };
}

/** Out-of-range cells are fully unloaded, or merely put to sleep (faster wake). */
export type StreamPolicy = 'unload' | 'sleep';

export interface SceneStreamingConfig {
    loadRadius: number;
    /** Clamped up to `loadRadius` if smaller (hysteresis requires unload ≥ load). */
    unloadRadius: number;
    policy?: StreamPolicy;
}

/**
 * The slice of SceneManager the streamer drives. `SceneManagerState` satisfies it
 * structurally; tests inject a recording stub.
 */
export interface SceneStreamHost {
    loadAdditive(name: string): Promise<unknown>;
    unload(name: string): Promise<void>;
    sleep(name: string): void;
    wake(name: string): void;
    isLoaded(name: string): boolean;
    isSleeping(name: string): boolean;
}

export class SceneStreamingController {
    private readonly host_: SceneStreamHost;
    private readonly cells_ = new Map<string, StreamCell>();
    /** Cells the controller currently considers in-range (hysteresis state). */
    private readonly active_ = new Set<string>();
    /** Cells with an async load/unload in flight, so it isn't issued twice. */
    private readonly inFlight_ = new Set<string>();
    private focusX_ = 0;
    private focusY_ = 0;
    private loadRadius_ = 0;
    private unloadRadius_ = 0;
    private policy_: StreamPolicy = 'unload';
    private focusEntity_: Entity | null = null;

    constructor(host: SceneStreamHost, config?: SceneStreamingConfig) {
        this.host_ = host;
        if (config) this.configure(config);
    }

    configure(config: SceneStreamingConfig): void {
        this.loadRadius_ = config.loadRadius;
        this.unloadRadius_ = Math.max(config.loadRadius, config.unloadRadius);
        this.policy_ = config.policy ?? 'unload';
    }

    register(cell: StreamCell): void {
        this.cells_.set(cell.scene, cell);
    }

    unregister(scene: string): void {
        this.cells_.delete(scene);
        this.active_.delete(scene);
    }

    clear(): void {
        this.cells_.clear();
        this.active_.clear();
        this.inFlight_.clear();
        this.focusEntity_ = null;
    }

    /** Set the focus directly (or let the streaming system read a focus entity). */
    setFocus(x: number, y: number): void {
        this.focusX_ = x;
        this.focusY_ = y;
    }

    /** Follow an entity; the streaming system reads its Transform each tick. */
    setFocusEntity(entity: Entity | null): void {
        this.focusEntity_ = entity;
    }

    getFocusEntity(): Entity | null {
        return this.focusEntity_;
    }

    /** Scenes the controller currently holds in-range. */
    getActive(): string[] {
        return [...this.active_];
    }

    /** Reconcile resident cells against the current focus. Idempotent per tick. */
    update(): void {
        if (this.cells_.size === 0) return;
        const decision = computeStreaming(
            [...this.cells_.values()],
            this.focusX_, this.focusY_,
            this.loadRadius_, this.unloadRadius_,
            this.active_,
        );
        for (const scene of decision.toActivate) {
            this.active_.add(scene);
            this.activate_(scene);
        }
        for (const scene of decision.toDeactivate) {
            this.active_.delete(scene);
            this.deactivate_(scene);
        }
    }

    private activate_(scene: string): void {
        if (this.policy_ === 'sleep' && this.host_.isSleeping(scene)) {
            this.host_.wake(scene);
            return;
        }
        if (this.host_.isLoaded(scene) || this.inFlight_.has(scene)) return;
        this.inFlight_.add(scene);
        Promise.resolve(this.host_.loadAdditive(scene)).then(
            // If the focus left during the load, drop it now (avoids a resident leak).
            () => { this.inFlight_.delete(scene); if (!this.active_.has(scene)) this.deactivate_(scene); },
            () => { this.inFlight_.delete(scene); },
        );
    }

    private deactivate_(scene: string): void {
        if (this.policy_ === 'sleep') {
            if (this.host_.isLoaded(scene)) this.host_.sleep(scene);
            return;
        }
        if (!this.host_.isLoaded(scene) || this.inFlight_.has(scene)) return;
        this.inFlight_.add(scene);
        Promise.resolve(this.host_.unload(scene)).then(
            () => { this.inFlight_.delete(scene); if (this.active_.has(scene)) this.activate_(scene); },
            () => { this.inFlight_.delete(scene); },
        );
    }
}

export const SceneStreaming = defineResource<SceneStreamingController>(null!, 'SceneStreaming');
