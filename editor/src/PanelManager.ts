import type { PanelInstance, PanelDescriptor } from './panels/PanelRegistry';
import { getPanel } from './panels/PanelRegistry';
import { getEditorContainer } from './container';
import { PANEL } from './container/tokens';
import { icons } from './utils/icons';
import { escapeHtml } from './utils/html';

export class PanelManager {
    private panelInstances_ = new Map<string, PanelInstance>();

    get panelInstances(): Map<string, PanelInstance> {
        return this.panelInstances_;
    }

    createPanelInContainer(panelId: string, container: HTMLElement): void {
        if (this.panelInstances_.has(panelId)) return;
        const desc = getPanel(panelId);
        if (!desc) return;
        this.createPanelWithErrorBoundary(desc, container);
    }

    private createPanelWithErrorBoundary(
        desc: PanelDescriptor,
        container: HTMLElement,
    ): void {
        try {
            const result = desc.factory(container);
            this.panelInstances_.set(desc.id, result.instance);
        } catch (err) {
            console.error(`Panel "${desc.id}" failed to initialize:`, err);
            this.showPanelError(desc, container, err as Error);
        }
    }

    private showPanelError(
        desc: PanelDescriptor,
        container: HTMLElement,
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
            this.createPanelWithErrorBoundary(desc, container);
        });

        overlay.querySelector('[data-action="close"]')?.addEventListener('click', () => {
            overlay.remove();
        });

        container.appendChild(overlay);
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

    removePanelInstance(panelId: string): void {
        const instance = this.panelInstances_.get(panelId);
        if (instance) {
            instance.dispose();
            this.panelInstances_.delete(panelId);
        }
    }

    cleanupExtensionPanels(): void {
        const c = getEditorContainer();
        for (const [id, instance] of this.panelInstances_) {
            if (c.isBuiltin(PANEL, id)) continue;
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
