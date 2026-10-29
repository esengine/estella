// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/collection/scroll-physics.ts
 * @brief   Drag, inertia and elastic bounce for a scrolled content rectangle — independent of how the UI is laid out.
 *
 * A scroll area is two rectangles on one axis: the view, and the content that moves inside it. This module knows nothing of nodes
 * or layout; it is given the two extents, told about drag deltas and releases, and answers where the content should be. A host
 * (a UINode scroll container, a world-space node in the Cocos compatibility layer) reads the position back each frame and applies it.
 *
 * Positions are the content's offset from "top/left edge aligned with the view's": 0 is aligned, and scrolling toward the end is
 * a growing positive offset up to {@link ScrollAxis.max}. Past either end is overscroll. All values are in the host's own units.
 *
 * The feel: a drag past an end is damped the further it goes; a release with velocity glides to rest on a quintic ease-out whose
 * length and time follow the speed; a rest position past an end springs back over `bounceTime`; `brake` shortens the glide.
 */

export interface ScrollSettings {
    /** Glide after release. */
    inertia: boolean;
    /** Allow overscroll with a spring back; off clamps hard. */
    elastic: boolean;
    /** 0..1: how hard the glide is cut short. 1 stops at once. */
    brake: number;
    /** Seconds for the spring back. */
    bounceTime: number;
}

export const DEFAULT_SCROLL: Readonly<ScrollSettings> = { inertia: true, elastic: true, brake: 0.5, bounceTime: 1 };

const quintOut = (t: number): number => { const k = t - 1; return k * k * k * k * k + 1; };

/** One axis of a scroll area. */
export class ScrollAxis {
    /** The content's offset: 0 = start edges aligned, `max` = end edges aligned. */
    offset = 0;
    /** content extent - view extent, never negative. */
    max = 0;
    private from_ = 0;
    private to_ = 0;
    private t_ = 0;
    private duration_ = 0;
    private mode_: 'idle' | 'glide' | 'bounce' = 'idle';
    private samples_: Array<{ t: number; offset: number }> = [];

    constructor(public settings: ScrollSettings = { ...DEFAULT_SCROLL }) {}

    /** Set the extents; the offset is kept. */
    setExtents(view: number, content: number): void { this.max = Math.max(0, content - view); }

    get moving(): boolean { return this.mode_ !== 'idle'; }

    /** How far past an end the offset is: negative before the start, positive past the end, 0 inside. */
    get overscroll(): number {
        if (this.offset < 0) return this.offset;
        if (this.offset > this.max) return this.offset - this.max;
        return 0;
    }

    /** A finger lands: any glide stops where it is. */
    press(): void {
        this.mode_ = 'idle';
        this.samples_ = [];
    }

    /** The finger moved by @p delta (positive = content toward its end), at @p time seconds. */
    drag(delta: number, time: number, viewExtent: number): void {
        const dir = Math.sign(delta);
        let remaining = Math.abs(delta);
        // the part of the move that stays inside the range is free; only what goes past an end is damped
        const over = this.overscroll;
        if (over === 0 || Math.sign(over) !== dir) {
            const room = dir > 0 ? this.max - this.offset : this.offset;   // distance to the end this move heads for
            const free = over !== 0 ? remaining : Math.min(remaining, Math.max(0, room));
            this.offset += dir * free;
            remaining -= free;
        }
        if (remaining > 0) {
            if (!this.settings.elastic) {
                this.offset = Math.min(this.max, Math.max(0, this.offset));
            } else {
                const out = Math.abs(this.overscroll);
                this.offset += dir * remaining * Math.max(0, 1 - out / Math.max(viewExtent, 1)) * 0.5;
            }
        }
        this.samples_.push({ t: time, offset: this.offset });
        while (this.samples_.length > 2 && time - this.samples_[0]!.t > 0.1) this.samples_.shift();
    }

    /** The finger lifted: glide if it was moving, then settle. */
    release(): void {
        const v = this.velocity_();
        this.samples_ = [];
        if (this.overscroll !== 0) { this.bounceBack_(); return; }
        if (this.settings.inertia && Math.abs(v) > 20) this.glide_(v);
        else this.mode_ = 'idle';
    }

    /** Move to @p target (clamped unless elastic) over @p seconds; 0 jumps. */
    scrollTo(target: number, seconds = 0, attenuated = true): void {
        const clamped = Math.min(this.max, Math.max(0, target));
        if (seconds <= 0) { this.offset = clamped; this.mode_ = 'idle'; return; }
        this.from_ = this.offset;
        this.to_ = clamped;
        this.t_ = 0;
        this.duration_ = seconds;
        this.mode_ = attenuated ? 'glide' : 'bounce';
    }

    stop(): void { this.mode_ = 'idle'; }

    /** Advance @p dt seconds. Returns true if the offset changed. */
    update(dt: number): boolean {
        if (this.mode_ === 'idle') return false;
        this.t_ += dt;
        const k = Math.min(1, this.t_ / this.duration_);
        const before = this.offset;
        this.offset = this.from_ + (this.to_ - this.from_) * quintOut(k);
        if (k >= 1) {
            this.offset = this.to_;
            // a glide that ended past an end (elastic) springs back
            if (this.mode_ === 'glide' && this.overscroll !== 0) this.bounceBack_(); else this.mode_ = 'idle';
        } else if (this.mode_ === 'glide' && this.settings.elastic === false) {
            this.offset = Math.min(this.max, Math.max(0, this.offset));
        }
        return this.offset !== before;
    }

    private velocity_(): number {
        const s = this.samples_;
        if (s.length < 2) return 0;
        const a = s[0]!, b = s[s.length - 1]!;
        const dt = b.t - a.t;
        return dt > 0 ? (b.offset - a.offset) / dt : 0;
    }

    private bounceBack_(): void {
        this.from_ = this.offset;
        this.to_ = Math.min(this.max, Math.max(0, this.offset));
        this.t_ = 0;
        this.duration_ = Math.max(this.settings.bounceTime, 0.01);
        this.mode_ = 'bounce';
    }

    private glide_(velocity: number): void {
        const speed = Math.abs(velocity);
        // longer for a harder flick; the brake cuts both distance and time
        const keep = 1 - Math.min(1, Math.max(0, this.settings.brake)) * 0.6;
        const duration = Math.min(4, Math.sqrt(Math.sqrt(speed / 5))) * keep;
        const distance = velocity * 0.7 * keep;
        this.from_ = this.offset;
        let to = this.offset + distance;
        if (!this.settings.elastic) to = Math.min(this.max, Math.max(0, to));
        this.to_ = to;
        this.t_ = 0;
        this.duration_ = Math.max(duration, 0.05);
        this.mode_ = 'glide';
    }
}
