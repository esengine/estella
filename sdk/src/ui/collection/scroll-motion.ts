// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/collection/scroll-motion.ts
 * @brief   ScrollMotion — what a hand does to a scroll area, over a ScrollContainer and a KineticScroll.
 *
 * The container knows where the content is and how far past an end it is pulled; the kinetic model knows how fast it was going when
 * let go. This ties them into the gesture: grab, drag, let go, and what follows — a coast that carries on after a flick, a spring
 * that returns an over-pulled end, and a timed scroll to a place. It has no input or ECS knowledge, so the UI scroll system and any
 * other host (a world-space node scrolled by touch) drive the same motion.
 */
import type { Vec2 } from '../../types';
import { KineticScroll } from './kinetic-scroll';
import { rubberBandInverse, type ScrollContainer } from './scroll-container';

const easeOutQuint = (t: number): number => { const k = t - 1; return k * k * k * k * k + 1; };

export class ScrollMotion {
    readonly kinetic: KineticScroll;
    private grabOffset_: Vec2 = { x: 0, y: 0 };
    private last_: Vec2 = { x: 0, y: 0 };
    private dragging_ = false;
    private anim_: { from: Vec2; to: Vec2; t: number; duration: number } | null = null;

    constructor(readonly container: ScrollContainer, kinetic?: KineticScroll) {
        this.kinetic = kinetic ?? new KineticScroll({ decelerationRate: container.getDecelerationRate() });
    }

    get isDragging(): boolean { return this.dragging_; }

    /** Whether anything is still moving: a coast, a spring, or a timed scroll. */
    get isMoving(): boolean {
        return this.anim_ !== null || this.kinetic.isCoasting() || this.container.isSpringing();
    }

    /**
     * A finger takes hold. Whatever was moving stops where it is; if the content was over-pulled, the grab continues from
     * there rather than snapping back.
     */
    grab(): void {
        this.kinetic.stop();
        this.anim_ = null;
        this.container.releaseSpring();
        const offset = this.container.getOffset();
        const over = this.container.getOverscroll();
        const view = this.container.getViewportSize();
        this.grabOffset_ = { x: offset.x + rubberBandInverse(over.x, view.x), y: offset.y + rubberBandInverse(over.y, view.y) };
        this.last_ = offset;
        this.dragging_ = true;
        this.kinetic.beginDrag();
    }

    /**
     * The finger is @p total (in offset units, positive = content toward its end) from where it took hold, @p dt after the last call.
     * The mapping is absolute from the grab point, so a pull past an end re-tracks the finger when it comes back.
     */
    dragBy(total: Vec2, dt: number): void {
        if (!this.dragging_) return;
        this.container.dragTo({ x: this.grabOffset_.x + total.x, y: this.grabOffset_.y + total.y });
        const now = this.container.getOffset();
        this.kinetic.sample({ x: now.x - this.last_.x, y: now.y - this.last_.y }, dt);
        this.last_ = now;
    }

    /** The finger lifts: the speed it had carries on as a coast, and an over-pulled end springs back. */
    release(): void {
        if (!this.dragging_) return;
        this.dragging_ = false;
        this.kinetic.endDrag();
    }

    /** Stop everything where it is. */
    stop(): void {
        this.dragging_ = false;
        this.anim_ = null;
        this.kinetic.stop();
        this.container.releaseSpring();
    }

    /** Move to @p target (clamped) over @p seconds, easing out; 0 jumps. */
    animateTo(target: Vec2, seconds: number): void {
        this.kinetic.stop();
        if (seconds <= 0) { this.anim_ = null; this.container.setOffset(target); return; }
        this.anim_ = { from: this.container.getOffset(), to: target, t: 0, duration: seconds };
    }

    /** Advance @p dt seconds. Returns whether the offset or the overscroll changed. */
    tick(dt: number): boolean {
        if (this.dragging_) return false;
        let changed = false;
        if (this.anim_) {
            const a = this.anim_;
            a.t += dt;
            const k = a.t >= a.duration - 1e-9 ? 1 : easeOutQuint(a.t / a.duration);
            const before = this.container.getOffset();
            this.container.setOffset({ x: a.from.x + (a.to.x - a.from.x) * k, y: a.from.y + (a.to.y - a.from.y) * k });
            const after = this.container.getOffset();
            changed = after.x !== before.x || after.y !== before.y;
            if (k >= 1) this.anim_ = null;
        } else if (this.kinetic.isCoasting()) {
            const delta = this.kinetic.tick(dt);
            const before = this.container.getOffset();
            this.container.scrollBy(delta);
            const after = this.container.getOffset();
            const velocity = this.kinetic.getVelocity();
            if (delta.x !== 0 && after.x === before.x) { this.container.absorb('x', velocity.x); this.kinetic.killAxis('x'); }
            if (delta.y !== 0 && after.y === before.y) { this.container.absorb('y', velocity.y); this.kinetic.killAxis('y'); }
            changed = after.x !== before.x || after.y !== before.y;
        }
        return this.container.tickSpring(dt) || changed;
    }
}
