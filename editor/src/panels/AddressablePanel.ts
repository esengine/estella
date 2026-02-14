/**
 * @file    AddressablePanel.ts
 * @brief   Addressable asset management panel with groups, labels, and dependency analysis
 */

import type { EditorStore, AssetType } from '../store/EditorStore';
import type { PanelInstance } from './PanelRegistry';
import { icons } from '../utils/icons';
import { getAssetDatabase, type AssetEntry } from '../asset/AssetDatabase';
import type { AssetGroupService, AssetGroupDef, BundleMode } from '../asset/AssetGroup';
import { AssetDependencyAnalyzer } from '../asset/AssetDependencyAnalyzer';
import { getEditorInstance, getEditorContext } from '../context/EditorContext';
import { showInputDialog, showConfirmDialog } from '../ui/dialog';
import { showContextMenu, type ContextMenuItem } from '../ui/ContextMenu';
import { getContextMenuItems, type ContextMenuContext } from '../ui/ContextMenuRegistry';
import { showErrorToast, showSuccessToast } from '../ui/Toast';
import { getEditorType } from 'esengine';

const EDITOR_TYPE_TO_ASSET_TYPE: Record<string, AssetType> = {
    'texture': 'image',
    'material': 'material',
    'shader': 'shader',
    'spine-atlas': 'file',
    'spine-skeleton': 'file',
    'bitmap-font': 'font',
    'prefab': 'file',
    'json': 'json',
    'audio': 'audio',
    'scene': 'scene',
};

function getAssetTypeFromPath(path: string): AssetType {
    const ext = path.substring(path.lastIndexOf('.')).toLowerCase();
    if (ext === '.ts' || ext === '.js') return 'script';
    const editorType = getEditorType(path);
    return EDITOR_TYPE_TO_ASSET_TYPE[editorType] ?? 'file';
}

const LABEL_COLORS = [
    '#61afef', '#e06c75', '#98c379', '#d19a66',
    '#c678dd', '#56b6c2', '#e5c07b', '#be5046',
];

// =============================================================================
// AddressablePanel
// =============================================================================

export class AddressablePanel implements PanelInstance {
    private container_: HTMLElement;
    private store_: EditorStore;
    private groupListEl_: HTMLElement | null = null;
    private groupConfigEl_: HTMLElement | null = null;
    private labelListEl_: HTMLElement | null = null;
    private assetTableEl_: HTMLElement | null = null;
    private statusBarEl_: HTMLElement | null = null;
    private unreferencedEl_: HTMLElement | null = null;
    private selectedGroup_: string = 'default';
    private filterLabels_ = new Set<string>();
    private searchQuery_ = '';
    private sortColumn_: 'name' | 'address' | 'type' | 'size' = 'name';
    private sortAsc_ = true;
    private selectedUuids_ = new Set<string>();
    private lastClickedUuid_: string | null = null;
    private currentEntries_: AssetEntry[] = [];
    private groupConfigExpanded_ = false;
    private unreferencedUuids_: string[] = [];
    private analyzing_ = false;

    constructor(container: HTMLElement, store: EditorStore) {
        this.container_ = container;
        this.store_ = store;
        this.buildLayout();
        this.render();
    }

    dispose(): void {
        this.container_.innerHTML = '';
        this.container_.classList.remove('es-addressable-panel');
    }

    onShow(): void {
        this.render();
    }

    // =========================================================================
    // Layout
    // =========================================================================

    private buildLayout(): void {
        this.container_.classList.add('es-addressable-panel');
        this.container_.innerHTML = `
            <div class="es-panel-header">
                <span class="es-panel-title">${icons.layers(14)} Addressable Assets</span>
                <div class="es-panel-actions">
                    <button class="es-btn es-btn-icon es-addr-refresh" title="Refresh">${icons.refresh(14)}</button>
                </div>
            </div>
            <div class="es-addressable-body">
                <div class="es-addressable-sidebar">
                    <div class="es-addressable-sidebar-section">
                        <div class="es-sidebar-header">
                            <span>Groups</span>
                            <button class="es-btn es-btn-icon es-addr-add-group" title="Add Group">${icons.plus(10)}</button>
                        </div>
                        <div class="es-addr-group-list"></div>
                    </div>
                    <div class="es-addressable-sidebar-section">
                        <div class="es-sidebar-header">
                            <span>Labels</span>
                            <button class="es-btn es-btn-icon es-addr-add-label" title="Add Label">${icons.plus(10)}</button>
                        </div>
                        <div class="es-addr-label-list"></div>
                    </div>
                    <div class="es-addr-group-config"></div>
                </div>
                <div class="es-addressable-main">
                    <div class="es-addressable-toolbar">
                        <input type="text" class="es-input es-addr-search" placeholder="Search assets..." />
                        <button class="es-btn es-btn-small es-addr-analyze" title="Analyze unreferenced assets">Analyze</button>
                    </div>
                    <div class="es-addr-asset-table"></div>
                    <div class="es-addr-unreferenced" style="display:none"></div>
                </div>
            </div>
            <div class="es-addressable-status"></div>
        `;

        this.groupListEl_ = this.container_.querySelector('.es-addr-group-list');
        this.groupConfigEl_ = this.container_.querySelector('.es-addr-group-config');
        this.labelListEl_ = this.container_.querySelector('.es-addr-label-list');
        this.assetTableEl_ = this.container_.querySelector('.es-addr-asset-table');
        this.statusBarEl_ = this.container_.querySelector('.es-addressable-status');
        this.unreferencedEl_ = this.container_.querySelector('.es-addr-unreferenced');

        this.container_.querySelector('.es-addr-refresh')?.addEventListener('click', () => this.render());
        this.container_.querySelector('.es-addr-add-group')?.addEventListener('click', () => this.addGroup());
        this.container_.querySelector('.es-addr-add-label')?.addEventListener('click', () => this.addLabel());
        this.container_.querySelector('.es-addr-analyze')?.addEventListener('click', () => this.analyzeUnreferenced());

        const searchInput = this.container_.querySelector('.es-addr-search') as HTMLInputElement;
        searchInput?.addEventListener('input', () => {
            this.searchQuery_ = searchInput.value.toLowerCase();
            this.renderAssetTable();
        });

        this.assetTableEl_?.addEventListener('dblclick', (e) => {
            const row = (e.target as HTMLElement).closest('.es-addr-table-row') as HTMLElement | null;
            if (!row) return;
            const uuid = row.dataset.uuid;
            if (!uuid) return;
            this.selectAssetInStore(uuid);
        });
    }

    // =========================================================================
    // Render
    // =========================================================================

    private render(): void {
        this.renderGroupList();
        this.renderLabelList();
        this.renderAssetTable();
        this.renderGroupConfig();
        this.renderStatusBar();
    }

    private renderGroupList(): void {
        if (!this.groupListEl_) return;
        const groupService = this.getGroupService();
        if (!groupService) {
            this.groupListEl_.innerHTML = '<div class="es-muted">No project loaded</div>';
            return;
        }

        const groups = groupService.groups;
        this.groupListEl_.innerHTML = '';

        const db = getAssetDatabase();
        for (const group of groups) {
            const count = db.getUuidsByGroup(group.name).size;
            const item = document.createElement('div');
            item.className = `es-addr-group-item${group.name === this.selectedGroup_ ? ' es-selected' : ''}`;
            item.innerHTML = `<span class="es-addr-group-dot"></span> ${this.escapeHtml(group.name)}<span class="es-addr-group-count">${count}</span>`;
            item.addEventListener('click', () => {
                this.selectedGroup_ = group.name;
                this.renderGroupList();
                this.renderAssetTable();
                this.renderGroupConfig();
            });
            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showGroupContextMenu(e as MouseEvent, group);
            });

            item.addEventListener('dragover', (e) => {
                if (e.dataTransfer?.types.includes('application/esengine-addressable')) {
                    e.preventDefault();
                    item.classList.add('es-drag-over');
                }
            });
            item.addEventListener('dragleave', () => {
                item.classList.remove('es-drag-over');
            });
            item.addEventListener('drop', (e) => {
                e.preventDefault();
                item.classList.remove('es-drag-over');
                const data = e.dataTransfer?.getData('application/esengine-addressable');
                if (!data) return;
                try {
                    const uuids: string[] = JSON.parse(data);
                    this.moveAssetsToGroup(uuids, group.name);
                } catch { /* ignore */ }
            });

            this.groupListEl_.appendChild(item);
        }
    }

    private renderLabelList(): void {
        if (!this.labelListEl_) return;
        const groupService = this.getGroupService();
        if (!groupService) {
            this.labelListEl_.innerHTML = '';
            return;
        }

        const labels = groupService.allLabels;
        this.labelListEl_.innerHTML = '';

        for (const label of labels) {
            const color = this.getLabelColor(label);
            const item = document.createElement('div');
            item.className = 'es-addr-label-item';
            const checked = this.filterLabels_.has(label);
            item.innerHTML = `
                <label class="es-addr-label-check">
                    <input type="checkbox" ${checked ? 'checked' : ''} />
                    <span class="es-addr-label-dot" style="background:${color}"></span>
                    <span>${this.escapeHtml(label)}</span>
                </label>
            `;
            const checkbox = item.querySelector('input')!;
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    this.filterLabels_.add(label);
                } else {
                    this.filterLabels_.delete(label);
                }
                this.renderAssetTable();
            });
            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showLabelContextMenu(e as MouseEvent, label);
            });
            this.labelListEl_.appendChild(item);
        }
    }

    private renderAssetTable(): void {
        if (!this.assetTableEl_) return;
        const db = getAssetDatabase();
        const uuids = db.getUuidsByGroup(this.selectedGroup_);

        let entries: AssetEntry[] = [];
        for (const uuid of uuids) {
            const entry = db.getEntry(uuid);
            if (!entry) continue;

            if (this.filterLabels_.size > 0) {
                let hasLabel = false;
                for (const label of this.filterLabels_) {
                    if (entry.labels.has(label)) {
                        hasLabel = true;
                        break;
                    }
                }
                if (!hasLabel) continue;
            }

            if (this.searchQuery_) {
                const name = entry.path.split('/').pop() || '';
                const addr = entry.address || '';
                if (!name.toLowerCase().includes(this.searchQuery_) &&
                    !addr.toLowerCase().includes(this.searchQuery_)) {
                    continue;
                }
            }

            entries.push(entry);
        }

        entries.sort((a, b) => {
            let cmp = 0;
            switch (this.sortColumn_) {
                case 'name': {
                    const nameA = a.path.split('/').pop() || '';
                    const nameB = b.path.split('/').pop() || '';
                    cmp = nameA.localeCompare(nameB);
                    break;
                }
                case 'address':
                    cmp = (a.address || '').localeCompare(b.address || '');
                    break;
                case 'type':
                    cmp = a.type.localeCompare(b.type);
                    break;
                case 'size':
                    cmp = a.fileSize - b.fileSize;
                    break;
            }
            return this.sortAsc_ ? cmp : -cmp;
        });

        this.currentEntries_ = entries;

        const sortIcon = (col: string) => {
            if (this.sortColumn_ !== col) return '';
            return `<span class="es-addr-sort-icon">${this.sortAsc_ ? '▲' : '▼'}</span>`;
        };

        const headerHtml = `
            <div class="es-addr-table-header">
                <span class="es-addr-col-name${this.sortColumn_ === 'name' ? ' es-sorted' : ''}" data-col="name">Name${sortIcon('name')}</span>
                <span class="es-addr-col-address${this.sortColumn_ === 'address' ? ' es-sorted' : ''}" data-col="address">Address${sortIcon('address')}</span>
                <span class="es-addr-col-labels">Labels</span>
                <span class="es-addr-col-type${this.sortColumn_ === 'type' ? ' es-sorted' : ''}" data-col="type">Type${sortIcon('type')}</span>
                <span class="es-addr-col-size${this.sortColumn_ === 'size' ? ' es-sorted' : ''}" data-col="size">Size${sortIcon('size')}</span>
            </div>
        `;

        const rowsHtml = entries.map(entry => {
            const name = entry.path.split('/').pop() || '';
            const labelsHtml = [...entry.labels].map(l => {
                const color = this.getLabelColor(l);
                return `<span class="es-addr-tag" style="--tag-color: ${color}">${this.escapeHtml(l)}</span>`;
            }).join('');
            const size = this.formatSize(entry.fileSize);
            const selected = this.selectedUuids_.has(entry.uuid);
            return `
                <div class="es-addr-table-row${selected ? ' es-selected' : ''}" data-uuid="${entry.uuid}" draggable="true">
                    <span class="es-addr-col-name" title="${this.escapeHtml(entry.path)}">${this.escapeHtml(name)}</span>
                    <span class="es-addr-col-address">${this.escapeHtml(entry.address || '')}</span>
                    <span class="es-addr-col-labels">${labelsHtml}</span>
                    <span class="es-addr-col-type">${entry.type}</span>
                    <span class="es-addr-col-size">${size}</span>
                </div>
            `;
        }).join('');

        const bodyContent = entries.length > 0
            ? `<div class="es-addr-table-body">${rowsHtml}</div>`
            : `<div class="es-addr-empty">No assets in this group</div>`;
        this.assetTableEl_.innerHTML = headerHtml + bodyContent;

        const sortHeaders = this.assetTableEl_.querySelectorAll('[data-col]');
        sortHeaders.forEach(el => {
            el.addEventListener('click', () => {
                const col = (el as HTMLElement).dataset.col as typeof this.sortColumn_;
                if (this.sortColumn_ === col) {
                    this.sortAsc_ = !this.sortAsc_;
                } else {
                    this.sortColumn_ = col;
                    this.sortAsc_ = true;
                }
                this.renderAssetTable();
            });
        });

        const rows = this.assetTableEl_.querySelectorAll('.es-addr-table-row');
        rows.forEach(row => {
            row.addEventListener('click', (e) => {
                const uuid = (row as HTMLElement).dataset.uuid;
                if (!uuid) return;
                const me = e as MouseEvent;

                if (me.shiftKey && this.lastClickedUuid_) {
                    const idxA = this.currentEntries_.findIndex(en => en.uuid === this.lastClickedUuid_);
                    const idxB = this.currentEntries_.findIndex(en => en.uuid === uuid);
                    if (idxA >= 0 && idxB >= 0) {
                        const lo = Math.min(idxA, idxB);
                        const hi = Math.max(idxA, idxB);
                        if (!me.ctrlKey && !me.metaKey) {
                            this.selectedUuids_.clear();
                        }
                        for (let i = lo; i <= hi; i++) {
                            this.selectedUuids_.add(this.currentEntries_[i].uuid);
                        }
                    }
                } else if (me.ctrlKey || me.metaKey) {
                    if (this.selectedUuids_.has(uuid)) {
                        this.selectedUuids_.delete(uuid);
                    } else {
                        this.selectedUuids_.add(uuid);
                    }
                    this.lastClickedUuid_ = uuid;
                } else {
                    this.selectedUuids_.clear();
                    this.selectedUuids_.add(uuid);
                    this.lastClickedUuid_ = uuid;
                }

                rows.forEach(r => r.classList.toggle('es-selected',
                    this.selectedUuids_.has((r as HTMLElement).dataset.uuid!)));
                this.renderStatusBar();

                if (this.selectedUuids_.size === 1) {
                    this.selectAssetInStore([...this.selectedUuids_][0]);
                }
            });

            row.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const uuid = (row as HTMLElement).dataset.uuid;
                if (!uuid) return;
                if (!this.selectedUuids_.has(uuid)) {
                    this.selectedUuids_.clear();
                    this.selectedUuids_.add(uuid);
                    this.lastClickedUuid_ = uuid;
                    rows.forEach(r => r.classList.toggle('es-selected',
                        this.selectedUuids_.has((r as HTMLElement).dataset.uuid!)));
                }
                this.showAssetContextMenu(e as MouseEvent);
            });

            row.addEventListener('dragstart', (e) => {
                const uuid = (row as HTMLElement).dataset.uuid;
                if (!uuid) return;
                if (!this.selectedUuids_.has(uuid)) {
                    this.selectedUuids_.clear();
                    this.selectedUuids_.add(uuid);
                    rows.forEach(r => r.classList.toggle('es-selected',
                        this.selectedUuids_.has((r as HTMLElement).dataset.uuid!)));
                }
                (e as DragEvent).dataTransfer?.setData(
                    'application/esengine-addressable',
                    JSON.stringify([...this.selectedUuids_])
                );
                (row as HTMLElement).classList.add('es-dragging');
            });

            row.addEventListener('dragend', () => {
                (row as HTMLElement).classList.remove('es-dragging');
            });
        });
    }

    private renderGroupConfig(): void {
        if (!this.groupConfigEl_) return;
        const groupService = this.getGroupService();
        if (!groupService || !this.groupConfigExpanded_) {
            this.groupConfigEl_.innerHTML = '';
            if (!this.groupConfigExpanded_) {
                this.groupConfigEl_.innerHTML = `
                    <div class="es-addr-config-toggle" title="Show group config">▸ Config</div>
                `;
                this.groupConfigEl_.querySelector('.es-addr-config-toggle')?.addEventListener('click', () => {
                    this.groupConfigExpanded_ = true;
                    this.renderGroupConfig();
                });
            }
            return;
        }

        const group = groupService.getGroup(this.selectedGroup_);
        if (!group) {
            this.groupConfigEl_.innerHTML = '';
            return;
        }

        const bundleOptions = (['together', 'separate', 'perFile'] as BundleMode[])
            .map(m => `<option value="${m}"${m === group.bundleMode ? ' selected' : ''}>${m}</option>`)
            .join('');

        const includeHtml = group.include.length > 0
            ? group.include.map(p => `<div class="es-addr-include-item">${this.escapeHtml(p)}</div>`).join('')
            : '<div class="es-muted">No patterns</div>';

        this.groupConfigEl_.innerHTML = `
            <div class="es-addr-config-toggle" title="Hide group config">▾ Config: ${this.escapeHtml(group.name)}</div>
            <div class="es-addr-group-config-body">
                <div class="es-addr-config-field">
                    <span class="es-addr-config-label">Description</span>
                    <input type="text" class="es-input es-addr-config-desc" value="${this.escapeHtml(group.description)}" placeholder="Group description" />
                </div>
                <div class="es-addr-config-field">
                    <span class="es-addr-config-label">Bundle Mode</span>
                    <select class="es-input es-addr-config-bundle">${bundleOptions}</select>
                </div>
                <div class="es-addr-config-field">
                    <span class="es-addr-config-label">Include Patterns</span>
                    <div class="es-addr-include-list">${includeHtml}</div>
                </div>
            </div>
        `;

        this.groupConfigEl_.querySelector('.es-addr-config-toggle')?.addEventListener('click', () => {
            this.groupConfigExpanded_ = !this.groupConfigExpanded_;
            this.renderGroupConfig();
        });

        const descInput = this.groupConfigEl_.querySelector('.es-addr-config-desc') as HTMLInputElement;
        descInput?.addEventListener('change', async () => {
            groupService.updateGroup(this.selectedGroup_, { description: descInput.value });
            await groupService.save();
        });

        const bundleSelect = this.groupConfigEl_.querySelector('.es-addr-config-bundle') as HTMLSelectElement;
        bundleSelect?.addEventListener('change', async () => {
            groupService.updateGroup(this.selectedGroup_, { bundleMode: bundleSelect.value as BundleMode });
            await groupService.save();
        });
    }

    private renderStatusBar(): void {
        if (!this.statusBarEl_) return;
        const db = getAssetDatabase();
        const totalAssets = db.entryCount;
        const totalGroups = db.getAllGroups().length;

        let totalSize = 0;
        for (const entry of db.getAllEntries()) {
            totalSize += entry.fileSize;
        }

        const parts: string[] = [];
        if (this.selectedUuids_.size > 0) {
            parts.push(`${this.selectedUuids_.size} selected`);
        }
        parts.push(`Total: ${totalAssets} assets`);
        parts.push(`${totalGroups} groups`);
        parts.push(this.formatSize(totalSize));
        if (this.unreferencedUuids_.length > 0) {
            parts.push(`${this.unreferencedUuids_.length} unreferenced`);
        }
        this.statusBarEl_.textContent = parts.join(' · ');
    }

    private renderUnreferenced(): void {
        if (!this.unreferencedEl_) return;

        if (this.unreferencedUuids_.length === 0) {
            this.unreferencedEl_.style.display = 'none';
            return;
        }

        this.unreferencedEl_.style.display = '';
        const db = getAssetDatabase();

        const rowsHtml = this.unreferencedUuids_.map(uuid => {
            const entry = db.getEntry(uuid);
            if (!entry) return '';
            const name = entry.path.split('/').pop() || '';
            return `
                <div class="es-addr-unreferenced-row" data-uuid="${uuid}" title="${this.escapeHtml(entry.path)}">
                    <span class="es-addr-col-name">${this.escapeHtml(name)}</span>
                    <span class="es-addr-col-type">${entry.type}</span>
                    <span class="es-addr-col-size">${this.formatSize(entry.fileSize)}</span>
                </div>
            `;
        }).join('');

        this.unreferencedEl_.innerHTML = `
            <div class="es-addr-unreferenced-header">Unreferenced Assets (${this.unreferencedUuids_.length})</div>
            <div class="es-addr-unreferenced-list">${rowsHtml}</div>
        `;

        this.unreferencedEl_.querySelectorAll('.es-addr-unreferenced-row').forEach(row => {
            row.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const uuid = (row as HTMLElement).dataset.uuid;
                if (!uuid) return;
                this.showUnreferencedContextMenu(e as MouseEvent, uuid);
            });
            row.addEventListener('dblclick', () => {
                const uuid = (row as HTMLElement).dataset.uuid;
                if (!uuid) return;
                const entry = db.getEntry(uuid);
                if (entry) {
                    getEditorInstance()?.navigateToAsset(entry.path);
                }
            });
        });
    }

    // =========================================================================
    // Actions
    // =========================================================================

    private async addGroup(): Promise<void> {
        const groupService = this.getGroupService();
        if (!groupService) return;

        const name = await showInputDialog({ title: 'New Group', placeholder: 'Group name' });
        if (!name) return;

        groupService.addGroup({
            name,
            description: '',
            bundleMode: 'together',
            labels: [],
            include: [],
        });
        await groupService.save();
        this.render();
    }

    private async addLabel(): Promise<void> {
        const groupService = this.getGroupService();
        if (!groupService) return;

        const name = await showInputDialog({ title: 'New Label', placeholder: 'Label name' });
        if (!name) return;

        groupService.addLabel(name);
        await groupService.save();
        this.renderLabelList();
    }

    private async moveAssetsToGroup(uuids: string[], targetGroup: string): Promise<void> {
        const db = getAssetDatabase();
        for (const uuid of uuids) {
            await db.updateMeta(uuid, { group: targetGroup });
        }
        this.render();
        showSuccessToast(`Moved ${uuids.length} asset(s) to "${targetGroup}"`);
    }

    private async analyzeUnreferenced(): Promise<void> {
        if (this.analyzing_) return;
        const db = getAssetDatabase();
        const fs = getEditorContext().fs;
        const projectFilePath = getEditorInstance()?.projectPath;
        if (!fs || !projectFilePath) {
            showErrorToast('No project loaded');
            return;
        }
        const projectDir = projectFilePath.replace(/[/\\][^/\\]+$/, '');

        this.analyzing_ = true;
        const btn = this.container_.querySelector('.es-addr-analyze') as HTMLButtonElement;
        if (btn) btn.textContent = 'Analyzing...';

        try {
            const scenePaths: string[] = [];
            for (const entry of db.getAllEntries()) {
                if (entry.path.endsWith('.esscene')) {
                    scenePaths.push(entry.path);
                }
            }

            const analyzer = new AssetDependencyAnalyzer(fs, projectDir, db);
            const graph = await analyzer.analyze(scenePaths);
            this.unreferencedUuids_ = [...graph.unreferenced];
            this.renderUnreferenced();
            this.renderStatusBar();
        } catch (e) {
            showErrorToast(`Analysis failed: ${e}`);
        } finally {
            this.analyzing_ = false;
            if (btn) btn.textContent = 'Analyze';
        }
    }

    private showGroupContextMenu(e: MouseEvent, group: AssetGroupDef): void {
        const items: ContextMenuItem[] = [
            {
                label: 'Rename',
                disabled: group.name === 'default',
                onClick: async () => {
                    const newName = await showInputDialog({
                        title: 'Rename Group',
                        placeholder: 'New name',
                        defaultValue: group.name,
                    });
                    if (!newName || newName === group.name) return;
                    const gs = this.getGroupService();
                    if (!gs) return;
                    gs.renameGroup(group.name, newName);
                    await gs.save();
                    if (this.selectedGroup_ === group.name) {
                        this.selectedGroup_ = newName;
                    }
                    this.render();
                },
            },
            {
                label: 'Delete',
                disabled: group.name === 'default',
                onClick: async () => {
                    const confirmed = await showConfirmDialog({
                        title: 'Delete Group',
                        message: `Delete group "${group.name}"?`,
                        danger: true,
                    });
                    if (!confirmed) return;
                    const gs = this.getGroupService();
                    if (!gs) return;
                    gs.removeGroup(group.name);
                    await gs.save();
                    if (this.selectedGroup_ === group.name) {
                        this.selectedGroup_ = 'default';
                    }
                    this.render();
                },
            },
        ];

        const ctx: ContextMenuContext = { location: 'addressable.group', groupName: group.name };
        const extensionItems = getContextMenuItems('addressable.group', ctx);
        if (extensionItems.length > 0) {
            items.push({ label: '', separator: true }, ...extensionItems);
        }

        showContextMenu({ x: e.clientX, y: e.clientY, items });
    }

    private showLabelContextMenu(e: MouseEvent, label: string): void {
        showContextMenu({
            x: e.clientX,
            y: e.clientY,
            items: [
                {
                    label: 'Delete',
                    onClick: async () => {
                        const confirmed = await showConfirmDialog({
                            title: 'Delete Label',
                            message: `Delete label "${label}"?`,
                            danger: true,
                        });
                        if (!confirmed) return;
                        const gs = this.getGroupService();
                        if (!gs) return;
                        gs.removeLabel(label);
                        await gs.save();
                        this.filterLabels_.delete(label);
                        this.render();
                    },
                },
            ],
        });
    }

    private showAssetContextMenu(e: MouseEvent): void {
        const db = getAssetDatabase();
        const groupService = this.getGroupService();
        const groups = groupService?.groups ?? [];
        const uuids = [...this.selectedUuids_];
        const isBatch = uuids.length > 1;

        if (isBatch) {
            const moveToItems = groups.map(g => ({
                label: g.name,
                onClick: () => this.moveAssetsToGroup(uuids, g.name),
            }));

            showContextMenu({
                x: e.clientX,
                y: e.clientY,
                items: [
                    {
                        label: `Set Labels (${uuids.length})`,
                        onClick: async () => {
                            const input = await showInputDialog({
                                title: 'Set Labels (batch)',
                                placeholder: 'Labels (comma separated)',
                            });
                            if (input === null) return;
                            const newLabels = new Set(
                                input.split(',').map(s => s.trim()).filter(Boolean)
                            );
                            for (const uuid of uuids) {
                                await db.updateMeta(uuid, { labels: newLabels });
                            }
                            this.renderAssetTable();
                        },
                    },
                    {
                        label: `Move to Group (${uuids.length})`,
                        children: moveToItems,
                    },
                ],
            });
            return;
        }

        const uuid = uuids[0];
        const entry = db.getEntry(uuid);
        if (!entry) return;

        const moveToItems = groups
            .filter(g => g.name !== entry.group)
            .map(g => ({
                label: g.name,
                onClick: async () => {
                    await db.updateMeta(uuid, { group: g.name });
                    this.render();
                },
            }));

        showContextMenu({
            x: e.clientX,
            y: e.clientY,
            items: [
                {
                    label: 'Set Address',
                    onClick: async () => {
                        const addr = await showInputDialog({
                            title: 'Set Address',
                            placeholder: 'Logical address',
                            defaultValue: entry.address ?? '',
                        });
                        if (addr === null) return;
                        await db.updateMeta(uuid, { address: addr || null });
                        this.renderAssetTable();
                    },
                },
                {
                    label: 'Edit Labels',
                    onClick: async () => {
                        const current = [...entry.labels].join(', ');
                        const input = await showInputDialog({
                            title: 'Edit Labels',
                            placeholder: 'Labels (comma separated)',
                            defaultValue: current,
                        });
                        if (input === null) return;
                        const newLabels = new Set(
                            input.split(',').map(s => s.trim()).filter(Boolean)
                        );
                        await db.updateMeta(uuid, { labels: newLabels });
                        this.renderAssetTable();
                    },
                },
                {
                    label: 'Move to Group',
                    children: moveToItems.length > 0 ? moveToItems : undefined,
                    disabled: moveToItems.length === 0,
                },
                {
                    label: 'Reveal in Content Browser',
                    onClick: () => {
                        getEditorInstance()?.navigateToAsset(entry.path);
                    },
                },
            ],
        });
    }

    private showUnreferencedContextMenu(e: MouseEvent, uuid: string): void {
        const groupService = this.getGroupService();
        const groups = groupService?.groups ?? [];

        const moveToItems = groups.map(g => ({
            label: g.name,
            onClick: () => this.moveAssetsToGroup([uuid], g.name),
        }));

        showContextMenu({
            x: e.clientX,
            y: e.clientY,
            items: [
                {
                    label: 'Move to Group',
                    children: moveToItems,
                },
            ],
        });
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    private getGroupService(): AssetGroupService | null {
        return getAssetDatabase().getGroupService();
    }

    private selectAssetInStore(uuid: string): void {
        const db = getAssetDatabase();
        const entry = db.getEntry(uuid);
        if (!entry) return;
        const projectDir = this.getProjectDir();
        const fullPath = projectDir ? `${projectDir}/${entry.path}` : entry.path;
        const name = entry.path.split('/').pop() || '';
        this.store_.selectAsset({
            path: fullPath,
            type: getAssetTypeFromPath(entry.path),
            name,
        });
    }

    private getProjectDir(): string | null {
        const projectPath = getEditorInstance()?.projectPath;
        if (!projectPath) return null;
        return projectPath.replace(/[/\\][^/\\]+$/, '');
    }

    private getLabelColor(label: string): string {
        let hash = 0;
        for (let i = 0; i < label.length; i++) {
            hash = ((hash << 5) - hash + label.charCodeAt(i)) | 0;
        }
        return LABEL_COLORS[Math.abs(hash) % LABEL_COLORS.length];
    }

    private formatSize(bytes: number): string {
        if (bytes === 0) return '-';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}
