import { R as ResourceDef, P as Plugin, S as SpineWasmProvider, A as App } from '../shared/app.js';
export { C as ConstraintList, a as PathMixData, b as SpineEventCallback, c as SpineModuleController, d as SpineModuleFactory, T as TransformMixData, e as createSpineFactories, l as loadSpineModule, w as wrapSpineModule } from '../shared/app.js';
import { E as Entity, C as CppRegistry, a as ESEngineModule } from '../shared/wasm.js';
import { S as SpineManager } from '../shared/SpineManager.js';
export { M as ModuleBackend, a as SpineVersion } from '../shared/SpineManager.js';

type SpineEventType = 'start' | 'interrupt' | 'end' | 'complete' | 'event';
interface SpineEvent {
    entity: Entity;
    type: SpineEventType;
    track: number;
    animationName: string;
    eventName?: string;
    floatValue?: number;
    intValue?: number;
    stringValue?: string;
}
interface SpineEventsData {
    readonly events: readonly SpineEvent[];
}
declare const SpineEvents: ResourceDef<SpineEventsData>;
declare class SpinePlugin implements Plugin {
    private spineManager_;
    private provider_;
    private app_;
    constructor(managerOrProvider?: SpineManager | SpineWasmProvider);
    get spineManager(): SpineManager | null;
    setSpineManager(manager: SpineManager): void;
    build(app: App): void;
    private collectAndPublishEvents_;
    private collectNativeEvents_;
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
    listConstraints(entity: Entity): {
        ik: string[];
        transform: string[];
        path: string[];
    } | null;
    getTransformConstraintMix(entity: Entity, name: string): {
        mixRotate: number;
        mixX: number;
        mixY: number;
        mixScaleX: number;
        mixScaleY: number;
        mixShearY: number;
    } | null;
    setTransformConstraintMix(entity: Entity, name: string, rotate: number, x: number, y: number, scaleX: number, scaleY: number, shearY: number): boolean;
    getPathConstraintMix(entity: Entity, name: string): {
        position: number;
        spacing: number;
        mixRotate: number;
        mixX: number;
        mixY: number;
    } | null;
    setPathConstraintMix(entity: Entity, name: string, position: number, spacing: number, rotate: number, x: number, y: number): boolean;
    getEventCount(): number;
    getEventRecord(index: number): {
        entity: number;
        animationName: string;
        eventName: string;
        stringValue: string;
    } | null;
    getEventBuffer(): number;
    clearEvents(): void;
};

export { SpineCpp, SpineEvents, SpineManager, SpinePlugin, SpineWasmProvider, initSpineCppAPI, shutdownSpineCppAPI };
export type { SpineEvent, SpineEventType, SpineEventsData };
