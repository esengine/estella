/**
 * @file    Tween.ts
 * @brief   Property tween API wrapping C++ TweenSystem
 */

import type { Entity } from '../types';
import type { ESEngineModule, CppRegistry } from '../wasm';
import {
    EasingType,
    TweenState,
    LoopMode,
    valueTweenManager,
    ValueTweenHandle,
} from './ValueTween';
import type { TweenOptions, BezierPoints } from './ValueTween';

// Re-export shared types from ValueTween for backward compatibility
export { EasingType, TweenState, LoopMode, ValueTweenHandle } from './ValueTween';
export type { TweenOptions, BezierPoints } from './ValueTween';

// =============================================================================
// Tween Target (C++ specific)
// =============================================================================

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
