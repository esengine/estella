import type { App } from 'esengine';
import { EditorBridge } from '../bridge/EditorBridge';
import type { EditorStore } from '../store/EditorStore';
import { getSharedRenderContext } from '../renderer/SharedRenderContext';

export type AppListener = (app: App, bridge: EditorBridge) => void;

export class RuntimeService {
    private app_: App | null = null;
    private bridge_: EditorBridge | null = null;
    private store_: EditorStore;
    private appListeners_: AppListener[] = [];

    constructor(store: EditorStore) {
        this.store_ = store;
    }

    get app(): App | null {
        return this.app_;
    }

    get bridge(): EditorBridge | null {
        return this.bridge_;
    }

    registerAppListener(listener: AppListener): () => void {
        this.appListeners_.push(listener);
        if (this.app_ && this.bridge_) {
            listener(this.app_, this.bridge_);
        }
        return () => {
            const idx = this.appListeners_.indexOf(listener);
            if (idx >= 0) this.appListeners_.splice(idx, 1);
        };
    }

    setApp(app: App): void {
        this.app_ = app;
        this.bridge_ = new EditorBridge(app, this.store_);
        for (const listener of this.appListeners_) {
            listener(app, this.bridge_!);
        }
    }

    setPhysicsFactory(factory: unknown): void {
        getSharedRenderContext().setPhysicsFactory(factory);
    }
}
