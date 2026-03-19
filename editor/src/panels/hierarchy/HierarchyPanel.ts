import type { Entity } from 'esengine';
import type { EditorStore, DirtyFlag } from '../../store/EditorStore';
import { icons } from '../../utils/icons';
import { getAssetDatabase, isUUID } from '../../asset/AssetDatabase';
import { escapeHtml } from '../../utils/html';
import { getInitialComponentData } from '../../schemas/ComponentSchemas';
import type { HierarchyState, FlattenedRow } from './HierarchyTypes';
import { ROW_HEIGHT, OVERSCAN, SLOW_DOUBLE_CLICK_MIN, SLOW_DOUBLE_CLICK_MAX } from './HierarchyTypes';
import { buildFlatRows, expandAncestors, renderSingleRow } from './HierarchyTree';
import { performSearch, selectNextResult, selectPreviousResult, focusSelectedResult, clearSearch } from './HierarchySearch';
import { setupKeyboard, selectRange } from './HierarchyKeyboard';
import { setupDragAndDrop } from './HierarchyDragDrop';
import { showEntityContextMenu, duplicateEntity, createEntityFromAsset } from './HierarchyContextMenu';
import { showContextMenu, type ContextMenuItem } from '../../ui/ContextMenu';
import { getPlayModeService, runtimeToEntityData } from '../../services/PlayModeService';
import { DisposableStore } from '../../utils/Disposable';

export class HierarchyPanel implements HierarchyState {
    private container_: HTMLElement;
    private disposables_ = new DisposableStore();
    store: EditorStore;
    treeContainer: HTMLElement;
    searchInput: HTMLInputElement | null = null;
    private prefabEditBar_: HTMLElement | null = null;
    searchFilter: string = '';
    searchResults: HierarchyState['searchResults'] = [];
    selectedResultIndex: number = -1;
    expandedIds: Set<number> = new Set();
    lastSelectedEntity: Entity | null = null;
    flatRows: FlattenedRow[] = [];
    scrollContent: HTMLElement;
    visibleWindow: HTMLElement;
    private scrollRafId_: number = 0;
    private lastVisibleStart_: number = -1;
    private lastVisibleEnd_: number = -1;
    dragOverEntityId: number | null = null;
    dropPosition: HierarchyState['dropPosition'] = null;
    draggingEntityId: number | null = null;
    renamingEntityId: number | null = null;
    lastClickEntityId: number | null = null;
    lastClickTime: number = 0;
    playMode: boolean = false;
    runtimeEntities?: HierarchyState['runtimeEntities'];
    private toolbar_: HTMLElement | null = null;
    private savedExpandedIds_: Set<number> | null = null;

    constructor(container: HTMLElement, store: EditorStore) {
        this.container_ = container;
        this.store = store;

        this.container_.className = 'es-hierarchy-panel';
        this.container_.innerHTML = `
            <div class="es-prefab-edit-bar" style="display: none;">
                <button class="es-prefab-back-btn">${icons.chevronRight(12)} Back to Scene</button>
                <span class="es-prefab-edit-name">${icons.package(12)} </span>
            </div>
            <div class="es-hierarchy-toolbar">
                <input type="text" class="es-input es-hierarchy-search" placeholder="Search (t:type)">
                <button class="es-btn es-btn-icon" data-action="collapse-all" data-tooltip="Collapse All">${icons.chevronRight(12)}</button>
                <button class="es-btn es-btn-icon" data-action="expand-all" data-tooltip="Expand All">${icons.chevronDown(12)}</button>
                <button class="es-btn es-btn-icon" data-action="add" data-tooltip="Create Entity">${icons.plus()}</button>
                <button class="es-btn es-btn-icon" data-action="duplicate" data-tooltip="Duplicate">${icons.copy()}</button>
            </div>
            <div class="es-hierarchy-columns">
                <span class="es-hierarchy-col-visibility">${icons.eye(12)}</span>
                <span class="es-hierarchy-col-label">Item Label</span>
                <span class="es-hierarchy-col-type">Type</span>
            </div>
            <div class="es-hierarchy-tree" role="tree"></div>
        `;

        this.treeContainer = this.container_.querySelector('.es-hierarchy-tree')!;
        this.treeContainer.tabIndex = 0;
        this.scrollContent = document.createElement('div');
        this.scrollContent.className = 'es-hierarchy-scroll-content';
        this.visibleWindow = document.createElement('div');
        this.visibleWindow.className = 'es-hierarchy-visible-window';
        this.scrollContent.appendChild(this.visibleWindow);
        this.treeContainer.appendChild(this.scrollContent);
        this.disposables_.addListener(this.treeContainer, 'scroll', () => this.onScroll());
        this.searchInput = this.container_.querySelector('.es-hierarchy-search');
        this.prefabEditBar_ = this.container_.querySelector('.es-prefab-edit-bar');

        const backBtn = this.container_.querySelector('.es-prefab-back-btn');
        if (backBtn) {
            this.disposables_.addListener(backBtn, 'click', () => {
                this.store.exitPrefabEditMode();
            });
        }

        this.toolbar_ = this.container_.querySelector('.es-hierarchy-toolbar');

        this.setupEvents();
        this.disposables_.add(store.subscribe((_state, dirtyFlags) => this.onStoreNotify(dirtyFlags)));
        this.render();

        const pms = getPlayModeService();
        this.disposables_.add(pms.onStateChange((state) => {
            const isPlaying = state === 'playing';
            this.playMode = isPlaying;
            if (isPlaying) {
                this.container_.classList.add('es-play-mode');
                this.savedExpandedIds_ = new Set(this.expandedIds);
                this.updateRuntimeEntities();
            } else {
                this.container_.classList.remove('es-play-mode');
                this.runtimeEntities = undefined;
                if (this.savedExpandedIds_) {
                    this.expandedIds = this.savedExpandedIds_;
                    this.savedExpandedIds_ = null;
                }
            }
            this.render();
        }));
        this.disposables_.add(pms.onEntityListUpdate(() => {
            if (this.playMode) {
                this.updateRuntimeEntities();
                this.render();
            }
        }));
        this.disposables_.add(pms.onSelectionChange((id) => {
            if (this.playMode) {
                this.playModeSelectedId = id;
                this.renderVisibleRows();
            }
        }));
    }

    private updateRuntimeEntities(): void {
        const pms = getPlayModeService();
        const entities = pms.runtimeEntities.map(runtimeToEntityData);

        const childrenMap = new Map<number | null, number[]>();
        for (const entity of entities) {
            const parent = entity.parent;
            if (!childrenMap.has(parent)) childrenMap.set(parent, []);
            childrenMap.get(parent)!.push(entity.id);
        }
        for (const entity of entities) {
            entity.children = childrenMap.get(entity.id) ?? [];
            if (entity.children.length > 0) {
                this.expandedIds.add(entity.id);
            }
        }

        this.runtimeEntities = entities;
    }

    dispose(): void {
        this.disposables_.dispose();
        if (this.scrollRafId_) {
            cancelAnimationFrame(this.scrollRafId_);
            this.scrollRafId_ = 0;
        }
    }

    private onStoreNotify(dirtyFlags?: ReadonlySet<DirtyFlag>): void {
        if (this.playMode) {
            if (dirtyFlags?.has('selection')) {
                const sel = this.store.selectedEntity;
                if (sel !== null) {
                    const pms = getPlayModeService();
                    const runtimeId = pms.editorToRuntimeId(sel as number);
                    if (runtimeId !== null) {
                        this.playModeSelectedId = runtimeId;
                        pms.selectEntity(runtimeId);
                    }
                } else {
                    this.playModeSelectedId = null;
                }
                this.renderVisibleRows();
            }
            return;
        }
        if (dirtyFlags && !dirtyFlags.has('scene') && !dirtyFlags.has('hierarchy') && !dirtyFlags.has('selection')) {
            return;
        }

        const needsRebuild = !dirtyFlags || dirtyFlags.has('scene') || dirtyFlags.has('hierarchy');

        if (needsRebuild) {
            this.render();
        } else {
            if (dirtyFlags?.has('selection')) {
                const sel = this.store.selectedEntity;
                if (sel !== null && !this.flatRows.some(r => r.entity.id === sel as number)) {
                    this.render();
                    return;
                }
            }
            this.renderVisibleRows();
            if (dirtyFlags?.has('selection')) {
                const sel = this.store.selectedEntity;
                if (sel !== null) {
                    this.scrollToEntity(sel as number);
                }
            }
        }
    }

    private setupEvents(): void {
        const addBtn = this.container_.querySelector('[data-action="add"]');
        if (addBtn) {
            this.disposables_.addListener(addBtn, 'click', () => {
                if (this.playMode) {
                    const pms = getPlayModeService();
                    pms.spawnEntity();
                    return;
                }
                const entity = this.store.createEntity();
                this.store.addComponent(entity, 'Transform', getInitialComponentData('Transform'));
            });
        }

        const dupBtn = this.container_.querySelector('[data-action="duplicate"]');
        if (dupBtn) {
            this.disposables_.addListener(dupBtn, 'click', () => {
                if (this.playMode) return;
                const selected = this.store.selectedEntity;
                if (selected !== null) {
                    duplicateEntity(this, selected);
                }
            });
        }

        const collapseAllBtn = this.container_.querySelector('[data-action="collapse-all"]');
        if (collapseAllBtn) {
            this.disposables_.addListener(collapseAllBtn, 'click', () => {
                this.expandedIds.clear();
                this.render();
            });
        }

        const expandAllBtn = this.container_.querySelector('[data-action="expand-all"]');
        if (expandAllBtn) {
            this.disposables_.addListener(expandAllBtn, 'click', () => {
                const entities = this.runtimeEntities ?? this.store.scene.entities;
                for (const entity of entities) {
                    if (entity.children.length > 0) {
                        this.expandedIds.add(entity.id);
                    }
                }
                this.render();
            });
        }

        if (this.searchInput) {
            this.disposables_.addListener(this.searchInput, 'input', () => {
                this.searchFilter = this.searchInput?.value ?? '';
                performSearch(this);
                this.render();
            });

            this.disposables_.addListener(this.searchInput, 'keydown', (e) => {
                const ke = e as KeyboardEvent;
                if (ke.key === 'ArrowDown') {
                    ke.preventDefault();
                    selectNextResult(this);
                } else if (ke.key === 'ArrowUp') {
                    ke.preventDefault();
                    selectPreviousResult(this);
                } else if (ke.key === 'Enter') {
                    ke.preventDefault();
                    focusSelectedResult(this);
                } else if (ke.key === 'Escape') {
                    clearSearch(this);
                }
            });
        }

        this.disposables_.addListener(this.treeContainer, 'click', (ev) => {
            const e = ev as MouseEvent;
            const target = e.target as HTMLElement;

            if (target.closest('.es-hierarchy-rename-input')) return;

            const expandBtn = target.closest('.es-hierarchy-expand') as HTMLElement;
            if (expandBtn) {
                e.stopPropagation();
                const row = expandBtn.closest('.es-hierarchy-row');
                const item = row?.parentElement as HTMLElement;
                const entityId = parseInt(item?.dataset.entityId ?? '', 10);
                if (!isNaN(entityId)) {
                    const shouldExpand = !this.expandedIds.has(entityId);
                    if (e.altKey) {
                        this.setExpandedRecursive_(entityId as Entity, shouldExpand);
                    } else if (shouldExpand) {
                        this.expandedIds.add(entityId);
                    } else {
                        this.expandedIds.delete(entityId);
                    }
                    this.render();
                }
                return;
            }

            if (this.playMode) {
                const row = target.closest('.es-hierarchy-row');
                const item = row?.parentElement as HTMLElement;
                if (!item?.classList.contains('es-hierarchy-item')) return;
                const runtimeId = parseInt(item.dataset.entityId ?? '', 10);
                if (!isNaN(runtimeId)) {
                    const pms = getPlayModeService();
                    pms.selectEntity(runtimeId);
                    this.playModeSelectedId = runtimeId;
                    const editorId = pms.runtimeToEditorId(runtimeId);
                    if (editorId !== null) {
                        this.store.selectEntity(editorId as Entity, 'replace');
                    }
                    this.renderVisibleRows();
                }
                return;
            }

            const visibilityBtn = target.closest('.es-hierarchy-visibility') as HTMLElement;
            if (visibilityBtn) {
                e.stopPropagation();
                const item = visibilityBtn.closest('.es-hierarchy-item') as HTMLElement;
                const entityId = parseInt(item?.dataset.entityId ?? '', 10);
                if (!isNaN(entityId)) {
                    this.store.toggleVisibility(entityId);
                }
                return;
            }

            const row = target.closest('.es-hierarchy-row');
            const item = row?.parentElement as HTMLElement;
            if (!item?.classList.contains('es-hierarchy-item')) return;

            const entityId = parseInt(item.dataset.entityId ?? '', 10);
            if (isNaN(entityId)) return;

            const now = Date.now();
            const timeSinceLastClick = now - this.lastClickTime;
            const sameEntity = this.lastClickEntityId === entityId;
            const wasSelected = this.store.selectedEntities.has(entityId);

            if (e.shiftKey && this.lastSelectedEntity !== null) {
                selectRange(this, this.lastSelectedEntity as number, entityId);
                this.lastSelectedEntity = entityId as Entity;
            } else if (e.ctrlKey || e.metaKey) {
                this.store.selectEntity(entityId as Entity, 'toggle');
                this.lastSelectedEntity = entityId as Entity;
            } else {
                if (sameEntity && wasSelected && !e.shiftKey && !e.ctrlKey && !e.metaKey
                    && timeSinceLastClick >= SLOW_DOUBLE_CLICK_MIN
                    && timeSinceLastClick <= SLOW_DOUBLE_CLICK_MAX) {
                    this.startInlineRename(entityId);
                } else {
                    this.store.selectEntity(entityId as Entity, 'replace');
                    this.lastSelectedEntity = entityId as Entity;
                }
            }

            this.lastClickEntityId = entityId;
            this.lastClickTime = now;
        });

        this.disposables_.addListener(this.treeContainer, 'dblclick', (ev) => {
            if (this.playMode) return;
            const e = ev as MouseEvent;
            const target = e.target as HTMLElement;
            if (target.closest('.es-hierarchy-rename-input')) return;
            const item = target.closest('.es-hierarchy-item') as HTMLElement;
            if (!item) return;

            const entityId = parseInt(item.dataset.entityId ?? '', 10);
            if (!isNaN(entityId)) {
                this.lastClickEntityId = null;
                this.lastClickTime = 0;
                this.store.focusEntity(entityId);
            }
        });

        this.disposables_.addListener(this.treeContainer, 'contextmenu', (ev) => {
            const e = ev as MouseEvent;
            if (this.playMode) {
                e.preventDefault();
                const target = e.target as HTMLElement;
                const item = target.closest('.es-hierarchy-item') as HTMLElement;
                const entityId = item ? parseInt(item.dataset.entityId ?? '', 10) : NaN;
                this.showPlayModeContextMenu(e.clientX, e.clientY, isNaN(entityId) ? null : entityId);
                return;
            }
            e.preventDefault();
            const target = e.target as HTMLElement;
            const item = target.closest('.es-hierarchy-item') as HTMLElement;

            if (item) {
                const entityId = parseInt(item.dataset.entityId ?? '', 10);
                if (!isNaN(entityId)) {
                    showEntityContextMenu(this, e.clientX, e.clientY, entityId as Entity);
                }
            } else {
                showEntityContextMenu(this, e.clientX, e.clientY, null);
            }
        });

        setupKeyboard(this, (id) => this.scrollToEntity(id));
        setupDragAndDrop(this, (asset, parent) => createEntityFromAsset(this, asset, parent));
    }

    private showPlayModeContextMenu(x: number, y: number, entityId: number | null): void {
        const pms = getPlayModeService();
        const items: ContextMenuItem[] = [];

        if (entityId !== null) {
            items.push(
                { label: 'Rename', icon: icons.pencil(14), onClick: () => {
                    this.renamingEntityId = entityId;
                    this.renderVisibleRows();
                } },
                { label: 'Delete', icon: icons.trash(14), onClick: () => {
                    pms.despawnEntity(entityId);
                } },
                { label: '', separator: true },
            );
        }

        items.push(
            { label: 'Create Empty Entity', icon: icons.plus(14), onClick: () => {
                const parentId = entityId;
                pms.spawnEntity(undefined, parentId);
            } },
        );

        showContextMenu({ x, y, items });
    }

    private startInlineRename(entityId: number): void {
        let entityData;
        if (this.playMode) {
            const pms = getPlayModeService();
            entityData = pms.getRuntimeEntityData(entityId);
        } else {
            entityData = this.store.getEntityData(entityId);
        }
        if (!entityData) return;

        this.renamingEntityId = entityId;

        const item = this.visibleWindow.querySelector(`[data-entity-id="${entityId}"]`);
        if (!item) return;

        const nameSpan = item.querySelector('.es-hierarchy-name') as HTMLElement;
        if (!nameSpan) return;

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'es-hierarchy-rename-input';
        input.value = entityData.name;
        input.select();

        const commitRename = () => {
            const newName = input.value.trim();
            if (newName && newName !== entityData.name) {
                if (this.playMode) {
                    const pms = getPlayModeService();
                    pms.renameEntity(entityId, newName);
                } else {
                    this.store.renameEntity(entityId as Entity, newName);
                }
            }
            this.renamingEntityId = null;
            this.renderVisibleRows();
        };

        const cancelRename = () => {
            this.renamingEntityId = null;
            this.renderVisibleRows();
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                commitRename();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelRename();
            }
            e.stopPropagation();
        });

        input.addEventListener('blur', commitRename, { once: true });

        nameSpan.textContent = '';
        nameSpan.appendChild(input);
        input.focus();
        input.select();
    }

    render(): void {
        const selectedEntity = this.store.selectedEntity;

        if (this.prefabEditBar_) {
            if (this.playMode) {
                this.prefabEditBar_.style.display = 'none';
            } else if (this.store.isEditingPrefab) {
                this.prefabEditBar_.style.display = '';
                const nameEl = this.prefabEditBar_.querySelector('.es-prefab-edit-name');
                if (nameEl) {
                    const rawPath = this.store.prefabEditingPath ?? '';
                    const path = isUUID(rawPath) ? (getAssetDatabase().getPath(rawPath) ?? rawPath) : rawPath;
                    const fileName = path.split('/').pop() ?? path;
                    nameEl.innerHTML = `${icons.package(12)} ${escapeHtml(fileName)}`;
                }
            } else {
                this.prefabEditBar_.style.display = 'none';
            }
        }

        const selectionChanged = selectedEntity !== null && selectedEntity !== this.lastSelectedEntity;
        if (selectionChanged) {
            expandAncestors(this, selectedEntity);
        }
        this.lastSelectedEntity = selectedEntity;

        this.flatRows = buildFlatRows(this);
        this.scrollContent.style.height = `${this.flatRows.length * ROW_HEIGHT}px`;
        this.lastVisibleStart_ = -1;
        this.lastVisibleEnd_ = -1;
        this.renderVisibleRows();

        if (selectionChanged) {
            this.scrollToEntity(selectedEntity as number);
        }
    }

    renderVisibleRows(): void {
        const { start, end } = this.getVisibleRange();
        const selectedEntity = this.store.selectedEntity;

        this.visibleWindow.style.transform = `translateY(${start * ROW_HEIGHT}px)`;

        let html = '';
        for (let i = start; i < end; i++) {
            html += renderSingleRow(this, this.flatRows[i], selectedEntity);
        }
        this.visibleWindow.innerHTML = html;

        this.lastVisibleStart_ = start;
        this.lastVisibleEnd_ = end;

        if (this.renamingEntityId !== null) {
            const item = this.visibleWindow.querySelector(`[data-entity-id="${this.renamingEntityId}"]`);
            if (item) {
                this.startInlineRename(this.renamingEntityId);
            }
        }
    }

    private getVisibleRange(): { start: number; end: number } {
        const scrollTop = this.treeContainer.scrollTop;
        const viewHeight = this.treeContainer.clientHeight;
        const totalRows = this.flatRows.length;

        let start = Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN;
        let end = Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT) + OVERSCAN;

        return { start: Math.max(0, start), end: Math.min(totalRows, end) };
    }

    private scrollToEntity(entityId: number): void {
        const index = this.flatRows.findIndex(r => r.entity.id === entityId);
        if (index === -1) return;

        const targetTop = index * ROW_HEIGHT;
        const targetBottom = targetTop + ROW_HEIGHT;
        const scrollTop = this.treeContainer.scrollTop;
        const viewHeight = this.treeContainer.clientHeight;

        if (targetTop < scrollTop) {
            this.treeContainer.scrollTop = targetTop;
        } else if (targetBottom > scrollTop + viewHeight) {
            this.treeContainer.scrollTop = targetBottom - viewHeight;
        }
    }

    private setExpandedRecursive_(entityId: Entity, expand: boolean): void {
        if (expand) {
            this.expandedIds.add(entityId);
        } else {
            this.expandedIds.delete(entityId);
        }
        const data = this.store.getEntityData(entityId);
        if (data?.children) {
            for (const childId of data.children) {
                this.setExpandedRecursive_(childId as Entity, expand);
            }
        }
    }

    private onScroll(): void {
        if (this.scrollRafId_) return;
        this.scrollRafId_ = requestAnimationFrame(() => {
            this.scrollRafId_ = 0;
            const { start, end } = this.getVisibleRange();
            if (start !== this.lastVisibleStart_ || end !== this.lastVisibleEnd_) {
                this.renderVisibleRows();
            }
        });
    }
}
