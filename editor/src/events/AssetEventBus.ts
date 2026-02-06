/**
 * @file    AssetEventBus.ts
 * @brief   Unified event bus for asset lifecycle events
 */

export type AssetEventType = 'asset:loaded' | 'asset:modified' | 'asset:unloaded';
export type AssetCategory = 'material' | 'texture' | 'shader' | 'spine';

export interface AssetEvent {
    type: AssetEventType;
    category: AssetCategory;
    path: string;
    handle?: number;
}

export type AssetEventListener = (event: AssetEvent) => void;

export class AssetEventBus {
    private listeners_ = new Map<AssetCategory, Set<AssetEventListener>>();
    private globalListeners_ = new Set<AssetEventListener>();

    on(category: AssetCategory, callback: AssetEventListener): () => void {
        if (!this.listeners_.has(category)) {
            this.listeners_.set(category, new Set());
        }
        this.listeners_.get(category)!.add(callback);
        return () => this.listeners_.get(category)?.delete(callback);
    }

    onAll(callback: AssetEventListener): () => void {
        this.globalListeners_.add(callback);
        return () => this.globalListeners_.delete(callback);
    }

    emit(event: AssetEvent): void {
        this.listeners_.get(event.category)?.forEach(cb => cb(event));
        this.globalListeners_.forEach(cb => cb(event));
    }

    clear(): void {
        this.listeners_.clear();
        this.globalListeners_.clear();
    }
}

let bus: AssetEventBus | null = null;

export function getAssetEventBus(): AssetEventBus {
    if (!bus) {
        bus = new AssetEventBus();
    }
    return bus;
}

export function resetAssetEventBus(): void {
    bus?.clear();
    bus = null;
}
