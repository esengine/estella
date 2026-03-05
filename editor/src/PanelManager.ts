import type { App } from 'esengine';
import type { SpineWasmModule } from 'esengine/spine';
import { SpineModuleController as SpineModuleControllerClass, wrapSpineModule } from 'esengine/spine';
import type { EditorStore } from './store/EditorStore';
import type { EditorBridge } from './bridge/EditorBridge';
import type { PanelInstance, PanelDescriptor, PanelHooks } from './panels/PanelRegistry';
import { getPanel } from './panels/PanelRegistry';
import type { EditorAssetServer } from './asset/EditorAssetServer';
import { getEditorContainer } from './container';
import { PANEL } from './container/tokens';
import { icons } from './utils/icons';
import { escapeHtml } from './utils/html';

export class PanelManager {
    private panelInstances_ = new Map<string, PanelInstance>();
    private panelHooks_ = new Map<string, PanelHooks>();
    private bridge_: EditorBridge | null = null;
    private app_: App | null = null;

    get panelInstances(): Map<string, PanelInstance> {
        return this.panelInstances_;
    }

    get assetServer(): EditorAssetServer | null {
        for (const hooks of this.panelHooks_.values()) {
            if (hooks.getAssetServer) return hooks.getAssetServer();
        }
        return null;
    }

    createPanelInContainer(panelId: string, container: HTMLElement, store: EditorStore): void {
        if (this.panelInstances_.has(panelId)) return;
        const desc = getPanel(panelId);
        if (!desc) return;
        this.createPanelWithErrorBoundary(desc, container, store, this.bridge_, this.app_);
    }

    private createPanelWithErrorBoundary(
        desc: PanelDescriptor,
        container: HTMLElement,
        store: EditorStore,
        bridge?: EditorBridge | null,
        app?: App | null,
    ): void {
        try {
            const result = desc.factory(container, store);
            const { instance, hooks } = result;
            if (hooks) {
                this.panelHooks_.set(desc.id, hooks);
                if (bridge) hooks.setBridge?.(bridge);
                if (app) hooks.setApp?.(app);
            }
            this.panelInstances_.set(desc.id, instance);
        } catch (err) {
            console.error(`Panel "${desc.id}" failed to initialize:`, err);
            this.showPanelError(desc, container, store, err as Error);
        }
    }

    private showPanelError(
        desc: PanelDescriptor,
        container: HTMLElement,
        store: EditorStore,
        error: Error,
    ): void {
        container.innerHTML = '';
        const overlay = document.createElement('div');
        overlay.className = 'es-panel-error-overlay';
        overlay.innerHTML = `
            <div class="es-panel-error-content">
                <div class="es-panel-error-icon">${icons.x(32)}</div>
                <h4 class="es-panel-error-title">Panel "${escapeHtml(desc.title)}" failed to load</h4>
                <p class="es-panel-error-message">${escapeHtml(error.message)}</p>
                <details class="es-panel-error-details">
                    <summary>Details</summary>
                    <pre>${escapeHtml(error.stack ?? '')}</pre>
                </details>
                <div class="es-panel-error-actions">
                    <button class="es-btn es-btn-primary" data-action="retry">Retry</button>
                    <button class="es-btn" data-action="close">Close</button>
                </div>
            </div>
        `;

        overlay.querySelector('[data-action="retry"]')?.addEventListener('click', () => {
            overlay.remove();
            this.createPanelWithErrorBoundary(desc, container, store, this.bridge_, this.app_);
        });

        overlay.querySelector('[data-action="close"]')?.addEventListener('click', () => {
            overlay.remove();
        });

        container.appendChild(overlay);
    }

    setApp(app: App, bridge: EditorBridge): void {
        this.app_ = app;
        this.bridge_ = bridge;
        for (const hooks of this.panelHooks_.values()) {
            hooks.setBridge?.(bridge);
            hooks.setApp?.(app);
        }
    }

    setSpineModule(module: unknown): void {
        const raw = module as SpineWasmModule;
        const controller = module ? new SpineModuleControllerClass(raw, wrapSpineModule(raw)) : null;
        for (const hooks of this.panelHooks_.values()) {
            hooks.setSpineController?.(controller);
        }
    }

    getSpineSkeletonInfo(entityId: number): { animations: string[]; skins: string[] } | null {
        for (const hooks of this.panelHooks_.values()) {
            if (hooks.getSpineSkeletonInfo) {
                return hooks.getSpineSkeletonInfo(entityId);
            }
        }
        return null;
    }

    onSpineInstanceReady(listener: (entityId: number) => void): () => void {
        for (const hooks of this.panelHooks_.values()) {
            if (hooks.onSpineInstanceReady) {
                return hooks.onSpineInstanceReady(listener);
            }
        }
        return () => {};
    }

    async navigateToAsset(assetPath: string): Promise<void> {
        for (const hooks of this.panelHooks_.values()) {
            if (hooks.navigateToAsset) {
                await hooks.navigateToAsset(assetPath);
                return;
            }
        }
    }

    showPanel(id: string): void {
        try {
            this.panelInstances_.get(id)?.onShow?.();
        } catch (err) {
            console.error(`Panel "${id}" onShow failed:`, err);
        }
    }

    hidePanel(id: string): void {
        try {
            this.panelInstances_.get(id)?.onHide?.();
        } catch (err) {
            console.error(`Panel "${id}" onHide failed:`, err);
        }
    }

    appendOutput(text: string, type: 'command' | 'stdout' | 'stderr' | 'error' | 'success'): void {
        const hooks = this.panelHooks_.get('output');
        if (hooks?.appendOutput) {
            hooks.appendOutput(text, type);
        }
    }

    saveDirtyPanels(): Promise<void> {
        const promises: Promise<boolean>[] = [];
        for (const hooks of this.panelHooks_.values()) {
            if (hooks.isDirty?.() && hooks.saveAsset) {
                promises.push(hooks.saveAsset());
            }
        }
        return Promise.all(promises).then(() => {});
    }

    removePanelInstance(panelId: string): void {
        const instance = this.panelInstances_.get(panelId);
        if (instance) {
            instance.dispose();
            this.panelInstances_.delete(panelId);
            this.panelHooks_.delete(panelId);
        }
    }

    cleanupExtensionPanels(): void {
        const c = getEditorContainer();
        for (const [id, instance] of this.panelInstances_) {
            if (c.isBuiltin(PANEL, id)) continue;
            instance.dispose();
            this.panelInstances_.delete(id);
            this.panelHooks_.delete(id);
        }
    }

    dispose(): void {
        for (const panel of this.panelInstances_.values()) {
            panel.dispose();
        }
        this.panelInstances_.clear();
        this.panelHooks_.clear();
    }
}
