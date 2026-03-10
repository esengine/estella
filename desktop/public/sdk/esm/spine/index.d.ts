import { P as Plugin, S as SpineWasmProvider, A as App } from '../shared/app.js';
export { a as SpineEvent, b as SpineEventCallback, c as SpineEventType, d as SpineModuleController, e as SpineModuleFactory, f as createSpineFactories, l as loadSpineModule, w as wrapSpineModule } from '../shared/app.js';
import { S as SpineManager } from '../shared/SpineManager.js';
export { M as ModuleBackend, a as SpineVersion } from '../shared/SpineManager.js';
import { C as CppRegistry, E as Entity, a as ESEngineModule } from '../shared/wasm.js';

declare class SpinePlugin implements Plugin {
    private spineManager_;
    private provider_;
    private app_;
    constructor(managerOrProvider?: SpineManager | SpineWasmProvider);
    get spineManager(): SpineManager | null;
    setSpineManager(manager: SpineManager): void;
    build(app: App): void;
}

declare function initSpineCppAPI(wasmModule: ESEngineModule): void;
declare function shutdownSpineCppAPI(): void;
declare const SpineCpp: {
    update(registry: {
        _cpp: CppRegistry;
    }, dt: number): void;
    play(entity: Entity, animation: string, loop?: boolean, track?: number): boolean;
    addAnimation(entity: Entity, animation: string, loop?: boolean, delay?: number, track?: number): boolean;
    setSkin(entity: Entity, skinName: string): boolean;
    getBonePosition(entity: Entity, boneName: string): {
        x: number;
        y: number;
    } | null;
    hasInstance(entity: Entity): boolean;
    reloadAssets(registry: {
        _cpp: CppRegistry;
    }): void;
    getAnimations(entity: Entity): string[];
    getSkins(entity: Entity): string[];
};

export { SpineCpp, SpineManager, SpinePlugin, SpineWasmProvider, initSpineCppAPI, shutdownSpineCppAPI };
