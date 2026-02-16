import type { App } from 'esengine';
import type { SpineModuleController, SpineWasmModule } from 'esengine/spine';
import { wrapSpineModule, SpineModuleController as SpineModuleControllerClass } from 'esengine/spine';
import type { EditorStore } from './store/EditorStore';
import type { EditorBridge } from './bridge/EditorBridge';
import type { PanelInstance, PanelPosition, PanelDescriptor } from './panels/PanelRegistry';
import {
    getAllPanels,
    getPanelsByPosition,
    isResizable,
    isBridgeAware,
    isAppAware,
    isAssetServerProvider,
    isAssetNavigable,
    isOutputAppendable,
    isSpineControllerAware,
    isSpineInfoProvider,
    isBuiltinPanel,
} from './panels/PanelRegistry';
import type { EditorAssetServer } from './asset/EditorAssetServer';
import { icons } from './utils/icons';

export class PanelManager {
    private panelInstances_ = new Map<string, PanelInstance>();
    private activeBottomPanelId_: string | null = 'content-browser';

    get activeBottomPanelId(): string | null {
        return this.activeBottomPanelId_;
    }

    get panelInstances(): Map<string, PanelInstance> {
        return this.panelInstances_;
    }

    get assetServer(): EditorAssetServer | null {
        for (const panel of this.panelInstances_.values()) {
            if (isAssetServerProvider(panel)) return panel.assetServer as EditorAssetServer;
        }
        return null;
    }

    instantiatePanels(container: HTMLElement, store: EditorStore): void {
        for (const desc of getAllPanels()) {
            if (!desc.defaultVisible && desc.position !== 'bottom') continue;
            const el = container.querySelector(`[data-panel-id="${desc.id}"]`) as HTMLElement;
            if (!el) continue;
            this.createPanelWithErrorBoundary(desc, el, store);
        }
    }

    instantiateExtensionPanels(
        container: HTMLElement,
        store: EditorStore,
        bridge: EditorBridge | null,
        app: App | null,
    ): void {
        for (const desc of getAllPanels()) {
            if (this.panelInstances_.has(desc.id)) continue;

            const position = desc.position ?? 'bottom';
            let parentEl: HTMLElement | null = null;

            if (position === 'bottom') {
                parentEl = container.querySelector('.es-editor-bottom');
            } else {
                parentEl = container.querySelector(`.es-editor-${position}`);
            }
            if (!parentEl) continue;

            const panelContainer = document.createElement('div');
            panelContainer.className = 'es-panel-container';
            panelContainer.dataset.panelId = desc.id;

            if (position === 'bottom') {
                panelContainer.style.display = 'none';
            }

            parentEl.appendChild(panelContainer);
            this.createPanelWithErrorBoundary(desc, panelContainer, store, bridge, app);
        }
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
            this.createPanelWithErrorBoundary(desc, container, store);
        });

        overlay.querySelector('[data-action="close"]')?.addEventListener('click', () => {
            overlay.remove();
        });

        container.appendChild(overlay);
    }

    setApp(app: App, bridge: EditorBridge): void {
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

    togglePanel(id: string): void {
        try {
            this.panelInstances_.get(id)?.onShow?.();
        } catch (err) {
            console.error(`Panel "${id}" onShow failed:`, err);
        }
    }

    showBottomPanel(id: string, container: HTMLElement): void {
        if (this.activeBottomPanelId_ === id) return;
        const prev = this.activeBottomPanelId_;
        this.activeBottomPanelId_ = id;
        this.updateBottomPanelVisibility(container);
        if (prev) {
            try {
                this.panelInstances_.get(prev)?.onHide?.();
            } catch (err) {
                console.error(`Panel "${prev}" onHide failed:`, err);
            }
        }
        try {
            this.panelInstances_.get(id)?.onShow?.();
        } catch (err) {
            console.error(`Panel "${id}" onShow failed:`, err);
        }
    }

    toggleBottomPanel(id: string, container: HTMLElement): void {
        const prev = this.activeBottomPanelId_;
        if (prev === id) {
            this.activeBottomPanelId_ = null;
        } else {
            this.activeBottomPanelId_ = id;
        }
        this.updateBottomPanelVisibility(container);
        if (prev && prev !== id) {
            try {
                this.panelInstances_.get(prev)?.onHide?.();
            } catch (err) {
                console.error(`Panel "${prev}" onHide failed:`, err);
            }
        }
        if (this.activeBottomPanelId_) {
            try {
                this.panelInstances_.get(this.activeBottomPanelId_)?.onShow?.();
            } catch (err) {
                console.error(`Panel "${this.activeBottomPanelId_}" onShow failed:`, err);
            }
        }
    }

    updateBottomPanelVisibility(container: HTMLElement): void {
        const bottomSection = container.querySelector('.es-editor-bottom') as HTMLElement;
        const bottomPanels = getPanelsByPosition('bottom');

        for (const desc of bottomPanels) {
            const el = container.querySelector(`[data-panel-id="${desc.id}"]`) as HTMLElement;
            if (el) {
                el.style.display = desc.id === this.activeBottomPanelId_ ? '' : 'none';
            }
        }

        if (bottomSection) {
            bottomSection.style.display = this.activeBottomPanelId_ ? '' : 'none';
        }

        for (const panel of this.panelInstances_.values()) {
            if (isResizable(panel)) {
                requestAnimationFrame(() => panel.resize());
                break;
            }
        }
    }

    appendOutput(text: string, type: 'command' | 'stdout' | 'stderr' | 'error' | 'success'): void {
        const outputPanel = this.panelInstances_.get('output');
        if (outputPanel && isOutputAppendable(outputPanel)) {
            outputPanel.appendOutput(text, type);
        }
    }

    cleanupExtensionPanels(container: HTMLElement): void {
        for (const [id, instance] of this.panelInstances_) {
            if (isBuiltinPanel(id)) continue;
            instance.dispose();
            this.panelInstances_.delete(id);
            container.querySelector(`[data-panel-id="${id}"]`)?.remove();
        }
    }

    buildMainPanelsHTML(): string {
        const sections = (['left', 'center', 'right'] as const).map(pos => {
            const panels = getPanelsByPosition(pos).filter(p => p.defaultVisible);
            const containers = panels.map(p =>
                `<div class="es-panel-container" data-panel-id="${p.id}"></div>`
            ).join('');
            return `<div class="es-editor-${pos}">${containers}</div>`;
        }).join('');
        return `<div class="es-editor-main">${sections}</div>`;
    }

    buildBottomPanelsHTML(): string {
        const panels = getPanelsByPosition('bottom');
        return panels.map(p =>
            `<div class="es-panel-container" data-panel-id="${p.id}" style="display: none;"></div>`
        ).join('');
    }

    buildTabBarHTML(): string {
        const positions: PanelPosition[] = ['left', 'center', 'right'];
        return positions.flatMap(pos => getPanelsByPosition(pos))
            .filter(p => p.defaultVisible)
            .map(p => `
                <div class="es-tab es-tab-active" data-panel="${p.id}">
                    <span class="es-tab-label">${p.title}</span>
                    <button class="es-tab-close">${icons.x(10)}</button>
                </div>
            `).join('');
    }

    dispose(): void {
        for (const panel of this.panelInstances_.values()) {
            panel.dispose();
        }
        this.panelInstances_.clear();
    }
}

function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
