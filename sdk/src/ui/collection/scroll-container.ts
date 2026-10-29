// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Vec2 } from '../../types';
import { log } from '../../util/logger';

export interface ScrollContainerOptions {
    viewportSize: Vec2;
    contentSize: Vec2;
    initialOffset?: Vec2;
    /** Axis restrictions. Default 'vertical'. */
    direction?: 'both' | 'vertical' | 'horizontal';
    /** Multiplier applied to wheel deltas. Default 1. */
    wheelSpeed?: number;
    /** Drag/touch scrolling (pointer grab + kinetic fling). Default true. */
    dragScroll?: boolean;
    /** Fling velocity left after 1s of coasting. Default 0.135. */
    decelerationRate?: number;
    /** Auto-fading overlay scrollbar thumbs. Default true. */
    showScrollbar?: boolean;
    /**
     * Let a drag pull the content past either end (rubber-banded, so the further out, the stiffer), and spring it back when let go.
     * The offset itself stays clamped; the extra is {@link ScrollContainer.getOverscroll}. Default false.
     */
    elastic?: boolean;
    /** Seconds the spring back takes to settle. Default 0.5. */
    bounceTime?: number;
}

export type ScrollListener = (offset: Vec2) => void;
/** Told when the overscroll changes; @p offset is the (clamped) offset it is measured from. */
export type OverscrollListener = (overscroll: Vec2, offset: Vec2) => void;

/** How far a pull of @p distance past an end shows, for a viewport of @p view: stiffer the further out, never more than the viewport. */
export function rubberBand(distance: number, view: number): number {
    if (distance === 0 || view <= 0) return 0;
    const d = Math.abs(distance);
    return Math.sign(distance) * view * (1 - 1 / ((d * 0.55) / view + 1));
}

/** The pull that {@link rubberBand} turns into @p shown: what the finger has travelled past the end to hold the content there. */
export function rubberBandInverse(shown: number, view: number): number {
    if (shown === 0 || view <= 0) return 0;
    const r = Math.min(0.999, Math.abs(shown) / view);
    return Math.sign(shown) * (view * r) / (0.55 * (1 - r));
}

/**
 * Scroll state for a virtualized view. Clamps offset to the legal range
 * `[0, contentSize - viewportSize]` and notifies listeners on any change.
 *
 * The ScrollContainer itself has no input knowledge; a system pushes
 * wheel / drag deltas into `scrollBy`. Consumers that need to react
 * (e.g. a ListView) subscribe via `onScroll`.
 */
export class ScrollContainer {
    private viewportSize_: Vec2;
    private contentSize_: Vec2;
    private offset_: Vec2 = { x: 0, y: 0 };
    private readonly direction_: 'both' | 'vertical' | 'horizontal';
    private readonly wheelSpeed_: number;
    private readonly dragScroll_: boolean;
    private readonly decelerationRate_: number;
    private readonly showScrollbar_: boolean;
    private readonly listeners_ = new Set<ScrollListener>();
    private readonly overListeners_ = new Set<OverscrollListener>();
    private readonly elastic_: boolean;
    private readonly bounceTime_: number;
    private over_: Vec2 = { x: 0, y: 0 };
    private overVel_: Vec2 = { x: 0, y: 0 };

    constructor(opts: ScrollContainerOptions) {
        this.viewportSize_ = { x: opts.viewportSize.x, y: opts.viewportSize.y };
        this.contentSize_ = { x: opts.contentSize.x, y: opts.contentSize.y };
        this.direction_ = opts.direction ?? 'vertical';
        this.wheelSpeed_ = opts.wheelSpeed ?? 1;
        this.dragScroll_ = opts.dragScroll ?? true;
        this.decelerationRate_ = opts.decelerationRate ?? 0.135;
        this.showScrollbar_ = opts.showScrollbar ?? true;
        this.elastic_ = opts.elastic ?? false;
        this.bounceTime_ = Math.max(0.05, opts.bounceTime ?? 0.5);
        this.setOffset(opts.initialOffset ?? { x: 0, y: 0 });
    }

    getOffset(): Vec2 {
        return { x: this.offset_.x, y: this.offset_.y };
    }

    getViewportSize(): Vec2 {
        return { x: this.viewportSize_.x, y: this.viewportSize_.y };
    }

    getContentSize(): Vec2 {
        return { x: this.contentSize_.x, y: this.contentSize_.y };
    }

    getMaxOffset(): Vec2 {
        return {
            x: Math.max(0, this.contentSize_.x - this.viewportSize_.x),
            y: Math.max(0, this.contentSize_.y - this.viewportSize_.y),
        };
    }

    getShowScrollbar(): boolean {
        return this.showScrollbar_;
    }

    getWheelSpeed(): number {
        return this.wheelSpeed_;
    }

    getDragScroll(): boolean {
        return this.dragScroll_;
    }

    getDecelerationRate(): number {
        return this.decelerationRate_;
    }

    setOffset(offset: Vec2): void {
        const max = this.getMaxOffset();
        const lockX = this.direction_ === 'vertical';
        const lockY = this.direction_ === 'horizontal';
        const next: Vec2 = {
            x: lockX ? 0 : clamp(offset.x, 0, max.x),
            y: lockY ? 0 : clamp(offset.y, 0, max.y),
        };
        if (next.x === this.offset_.x && next.y === this.offset_.y) return;
        this.offset_ = next;
        for (const listener of Array.from(this.listeners_)) {
            try {
                listener({ x: next.x, y: next.y });
            } catch (err) {
                log.error('ui', 'ScrollContainer listener error', err);
            }
        }
    }

    isElastic(): boolean {
        return this.elastic_;
    }

    /** How far the content is pulled past an end on each axis: negative before the start, positive past the end, 0 inside. */
    getOverscroll(): Vec2 {
        return { x: this.over_.x, y: this.over_.y };
    }

    /** Whether the content is out past an end, or still moving back from it. */
    isSpringing(): boolean {
        return this.over_.x !== 0 || this.over_.y !== 0 || this.overVel_.x !== 0 || this.overVel_.y !== 0;
    }

    /**
     * Put the content where a finger holding it would: @p raw is the UNCLAMPED offset the drag asks for. Inside the range it is the
     * offset; past an end the offset stops there and the rest is shown as rubber-banded overscroll. Not elastic, this is `setOffset`.
     */
    dragTo(raw: Vec2): void {
        this.setOffset(raw);
        if (!this.elastic_) return;
        const max = this.getMaxOffset();
        const lockX = this.direction_ === 'vertical';
        const lockY = this.direction_ === 'horizontal';
        this.setOverscroll({
            x: lockX ? 0 : rubberBand(raw.x - clamp(raw.x, 0, max.x), this.viewportSize_.x),
            y: lockY ? 0 : rubberBand(raw.y - clamp(raw.y, 0, max.y), this.viewportSize_.y),
        }, { x: 0, y: 0 });
    }

    /** Take the speed out of the spring, leaving the content where it is. */
    releaseSpring(): void {
        this.overVel_ = { x: 0, y: 0 };
    }

    /** Momentum arriving at an end: some of it goes into the overscroll, which then springs back. */
    absorb(axis: 'x' | 'y', velocity: number): void {
        if (!this.elastic_) return;
        this.overVel_[axis] += velocity * 0.3;
    }

    /** Advance the spring by @p dt seconds. Returns whether the overscroll changed. */
    tickSpring(dt: number): boolean {
        if (!this.elastic_ || dt <= 0 || !this.isSpringing()) return false;
        // critically damped, in closed form so the step size does not matter; tuned so it has all but settled by `bounceTime`
        const w = 7 / this.bounceTime_;
        const decay = Math.exp(-w * dt);
        const x = { ...this.over_ };
        const v = { ...this.overVel_ };
        for (const axis of ['x', 'y'] as const) {
            const c = v[axis] + w * x[axis];
            x[axis] = decay * (x[axis] + c * dt);
            v[axis] = decay * (v[axis] - w * c * dt);
        }
        for (const axis of ['x', 'y'] as const) {
            if (Math.abs(x[axis]) < 0.1 && Math.abs(v[axis]) < 1) { x[axis] = 0; v[axis] = 0; }
        }
        return this.setOverscroll(x, v);
    }

    private setOverscroll(over: Vec2, velocity: Vec2): boolean {
        const changed = over.x !== this.over_.x || over.y !== this.over_.y;
        this.over_ = over;
        this.overVel_ = velocity;
        if (changed) this.notifyOver_();
        return changed;
    }

    private notifyOver_(): void {
        const offset = this.getOffset();
        for (const listener of Array.from(this.overListeners_)) {
            try {
                listener({ x: this.over_.x, y: this.over_.y }, offset);
            } catch (err) {
                log.error('ui', 'ScrollContainer overscroll listener error', err);
            }
        }
    }

    scrollBy(delta: Vec2): void {
        this.setOffset({
            x: this.offset_.x + delta.x,
            y: this.offset_.y + delta.y,
        });
    }

    setViewportSize(size: Vec2): void {
        this.setSizes(size, this.contentSize_);
    }

    setContentSize(size: Vec2): void {
        this.setSizes(this.viewportSize_, size);
    }

    /** Update both extents before clamping, so resize emits only its final offset. */
    setSizes(viewport: Vec2, content: Vec2): void {
        if (viewport.x === this.viewportSize_.x && viewport.y === this.viewportSize_.y
            && content.x === this.contentSize_.x && content.y === this.contentSize_.y) return;
        this.viewportSize_ = { x: viewport.x, y: viewport.y };
        this.contentSize_ = { x: content.x, y: content.y };
        this.setOffset(this.offset_);
    }

    onScroll(listener: ScrollListener): () => void {
        this.listeners_.add(listener);
        return () => {
            this.listeners_.delete(listener);
        };
    }

    onOverscroll(listener: OverscrollListener): () => void {
        this.overListeners_.add(listener);
        return () => {
            this.overListeners_.delete(listener);
        };
    }

    dispose(): void {
        this.listeners_.clear();
        this.overListeners_.clear();
    }
}

/** Registry of scroll containers keyed by the entity they're attached to. */
export class ScrollContainerRegistry {
    private readonly entries_ = new Map<number, ScrollContainer>();

    attach(entity: number, container: ScrollContainer): void {
        this.entries_.set(entity, container);
    }

    detach(entity: number): void {
        this.entries_.delete(entity);
    }

    get(entity: number): ScrollContainer | undefined {
        return this.entries_.get(entity);
    }

    entries(): IterableIterator<[number, ScrollContainer]> {
        return this.entries_.entries();
    }

    size(): number {
        return this.entries_.size;
    }

    clear(): void {
        this.entries_.clear();
    }
}

function clamp(value: number, lo: number, hi: number): number {
    return value < lo ? lo : value > hi ? hi : value;
}
