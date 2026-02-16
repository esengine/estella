import type { App } from 'esengine';
import type { SpineModuleController, SpineWasmModule } from 'esengine/spine';
import { wrapSpineModule, SpineModuleController as SpineModuleControllerClass } from 'esengine/spine';
import type { EditorStore } from './store/EditorStore';
import type { EditorBridge } from './bridge/EditorBridge';
import type { PanelInstance, PanelDescriptor } from './panels/PanelRegistry';
import {
    isBridgeAware,
    isAppAware,
    isAssetServerProvider,
    isAssetNavigable,
    isOutputAppendable,
    isSpineControllerAware,
    isSpineInfoProvider,
    isBuiltinPanel,
    getPanel,
} from './panels/PanelRegistry';
import type { EditorAssetServer } from './asset/EditorAssetServer';
import { icons } from './utils/icons';
import { escapeHtml } from './utils/html';

export class PanelManager {
    private panelInstances_ = new Map<string, PanelInstance>();
    private bridge_: EditorBridge | null = null;
    private app_: App | null = null;

    get panelInstances(): Map<string, PanelInstance> {
        return this.panelInstances_;
    }

    get assetServer(): EditorAssetServer | null {
        for (const panel of this.panelInstances_.values()) {
            if (isAssetServerProvider(panel)) return panel.assetServer as EditorAssetServer;
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
            const instance = desc.factory(container, store);
            if (bridge && isBridgeAware(instance)) instance.setBridge(bridge);
            if (app && isAppAware(instance)) instance.setApp(app);
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
        for (const panel of this.panelInstances_.values()) {
            if (isBridgeAware(panel)) panel.setBridge(bridge);
            if (isAppAware(panel)) panel.setApp(app);
        }
    }

    setSpineModule(module: unknown): void {
        const raw = module as SpineWasmModule;
        const controller = module ? new SpineModuleControllerClass(raw, wrapSpineModule(raw)) : null;
        for (const panel of this.panelInstances_.values()) {
            if (isSpineControllerAware(panel)) {
                panel.setSpineController(controller);
            }
        }
    }

    getSpineSkeletonInfo(entityId: number): { animations: string[]; skins: string[] } | null {
        for (const panel of this.panelInstances_.values()) {
            if (isSpineInfoProvider(panel)) {
                return panel.getSpineSkeletonInfo(entityId);
            }
        }
        return null;
    }

    onSpineInstanceReady(listener: (entityId: number) => void): () => void {
        for (const panel of this.panelInstances_.values()) {
            if (isSpineInfoProvider(panel)) {
                return panel.onSpineInstanceReady(listener);
            }
        }
        return () => {};
    }

    async navigateToAsset(assetPath: string): Promise<void> {
        for (const panel of this.panelInstances_.values()) {
            if (isAssetNavigable(panel)) {
                await panel.navigateToAsset(assetPath);
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
        const outputPanel = this.panelInstances_.get('output');
        if (outputPanel && isOutputAppendable(outputPanel)) {
            outputPanel.appendOutput(text, type);
        }
    }

    removePanelInstance(panelId: string): void {
        const instance = this.panelInstances_.get(panelId);
        if (instance) {
            instance.dispose();
            this.panelInstances_.delete(panelId);
        }
    }

    cleanupExtensionPanels(): void {
        for (const [id, instance] of this.panelInstances_) {
            if (isBuiltinPanel(id)) continue;
            instance.dispose();
            this.panelInstances_.delete(id);
        }
    }

    dispose(): void {
        for (const panel of this.panelInstances_.values()) {
            panel.dispose();
        }
        this.panelInstances_.clear();
    }
}

