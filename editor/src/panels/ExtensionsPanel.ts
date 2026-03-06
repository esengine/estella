import type { PanelInstance } from './PanelRegistry';
import type { ExtensionPluginInfo } from '../extension/ExtensionLoader';
import { DisposableStore } from '../utils/Disposable';
import { getExtensionService } from '../services';
import { getSettingsValue, setSettingsValue } from '../settings';
import { getEditorContext } from '../context/EditorContext';
import { icons } from '../utils/icons';
import {
    CHANNEL_EXTENSIONS_DATA,
    CHANNEL_EXTENSIONS_TOGGLE,
    CHANNEL_EXTENSIONS_RELOAD,
    CHANNEL_EXTENSIONS_REQUEST,
    type ExtensionDataMessage,
    type ExtensionPluginData,
} from '../multiwindow/protocol';

const ICON_SM = 12;

type PluginItem = ExtensionPluginInfo | ExtensionPluginData;

function isExternalWindow(): boolean {
    try {
        return typeof window !== 'undefined'
            && '__TAURI_INTERNALS__' in window
            && window.location.href.includes('panel-window');
    } catch {
        return false;
    }
}

export class ExtensionsPanel implements PanelInstance {
    private container_: HTMLElement;
    private disposables_ = new DisposableStore();
    private listEl_: HTMLElement | null = null;
    private detailEl_: HTMLElement | null = null;
    private selected_: PluginItem | null = null;
    private plugins_: PluginItem[] = [];
    private reloading_ = false;
    private external_ = isExternalWindow();
    private dataUnlisten_: (() => void) | null = null;

    constructor(container: HTMLElement) {
        this.container_ = container;
        this.render_();
        if (this.external_) {
            this.startListening_();
        } else {
            this.refreshFromService_();
        }
    }

    dispose(): void {
        this.dataUnlisten_?.();
        this.dataUnlisten_ = null;
        this.disposables_.dispose();
        this.container_.innerHTML = '';
    }

    private render_(): void {
        this.container_.innerHTML = `
            <div class="es-extensions-panel">
                <div class="es-ext-toolbar">
                    <span class="es-ext-toolbar-title">${icons.package(ICON_SM)} Extensions</span>
                    <button class="es-ext-toolbar-btn" data-action="reload" title="Reload All">${icons.refresh(ICON_SM)}</button>
                </div>
                <div class="es-ext-body">
                    <div class="es-ext-list"></div>
                    <div class="es-ext-detail"></div>
                </div>
            </div>
        `;

        this.listEl_ = this.container_.querySelector('.es-ext-list');
        this.detailEl_ = this.container_.querySelector('.es-ext-detail');

        const reloadBtn = this.container_.querySelector('[data-action="reload"]');
        if (reloadBtn) {
            this.disposables_.addListener(reloadBtn, 'click', () => this.handleReload_());
        }
    }

    private async startListening_(): Promise<void> {
        const { listen, emit } = await import('@tauri-apps/api/event');
        this.dataUnlisten_ = await listen<ExtensionDataMessage>(
            CHANNEL_EXTENSIONS_DATA,
            (event) => {
                this.plugins_ = event.payload.plugins;
                this.reloading_ = event.payload.reloading;
                this.renderList_();
                if (this.selected_) {
                    const updated = this.plugins_.find(p => p.id === this.selected_!.id);
                    this.selected_ = updated ?? null;
                }
                this.renderDetail_();
            },
        );
        emit(CHANNEL_EXTENSIONS_REQUEST, {});
    }

    private refreshFromService_(): void {
        try {
            const svc = getExtensionService();
            this.plugins_ = svc.getDiscoveredPlugins();
            this.reloading_ = svc.isReloading;
        } catch {
            this.plugins_ = [];
            this.reloading_ = false;
        }
        this.renderList_();
        this.renderDetail_();
    }

    private renderList_(): void {
        if (!this.listEl_) return;
        this.listEl_.innerHTML = '';

        if (this.reloading_) {
            this.listEl_.innerHTML = `
                <div class="es-ext-loading">
                    <div class="es-ext-spinner"></div>
                    <span>Reloading extensions...</span>
                </div>`;
            return;
        }

        if (this.plugins_.length === 0) {
            this.listEl_.innerHTML = `
                <div class="es-ext-empty">
                    <div class="es-ext-empty-icon">${icons.package(28)}</div>
                    <div class="es-ext-empty-title">No Extensions</div>
                    <div class="es-ext-empty-desc">
                        Add <code>.ts</code> files to <code>editor/src/</code>,
                        or install npm plugins with <code>esengine.type: "plugin"</code>.
                    </div>
                </div>`;
            return;
        }

        const npms = this.plugins_.filter(p => p.type === 'npm');
        const locals = this.plugins_.filter(p => p.type === 'local');

        if (npms.length > 0) this.listEl_.appendChild(this.createGroup_('Plugins', npms));
        if (locals.length > 0) this.listEl_.appendChild(this.createGroup_('Local', locals));
    }

    private createGroup_(title: string, items: PluginItem[]): HTMLElement {
        const group = document.createElement('div');
        group.className = 'es-ext-group';

        const header = document.createElement('div');
        header.className = 'es-ext-group-header';
        header.innerHTML = `<span>${title}</span><span class="es-ext-group-badge">${items.length}</span>`;
        group.appendChild(header);

        for (const item of items) {
            group.appendChild(this.createRow_(item));
        }

        return group;
    }

    private createRow_(item: PluginItem): HTMLElement {
        const row = document.createElement('div');
        const isActive = item.status === 'loaded';
        const isError = item.status === 'error';
        const isDisabled = item.status === 'disabled';
        const isSelected = this.selected_?.id === item.id;

        row.className = 'es-ext-row';
        if (isSelected) row.classList.add('es-selected');
        if (isDisabled) row.classList.add('es-ext-row--off');

        const statusClass = isActive ? 'es-ext-dot--on' : isError ? 'es-ext-dot--err' : 'es-ext-dot--off';

        row.innerHTML = `
            <span class="es-ext-dot ${statusClass}" title="${isActive ? 'Active' : isError ? 'Error' : 'Disabled'}"></span>
            <span class="es-ext-row-name">${escapeHtml(item.name)}</span>
            ${item.version ? `<span class="es-ext-row-ver">v${escapeHtml(item.version)}</span>` : ''}
            <span class="es-ext-row-spacer"></span>
            <button class="es-ext-row-action" data-role="toggle" title="${isDisabled ? 'Enable' : 'Disable'}">
                ${isDisabled ? icons.play(10) : icons.pause(10)}
            </button>
        `;

        const toggleBtn = row.querySelector('[data-role="toggle"]');
        if (toggleBtn) {
            this.disposables_.addListener(toggleBtn, 'click', (e) => {
                e.stopPropagation();
                this.handleToggle_(item);
            });
        }

        this.disposables_.addListener(row, 'click', (e) => {
            if ((e.target as HTMLElement).closest('[data-role="toggle"]')) return;
            this.listEl_?.querySelectorAll('.es-ext-row').forEach(el => el.classList.remove('es-selected'));
            row.classList.add('es-selected');
            this.selected_ = item;
            this.renderDetail_();
        });

        return row;
    }

    private renderDetail_(): void {
        if (!this.detailEl_) return;

        if (!this.selected_) {
            this.detailEl_.innerHTML = `
                <div class="es-ext-detail-empty">
                    <span>Select an extension to view details</span>
                </div>`;
            return;
        }

        const item = this.selected_;
        const isDisabled = item.status === 'disabled';
        const isError = item.status === 'error';

        const statusDot = item.status === 'loaded' ? 'es-ext-dot--on'
            : isError ? 'es-ext-dot--err' : 'es-ext-dot--off';
        const statusLabel = item.status === 'loaded' ? 'Active'
            : isError ? 'Error' : 'Disabled';

        let html = '<div class="es-ext-detail-content">';

        html += `<div class="es-ext-detail-header">`;
        html += `<span class="es-ext-detail-name">${escapeHtml(item.name)}</span>`;
        if (item.version) html += `<span class="es-ext-detail-ver">v${escapeHtml(item.version)}</span>`;
        html += `</div>`;

        if (item.description) {
            html += `<div class="es-ext-detail-desc">${escapeHtml(item.description)}</div>`;
        }

        html += `<div class="es-ext-detail-fields">`;
        html += `<div class="es-ext-detail-field"><span class="es-ext-field-key">Status</span><span class="es-ext-field-val"><span class="es-ext-dot ${statusDot}"></span> ${statusLabel}</span></div>`;
        html += `<div class="es-ext-detail-field"><span class="es-ext-field-key">Type</span><span class="es-ext-field-val">${item.type === 'npm' ? 'npm package' : 'Local file'}</span></div>`;
        html += `<div class="es-ext-detail-field"><span class="es-ext-field-key">ID</span><span class="es-ext-field-val es-ext-mono">${escapeHtml(item.id)}</span></div>`;
        html += `</div>`;

        if (item.error) {
            html += `<div class="es-ext-detail-err-box">`;
            html += `<div class="es-ext-detail-err-title">${icons.alertTriangle(ICON_SM)} Error</div>`;
            html += `<pre class="es-ext-detail-err-msg">${escapeHtml(item.error)}</pre>`;
            html += `</div>`;
        }

        html += `<div class="es-ext-detail-actions">`;
        html += `<button class="es-btn es-btn-sm" data-action="toggle">${isDisabled ? 'Enable' : 'Disable'}</button>`;
        if (item.type === 'npm') {
            html += `<button class="es-btn es-btn-sm" data-action="open-folder">${icons.folderOpen(ICON_SM)} Open Folder</button>`;
        }
        html += `</div>`;

        html += '</div>';
        this.detailEl_.innerHTML = html;

        const toggleBtn = this.detailEl_.querySelector('[data-action="toggle"]');
        if (toggleBtn) {
            this.disposables_.addListener(toggleBtn, 'click', () => this.handleToggle_(item));
        }

        const openBtn = this.detailEl_.querySelector('[data-action="open-folder"]');
        if (openBtn) {
            this.disposables_.addListener(openBtn, 'click', () => this.handleOpenFolder_(item));
        }
    }

    private handleToggle_(item: PluginItem): void {
        if (this.external_) {
            import('@tauri-apps/api/event').then(({ emit }) => {
                emit(CHANNEL_EXTENSIONS_TOGGLE, { pluginId: item.id });
            });
            return;
        }

        const disabled = getSettingsValue<string[]>('extensions.disabled') ?? [];
        const set = new Set(disabled);
        const willDisable = !set.has(item.id);
        if (willDisable) {
            set.add(item.id);
        } else {
            set.delete(item.id);
        }
        setSettingsValue('extensions.disabled', Array.from(set));
        this.handleReload_();
    }

    private async handleReload_(): Promise<void> {
        if (this.external_) {
            const { emit } = await import('@tauri-apps/api/event');
            emit(CHANNEL_EXTENSIONS_RELOAD, {});
            return;
        }

        this.reloading_ = true;
        this.renderList_();
        try {
            await getExtensionService().reload();
        } finally {
            this.reloading_ = false;
            this.refreshFromService_();
        }
    }

    private handleOpenFolder_(item: PluginItem): void {
        const fs = getEditorContext().fs;
        if (!fs || item.type !== 'npm') return;
        const parts = item.id.split('/');
        const folderPath = parts.length > 1
            ? `node_modules/${parts[0]}/${parts[1]}`
            : `node_modules/${item.id}`;
        fs.openFolder(folderPath);
    }
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
