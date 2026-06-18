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
