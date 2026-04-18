/**
 * @file    Tween.ts
 * @brief   Property tween API wrapping C++ TweenSystem
 *
 * `TweenAPI` is per-app — each `App` owns an instance via the `Tween`
 * resource. Consume as `Res(Tween)` in a system or
 * `app.getResource(Tween)` outside ECS code.
 */

import type { Entity } from '../types';
import type { ESEngineModule, CppRegistry } from '../wasm';
import { defineResource } from '../resource';
import { EasingType } from './Easing';
import { LoopMode, TweenState, type TweenOptions } from './TweenTypes';
import { ValueTweenManager, ValueTweenHandle } from './ValueTween';
import {
    TweenGroup,
    TweenSequence,
    TweenCompositionManager,
    type Completable,
    type TweenFactory,
} from './TweenGroup';

// Re-export so consumers can reach shared types via the Tween entry point
export { EasingType, type BezierPoints } from './Easing';
export { TweenState, LoopMode, type TweenOptions } from './TweenTypes';
export { ValueTweenHandle } from './ValueTween';

// =============================================================================
// Tween Target (wire protocol — must stay in lock-step with
// src/esengine/animation/TweenData.hpp::TweenTarget — both the order
// and the numeric values are the WASM boundary contract).
// =============================================================================

/**
 * The 13 properties the C++ TweenSystem can drive directly.
 *
 * NOTE ON THE RELATIONSHIP TO `AnimTargetField`: Timeline uses the
 * wider, code-generated `AnimTargetField` enum (33 entries) because
 * it composes smaller setters on top of `AnimApplicator`. TweenTarget
 * is intentionally narrower — just the common property tweens that
 * have a fast C++ fast-path. Unifying the two would require
 * `_anim_createTween` on the WASM boundary to accept AnimTargetField
 * values directly and an extended TWEEN_TO_ANIM_FIELD map in
 * TweenSystem.cpp. That's a larger cross-layer change tracked
 * separately; for now TweenTarget is the stable subset.
 *
 * If you need to tween a field not in this list (e.g. UIRect.anchorMin.x),
 * use `tween.value(...)` with a callback that writes the field yourself,
 * or drive it via Timeline.
 */
export const TweenTarget = {
    PositionX: 0,
    PositionY: 1,
    PositionZ: 2,
    ScaleX: 3,
    ScaleY: 4,
    RotationZ: 5,
    ColorR: 6,
    ColorG: 7,
    ColorB: 8,
    ColorA: 9,
    SizeX: 10,
    SizeY: 11,
    CameraOrthoSize: 12,
} as const;

export type TweenTarget = (typeof TweenTarget)[keyof typeof TweenTarget];

// =============================================================================
// Tween Handle (fluent builder)
// =============================================================================

export class TweenHandle {
    private readonly module_: ESEngineModule;
    private readonly registry_: CppRegistry;
    private readonly valueManager_: ValueTweenManager;
    readonly entity: Entity;

    constructor(
        module: ESEngineModule,
        registry: CppRegistry,
        valueManager: ValueTweenManager,
        entity: Entity,
    ) {
        this.module_ = module;
        this.registry_ = registry;
        this.valueManager_ = valueManager;
        this.entity = entity;
    }

    get state(): TweenState {
        return this.module_._anim_getTweenState(this.registry_, this.entity) as TweenState;
    }

    bezier(p1x: number, p1y: number, p2x: number, p2y: number): this {
        this.module_._anim_setTweenBezier(this.registry_, this.entity, p1x, p1y, p2x, p2y);
        return this;
    }

    then(next: TweenHandle | ValueTweenHandle): this {
        if (next instanceof ValueTweenHandle) {
            this.valueManager_.registerCppSequence(this.entity, next.id);
            return this;
        }
        this.module_._anim_setSequenceNext(this.registry_, this.entity, next.entity);
        return this;
    }

    pause(): void {
        this.module_._anim_pauseTween(this.registry_, this.entity);
    }

    resume(): void {
        this.module_._anim_resumeTween(this.registry_, this.entity);
    }

    cancel(): void {
        this.module_._anim_cancelTween(this.registry_, this.entity);
    }
}

// =============================================================================
// Per-app Tween API
// =============================================================================

export class TweenAPI {
    private readonly module_: ESEngineModule;
    private readonly registry_: CppRegistry;
    private readonly valueManager_: ValueTweenManager;
    private readonly compositionManager_: TweenCompositionManager;

    constructor(module: ESEngineModule, registry: CppRegistry) {
        this.module_ = module;
        this.registry_ = registry;
        this.valueManager_ = new ValueTweenManager(module, registry);
        this.compositionManager_ = new TweenCompositionManager();
    }

    to(
        entity: Entity,
        target: TweenTarget,
        from: number,
        to: number,
        duration: number,
        options?: TweenOptions,
    ): TweenHandle {
        const easing = options?.easing ?? EasingType.Linear;
        const delay = options?.delay ?? 0;
        const loop = options?.loop ?? LoopMode.None;
        const loopCount = options?.loopCount ?? 0;

        const tweenEntity = this.module_._anim_createTween(
            this.registry_, entity, target, from, to, duration,
            easing, delay, loop, loopCount,
        ) as Entity;

        return new TweenHandle(this.module_, this.registry_, this.valueManager_, tweenEntity);
    }

    value(
        from: number,
        to: number,
        duration: number,
        callback: (value: number) => void,
        options?: TweenOptions,
    ): ValueTweenHandle {
        const id = this.valueManager_.create(from, to, duration, callback, options);
        return new ValueTweenHandle(this.valueManager_, id);
    }

    cancel(tweenHandle: TweenHandle): void {
        this.module_._anim_cancelTween(this.registry_, tweenHandle.entity);
    }

    cancelAll(entity: Entity): void {
        this.module_._anim_cancelAllTweens(this.registry_, entity);
    }

    update(deltaTime: number): void {
        this.module_._anim_updateTweens(this.registry_, deltaTime);
        this.valueManager_.update(deltaTime);
        this.compositionManager_.update();
    }

    // ---- Composition builders -------------------------------------------------

    parallel(tweens: Completable[]): TweenGroup {
        const group = new TweenGroup(tweens);
        this.compositionManager_.add(group);
        return group;
    }

    sequence(factories: TweenFactory[]): TweenSequence {
        const seq = new TweenSequence(factories);
        this.compositionManager_.add(seq);
        return seq;
    }

    delay(seconds: number): ValueTweenHandle {
        const id = this.valueManager_.create(0, 0, seconds, () => {});
        return new ValueTweenHandle(this.valueManager_, id);
    }

    /** @internal test hook — how many groups/sequences are still being polled */
    get activeCompositionCount(): number {
        return this.compositionManager_.activeCount;
    }

    /** @internal shutdown hook for plugin cleanup */
    clear(): void {
        this.compositionManager_.clear();
    }
}

/** Resource handle for the per-app Tween API. */
export const Tween = defineResource<TweenAPI>(null!, 'Tween');
