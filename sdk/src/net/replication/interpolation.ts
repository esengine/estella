// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    interpolation.ts
 * @brief   Snapshot interpolation for NetGhost state. Delta frames land as
 *          per-field time series (sparse deltas need no full-snapshot
 *          reconstruction — a field simply has samples at the ticks it
 *          changed); the render clock trails the newest server tick by a
 *          fixed delay and samples each series there, so motion stays smooth
 *          across frame-rate mismatch and delivery jitter. Continuous values
 *          lerp (f32 scalars, f32 leaves of vectors, quats via nlerp);
 *          discrete values hold until their sample time passes.
 *
 * @beta   Pre-1.0 networking: client prediction and interest management will reshape this surface.
 */
import type { FieldShape } from './codec';

interface Sample {
    tick: number;
    value: unknown;
}

function isQuatKeys(keys: string[]): boolean {
    if (keys.length !== 4) return false;
    const set = new Set(keys);
    return set.has('x') && set.has('y') && set.has('z') && set.has('w');
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

function nlerpQuat(a: Record<string, number>, b: Record<string, number>, t: number): Record<string, number> {
    // Component-wise lerp toward the nearer cover (negate on negative dot),
    // then normalize — exact enough for replication smoothing.
    const dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
    const s = dot < 0 ? -1 : 1;
    let x = lerp(a.x, b.x * s, t);
    let y = lerp(a.y, b.y * s, t);
    let z = lerp(a.z, b.z * s, t);
    let w = lerp(a.w, b.w * s, t);
    const len = Math.hypot(x, y, z, w);
    if (len > 1e-8) { x /= len; y /= len; z /= len; w /= len; }
    return { x, y, z, w };
}

/** Interpolate between two decoded values of one shape at t ∈ [0,1].
 *  Non-continuous values hold the older sample. */
export function lerpValue(shape: FieldShape, a: unknown, b: unknown, t: number): unknown {
    switch (shape.kind) {
        case 'f32':
            return lerp(a as number, b as number, t);
        case 'object': {
            const ra = a as Record<string, unknown>;
            const rb = b as Record<string, unknown>;
            if (isQuatKeys(shape.keys)) {
                return nlerpQuat(ra as Record<string, number>, rb as Record<string, number>, t);
            }
            const out: Record<string, unknown> = {};
            for (let i = 0; i < shape.keys.length; i++) {
                const k = shape.keys[i];
                out[k] = lerpValue(shape.shapes[i], ra[k], rb[k], t);
            }
            return out;
        }
        default:
            return a;
    }
}

/** One field's sample series (ticks strictly increasing). */
class FieldSeries {
    readonly samples: Sample[] = [];

    push(tick: number, value: unknown): void {
        const last = this.samples[this.samples.length - 1];
        if (last && tick <= last.tick) {
            // Redelivery / reorder of an already-seen tick: newest write wins.
            last.value = value;
            return;
        }
        this.samples.push({ tick, value });
    }

    /** Drop samples that can no longer bracket any time ≥ `beforeTick`
     *  (keep one sample at/below it as the hold/lerp base). */
    trim(beforeTick: number): void {
        let drop = 0;
        while (drop < this.samples.length - 1 && this.samples[drop + 1].tick <= beforeTick) drop++;
        if (drop > 0) this.samples.splice(0, drop);
    }

    /** Sample at time t (in ticks). Returns undefined before the first sample. */
    sample(shape: FieldShape, t: number): unknown {
        const s = this.samples;
        if (s.length === 0) return undefined;
        if (t <= s[0].tick) return t === s[0].tick ? s[0].value : undefined;
        for (let i = s.length - 1; i >= 0; i--) {
            if (s[i].tick <= t) {
                const a = s[i];
                const b = s[i + 1];
                if (!b) return a.value; // newest known — hold
                return lerpValue(shape, a.value, b.value, (t - a.tick) / (b.tick - a.tick));
            }
        }
        return undefined;
    }
}

/** All buffered series for one ghost component: fieldIndex → series. */
export class ComponentBuffer {
    readonly byField = new Map<number, FieldSeries>();

    push(fieldIndex: number, tick: number, value: unknown): void {
        let series = this.byField.get(fieldIndex);
        if (!series) {
            series = new FieldSeries();
            this.byField.set(fieldIndex, series);
        }
        series.push(tick, value);
    }
}

/**
 * The client-side buffer of everything received but not yet (fully) shown.
 * The render clock trails `newestTick` by `delayTicks`, advancing on render
 * time with a soft correction toward the target so delivery jitter bends the
 * clock instead of snapping the world.
 */
export class InterpolationState {
    /** netId → componentId → buffer. */
    readonly buffers = new Map<number, Map<number, ComponentBuffer>>();
    newestTick = 0;
    private renderTime_: number | null = null;

    constructor(public delayTicks: number) {}

    push(netId: number, componentId: number, fieldIndex: number, tick: number, value: unknown): void {
        if (tick > this.newestTick) this.newestTick = tick;
        let perComp = this.buffers.get(netId);
        if (!perComp) {
            perComp = new Map();
            this.buffers.set(netId, perComp);
        }
        let buf = perComp.get(componentId);
        if (!buf) {
            buf = new ComponentBuffer();
            perComp.set(componentId, buf);
        }
        buf.push(fieldIndex, tick, value);
    }

    drop(netId: number): void {
        this.buffers.delete(netId);
    }

    /** Advance the render clock by `deltaTicks` of render time; returns the
     *  time (in server ticks) to sample the series at. */
    advance(deltaTicks: number): number {
        const target = this.newestTick - this.delayTicks;
        if (this.renderTime_ === null) {
            this.renderTime_ = target;
        } else {
            this.renderTime_ += deltaTicks;
            // Soft-sync toward the target so late/early bursts bend the clock.
            this.renderTime_ += (target - this.renderTime_) * 0.1;
            // Never extrapolate past the newest data; never fall further than
            // one extra delay behind.
            const max = this.newestTick;
            const min = target - this.delayTicks;
            if (this.renderTime_ > max) this.renderTime_ = max;
            if (this.renderTime_ < min) this.renderTime_ = min;
        }
        // Retire series history behind the clock.
        for (const perComp of this.buffers.values()) {
            for (const buf of perComp.values()) {
                for (const series of buf.byField.values()) series.trim(this.renderTime_);
            }
        }
        return this.renderTime_;
    }
}
