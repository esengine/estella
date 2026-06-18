/**
 * @file    CoreApiBridge.ts
 * @brief   Bridge for the core engine module's API facets.
 *
 * @details The renderer / draw / material / geometry / postprocess / gl-debug
 *          APIs are all facets of the SAME main engine module, each historically
 *          holding its own `let module` singleton. They route through one shared
 *          base ({@link WasmBridge}) via this class so every call inherits the
 *          terminal-abort guard; the per-instance `label` keeps diagnostics
 *          specific (e.g. `geometry.geometry_upload`). The main module is shared
 *          with BuiltinBridge, so installing the abort guard is idempotent and
 *          the dead flag is shared by module identity.
 */

import type { ESEngineModule } from './wasm';
import { WasmBridge } from './WasmBridge';

export class CoreApiBridge extends WasmBridge<ESEngineModule> {
    protected readonly label: string;

    constructor(label: string) {
        super();
        this.label = label;
    }
}
