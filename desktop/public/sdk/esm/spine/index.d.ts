import { P as Plugin, S as SpineModuleFactory, A as App, R as ResourceDef, a as SpineModuleController } from '../shared/app.js';
export { b as SpineEvent, c as SpineEventCallback, d as SpineEventType, e as SpineWasmModule, f as SpineWrappedAPI, l as loadSpineModule, w as wrapSpineModule } from '../shared/app.js';
import { E as ESEngineModule } from '../shared/wasm.js';

declare const SpineResource: ResourceDef<SpineModuleController | null>;
declare class SpinePlugin implements Plugin {
    private wasmUrl_;
    private factory_?;
    constructor(wasmUrl: string, factory?: SpineModuleFactory);
    build(app: App): void;
}
declare function submitSpineMeshesToCore(coreModule: ESEngineModule, controller: SpineModuleController, instanceId: number, transform?: Float32Array, color?: {
    r: number;
    g: number;
    b: number;
    a: number;
}): void;

export { SpineModuleController, SpineModuleFactory, SpinePlugin, SpineResource, submitSpineMeshesToCore };
