/**
 * @file    PhysicsRuntime.ts
 * @brief   Resource holding the physics wasm module + its load promise
 *
 * Decoupling this from App as a resource (instead of dynamic
 * properties) lets PhysicsPlugin own the lifetime of the module
 * without mutating App, and lets other systems read readiness
 * state in the same way they read any other resource.
 */

import { defineResource } from '../resource';
import type { PhysicsWasmModule } from './PhysicsModuleLoader';

export interface PhysicsRuntimeData {
    /** Loaded physics wasm module, null until the plugin's init promise resolves. */
    module: PhysicsWasmModule | null;
    /** Promise that resolves once the module is loaded; null before plugin install. */
    initPromise: Promise<void> | null;
}

export const PhysicsRuntime = defineResource<PhysicsRuntimeData>(
    { module: null, initPromise: null },
    'PhysicsRuntime',
);
