/**
 * @file    index.ts
 * @brief   ESEngine Spine module - standalone Spine WASM integration
 *
 * @example
 * ```typescript
 * import { SpinePlugin } from 'esengine/spine';
 * app.addPlugin(new SpinePlugin('/assets/spine42.wasm'));
 * ```
 */

export { SpinePlugin, SpineResource, submitSpineMeshesToCore } from './SpinePlugin';
export {
    SpineModuleController,
    type SpineEventType,
    type SpineEventCallback,
    type SpineEvent,
} from './SpineController';
export {
    loadSpineModule,
    type SpineWasmModule,
    type SpineModuleFactory,
} from './SpineModuleLoader';
