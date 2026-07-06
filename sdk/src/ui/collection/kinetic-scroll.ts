// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/collection/kinetic-scroll.ts
 * @brief   KineticScroll — the pure velocity model behind drag/touch scrolling.
 *
 * Tracks the pointer's velocity while a drag is held (EMA-smoothed so one
 * jittery frame doesn't dictate the fling) and, after release, decays it
 * exponentially so the content coasts to rest — the standard kinetic-scroll
 * feel (Unity ScrollRect / iOS). Like {@link ScrollContainer}, it has no
 * input or ECS knowledge: a behavior system pushes samples in and applies
 * the ticked deltas back to the container, keeping the model unit-testable.
 */
import type { Vec2 } from '../../types';

export interface KineticScrollOptions {
    /**
     * Fraction of the release velocity remaining after one second of
     * coasting (`v *= rate^dt`). Default 0.135 — Unity's ScrollRect default.
     */
    decelerationRate?: number;
    /** Speed floor (px/s) below which coasting stops. Default 4. */
    restVelocity?: number;
    /**
     * Per-second EMA rate blending new velocity samples over the held drag
     * (`blend = 1 - e^(-rate·dt)`). Default 12 — ≈70% weight in 100ms.
     */
    sampleRate?: number;
}

export class KineticScroll {
    private readonly decelerationRate_: number;
    private readonly restVelocity_: number;
    private readonly sampleRate_: number;
    private velocity_: Vec2 = { x: 0, y: 0 };
    private dragging_ = false;

    constructor(opts: KineticScrollOptions = {}) {
        this.decelerationRate_ = opts.decelerationRate ?? 0.135;
        this.restVelocity_ = opts.restVelocity ?? 4;
        this.sampleRate_ = opts.sampleRate ?? 12;
    }

    /** A finger/pointer grabbed the content: cancel any coast, start sampling. */
    beginDrag(): void {
        this.dragging_ = true;
        this.velocity_ = { x: 0, y: 0 };
    }

    /** Feed one frame's offset delta (px) while the drag is held. */
    sample(delta: Vec2, dt: number): void {
        if (!this.dragging_ || dt <= 0) return;
        const instant = { x: delta.x / dt, y: delta.y / dt };
        const blend = 1 - Math.exp(-this.sampleRate_ * dt);
        this.velocity_.x += (instant.x - this.velocity_.x) * blend;
        this.velocity_.y += (instant.y - this.velocity_.y) * blend;
    }

    /** Release: the sampled velocity carries over into coasting. */
    endDrag(): void {
        this.dragging_ = false;
    }

    /** Hard stop (new grab, wheel input, or hitting a clamp edge). */
    stop(): void {
        this.dragging_ = false;
        this.velocity_ = { x: 0, y: 0 };
    }

    /** Kill one axis of the coast (that axis hit its clamp edge). */
    killAxis(axis: 'x' | 'y'): void {
        this.velocity_[axis] = 0;
    }

    isDragging(): boolean {
        return this.dragging_;
    }

    /** Coasting = released with speed above the rest floor. */
    isCoasting(): boolean {
        if (this.dragging_) return false;
        const { x, y } = this.velocity_;
        return Math.hypot(x, y) > this.restVelocity_;
    }

    getVelocity(): Vec2 {
        return { x: this.velocity_.x, y: this.velocity_.y };
    }

    /**
     * Advance one coast frame: returns the offset delta to apply and decays
     * the velocity. Zero vector when not coasting.
     */
    tick(dt: number): Vec2 {
        if (!this.isCoasting() || dt <= 0) return { x: 0, y: 0 };
        const delta = { x: this.velocity_.x * dt, y: this.velocity_.y * dt };
        const decay = Math.pow(this.decelerationRate_, dt);
        this.velocity_.x *= decay;
        this.velocity_.y *= decay;
        if (!this.isCoasting()) this.velocity_ = { x: 0, y: 0 };
        return delta;
    }
}
