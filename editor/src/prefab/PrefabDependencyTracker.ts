import type { SceneData } from '../types/SceneTypes';
import { syncPrefabInstances } from './PrefabInstantiator';
import { loadPrefabFromPath } from './PrefabSerializer';
import { getAssetDatabase, isUUID } from '../asset';

const DEBOUNCE_MS = 100;

export class PrefabDependencyTracker {
    private dependents_ = new Map<string, Set<string>>();
    private pendingSync_ = new Set<string>();
    private debounceTimer_: ReturnType<typeof setTimeout> | null = null;
    private scene_: SceneData | null = null;
    private onSceneChanged_: (() => void) | null = null;

    setScene(scene: SceneData, onChanged: () => void): void {
        this.scene_ = scene;
        this.onSceneChanged_ = onChanged;
        this.rebuildDependencyMap();
    }

    clearScene(): void {
        this.scene_ = null;
        this.onSceneChanged_ = null;
        this.pendingSync_.clear();
        if (this.debounceTimer_) {
            clearTimeout(this.debounceTimer_);
            this.debounceTimer_ = null;
        }
    }

    registerDependency(dependentPrefab: string, dependsOn: string): void {
        const normalized = this.normalizePath(dependsOn);
        const normalizedDependent = this.normalizePath(dependentPrefab);
        if (this.wouldCreateCycle(normalized, normalizedDependent)) {
            console.warn(`Circular prefab dependency detected: ${normalizedDependent} -> ${normalized}`);
            return;
        }
        let set = this.dependents_.get(normalized);
        if (!set) {
            set = new Set();
            this.dependents_.set(normalized, set);
        }
        set.add(normalizedDependent);
    }

    private wouldCreateCycle(dependsOn: string, dependent: string): boolean {
        const visited = new Set<string>();
        const check = (from: string): boolean => {
            if (from === dependent) return true;
            if (visited.has(from)) return false;
            visited.add(from);
            const upstreams = this.dependents_.get(from);
            if (!upstreams) return false;
            for (const u of upstreams) {
                if (check(u)) return true;
            }
            return false;
        };
        return check(dependsOn);
    }

    onPrefabFileChanged(changedPaths: string[]): void {
        if (!this.scene_) return;

        for (const path of changedPaths) {
            if (!path.endsWith('.esprefab')) continue;
            const normalized = this.normalizePath(path);
            this.collectAffectedPrefabs(normalized, this.pendingSync_);
        }

        if (this.pendingSync_.size > 0) {
            this.scheduleBatchSync();
        }
    }

    private collectAffectedPrefabs(path: string, result: Set<string>): void {
        result.add(path);
        const upstreams = this.dependents_.get(path);
        if (!upstreams) return;
        for (const upstream of upstreams) {
            if (!result.has(upstream)) {
                this.collectAffectedPrefabs(upstream, result);
            }
        }
    }

    private scheduleBatchSync(): void {
        if (this.debounceTimer_) {
            clearTimeout(this.debounceTimer_);
        }
        this.debounceTimer_ = setTimeout(() => {
            this.debounceTimer_ = null;
            this.flushSync();
        }, DEBOUNCE_MS);
    }

    private async flushSync(): Promise<void> {
        if (!this.scene_ || this.pendingSync_.size === 0) return;

        const toSync = new Set(this.pendingSync_);
        this.pendingSync_.clear();

        let anyChanged = false;
        for (const prefabPath of toSync) {
            const synced = await syncPrefabInstances(this.scene_, prefabPath);
            if (synced) anyChanged = true;
        }

        if (anyChanged && this.onSceneChanged_) {
            this.onSceneChanged_();
        }
    }

    private rebuildDependencyMap(): void {
        this.dependents_.clear();
        if (!this.scene_) return;

        for (const entity of this.scene_.entities) {
            if (!entity.prefab) continue;
            const prefabPath = entity.prefab.prefabPath;

            if (entity.prefab.basePrefab) {
                this.registerDependency(prefabPath, entity.prefab.basePrefab);
            }
        }
    }

    private normalizePath(path: string): string {
        if (isUUID(path)) return path;
        const db = getAssetDatabase();
        return db.getUuid(path) ?? path;
    }

    async scanPrefabDependencies(prefabPath: string): Promise<void> {
        const prefab = await loadPrefabFromPath(prefabPath);
        if (!prefab) return;

        const normalized = this.normalizePath(prefabPath);

        for (const entity of prefab.entities) {
            if (entity.nestedPrefab) {
                this.registerDependency(normalized, entity.nestedPrefab.prefabPath);
            }
        }

        if (prefab.basePrefab) {
            this.registerDependency(normalized, prefab.basePrefab);
        }
    }
}

let globalTracker: PrefabDependencyTracker | null = null;

export function getPrefabDependencyTracker(): PrefabDependencyTracker {
    if (!globalTracker) {
        globalTracker = new PrefabDependencyTracker();
    }
    return globalTracker;
}
