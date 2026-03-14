import type { CppResourceManager } from './wasm';

export interface TextureDimensions {
    width: number;
    height: number;
}

let rm_: CppResourceManager | null = null;
const dimsCache_ = new Map<number, TextureDimensions>();

export function initResourceManager(rm: CppResourceManager): void {
    rm_ = rm;
    dimsCache_.clear();
}

export function shutdownResourceManager(): void {
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
