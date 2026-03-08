import type { EditorStore } from '../store/EditorStore';

export interface SpinePanelDelegate {
    setSpineController(ctrl: unknown): void;
    getSpineSkeletonInfo(entityId: number): { animations: string[]; skins: string[] } | null;
    onSpineInstanceReady(listener: (entityId: number) => void): () => void;
}

export class SpineService {
    private spineVersion_: string = 'none';
    private spineVersionChangeHandler_: ((version: string) => void) | null = null;
    private store_: EditorStore;
    private delegate_: SpinePanelDelegate | null = null;

    constructor(store: EditorStore) {
        this.store_ = store;
    }

    registerSpinePanel(delegate: SpinePanelDelegate): () => void {
        this.delegate_ = delegate;
        return () => { this.delegate_ = null; };
    }

    setSpineModule(_module: unknown, version: string): void {
        this.spineVersion_ = version;
        this.store_.notifyChange();
    }

    onSpineVersionChange(handler: (version: string) => void): void {
        this.spineVersionChangeHandler_ = handler;
    }

    notifyVersionChange(version: string): void {
        this.spineVersionChangeHandler_?.(version);
    }

    get spineVersion(): string {
        return this.spineVersion_;
    }

    getSpineSkeletonInfo(entityId: number): { animations: string[]; skins: string[] } | null {
        return this.delegate_?.getSpineSkeletonInfo(entityId) ?? null;
    }

    onSpineInstanceReady(listener: (entityId: number) => void): () => void {
        return this.delegate_?.onSpineInstanceReady(listener) ?? (() => {});
    }
}
