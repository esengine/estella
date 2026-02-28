import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import type { Entity } from '../src/types';
import {
    Tween,
    TweenHandle,
    EasingType,
    TweenTarget,
    TweenState,
    LoopMode,
    initTweenAPI,
    shutdownTweenAPI,
} from '../src/animation/Tween';

function createMockAnimModule() {
    const calls: Record<string, any[][]> = {};
    function track(name: string, ...args: any[]) {
        (calls[name] ??= []).push(args);
    }

    let nextTweenEntity = 1000;

    const registry = {} as CppRegistry;

    const module = {
        _anim_createTween: vi.fn((_reg: CppRegistry, entity: number, targetProp: number,
            from: number, to: number, duration: number,
            easing: number, delay: number, loopMode: number, loopCount: number) => {
            return nextTweenEntity++;
        }),
        _anim_cancelTween: vi.fn(),
        _anim_cancelAllTweens: vi.fn(),
        _anim_pauseTween: vi.fn(),
        _anim_resumeTween: vi.fn(),
        _anim_setTweenBezier: vi.fn(),
        _anim_setSequenceNext: vi.fn(),
        _anim_updateTweens: vi.fn(),
        _anim_getTweenState: vi.fn(() => TweenState.Running),
    } as unknown as ESEngineModule;

    return { module, registry, calls };
}

describe('Tween API', () => {
    let module: ESEngineModule;
    let registry: CppRegistry;

    beforeEach(() => {
        const mock = createMockAnimModule();
        module = mock.module;
        registry = mock.registry;
        initTweenAPI(module, registry);
    });

    afterEach(() => {
        shutdownTweenAPI();
    });

    // =========================================================================
    // Enums
    // =========================================================================

    describe('enums', () => {
        it('EasingType values should match C++ enum', () => {
            expect(EasingType.Linear).toBe(0);
            expect(EasingType.EaseInQuad).toBe(1);
            expect(EasingType.EaseOutBounce).toBe(13);
            expect(EasingType.CubicBezier).toBe(14);
            expect(EasingType.Step).toBe(15);
        });

        it('TweenTarget values should match C++ enum', () => {
            expect(TweenTarget.PositionX).toBe(0);
            expect(TweenTarget.PositionY).toBe(1);
            expect(TweenTarget.ScaleX).toBe(3);
            expect(TweenTarget.ColorA).toBe(9);
            expect(TweenTarget.CameraOrthoSize).toBe(12);
        });

        it('TweenState values should match C++ enum', () => {
            expect(TweenState.Running).toBe(0);
            expect(TweenState.Paused).toBe(1);
            expect(TweenState.Completed).toBe(2);
            expect(TweenState.Cancelled).toBe(3);
        });

        it('LoopMode values should match C++ enum', () => {
            expect(LoopMode.None).toBe(0);
            expect(LoopMode.Restart).toBe(1);
            expect(LoopMode.PingPong).toBe(2);
        });
    });

    // =========================================================================
    // Tween.to()
    // =========================================================================

    describe('Tween.to()', () => {
        it('should call WASM createTween with correct params', () => {
            const entity = 42 as Entity;
            Tween.to(entity, TweenTarget.PositionX, 0, 100, 1.5);

            expect(module._anim_createTween).toHaveBeenCalledWith(
                registry, 42, TweenTarget.PositionX,
                0, 100, 1.5,
                EasingType.Linear, 0, LoopMode.None, 0,
            );
        });

        it('should pass easing option', () => {
            Tween.to(1 as Entity, TweenTarget.ColorA, 1, 0, 0.5, {
                easing: EasingType.EaseOutQuad,
            });

            expect(module._anim_createTween).toHaveBeenCalledWith(
                registry, 1, TweenTarget.ColorA,
                1, 0, 0.5,
                EasingType.EaseOutQuad, 0, LoopMode.None, 0,
            );
        });

        it('should pass delay option', () => {
            Tween.to(1 as Entity, TweenTarget.ScaleX, 1, 2, 1, {
                delay: 0.5,
            });

            expect(module._anim_createTween).toHaveBeenCalledWith(
                registry, 1, TweenTarget.ScaleX,
                1, 2, 1,
                EasingType.Linear, 0.5, LoopMode.None, 0,
            );
        });

        it('should pass loop options', () => {
            Tween.to(1 as Entity, TweenTarget.PositionY, 0, 50, 2, {
                loop: LoopMode.PingPong,
                loopCount: 3,
            });

            expect(module._anim_createTween).toHaveBeenCalledWith(
                registry, 1, TweenTarget.PositionY,
                0, 50, 2,
                EasingType.Linear, 0, LoopMode.PingPong, 3,
            );
        });

        it('should return a TweenHandle', () => {
            const handle = Tween.to(1 as Entity, TweenTarget.PositionX, 0, 10, 1);
            expect(handle).toBeInstanceOf(TweenHandle);
        });
    });

    // =========================================================================
    // TweenHandle
    // =========================================================================

    describe('TweenHandle', () => {
        it('should report state from WASM', () => {
            (module._anim_getTweenState as ReturnType<typeof vi.fn>)
                .mockReturnValueOnce(TweenState.Paused);

            const handle = Tween.to(1 as Entity, TweenTarget.PositionX, 0, 10, 1);
            expect(handle.state).toBe(TweenState.Paused);
        });

        it('should call WASM setBezier', () => {
            const handle = Tween.to(1 as Entity, TweenTarget.PositionX, 0, 10, 1);
            handle.bezier(0.25, 0.1, 0.25, 1.0);

            expect(module._anim_setTweenBezier).toHaveBeenCalledWith(
                registry, handle.entity, 0.25, 0.1, 0.25, 1.0,
            );
        });

        it('bezier() should return this for chaining', () => {
            const handle = Tween.to(1 as Entity, TweenTarget.PositionX, 0, 10, 1);
            const result = handle.bezier(0, 0, 1, 1);
            expect(result).toBe(handle);
        });

        it('should chain tweens with then()', () => {
            const h1 = Tween.to(1 as Entity, TweenTarget.PositionX, 0, 10, 1);
            const h2 = Tween.to(1 as Entity, TweenTarget.PositionY, 0, 20, 1);
            h1.then(h2);

            expect(module._anim_setSequenceNext).toHaveBeenCalledWith(
                registry, h1.entity, h2.entity,
            );
        });

        it('then() should return this for chaining', () => {
            const h1 = Tween.to(1 as Entity, TweenTarget.PositionX, 0, 10, 1);
            const h2 = Tween.to(1 as Entity, TweenTarget.PositionY, 0, 20, 1);
            const result = h1.then(h2);
            expect(result).toBe(h1);
        });

        it('should pause a tween', () => {
            const handle = Tween.to(1 as Entity, TweenTarget.PositionX, 0, 10, 1);
            handle.pause();

            expect(module._anim_pauseTween).toHaveBeenCalledWith(registry, handle.entity);
        });

        it('should resume a tween', () => {
            const handle = Tween.to(1 as Entity, TweenTarget.PositionX, 0, 10, 1);
            handle.resume();

            expect(module._anim_resumeTween).toHaveBeenCalledWith(registry, handle.entity);
        });

        it('should cancel a tween via handle', () => {
            const handle = Tween.to(1 as Entity, TweenTarget.PositionX, 0, 10, 1);
            handle.cancel();

            expect(module._anim_cancelTween).toHaveBeenCalledWith(registry, handle.entity);
        });
    });

    // =========================================================================
    // Tween static methods
    // =========================================================================

    describe('static methods', () => {
        it('Tween.cancel() should delegate to WASM', () => {
            const handle = Tween.to(1 as Entity, TweenTarget.PositionX, 0, 10, 1);
            Tween.cancel(handle);

            expect(module._anim_cancelTween).toHaveBeenCalledWith(registry, handle.entity);
        });

        it('Tween.cancelAll() should delegate to WASM', () => {
            const entity = 5 as Entity;
            Tween.cancelAll(entity);

            expect(module._anim_cancelAllTweens).toHaveBeenCalledWith(registry, 5);
        });

        it('Tween.update() should delegate to WASM', () => {
            Tween.update(0.016);

            expect(module._anim_updateTweens).toHaveBeenCalledWith(registry, 0.016);
        });
    });

    // =========================================================================
    // Lifecycle
    // =========================================================================

    describe('lifecycle', () => {
        it('should throw if used before init', () => {
            shutdownTweenAPI();
            expect(() => Tween.to(1 as Entity, TweenTarget.PositionX, 0, 10, 1))
                .toThrow('Tween API not initialized');
        });

        it('should work after re-init', () => {
            shutdownTweenAPI();
            initTweenAPI(module, registry);

            expect(() => Tween.to(1 as Entity, TweenTarget.PositionX, 0, 10, 1))
                .not.toThrow();
        });
    });
});
