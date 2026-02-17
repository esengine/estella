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
import { getPlayModeService } from '../../services/PlayModeService';
import type { RuntimeEntityData } from '../game-view/GameViewBridge';
import type { EntityData } from '../../types/SceneTypes';

export class HierarchyPanel implements HierarchyState {
    private container_: HTMLElement;
    store: EditorStore;
    treeContainer: HTMLElement;
    searchInput: HTMLInputElement | null = null;
    private footerContainer_: HTMLElement | null = null;
    private prefabEditBar_: HTMLElement | null = null;
    private unsubscribe_: (() => void) | null = null;
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
    private boundOnScroll_: (() => void) | null = null;
    renamingEntityId: number | null = null;
    lastClickEntityId: number | null = null;
    lastClickTime: number = 0;
    playMode: boolean = false;
    private playModeCleanups_: (() => void)[] = [];
    private toolbar_: HTMLElement | null = null;

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
                <input type="text" class="es-input es-hierarchy-search" placeholder="Search...">
                <button class="es-btn es-btn-icon" data-action="collapse-all" title="Collapse All">${icons.chevronRight(12)}</button>
                <button class="es-btn es-btn-icon" data-action="expand-all" title="Expand All">${icons.chevronDown(12)}</button>
                <button class="es-btn es-btn-icon" data-action="add" title="Create Entity">${icons.plus()}</button>
                <button class="es-btn es-btn-icon" data-action="duplicate" title="Duplicate">${icons.copy()}</button>
            </div>
            <div class="es-hierarchy-columns">
                <span class="es-hierarchy-col-visibility">${icons.eye(12)}</span>
                <span class="es-hierarchy-col-lock">${icons.star(12)}</span>
                <span class="es-hierarchy-col-label">Item Label</span>
                <span class="es-hierarchy-col-type">Type</span>
            </div>
            <div class="es-hierarchy-tree" role="tree"></div>
            <div class="es-hierarchy-footer">0 entities</div>
        `;

        this.treeContainer = this.container_.querySelector('.es-hierarchy-tree')!;
        this.treeContainer.tabIndex = 0;
        this.scrollContent = document.createElement('div');
        this.scrollContent.className = 'es-hierarchy-scroll-content';
        this.visibleWindow = document.createElement('div');
        this.visibleWindow.className = 'es-hierarchy-visible-window';
        this.scrollContent.appendChild(this.visibleWindow);
        this.treeContainer.appendChild(this.scrollContent);
        this.boundOnScroll_ = () => this.onScroll();
        this.treeContainer.addEventListener('scroll', this.boundOnScroll_);
        this.searchInput = this.container_.querySelector('.es-hierarchy-search');
        this.footerContainer_ = this.container_.querySelector('.es-hierarchy-footer');
        this.prefabEditBar_ = this.container_.querySelector('.es-prefab-edit-bar');

        const backBtn = this.container_.querySelector('.es-prefab-back-btn');
        backBtn?.addEventListener('click', () => {
            this.store.exitPrefabEditMode();
        });

        this.toolbar_ = this.container_.querySelector('.es-hierarchy-toolbar');

        this.setupEvents();
        this.unsubscribe_ = store.subscribe((_state, dirtyFlags) => this.onStoreNotify(dirtyFlags));
        this.render();

        const pms = getPlayModeService();
        this.playModeCleanups_.push(
            pms.onStateChange((state) => {
                this.playMode = state === 'playing';
                if (this.playMode) {
                    this.container_.classList.add('es-play-mode');
                    this.setToolbarDisabled(true);
                } else {
                    this.container_.classList.remove('es-play-mode');
                    this.setToolbarDisabled(false);
                }
                this.render();
            }),
            pms.onEntityListUpdate(() => {
                if (this.playMode) this.render();
            }),
            pms.onSelectionChange(() => {
                if (this.playMode) this.renderVisibleRows();
            }),
        );
    }

    dispose(): void {
        for (const cleanup of this.playModeCleanups_) cleanup();
        this.playModeCleanups_ = [];
        if (this.unsubscribe_) {
            this.unsubscribe_();
            this.unsubscribe_ = null;
        }
        if (this.scrollRafId_) {
            cancelAnimationFrame(this.scrollRafId_);
            this.scrollRafId_ = 0;
        }
        if (this.boundOnScroll_) {
            this.treeContainer.removeEventListener('scroll', this.boundOnScroll_);
            this.boundOnScroll_ = null;
        }
    }

    private onStoreNotify(dirtyFlags?: ReadonlySet<DirtyFlag>): void {
        if (this.playMode) return;
        if (dirtyFlags && !dirtyFlags.has('scene') && !dirtyFlags.has('hierarchy') && !dirtyFlags.has('selection')) {
            return;
        }

        const needsRebuild = !dirtyFlags || dirtyFlags.has('scene') || dirtyFlags.has('hierarchy');

        if (needsRebuild) {
            this.render();
        } else {
            this.renderVisibleRows();
            this.updateFooter();
        }
    }

    private setupEvents(): void {
        const addBtn = this.container_.querySelector('[data-action="add"]');
        addBtn?.addEventListener('click', () => {
            const entity = this.store.createEntity();
            this.store.addComponent(entity, 'LocalTransform', getInitialComponentData('LocalTransform'));
        });

        const dupBtn = this.container_.querySelector('[data-action="duplicate"]');
        dupBtn?.addEventListener('click', () => {
            const selected = this.store.selectedEntity;
            if (selected !== null) {
                duplicateEntity(this, selected);
            }
        });

        const collapseAllBtn = this.container_.querySelector('[data-action="collapse-all"]');
        collapseAllBtn?.addEventListener('click', () => {
            this.expandedIds.clear();
            this.render();
        });

        const expandAllBtn = this.container_.querySelector('[data-action="expand-all"]');
        expandAllBtn?.addEventListener('click', () => {
            for (const entity of this.store.scene.entities) {
                if (entity.children.length > 0) {
                    this.expandedIds.add(entity.id);
                }
            }
            this.render();
        });

        this.searchInput?.addEventListener('input', () => {
            this.searchFilter = this.searchInput?.value ?? '';
            performSearch(this);
            this.render();
        });

        this.searchInput?.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                selectNextResult(this);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                selectPreviousResult(this);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                focusSelectedResult(this);
            } else if (e.key === 'Escape') {
                clearSearch(this);
            }
        });

        this.treeContainer.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;

            if (target.closest('.es-hierarchy-rename-input')) return;

            const expandBtn = target.closest('.es-hierarchy-expand') as HTMLElement;
            if (expandBtn) {
                e.stopPropagation();
                const row = expandBtn.closest('.es-hierarchy-row');
                const item = row?.parentElement as HTMLElement;
                const entityId = parseInt(item?.dataset.entityId ?? '', 10);
                if (!isNaN(entityId)) {
                    if (this.expandedIds.has(entityId)) {
                        this.expandedIds.delete(entityId);
                    } else {
                        this.expandedIds.add(entityId);
                    }
                    this.render();
                }
                return;
            }

            if (this.playMode) {
                const row = target.closest('.es-hierarchy-row');
                const item = row?.parentElement as HTMLElement;
                if (!item?.classList.contains('es-hierarchy-item')) return;
                const entityId = parseInt(item.dataset.entityId ?? '', 10);
                if (!isNaN(entityId)) {
                    getPlayModeService().selectEntity(entityId);
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

        this.treeContainer.addEventListener('dblclick', (e) => {
            if (this.playMode) return;
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

        this.treeContainer.addEventListener('contextmenu', (e) => {
            if (this.playMode) { e.preventDefault(); return; }
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

    private startInlineRename(entityId: number): void {
        const entityData = this.store.getEntityData(entityId);
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
                this.store.renameEntity(entityId as Entity, newName);
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
        if (this.playMode) {
            this.renderPlayMode();
            return;
        }

        const scene = this.store.scene;
        const selectedEntity = this.store.selectedEntity;

        if (this.prefabEditBar_) {
            if (this.store.isEditingPrefab) {
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

        this.updateFooter();

        if (selectionChanged) {
            this.scrollToEntity(selectedEntity as number);
        }
    }

    private updateFooter(): void {
        if (!this.footerContainer_) return;

        if (this.playMode) {
            const count = getPlayModeService().runtimeEntities.length;
            this.footerContainer_.textContent = `${count} ${count === 1 ? 'entity' : 'entities'} (Runtime)`;
            return;
        }

        if (this.searchFilter) {
            const count = this.searchResults.length;
            this.footerContainer_.textContent = `${count} ${count === 1 ? 'match' : 'matches'}`;
        } else {
            const count = this.store.scene.entities.length;
            this.footerContainer_.textContent = `${count} ${count === 1 ? 'entity' : 'entities'}`;
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

    private renderPlayMode(): void {
        if (this.prefabEditBar_) {
            this.prefabEditBar_.style.display = 'none';
        }

        const entities = getPlayModeService().runtimeEntities;
        const entityMap = new Map<number, RuntimeEntityData>();
        for (const e of entities) entityMap.set(e.entityId, e);

        const rows: FlattenedRow[] = [];
        const visited = new Set<number>();
        const buildRows = (parentId: number | null, depth: number) => {
            for (const e of entities) {
                if (visited.has(e.entityId)) continue;
                if ((e.parentId ?? null) !== parentId) continue;
                visited.add(e.entityId);
                const adapted = runtimeToEntityData(e);
                const hasChildren = (e.children?.length ?? 0) > 0;
                const isExpanded = this.expandedIds.has(e.entityId);
                rows.push({ entity: adapted, depth, hasChildren, isExpanded });
                if (hasChildren && isExpanded) {
                    buildRows(e.entityId, depth + 1);
                }
            }
        };
        buildRows(null, 0);

        this.flatRows = rows;
        this.scrollContent.style.height = `${rows.length * ROW_HEIGHT}px`;
        this.lastVisibleStart_ = -1;
        this.lastVisibleEnd_ = -1;
        this.renderVisibleRows();
        this.updateFooter();
    }

    private setToolbarDisabled(disabled: boolean): void {
        if (!this.toolbar_) return;
        const buttons = this.toolbar_.querySelectorAll('[data-action="add"], [data-action="duplicate"]');
        for (const btn of buttons) {
            (btn as HTMLButtonElement).disabled = disabled;
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

function runtimeToEntityData(r: RuntimeEntityData): EntityData {
    return {
        id: r.entityId,
        name: r.name,
        parent: r.parentId ?? null,
        children: r.children ?? [],
        components: r.components.map(c => ({ type: c.type, data: c.data })),
        visible: true,
    };
}
