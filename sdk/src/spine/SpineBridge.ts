/**
 * @file    SpineBridge.ts
 * @brief   Spine's bridges to its two WASM surfaces.
 *
 * @details Spine spans two runtimes (see SpineManager): the built-in `spine_*`
 *          exports on the MAIN engine module, and version-specific standalone
 *          side modules (3.8 / 4.1) each with their own runtime. Both surfaces
 *          route through {@link WasmBridge} so every call inherits the
 *          terminal-abort guard.
 */

import type { ESEngineModule } from '../wasm';
import { WasmBridge } from '../WasmBridge';
import type { SpineWrappedAPI } from './SpineModuleLoader';

/**
 * Guards the built-in `spine_*` exports on the main engine module. The main
 * module is shared with {@link ../ecs/BuiltinBridge BuiltinBridge}; installing
 * the abort guard twice is idempotent and the dead flag is shared by module
 * identity, so an abort anywhere short-circuits everywhere.
 */
export class SpineCoreBridge extends WasmBridge<ESEngineModule> {
    protected readonly label = 'spine';
}

/**
 * Guards a version-specific spine side module's wrapped API. The call surface
 * (`SpineWrappedAPI`, all functions) is guarded; its abort-authoritative module
 * is the raw side module, which owns the heap, allocator, and `onAbort`.
 */
export class SpineModuleBridge extends WasmBridge<SpineWrappedAPI> {
    protected readonly label = 'spine';
}
