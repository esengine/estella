/**
 * @file    ValueTween.ts
 * @brief   JS-side value tweening with easing functions ported from C++
 */

import type { ESEngineModule, CppRegistry } from '../wasm';
import type { Entity } from '../types';

// =============================================================================
// Enums (must match C++ TweenData.hpp)
// =============================================================================

export const EasingType = {
    Linear: 0,
    EaseInQuad: 1,
    EaseOutQuad: 2,
    EaseInOutQuad: 3,
    EaseInCubic: 4,
    EaseOutCubic: 5,
    EaseInOutCubic: 6,
    EaseInBack: 7,
    EaseOutBack: 8,
    EaseInOutBack: 9,
    EaseInElastic: 10,
    EaseOutElastic: 11,
    EaseInOutElastic: 12,
    EaseOutBounce: 13,
    CubicBezier: 14,
    Step: 15,
} as const;

export type EasingType = (typeof EasingType)[keyof typeof EasingType];

export const TweenState = {
    Running: 0,
    Paused: 1,
    Completed: 2,
    Cancelled: 3,
} as const;

export type TweenState = (typeof TweenState)[keyof typeof TweenState];

export const LoopMode = {
    None: 0,
    Restart: 1,
    PingPong: 2,
} as const;

export type LoopMode = (typeof LoopMode)[keyof typeof LoopMode];

export interface TweenOptions {
    easing?: EasingType;
    delay?: number;
    loop?: LoopMode;
    loopCount?: number;
}

export interface BezierPoints {
    p1x: number;
    p1y: number;
    p2x: number;
    p2y: number;
}

// =============================================================================
// Easing Functions (1:1 port from C++ EasingFunctions.hpp)
// =============================================================================

function easeLinear(t: number): number {
    return t;
}

function easeInQuad(t: number): number {
    return t * t;
}

function easeOutQuad(t: number): number {
    return t * (2 - t);
}

function easeInOutQuad(t: number): number {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

function easeInCubic(t: number): number {
    return t * t * t;
}

function easeOutCubic(t: number): number {
    const t1 = t - 1;
    return t1 * t1 * t1 + 1;
}

function easeInOutCubic(t: number): number {
    return t < 0.5
        ? 4 * t * t * t
        : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;
}

const BACK_C1 = 1.70158;
const BACK_C3 = BACK_C1 + 1;
const BACK_C2 = BACK_C1 * 1.525;

function easeInBack(t: number): number {
    return BACK_C3 * t * t * t - BACK_C1 * t * t;
}

function easeOutBack(t: number): number {
    const t1 = t - 1;
    return 1 + BACK_C3 * t1 * t1 * t1 + BACK_C1 * t1 * t1;
}

function easeInOutBack(t: number): number {
    if (t < 0.5) {
        return (Math.pow(2 * t, 2) * ((BACK_C2 + 1) * 2 * t - BACK_C2)) / 2;
    }
    return (Math.pow(2 * t - 2, 2) * ((BACK_C2 + 1) * (t * 2 - 2) + BACK_C2) + 2) / 2;
}

const ELASTIC_C4 = (2 * Math.PI) / 3;
const ELASTIC_C5 = (2 * Math.PI) / 4.5;

function easeInElastic(t: number): number {
    if (t === 0 || t === 1) return t;
    return -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * ELASTIC_C4);
}

function easeOutElastic(t: number): number {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ELASTIC_C4) + 1;
}

function easeInOutElastic(t: number): number {
    if (t === 0 || t === 1) return t;
    if (t < 0.5) {
        return -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * ELASTIC_C5)) / 2;
    }
    return (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * ELASTIC_C5)) / 2 + 1;
}

const BOUNCE_N1 = 7.5625;
const BOUNCE_D1 = 2.75;

function easeOutBounce(t: number): number {
    if (t < 1 / BOUNCE_D1) {
        return BOUNCE_N1 * t * t;
    } else if (t < 2 / BOUNCE_D1) {
        t -= 1.5 / BOUNCE_D1;
        return BOUNCE_N1 * t * t + 0.75;
    } else if (t < 2.5 / BOUNCE_D1) {
        t -= 2.25 / BOUNCE_D1;
        return BOUNCE_N1 * t * t + 0.9375;
    } else {
        t -= 2.625 / BOUNCE_D1;
        return BOUNCE_N1 * t * t + 0.984375;
    }
}

const BEZIER_MAX_ITERATIONS = 8;
const BEZIER_EPSILON = 1e-6;

function cubicBezier(t: number, p1x: number, p1y: number, p2x: number, p2y: number): number {
    let x = t;
    for (let i = 0; i < BEZIER_MAX_ITERATIONS; i++) {
        const ix = 1 - x;
        const cx = 3 * p1x * ix * ix * x + 3 * p2x * ix * x * x + x * x * x - t;
        if (Math.abs(cx) < BEZIER_EPSILON) break;
        const dx = 3 * p1x * (1 - 2 * x) * (1 - x)
                 + 6 * p2x * x * (1 - x)
                 - 3 * p2x * x * x
                 + 3 * x * x;
        if (Math.abs(dx) < BEZIER_EPSILON) break;
        x -= cx / dx;
    }
    const ix = 1 - x;
    return 3 * p1y * ix * ix * x + 3 * p2y * ix * x * x + x * x * x;
}

function step(t: number): number {
    return t < 1 ? 0 : 1;
}

// =============================================================================
// Public Easing Dispatcher
// =============================================================================

export function applyEasing(type: EasingType, t: number, bezier?: BezierPoints): number {
    switch (type) {
        case EasingType.Linear:           return easeLinear(t);
        case EasingType.EaseInQuad:       return easeInQuad(t);
        case EasingType.EaseOutQuad:      return easeOutQuad(t);
        case EasingType.EaseInOutQuad:    return easeInOutQuad(t);
        case EasingType.EaseInCubic:      return easeInCubic(t);
        case EasingType.EaseOutCubic:     return easeOutCubic(t);
        case EasingType.EaseInOutCubic:   return easeInOutCubic(t);
        case EasingType.EaseInBack:       return easeInBack(t);
        case EasingType.EaseOutBack:      return easeOutBack(t);
        case EasingType.EaseInOutBack:    return easeInOutBack(t);
        case EasingType.EaseInElastic:    return easeInElastic(t);
        case EasingType.EaseOutElastic:   return easeOutElastic(t);
        case EasingType.EaseInOutElastic: return easeInOutElastic(t);
        case EasingType.EaseOutBounce:    return easeOutBounce(t);
        case EasingType.CubicBezier:
            if (bezier) return cubicBezier(t, bezier.p1x, bezier.p1y, bezier.p2x, bezier.p2y);
            return easeLinear(t);
        case EasingType.Step:             return step(t);
        default:                          return easeLinear(t);
    }
}

// =============================================================================
// Value Tween Entry
// =============================================================================

interface ValueTweenEntry {
    id: number;
    from: number;
    to: number;
    duration: number;
    elapsed: number;
    delay: number;
    easing: EasingType;
    bezierPoints: BezierPoints | null;
    state: TweenState;
    loop: LoopMode;
    loopCount: number;
    loopsRemaining: number;
    callback: (value: number) => void;
    sequenceNext: number | null;
    sequenceNextExternal: { pause(): void; resume(): void } | null;
}

// =============================================================================
// Value Tween Manager
// =============================================================================

class ValueTweenManager {
    private entries_ = new Map<number, ValueTweenEntry>();
    private nextId_ = 1;
    private cppSequences_ = new Map<number, number>();
    private module_: ESEngineModule | null = null;
    private registry_: CppRegistry | null = null;

    init(module: ESEngineModule, registry: CppRegistry): void {
        this.module_ = module;
        this.registry_ = registry;
    }

    create(
        from: number,
        to: number,
        duration: number,
        callback: (value: number) => void,
        options?: TweenOptions,
    ): number {
        const id = this.nextId_++;
        this.entries_.set(id, {
            id,
            from,
            to,
            duration,
            elapsed: 0,
            delay: options?.delay ?? 0,
            easing: options?.easing ?? EasingType.Linear,
            bezierPoints: null,
            state: TweenState.Running,
            loop: options?.loop ?? LoopMode.None,
            loopCount: options?.loopCount ?? 0,
            loopsRemaining: options?.loopCount ?? 0,
            callback,
            sequenceNext: null,
            sequenceNextExternal: null,
        });
        return id;
    }

    update(dt: number): void {
        if (this.module_ && this.registry_) {
            for (const [cppEntity, jsTweenId] of this.cppSequences_) {
                const cppState = this.module_._anim_getTweenState(
                    this.registry_, cppEntity as Entity,
                );
                if (cppState === TweenState.Completed) {
                    this.resume(jsTweenId);
                    this.cppSequences_.delete(cppEntity);
                }
            }
        }

        for (const entry of this.entries_.values()) {
            if (entry.state !== TweenState.Running) continue;

            if (entry.delay > 0) {
                entry.delay -= dt;
                if (entry.delay > 0) continue;
                dt = -entry.delay;
                entry.delay = 0;
            }

            entry.elapsed += dt;
            const t = Math.min(entry.elapsed / entry.duration, 1);
            const easedT = applyEasing(entry.easing, t, entry.bezierPoints ?? undefined);
            entry.callback(entry.from + (entry.to - entry.from) * easedT);

            if (t >= 1) {
                if (entry.loop !== LoopMode.None) {
                    const infinite = entry.loopCount === 0;
                    if (infinite || entry.loopsRemaining > 1) {
                        if (!infinite) entry.loopsRemaining--;
                        entry.elapsed = 0;
                        if (entry.loop === LoopMode.PingPong) {
                            const tmp = entry.from;
                            entry.from = entry.to;
                            entry.to = tmp;
                        }
                        continue;
                    }
                }
                entry.state = TweenState.Completed;
                if (entry.sequenceNext !== null) {
                    this.resume(entry.sequenceNext);
                }
                if (entry.sequenceNextExternal) {
                    entry.sequenceNextExternal.resume();
                }
            }
        }

        for (const [id, entry] of this.entries_) {
            if (
                entry.state === TweenState.Completed ||
                entry.state === TweenState.Cancelled
            ) {
                this.entries_.delete(id);
            }
        }
    }

    pause(id: number): void {
        const entry = this.entries_.get(id);
        if (entry && entry.state === TweenState.Running) {
            entry.state = TweenState.Paused;
        }
    }

    resume(id: number): void {
        const entry = this.entries_.get(id);
        if (entry && entry.state === TweenState.Paused) {
            entry.state = TweenState.Running;
        }
    }

    cancel(id: number): void {
        const entry = this.entries_.get(id);
        if (entry) {
            entry.state = TweenState.Cancelled;
        }
    }

    getState(id: number): TweenState {
        const entry = this.entries_.get(id);
        return entry ? entry.state as TweenState : TweenState.Cancelled;
    }

    setBezier(id: number, p1x: number, p1y: number, p2x: number, p2y: number): void {
        const entry = this.entries_.get(id);
        if (entry) {
            entry.bezierPoints = { p1x, p1y, p2x, p2y };
        }
    }

    setSequenceNext(id: number, nextId: number): void {
        const entry = this.entries_.get(id);
        if (entry) {
            entry.sequenceNext = nextId;
            this.pause(nextId);
        }
    }

    setSequenceNextExternal(id: number, external: { pause(): void; resume(): void }): void {
        const entry = this.entries_.get(id);
        if (entry) {
            entry.sequenceNextExternal = external;
            external.pause();
        }
    }

    registerCppSequence(cppEntity: Entity, jsTweenId: number): void {
        this.cppSequences_.set(cppEntity as number, jsTweenId);
        this.pause(jsTweenId);
    }

    shutdown(): void {
        this.entries_.clear();
        this.cppSequences_.clear();
        this.module_ = null;
        this.registry_ = null;
        this.nextId_ = 1;
    }
}

export const valueTweenManager = new ValueTweenManager();

// =============================================================================
// Value Tween Handle
// =============================================================================

export class ValueTweenHandle {
    readonly id: number;

    constructor(id: number) {
        this.id = id;
    }

    get state(): TweenState {
        return valueTweenManager.getState(this.id);
    }

    bezier(p1x: number, p1y: number, p2x: number, p2y: number): this {
        valueTweenManager.setBezier(this.id, p1x, p1y, p2x, p2y);
        return this;
    }

    then(next: ValueTweenHandle): this;
    then(next: { pause(): void; resume(): void }): this;
    then(next: ValueTweenHandle | { pause(): void; resume(): void }): this {
        if (next instanceof ValueTweenHandle) {
            valueTweenManager.setSequenceNext(this.id, next.id);
        } else {
            valueTweenManager.setSequenceNextExternal(this.id, next);
        }
        return this;
    }

    pause(): void {
        valueTweenManager.pause(this.id);
    }

    resume(): void {
        valueTweenManager.resume(this.id);
    }

    cancel(): void {
        valueTweenManager.cancel(this.id);
    }
}
