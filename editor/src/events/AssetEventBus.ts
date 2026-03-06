/**
 * @file    AssetEventBus.ts
 * @brief   Unified event bus for asset lifecycle events
 */

export type AssetEventType = 'asset:loaded' | 'asset:modified' | 'asset:unloaded';
export type AssetCategory = string;

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

import { getEditorContainer } from '../container/EditorContainer';
import { ASSET_EVENT_BUS } from '../container/tokens';

const SERVICE_KEY = 'default';

export function getAssetEventBus(): AssetEventBus {
    return getEditorContainer().get(ASSET_EVENT_BUS, SERVICE_KEY)!;
}

export function resetAssetEventBus(): void {
    const bus = getEditorContainer().get(ASSET_EVENT_BUS, SERVICE_KEY);
    bus?.clear();
}
