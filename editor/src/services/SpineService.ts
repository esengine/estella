import type { SpineWasmModule } from 'esengine/spine';
import { SpineModuleController, wrapSpineModule } from 'esengine/spine';
import type { EditorStore } from '../store/EditorStore';

export interface SpinePanelDelegate {
    setSpineController(ctrl: SpineModuleController | null): void;
    getSpineSkeletonInfo(entityId: number): { animations: string[]; skins: string[] } | null;
    onSpineInstanceReady(listener: (entityId: number) => void): () => void;
}

export class SpineService {
    private spineModule_: unknown = null;
    private spineVersion_: string = 'none';
    private spineVersionChangeHandler_: ((version: string) => void) | null = null;
    private store_: EditorStore;
    private delegate_: SpinePanelDelegate | null = null;

    constructor(store: EditorStore) {
        this.store_ = store;
    }

    registerSpinePanel(delegate: SpinePanelDelegate): () => void {
        this.delegate_ = delegate;
        if (this.spineModule_) {
            const raw = this.spineModule_ as SpineWasmModule;
            const controller = new SpineModuleController(raw, wrapSpineModule(raw));
            delegate.setSpineController(controller);
        }
        return () => { this.delegate_ = null; };
    }

    setSpineModule(module: unknown, version: string): void {
        this.spineModule_ = module;
        this.spineVersion_ = version;
        if (this.delegate_ && module) {
            const raw = module as SpineWasmModule;
            const controller = new SpineModuleController(raw, wrapSpineModule(raw));
            this.delegate_.setSpineController(controller);
        }
        this.store_.notifyChange();
    }

    onSpineVersionChange(handler: (version: string) => void): void {
        this.spineVersionChangeHandler_ = handler;
    }

    notifyVersionChange(version: string): void {
        this.spineVersionChangeHandler_?.(version);
    }

    get spineModule(): unknown {
        return this.spineModule_;
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
