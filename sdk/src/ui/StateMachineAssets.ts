import { getComponentAssetFieldDescriptors } from '../scene';
import type { AssetServer } from '../asset/AssetServer';

const ASSET_PREFIX = 'asset:';
const assetPathCache_ = new Map<string, boolean>();

export function isAssetPropertyPath(path: string): boolean {
    const cached = assetPathCache_.get(path);
    if (cached !== undefined) return cached;
    const dotIndex = path.indexOf('.');
    if (dotIndex === -1) { assetPathCache_.set(path, false); return false; }
    const componentName = path.substring(0, dotIndex);
    const fieldName = path.substring(dotIndex + 1).split('.')[0];
    const descriptors = getComponentAssetFieldDescriptors(componentName);
    const result = descriptors.some(d => d.field === fieldName && d.type === 'texture');
    assetPathCache_.set(path, result);
    return result;
}

export function normalizeAssetValue(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    if (value.startsWith(ASSET_PREFIX)) return value.slice(ASSET_PREFIX.length);
    return value;
}

export function collectAssetPaths(properties?: Record<string, unknown>): string[] {
    if (!properties) return [];
    const paths: string[] = [];
    for (const [key, value] of Object.entries(properties)) {
        if (!isAssetPropertyPath(key)) continue;
        const normalized = normalizeAssetValue(value);
        if (normalized) paths.push(normalized);
    }
    return paths;
}

export class StateMachineAssetCache {
    private resolved_ = new Map<string, number>();
    private loading_ = false;
    readonly paths: string[];

    constructor(paths: string[]) {
        const unique = new Set(paths);
        this.paths = [...unique];
    }

    get isLoading(): boolean { return this.loading_; }

    get allLoaded(): boolean {
        return this.paths.length === 0 || this.resolved_.size >= this.paths.length;
    }

    startLoading(assetServer: AssetServer): void {
        if (this.loading_) return;
        this.loading_ = true;
        let pending = 0;
        for (const path of this.paths) {
            if (this.resolved_.has(path)) continue;
            pending++;
            assetServer.loadTexture(path).then(info => {
                this.resolved_.set(path, info.handle);
            }).catch(() => {}).finally(() => {
                pending--;
                if (pending === 0) this.loading_ = false;
            });
        }
        if (pending === 0) this.loading_ = false;
    }

    getHandle(path: string): number | undefined {
        return this.resolved_.get(path);
    }

    release(assetServer: AssetServer): void {
        for (const path of this.paths) {
            assetServer.releaseTexture(path);
        }
        this.resolved_.clear();
    }
}
