export type AssetStatus = 'unloaded' | 'loading' | 'loaded' | 'failed';

export type AssetChangeListener = () => void;

export interface AssetHandle<T = unknown> {
    readonly path: string;
    readonly status: AssetStatus;
    readonly data: T | null;
    readonly version: number;
    onChange(callback: AssetChangeListener): () => void;
}

export class AssetNode<T = unknown> implements AssetHandle<T> {
    path: string;
    status: AssetStatus = 'unloaded';
    data: T | null = null;
    version = 0;

    readonly dependencies = new Set<AssetNode>();
    readonly dependents = new Set<AssetNode>();

    private listeners_ = new Set<AssetChangeListener>();

    constructor(path: string) {
        this.path = path;
    }

    onChange(callback: AssetChangeListener): () => void {
        this.listeners_.add(callback);
        return () => this.listeners_.delete(callback);
    }

    invalidate(): void {
        this.status = 'unloaded';
        this.data = null;
        this.version++;
        this.notify_();
        for (const dep of this.dependents) {
            dep.invalidate();
        }
    }

    markLoading(): void {
        this.status = 'loading';
    }

    markLoaded(data: T): void {
        this.data = data;
        this.status = 'loaded';
        this.version++;
        this.notify_();
    }

    markFailed(): void {
        this.status = 'failed';
        this.version++;
        this.notify_();
    }

    private notify_(): void {
        for (const listener of this.listeners_) {
            listener();
        }
    }
}
