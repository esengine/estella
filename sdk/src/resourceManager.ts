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
 * disables caching — a texture frees the moment its refcount hits zero.
 * Negative / fractional inputs are clamped to a non-negative integer.
 *
 * The engine applies `RuntimeConfig.textureCacheBudget` at startup, so scene
 * switches keep recently-used textures warm by default; call this (or set
 * `textureCacheBudget` in the build config) to size it for your game.
 *
 * This is the single game-facing surface over the C++ budget; there is no
 * parallel TS-side budget to drift from it.
 */
export function setTextureBudget(bytes: number): void {
    requireResourceManager().setTextureBudget(Math.max(0, Math.floor(bytes)));
}

/** GPU resource counts + texture residency figures. See {@link getResourceStats}. */
export interface ResourceStats {
    shaderCount: number;
    textureCount: number;
    vertexBufferCount: number;
    indexBufferCount: number;
    cacheHits: number;
    cacheMisses: number;
    /** Resident texture bytes (RGBA8 estimate) — held + evictable entries. */
    textureBytes: number;
    /** The texture pool's resident-byte budget (0 = eviction off). */
    textureBudget: number;
    /** Cached refCount==0 textures awaiting revive or eviction. */
    textureEvictableCount: number;
}

/**
 * Snapshot of GPU resource usage from the C++ ResourceManager — the
 * observability side of the texture budget: watch `textureBytes` against
 * `textureBudget` and `textureEvictableCount` to size the warm cache.
 * Returns null when the resource manager isn't initialized (or a test mock
 * doesn't model stats).
 */
export function getResourceStats(): ResourceStats | null {
    if (!rm_ || typeof rm_.getResourceStats !== 'function') return null;
    return rm_.getResourceStats();
}

/**
 * Free every evictable cached texture now (memory pressure). Held textures
 * and the budget are untouched; the warm cache refills as textures are
 * released afterwards. The engine calls this on OS memory warnings — call it
 * yourself before a known memory spike (e.g. a huge one-off allocation).
 * Returns the number of textures freed (0 when uninitialized / mocked).
 */
export function trimTextureCache(): number {
    if (!rm_ || typeof rm_.trimTextureCache !== 'function') return 0;
    return rm_.trimTextureCache();
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
