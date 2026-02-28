/**
 * @file    Tween.ts
 * @brief   Property tween API wrapping C++ TweenSystem
 */

import type { Entity } from '../types';
import type { World } from '../world';
import type { ESEngineModule, CppRegistry } from '../wasm';

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

// =============================================================================
// Tween Options
// =============================================================================

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

    then(next: TweenHandle): this {
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
}

export function shutdownTweenAPI(): void {
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

    cancel(tweenHandle: TweenHandle): void {
        getModule()._anim_cancelTween(getRegistry(), tweenHandle.entity);
    },

    cancelAll(entity: Entity): void {
        getModule()._anim_cancelAllTweens(getRegistry(), entity);
    },

    update(deltaTime: number): void {
        getModule()._anim_updateTweens(getRegistry(), deltaTime);
    },
} as const;
