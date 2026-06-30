// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { CppResourceManager, ESEngineModule } from './wasm';
import { WasmBridge } from './WasmBridge';

export interface TextureDimensions {
    width: number;
    height: number;
}

/**
 * The C++ ResourceManager is an embind object reached via
 * `module.getResourceManager()`, not a module itself — it owns no heap or
 * onAbort. Guard its method calls with the main module as the abort authority
 * (proxying the embind instance is safe: methods are invoked with the real
 * instance as `this`, and HEAP/$$ pass straight through).
 */
class ResourceManagerBridge extends WasmBridge<CppResourceManager> {
    protected readonly label = 'resourceManager';
}

const bridge = new ResourceManagerBridge();
let rm_: CppResourceManager | null = null;
const dimsCache_ = new Map<number, TextureDimensions>();

export function initResourceManager(rm: CppResourceManager, module?: ESEngineModule): void {
    // Production (corePlugin) passes the main module → guarded calls. Tests pass
    // only a mock rm → kept raw (unguarded), since they don't exercise abort.
    if (module) {
        bridge.connect(rm, module);
        rm_ = bridge.module;
    } else {
        bridge.disconnect();
        rm_ = rm;
    }
    dimsCache_.clear();
}

export function shutdownResourceManager(): void {
    bridge.disconnect();
    rm_ = null;
    dimsCache_.clear();
}

export function getResourceManager(): CppResourceManager | null {
    return rm_;
}

export function requireResourceManager(): CppResourceManager {
    if (!rm_) {
        throw new Error('ResourceManager not initialized. Call initResourceManager() first.');
    }
    return rm_;
}

/**
 * Set the resident GPU-texture byte budget. When resident bytes exceed this,
 * the C++ ResourcePool evicts least-recently-used unreferenced textures. `0`
 * (the default) disables caching — a texture frees the moment its refcount hits
 * zero. Negative / fractional inputs are clamped to a non-negative integer.
 *
 * This is the single game-facing surface over the C++ budget; there is no
 * parallel TS-side budget to drift from it.
 */
export function setTextureBudget(bytes: number): void {
    requireResourceManager().setTextureBudget(Math.max(0, Math.floor(bytes)));
}

export function evictTextureDimensions(handle: number): void {
    dimsCache_.delete(handle);
}

export function getTextureDimensions(handle: number): TextureDimensions | null {
    if (!handle) return null;
    const cached = dimsCache_.get(handle);
    if (cached) return cached;
    if (!rm_) return null;
    const dims = rm_.getTextureDimensions(handle);
    if (dims) dimsCache_.set(handle, dims);
    return dims;
}
