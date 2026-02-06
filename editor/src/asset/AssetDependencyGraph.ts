/**
 * @file    AssetDependencyGraph.ts
 * @brief   Tracks dependencies between entities and assets
 */

export class AssetDependencyGraph {
    private assetToEntities_ = new Map<string, Set<number>>();
    private entityToAssets_ = new Map<number, Set<string>>();

    registerUsage(assetPath: string, entityId: number): void {
        if (!this.assetToEntities_.has(assetPath)) {
            this.assetToEntities_.set(assetPath, new Set());
        }
        this.assetToEntities_.get(assetPath)!.add(entityId);

        if (!this.entityToAssets_.has(entityId)) {
            this.entityToAssets_.set(entityId, new Set());
        }
        this.entityToAssets_.get(entityId)!.add(assetPath);
    }

    unregisterUsage(assetPath: string, entityId: number): void {
        this.assetToEntities_.get(assetPath)?.delete(entityId);
        this.entityToAssets_.get(entityId)?.delete(assetPath);
    }

    getUsers(assetPath: string): Set<number> {
        return this.assetToEntities_.get(assetPath) ?? new Set();
    }

    getAssets(entityId: number): Set<string> {
        return this.entityToAssets_.get(entityId) ?? new Set();
    }

    clearEntity(entityId: number): void {
        const assets = this.entityToAssets_.get(entityId);
        if (assets) {
            for (const assetPath of assets) {
                this.assetToEntities_.get(assetPath)?.delete(entityId);
            }
            this.entityToAssets_.delete(entityId);
        }
    }

    clear(): void {
        this.assetToEntities_.clear();
        this.entityToAssets_.clear();
    }
}

let graph: AssetDependencyGraph | null = null;

export function getDependencyGraph(): AssetDependencyGraph {
    if (!graph) {
        graph = new AssetDependencyGraph();
    }
    return graph;
}

export function resetDependencyGraph(): void {
    graph?.clear();
    graph = null;
}
