/**
 * @file    Tween.ts
 * @brief   Property tween API wrapping C++ TweenSystem
 */

import type { Entity } from '../types';
import type { ESEngineModule, CppRegistry } from '../wasm';
import { EasingType } from './Easing';
import { LoopMode, TweenState, type TweenOptions } from './TweenTypes';
import { valueTweenManager, ValueTweenHandle } from './ValueTween';

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
 * use `Tween.value(...)` with a callback that writes the field yourself,
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
    readonly entity: Entity;

    constructor(module: ESEngineModule, registry: CppRegistry, entity: Entity) {
        this.module_ = module;
        this.registry_ = registry;
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
            valueTweenManager.registerCppSequence(this.entity, next.id);
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
// Tween Static API
// =============================================================================

let _module: ESEngineModule | null = null;
let _registry: CppRegistry | null = null;

export function initTweenAPI(module: ESEngineModule, registry: CppRegistry): void {
    _module = module;
    _registry = registry;
    valueTweenManager.init(module, registry);
}

export function shutdownTweenAPI(): void {
    valueTweenManager.shutdown();
    _module = null;
    _registry = null;
}

function getModule(): ESEngineModule {
    if (!_module) throw new Error('Tween API not initialized');
    return _module;
}

function getRegistry(): CppRegistry {
    if (!_registry) throw new Error('Tween API not initialized');
    return _registry;
}

export const Tween = {
    to(entity: Entity, target: TweenTarget, from: number, to: number,
       duration: number, options?: TweenOptions): TweenHandle {
        const m = getModule();
        const r = getRegistry();
        const easing = options?.easing ?? EasingType.Linear;
        const delay = options?.delay ?? 0;
        const loop = options?.loop ?? LoopMode.None;
        const loopCount = options?.loopCount ?? 0;

        const tweenEntity = m._anim_createTween(
            r, entity, target, from, to, duration,
            easing, delay, loop, loopCount,
        ) as Entity;

        return new TweenHandle(m, r, tweenEntity);
    },

    value(from: number, to: number, duration: number,
          callback: (value: number) => void,
          options?: TweenOptions): ValueTweenHandle {
        const id = valueTweenManager.create(from, to, duration, callback, options);
        return new ValueTweenHandle(id);
    },

    cancel(tweenHandle: TweenHandle): void {
        getModule()._anim_cancelTween(getRegistry(), tweenHandle.entity);
    },

    cancelAll(entity: Entity): void {
        getModule()._anim_cancelAllTweens(getRegistry(), entity);
    },

    update(deltaTime: number): void {
        getModule()._anim_updateTweens(getRegistry(), deltaTime);
        valueTweenManager.update(deltaTime);
    },
};
