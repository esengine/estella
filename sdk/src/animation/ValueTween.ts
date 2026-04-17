/**
 * @file    ValueTween.ts
 * @brief   JS-side value tweening (fallback for fields not covered by C++ TweenTarget)
 */

import type { ESEngineModule, CppRegistry } from '../wasm';
import type { Entity } from '../types';
import { applyEasing, EasingType, type BezierPoints } from './Easing';
import { LoopMode, TweenState, type TweenOptions } from './TweenTypes';

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
