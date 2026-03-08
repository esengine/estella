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
};
