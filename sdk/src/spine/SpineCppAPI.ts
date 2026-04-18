import type { ESEngineModule, CppRegistry } from '../wasm';
import type { Entity } from '../types';

let module: ESEngineModule | null = null;

export function initSpineCppAPI(wasmModule: ESEngineModule): void {
    module = wasmModule;
}

export function shutdownSpineCppAPI(): void {
    module = null;
}

export const SpineCpp = {
    update(registry: { _cpp: CppRegistry }, dt: number): void {
        module?.spine_update?.(registry._cpp, dt);
    },

    play(entity: Entity, animation: string, loop: boolean = true, track: number = 0): boolean {
        return module?.spine_play?.(entity, animation, loop, track) ?? false;
    },

    addAnimation(entity: Entity, animation: string, loop: boolean = true, delay: number = 0, track: number = 0): boolean {
        return module?.spine_addAnimation?.(entity, animation, loop, delay, track) ?? false;
    },

    setSkin(entity: Entity, skinName: string): boolean {
        return module?.spine_setSkin?.(entity, skinName) ?? false;
    },

    getBonePosition(entity: Entity, boneName: string): { x: number; y: number } | null {
        return module?.spine_getBonePosition?.(entity, boneName) ?? null;
    },

    hasInstance(entity: Entity): boolean {
        return module?.spine_hasInstance?.(entity) ?? false;
    },

    reloadAssets(registry: { _cpp: CppRegistry }): void {
        module?.spine_reloadAssets?.(registry._cpp);
    },

    getAnimations(entity: Entity): string[] {
        return module?.spine_getAnimations?.(entity) ?? [];
    },

    getSkins(entity: Entity): string[] {
        return module?.spine_getSkins?.(entity) ?? [];
    },

    listConstraints(entity: Entity): { ik: string[]; transform: string[]; path: string[] } | null {
        return module?.spine_native_listConstraints?.(entity) ?? null;
    },

    getTransformConstraintMix(entity: Entity, name: string): { mixRotate: number; mixX: number; mixY: number; mixScaleX: number; mixScaleY: number; mixShearY: number } | null {
        return module?.spine_native_getTransformConstraintMix?.(entity, name) ?? null;
    },

    setTransformConstraintMix(entity: Entity, name: string, rotate: number, x: number, y: number, scaleX: number, scaleY: number, shearY: number): boolean {
        return module?.spine_native_setTransformConstraintMix?.(entity, name, rotate, x, y, scaleX, scaleY, shearY) ?? false;
    },

    getPathConstraintMix(entity: Entity, name: string): { position: number; spacing: number; mixRotate: number; mixX: number; mixY: number } | null {
        return module?.spine_native_getPathConstraintMix?.(entity, name) ?? null;
    },

    setPathConstraintMix(entity: Entity, name: string, position: number, spacing: number, rotate: number, x: number, y: number): boolean {
        return module?.spine_native_setPathConstraintMix?.(entity, name, position, spacing, rotate, x, y) ?? false;
    },

    getEventCount(): number {
        return module?.spine_native_getEventCount?.() ?? 0;
    },

    getEventRecord(index: number): { entity: number; animationName: string; eventName: string; stringValue: string } | null {
        return module?.spine_native_getEventRecord?.(index) ?? null;
    },

    getEventBuffer(): number {
        return module?.spine_native_getEventBuffer?.() ?? 0;
    },

    clearEvents(): void {
        module?.spine_native_clearEvents?.();
    },
};
