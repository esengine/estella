/**
 * @file    TimelineEvaluator.ts
 * @brief   Pure-TS timeline sampler — evaluate a TimelineAsset at an absolute
 *          time and apply its property tracks to the world.
 *
 * The engine's C++ TimelineSystem is a temporary implementation (see
 * docs/REARCH_ANIMATION.md). This is the modern replacement's kernel: ONE
 * sample(time) call drives both forward playback (advance the clock, then sample)
 * and editor scrubbing (sample at any T) — so the editor gets "scrub ==
 * evaluate-at-T" for free, with no separate evaluate/apply paths.
 *
 * The interpolation math is a 1:1 port of TimelineSystem.cpp::evaluateChannel
 * (hermite/linear/step/ease) so playback and editor preview match the C++ path
 * numerically, and P4 can delete the C++ runtime with no regression.
 *
 * The sampler is dependency-injected (world / component lookup / child resolution)
 * so it is a pure function: unit-testable without WASM and reusable by both the
 * runtime and the editor preview bridge.
 */

import { TrackType, InterpType, WrapMode, type TimelineAsset, type PropertyChannel } from './TimelineTypes';
import { setNestedProperty, resolveChildEntity } from './TimelineRuntime';
import { getComponent } from '../component';
import type { Entity } from '../types';

// ---------------------------------------------------------------------------
// Core math — 1:1 port of TimelineSystem.cpp (keep in lock-step)
// ---------------------------------------------------------------------------

function hermite(p0: number, p1: number, m0: number, m1: number, t: number): number {
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1;
}

function easeIn(t: number): number {
    return t * t;
}

function easeOut(t: number): number {
    return 1 - (1 - t) * (1 - t);
}

function easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
}

/** Evaluate a single property channel at `time` (seconds). Endpoints clamp. */
export function evaluateChannel(channel: PropertyChannel, time: number): number {
    const kfs = channel.keyframes;
    if (!kfs || kfs.length === 0) return 0;
    if (kfs.length === 1) return kfs[0].value;

    if (time <= kfs[0].time) return kfs[0].value;
    if (time >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].value;

    let i = 0;
    while (i < kfs.length - 1 && kfs[i + 1].time <= time) i++;

    const k0 = kfs[i];
    const k1 = kfs[i + 1];
    const dt = k1.time - k0.time;
    if (dt <= 0) return k0.value;

    const t = (time - k0.time) / dt;

    switch (k0.interpolation) {
        case InterpType.Linear:
            return k0.value + (k1.value - k0.value) * t;
        case InterpType.Step:
            return k0.value;
        case InterpType.EaseIn:
            return k0.value + (k1.value - k0.value) * easeIn(t);
        case InterpType.EaseOut:
            return k0.value + (k1.value - k0.value) * easeOut(t);
        case InterpType.EaseInOut:
            return k0.value + (k1.value - k0.value) * easeInOut(t);
        case InterpType.Hermite:
        default:
            return hermite(k0.value, k1.value, k0.outTangent * dt, k1.inTangent * dt, t);
    }
}

/** Map an absolute time through the clip's wrap mode (for forward playback). */
export function applyWrapMode(
    time: number, duration: number, mode: WrapMode,
): { time: number; stopped: boolean } {
    if (duration <= 0) return { time: 0, stopped: true };
    if (time < 0) return { time: 0, stopped: false };
    if (time < duration) return { time, stopped: false };

    switch (mode) {
        case WrapMode.Loop:
            return { time: time % duration, stopped: false };
        case WrapMode.PingPong: {
            const cycle = duration * 2;
            const t = time % cycle;
            return { time: t <= duration ? t : cycle - t, stopped: false };
        }
        case WrapMode.Once:
        default:
            return { time: duration, stopped: true };
    }
}

// ---------------------------------------------------------------------------
// Field application — seed of the REARCH_ANIMATION L1 reflection writer table
// ---------------------------------------------------------------------------

type FieldWriter = (data: any, value: number) => void;

/**
 * Per-field writers for animatable paths whose JS shape differs from the raw
 * dot-path (so a generic `setNestedProperty` would corrupt them). This is the
 * TS seed of L1's generated reflection writer table; for now the only such case
 * is Transform rotation. Mirrors animTargets.generated.hpp exactly (value is the
 * full Z angle in radians; the quaternion uses the half-angle) so editor preview
 * matches the C++ runtime bit-for-bit.
 */
const WRITER_OVERRIDES: Record<string, FieldWriter> = {
    'Transform.rotation.z': (data, v) => {
        const h = v * 0.5;
        data.rotation = { w: Math.cos(h), x: 0, y: 0, z: Math.sin(h) };
    },
};

function applyField(data: any, component: string, property: string, value: number): boolean {
    const override = WRITER_OVERRIDES[`${component}.${property}`];
    if (override) {
        override(data, value);
        return true;
    }
    return setNestedProperty(data, property, value);
}

// ---------------------------------------------------------------------------
// Sampler
// ---------------------------------------------------------------------------

/** Minimal world surface the sampler needs (component get/set by definition). */
export interface SampleWorld {
    has(entity: Entity, def: any): boolean;
    get(entity: Entity, def: any): any;
    set(entity: Entity, def: any, data: any): void;
}

export interface SampleDeps {
    world: SampleWorld;
    getComponent: (name: string) => any;
    resolveChild: (root: Entity, childPath: string) => Entity | null;
}

export interface SampleOptions {
    /** Return true to skip a channel — the editor uses this for muted tracks. */
    skipChannel?: (childPath: string, component: string, property: string) => boolean;
}

/**
 * Evaluate every property track at `time` and write the results to the world.
 * P1 covers property tracks only; spine/audio/spriteAnim/activation side-effects
 * land in P3/P4. Each track touches one component on one resolved entity, so it
 * reads/writes that component once (all channels folded into a single set).
 */
export function sampleTimeline(
    asset: TimelineAsset, time: number, rootEntity: Entity, deps: SampleDeps, opts?: SampleOptions,
): void {
    for (const track of asset.tracks) {
        if (track.type !== TrackType.Property) continue;

        const def = deps.getComponent(track.component);
        if (!def) continue;

        const entity = deps.resolveChild(rootEntity, track.childPath);
        if (entity == null || !deps.world.has(entity, def)) continue;

        const data = deps.world.get(entity, def);
        let changed = false;
        for (const ch of track.channels) {
            if (!ch.keyframes || ch.keyframes.length === 0) continue;
            if (opts?.skipChannel?.(track.childPath, track.component, ch.property)) continue;
            const v = evaluateChannel(ch, time);
            if (applyField(data, track.component, ch.property, v)) changed = true;
        }
        if (changed) deps.world.set(entity, def, data);
    }
}

/**
 * Convenience wrapper binding the real SDK component registry + child resolver.
 * The editor preview bridge and the runtime both call this; tests inject mocks
 * into {@link sampleTimeline} directly.
 */
export function sampleTimelineInWorld(
    asset: TimelineAsset, time: number, world: SampleWorld & any, rootEntity: Entity, opts?: SampleOptions,
): void {
    sampleTimeline(asset, time, rootEntity, {
        world,
        getComponent,
        resolveChild: (root, childPath) => resolveChildEntity(world, root, childPath),
    }, opts);
}
