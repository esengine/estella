/**
 * @file    HierarchyPanel.ts
 * @brief   Entity hierarchy tree panel
 */

import type { Entity } from 'esengine';
import type { EntityData } from '../types/SceneTypes';
import type { EditorStore } from '../store/EditorStore';
import { icons } from '../utils/icons';
import { getGlobalPathResolver } from '../asset';
import { getInitialComponentData } from '../schemas/ComponentSchemas';
import { showContextMenu, type ContextMenuItem } from '../ui/ContextMenu';
import { getContextMenuItems, type ContextMenuContext } from '../ui/ContextMenuRegistry';
import { getEditorContext, getEditorInstance } from '../context/EditorContext';
import { getAssetDatabase, isUUID } from '../asset/AssetDatabase';
import { getPlatformAdapter } from '../platform/PlatformAdapter';
import { generateUniqueName } from '../utils/naming';
import { showInputDialog } from '../ui/dialog';
import { joinPath, getParentDir } from '../utils/path';
import { hasAnyOverrides } from '../prefab';

type DropPosition = 'before' | 'after' | 'inside';

const ROW_HEIGHT = 22;
const OVERSCAN = 5;

interface FlattenedRow {
    entity: EntityData;
    depth: number;
    hasChildren: boolean;
    isExpanded: boolean;
}

// =============================================================================
// HierarchyPanel
// =============================================================================

export class HierarchyPanel {
    private container_: HTMLElement;
    private store_: EditorStore;
    private treeContainer_: HTMLElement;
    private searchInput_: HTMLInputElement | null = null;
    private footerContainer_: HTMLElement | null = null;
    private prefabEditBar_: HTMLElement | null = null;
    private unsubscribe_: (() => void) | null = null;
    private searchFilter_: string = '';
    private expandedIds_: Set<number> = new Set();
    private lastSelectedEntity_: Entity | null = null;
    private flatRows_: FlattenedRow[] = [];
    private scrollContent_!: HTMLElement;
    private visibleWindow_!: HTMLElement;
    private scrollRafId_: number = 0;
    private lastVisibleStart_: number = -1;
    private lastVisibleEnd_: number = -1;
    private dragOverEntityId_: number | null = null;
    private dropPosition_: DropPosition | null = null;
    private draggingEntityId_: number | null = null;

    constructor(container: HTMLElement, store: EditorStore) {
        this.container_ = container;
        this.store_ = store;

        this.container_.className = 'es-hierarchy-panel';
        this.container_.innerHTML = `
            <div class="es-panel-header">
                <span class="es-panel-title">${icons.list(14)} Hierarchy</span>
                <div class="es-panel-actions">
                    <button class="es-btn es-btn-icon" title="Minimize">${icons.chevronDown(12)}</button>
                    <button class="es-btn es-btn-icon" title="Close">${icons.x(12)}</button>
                </div>
            </div>
            <div class="es-prefab-edit-bar" style="display: none;">
                <button class="es-prefab-back-btn">${icons.chevronRight(12)} Back to Scene</button>
                <span class="es-prefab-edit-name">${icons.package(12)} </span>
            </div>
            <div class="es-hierarchy-toolbar">
                <input type="text" class="es-input es-hierarchy-search" placeholder="Search...">
                <button class="es-btn es-btn-icon" data-action="add" title="Create Entity">${icons.plus()}</button>
                <button class="es-btn es-btn-icon" title="Duplicate">${icons.copy()}</button>
                <button class="es-btn es-btn-icon" title="Settings">${icons.settings()}</button>
            </div>
            <div class="es-hierarchy-columns">
                <span class="es-hierarchy-col-visibility">${icons.eye(12)}</span>
                <span class="es-hierarchy-col-lock">${icons.star(12)}</span>
                <span class="es-hierarchy-col-label">Item Label</span>
                <span class="es-hierarchy-col-type">Type</span>
            </div>
            <div class="es-hierarchy-tree"></div>
            <div class="es-hierarchy-footer">0 entities</div>
        `;

        this.treeContainer_ = this.container_.querySelector('.es-hierarchy-tree')!;
        this.scrollContent_ = document.createElement('div');
        this.scrollContent_.className = 'es-hierarchy-scroll-content';
        this.visibleWindow_ = document.createElement('div');
        this.visibleWindow_.className = 'es-hierarchy-visible-window';
        this.scrollContent_.appendChild(this.visibleWindow_);
        this.treeContainer_.appendChild(this.scrollContent_);
        this.treeContainer_.addEventListener('scroll', () => this.onScroll());
        this.searchInput_ = this.container_.querySelector('.es-hierarchy-search');
        this.footerContainer_ = this.container_.querySelector('.es-hierarchy-footer');
        this.prefabEditBar_ = this.container_.querySelector('.es-prefab-edit-bar');

        const backBtn = this.container_.querySelector('.es-prefab-back-btn');
        backBtn?.addEventListener('click', () => {
            this.store_.exitPrefabEditMode();
        });

        this.setupEvents();
        this.unsubscribe_ = store.subscribe(() => this.render());
        this.render();
    }

    dispose(): void {
        if (this.unsubscribe_) {
            this.unsubscribe_();
            this.unsubscribe_ = null;
        }
        if (this.scrollRafId_) {
            cancelAnimationFrame(this.scrollRafId_);
            this.scrollRafId_ = 0;
        }
    }

    private setupEvents(): void {
        const addBtn = this.container_.querySelector('[data-action="add"]');
        addBtn?.addEventListener('click', () => {
            const entity = this.store_.createEntity();
            this.store_.addComponent(entity, 'LocalTransform', getInitialComponentData('LocalTransform'));
        });

        this.searchInput_?.addEventListener('input', () => {
            this.searchFilter_ = this.searchInput_?.value.toLowerCase() ?? '';
            this.render();
        });

        this.treeContainer_.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;

            const visibilityBtn = target.closest('.es-hierarchy-visibility') as HTMLElement;
            if (visibilityBtn) {
                e.stopPropagation();
                const item = visibilityBtn.closest('.es-hierarchy-item') as HTMLElement;
                const entityId = parseInt(item?.dataset.entityId ?? '', 10);
                if (!isNaN(entityId)) {
                    this.store_.toggleVisibility(entityId);
                }
                return;
            }

            const expandBtn = target.closest('.es-hierarchy-expand') as HTMLElement;
            if (expandBtn) {
                e.stopPropagation();
                const row = expandBtn.closest('.es-hierarchy-row');
                const item = row?.parentElement as HTMLElement;
                const entityId = parseInt(item?.dataset.entityId ?? '', 10);
                if (!isNaN(entityId)) {
                    if (this.expandedIds_.has(entityId)) {
                        this.expandedIds_.delete(entityId);
                    } else {
                        this.expandedIds_.add(entityId);
                    }
                    this.render();
                }
                return;
            }

            const row = target.closest('.es-hierarchy-row');
            const item = row?.parentElement as HTMLElement;
            if (!item?.classList.contains('es-hierarchy-item')) return;

            const entityId = parseInt(item.dataset.entityId ?? '', 10);
            if (isNaN(entityId)) return;

            this.store_.selectEntity(entityId as Entity);
        });

        this.treeContainer_.addEventListener('dblclick', (e) => {
            const target = e.target as HTMLElement;
            const item = target.closest('.es-hierarchy-item') as HTMLElement;
            if (!item) return;

            const entityId = parseInt(item.dataset.entityId ?? '', 10);
            if (!isNaN(entityId)) {
                this.store_.focusEntity(entityId);
            }
        });

        this.treeContainer_.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const target = e.target as HTMLElement;
            const item = target.closest('.es-hierarchy-item') as HTMLElement;

            if (item) {
                const entityId = parseInt(item.dataset.entityId ?? '', 10);
                if (!isNaN(entityId)) {
                    this.showEntityContextMenu(e.clientX, e.clientY, entityId as Entity);
                }
            } else {
                this.showEntityContextMenu(e.clientX, e.clientY, null);
            }
        });

        this.setupDragAndDrop();
    }

    private setupDragAndDrop(): void {
        this.treeContainer_.addEventListener('dragstart', (e) => {
            const target = e.target as HTMLElement;
            const row = target.closest('.es-hierarchy-row') as HTMLElement;
            const item = row?.parentElement as HTMLElement;
            if (!item?.classList.contains('es-hierarchy-item')) return;

            const entityId = item.dataset.entityId;
            if (!entityId) return;

            e.dataTransfer!.setData('application/esengine-entity', entityId);
            e.dataTransfer!.effectAllowed = 'move';
            this.draggingEntityId_ = parseInt(entityId, 10);
            item.classList.add('es-dragging');

            const onDragEnd = () => {
                row.removeEventListener('dragend', onDragEnd);
                this.draggingEntityId_ = null;
                this.dragOverEntityId_ = null;
                this.dropPosition_ = null;
                this.treeContainer_.classList.remove('es-drag-over');
                this.renderVisibleRows();
            };
            row.addEventListener('dragend', onDragEnd);
        });

        this.treeContainer_.addEventListener('dragover', (e) => {
            const types = e.dataTransfer?.types ?? [];
            const hasAssetData = Array.from(types).includes('application/esengine-asset');
            const hasEntityData = Array.from(types).includes('application/esengine-entity');

            if (!hasAssetData && !hasEntityData) return;

            e.preventDefault();

            const target = e.target as HTMLElement;
            const item = target.closest('.es-hierarchy-item') as HTMLElement;
            const entityId = item ? parseInt(item.dataset.entityId ?? '', 10) : NaN;
            const newEntityId = isNaN(entityId) ? null : entityId;

            if (hasAssetData) {
                e.dataTransfer!.dropEffect = 'copy';
                if (newEntityId !== this.dragOverEntityId_ || this.dropPosition_ !== null) {
                    this.dragOverEntityId_ = newEntityId;
                    this.dropPosition_ = null;
                    this.treeContainer_.classList.toggle('es-drag-over', !item);
                    this.renderVisibleRows();
                }
                return;
            }

            e.dataTransfer!.dropEffect = 'move';

            if (!item) {
                if (this.dragOverEntityId_ !== null) {
                    this.dragOverEntityId_ = null;
                    this.dropPosition_ = null;
                    this.renderVisibleRows();
                }
                this.treeContainer_.classList.add('es-drag-over');
                return;
            }

            this.treeContainer_.classList.remove('es-drag-over');
            const position = this.getDropPosition(e, item);
            if (newEntityId !== this.dragOverEntityId_ || position !== this.dropPosition_) {
                this.dragOverEntityId_ = newEntityId;
                this.dropPosition_ = position;
                this.renderVisibleRows();
            }
        });

        this.treeContainer_.addEventListener('dragleave', (e) => {
            const relatedTarget = e.relatedTarget as HTMLElement;
            if (this.treeContainer_.contains(relatedTarget)) return;
            this.dragOverEntityId_ = null;
            this.dropPosition_ = null;
            this.treeContainer_.classList.remove('es-drag-over');
            this.renderVisibleRows();
        });

        this.treeContainer_.addEventListener('drop', (e) => {
            e.preventDefault();

            const assetDataStr = e.dataTransfer?.getData('application/esengine-asset');
            const entityIdStr = e.dataTransfer?.getData('application/esengine-entity');
            const target = e.target as HTMLElement;
            const dropItem = target.closest('.es-hierarchy-item') as HTMLElement;
            const dropTargetId = dropItem ? parseInt(dropItem.dataset.entityId ?? '', 10) : NaN;
            const dropPos = dropItem ? this.getDropPosition(e, dropItem) : null;

            this.dragOverEntityId_ = null;
            this.dropPosition_ = null;
            this.draggingEntityId_ = null;
            this.treeContainer_.classList.remove('es-drag-over');

            if (assetDataStr) {
                let assetData: { type: string; path: string; name: string };
                try {
                    assetData = JSON.parse(assetDataStr);
                } catch {
                    return;
                }
                const parentEntity = !isNaN(dropTargetId) ? dropTargetId as Entity : null;
                this.createEntityFromAsset(assetData, parentEntity);
                return;
            }

            if (!entityIdStr) return;

            const draggedId = parseInt(entityIdStr, 10);
            if (isNaN(draggedId)) return;

            if (isNaN(dropTargetId)) {
                const scene = this.store_.scene;
                const roots = scene.entities.filter(e => e.parent === null);
                this.store_.moveEntity(draggedId as Entity, null, roots.length);
                return;
            }

            if (dropTargetId === draggedId || !dropPos) return;
            if (this.isDescendantOf(draggedId, dropTargetId)) return;

            const targetEntity = this.store_.getEntityData(dropTargetId);
            if (!targetEntity) return;

            if (dropPos === 'inside') {
                this.store_.moveEntity(draggedId as Entity, dropTargetId as Entity, targetEntity.children.length);
                this.expandedIds_.add(dropTargetId);
            } else {
                const parentId = targetEntity.parent;
                if (parentId !== null) {
                    const parent = this.store_.getEntityData(parentId);
                    if (!parent) return;
                    let idx = parent.children.indexOf(dropTargetId);
                    if (dropPos === 'after') idx++;
                    const draggedIdx = parent.children.indexOf(draggedId);
                    if (draggedIdx !== -1 && draggedIdx < idx) idx--;
                    this.store_.moveEntity(draggedId as Entity, parentId as Entity, idx);
                } else {
                    const scene = this.store_.scene;
                    const roots = scene.entities.filter(en => en.parent === null);
                    let idx = roots.findIndex(en => en.id === dropTargetId);
                    if (dropPos === 'after') idx++;
                    const draggedIdx = roots.findIndex(en => en.id === draggedId);
                    if (draggedIdx !== -1 && draggedIdx < idx) idx--;
                    this.store_.moveEntity(draggedId as Entity, null, idx);
                }
            }
        });
    }

    private getDropPosition(e: DragEvent, item: HTMLElement): DropPosition {
        const row = item.querySelector('.es-hierarchy-row') as HTMLElement;
        const rect = row.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const ratio = y / rect.height;
        if (ratio < 0.25) return 'before';
        if (ratio > 0.75) return 'after';
        return 'inside';
    }

    private isDescendantOf(entityId: number, ancestorId: number): boolean {
        let current: number | null = entityId;
        while (current !== null) {
            if (current === ancestorId) return true;
            const entity = this.store_.getEntityData(current);
            current = entity?.parent ?? null;
        }
        return false;
    }

    private async createEntityFromAsset(
        asset: { type: string; path: string; name: string },
        parent: Entity | null
    ): Promise<void> {
        if (asset.type === 'prefab') {
            await this.createEntityFromPrefab(asset.path, parent);
            return;
        }

        const baseName = asset.name.replace(/\.[^.]+$/, '');

        if (asset.type === 'spine' || asset.type === 'json') {
            const ext = asset.name.substring(asset.name.lastIndexOf('.')).toLowerCase();
            if (ext === '.atlas') return;

            const skeletonPath = this.toRelativePath(asset.path);
            const atlasPath = await this.findAtlasFile(skeletonPath);

            if (!atlasPath) {
                console.error(`[HierarchyPanel] No atlas file found for: ${skeletonPath}`);
                alert(`无法找到 atlas 文件。\n请确保骨骼文件所在目录下有 .atlas 文件。`);
                return;
            }

            const newEntity = this.store_.createEntity(baseName, parent);

            this.store_.addComponent(newEntity, 'LocalTransform', getInitialComponentData('LocalTransform'));

            this.store_.addComponent(newEntity, 'SpineAnimation', {
                ...getInitialComponentData('SpineAnimation'),
                skeletonPath,
                atlasPath,
            });
        } else if (asset.type === 'image') {
            const newEntity = this.store_.createEntity(baseName, parent);

            this.store_.addComponent(newEntity, 'LocalTransform', getInitialComponentData('LocalTransform'));

            this.store_.addComponent(newEntity, 'Sprite', {
                ...getInitialComponentData('Sprite'),
                texture: this.toRelativePath(asset.path),
            });

            this.loadImageSize(asset.path).then(size => {
                if (size) {
                    this.store_.updateProperty(newEntity, 'Sprite', 'size', { x: 32, y: 32 }, size);
                }
            });
        }
    }

    private toRelativePath(absolutePath: string): string {
        return getGlobalPathResolver().toRelativePath(absolutePath);
    }

    private async findAtlasFile(skeletonPath: string): Promise<string | null> {
        const pathResolver = getGlobalPathResolver();

        const sameNameAtlas = skeletonPath.replace(/\.(json|skel)$/i, '.atlas');
        const validation = await pathResolver.validatePath(sameNameAtlas);
        if (validation.exists) {
            return sameNameAtlas;
        }

        const dir = skeletonPath.substring(0, skeletonPath.lastIndexOf('/'));
        const absoluteDir = pathResolver.toAbsolutePath(dir);

        const fs = getEditorContext().fs;
        if (!fs) {
            return null;
        }

        try {
            const entries = await fs.listDirectoryDetailed(absoluteDir);
            const atlasFiles = entries
                .filter(e => e.name.endsWith('.atlas'))
                .map(e => e.name);

            if (atlasFiles.length === 1) {
                return dir ? `${dir}/${atlasFiles[0]}` : atlasFiles[0];
            }

            if (atlasFiles.length > 1) {
                const baseName = skeletonPath
                    .substring(skeletonPath.lastIndexOf('/') + 1)
                    .replace(/\.(json|skel)$/i, '');

                const matching = atlasFiles.find((name: string) =>
                    name.replace('.atlas', '').toLowerCase().includes(baseName.toLowerCase().split('-')[0])
                );

                if (matching) {
                    return dir ? `${dir}/${matching}` : matching;
                }

                return dir ? `${dir}/${atlasFiles[0]}` : atlasFiles[0];
            }
        } catch (err) {
            console.warn('[HierarchyPanel] Failed to scan directory for atlas files:', err);
        }

        return null;
    }

    private loadImageSize(absolutePath: string): Promise<{ x: number; y: number } | null> {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve({ x: img.naturalWidth, y: img.naturalHeight });
            img.onerror = () => resolve(null);
            img.src = getPlatformAdapter().convertFilePathToUrl(absolutePath);
        });
    }

    private render(): void {
        const scene = this.store_.scene;
        const selectedEntity = this.store_.selectedEntity;

        if (this.prefabEditBar_) {
            if (this.store_.isEditingPrefab) {
                this.prefabEditBar_.style.display = '';
                const nameEl = this.prefabEditBar_.querySelector('.es-prefab-edit-name');
                if (nameEl) {
                    const rawPath = this.store_.prefabEditingPath ?? '';
                    const path = isUUID(rawPath) ? (getAssetDatabase().getPath(rawPath) ?? rawPath) : rawPath;
                    const fileName = path.split('/').pop() ?? path;
                    nameEl.innerHTML = `${icons.package(12)} ${this.escapeHtml(fileName)}`;
                }
            } else {
                this.prefabEditBar_.style.display = 'none';
            }
        }

        const selectionChanged = selectedEntity !== null && selectedEntity !== this.lastSelectedEntity_;
        if (selectionChanged) {
            this.expandAncestors(selectedEntity);
        }
        this.lastSelectedEntity_ = selectedEntity;

        this.buildFlatRows();
        this.scrollContent_.style.height = `${this.flatRows_.length * ROW_HEIGHT}px`;
        this.lastVisibleStart_ = -1;
        this.lastVisibleEnd_ = -1;
        this.renderVisibleRows();

        if (this.footerContainer_) {
            const count = scene.entities.length;
            this.footerContainer_.textContent = `${count} ${count === 1 ? 'entity' : 'entities'}`;
        }

        if (selectionChanged) {
            this.scrollToEntity(selectedEntity as number);
        }
    }

    private expandAncestors(entityId: Entity): void {
        const entity = this.store_.getEntityData(entityId as number);
        if (!entity || entity.parent === null) return;

        let parentId: number | null = entity.parent;
        while (parentId !== null) {
            this.expandedIds_.add(parentId);
            const parent = this.store_.getEntityData(parentId);
            parentId = parent?.parent ?? null;
        }
    }

    private getEntityIcon(entity: EntityData): string {
        if (entity.prefab?.isRoot) return icons.package(12);

        const hasCamera = entity.components.some(c => c.type === 'Camera');
        const hasSprite = entity.components.some(c => c.type === 'Sprite');
        const hasText = entity.components.some(c => c.type === 'Text');
        const hasBitmapText = entity.components.some(c => c.type === 'BitmapText');
        const hasTextInput = entity.components.some(c => c.type === 'TextInput');
        const hasSpine = entity.components.some(c => c.type === 'SpineAnimation');

        if (hasCamera) return icons.camera(12);
        if (hasSpine) return icons.bone(12);
        if (hasText || hasBitmapText || hasTextInput) return icons.type(12);
        if (hasSprite) return icons.image(12);
        return icons.box(12);
    }

    private getEntityType(entity: EntityData): string {
        const hasCamera = entity.components.some(c => c.type === 'Camera');
        const hasSpine = entity.components.some(c => c.type === 'SpineAnimation');
        if (hasCamera) return 'Camera';
        if (hasSpine) return 'Spine';
        return 'Entity';
    }

    private buildFlatRows(): void {
        this.flatRows_ = [];
        const scene = this.store_.scene;

        if (this.searchFilter_) {
            for (const entity of scene.entities) {
                if (entity.name.toLowerCase().includes(this.searchFilter_)) {
                    this.flatRows_.push({ entity, depth: 0, hasChildren: false, isExpanded: false });
                }
            }
            return;
        }

        const roots = scene.entities.filter(e => e.parent === null);
        this.flattenDFS(roots, 0);
    }

    private flattenDFS(entities: EntityData[], depth: number): void {
        for (const entity of entities) {
            const children = entity.children
                .map(id => this.store_.getEntityData(id))
                .filter((e): e is EntityData => e !== null);
            const hasChildren = children.length > 0;
            const isExpanded = this.expandedIds_.has(entity.id);

            this.flatRows_.push({ entity, depth, hasChildren, isExpanded });

            if (hasChildren && isExpanded) {
                this.flattenDFS(children, depth + 1);
            }
        }
    }

    private getVisibleRange(): { start: number; end: number } {
        const scrollTop = this.treeContainer_.scrollTop;
        const viewHeight = this.treeContainer_.clientHeight;
        const totalRows = this.flatRows_.length;

        let start = Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN;
        let end = Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT) + OVERSCAN;

        return { start: Math.max(0, start), end: Math.min(totalRows, end) };
    }

    private renderVisibleRows(): void {
        const { start, end } = this.getVisibleRange();
        const selectedEntity = this.store_.selectedEntity;

        this.visibleWindow_.style.transform = `translateY(${start * ROW_HEIGHT}px)`;

        let html = '';
        for (let i = start; i < end; i++) {
            html += this.renderSingleRow(this.flatRows_[i], selectedEntity);
        }
        this.visibleWindow_.innerHTML = html;

        this.lastVisibleStart_ = start;
        this.lastVisibleEnd_ = end;
    }

    private renderSingleRow(row: FlattenedRow, selectedEntity: Entity | null): string {
        const { entity, depth, hasChildren, isExpanded } = row;
        const icon = this.getEntityIcon(entity);
        const type = this.getEntityType(entity);
        const expandIcon = isExpanded ? icons.chevronDown(10) : icons.chevronRight(10);
        const isVisible = this.store_.isEntityVisible(entity.id);
        const visibilityIcon = isVisible ? icons.eye(10) : icons.eyeOff(10);

        let itemClass = 'es-hierarchy-item';
        if (entity.id === selectedEntity) itemClass += ' es-selected';
        if (!isVisible) itemClass += ' es-entity-hidden';
        if (entity.prefab?.isRoot) itemClass += ' es-prefab-root';
        else if (entity.prefab) itemClass += ' es-prefab-child';
        if (hasChildren) itemClass += ' es-has-children';
        if (isExpanded) itemClass += ' es-expanded';
        if (entity.id === this.draggingEntityId_) itemClass += ' es-dragging';
        if (entity.id === this.dragOverEntityId_) {
            if (this.dropPosition_) {
                itemClass += ` es-drop-${this.dropPosition_}`;
            } else {
                itemClass += ' es-drag-over';
            }
        }

        return `<div class="${itemClass}" data-entity-id="${entity.id}">
            <div class="es-hierarchy-row" draggable="true" style="padding-left: ${8 + depth * 16}px">
                ${hasChildren ? `<span class="es-hierarchy-expand">${expandIcon}</span>` : '<span class="es-hierarchy-spacer"></span>'}
                <span class="es-hierarchy-visibility">${visibilityIcon}</span>
                <span class="es-hierarchy-icon">${icon}</span>
                <span class="es-hierarchy-name">${this.escapeHtml(entity.name)}</span>
                <span class="es-hierarchy-type">${type}</span>
            </div>
        </div>`;
    }

    private scrollToEntity(entityId: number): void {
        const index = this.flatRows_.findIndex(r => r.entity.id === entityId);
        if (index === -1) return;

        const targetTop = index * ROW_HEIGHT;
        const targetBottom = targetTop + ROW_HEIGHT;
        const scrollTop = this.treeContainer_.scrollTop;
        const viewHeight = this.treeContainer_.clientHeight;

        if (targetTop < scrollTop) {
            this.treeContainer_.scrollTop = targetTop;
        } else if (targetBottom > scrollTop + viewHeight) {
            this.treeContainer_.scrollTop = targetBottom - viewHeight;
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

    private showEntityContextMenu(x: number, y: number, entity: Entity | null): void {
        const entityData = entity !== null ? this.store_.getEntityData(entity as number) : null;
        const has = (type: string) => entityData?.components.some(c => c.type === type) ?? false;
        const editor = getEditorInstance();

        const createChildren: ContextMenuItem[] = [
            { label: 'Empty Entity', icon: icons.plus(14), onClick: () => {
                const newEntity = this.store_.createEntity(undefined, entity);
                this.store_.addComponent(newEntity, 'LocalTransform', getInitialComponentData('LocalTransform'));
            } },
            { label: 'Sprite', icon: icons.image(14), onClick: () => this.createEntityWithComponent('Sprite', entity) },
            { label: 'Text', icon: icons.type(14), onClick: () => this.createEntityWithComponent('Text', entity) },
            { label: 'BitmapText', icon: icons.type(14), onClick: () => this.createEntityWithComponent('BitmapText', entity) },
            { label: 'Spine', icon: icons.bone(14), onClick: () => this.createEntityWithComponent('SpineAnimation', entity) },
            { label: 'Camera', icon: icons.camera(14), onClick: () => this.createEntityWithComponent('Camera', entity) },
            { label: 'Canvas', icon: icons.template(14), onClick: () => this.createEntityWithComponent('Canvas', entity) },
            { label: '', separator: true },
            { label: 'UI', icon: icons.pointer(14), children: [
                { label: 'Button', onClick: () => this.createButtonEntity(entity) },
                { label: 'TextInput', onClick: () => this.createTextInputEntity(entity) },
                { label: 'Panel', onClick: () => this.createPanelEntity(entity) },
                { label: 'ScreenSpace Root', onClick: () => this.createScreenSpaceRootEntity(entity) },
            ] },
            { label: 'Physics', icon: icons.circle(14), children: [
                { label: 'Box Collider', onClick: () => this.createPhysicsEntity('BoxCollider', entity) },
                { label: 'Circle Collider', onClick: () => this.createPhysicsEntity('CircleCollider', entity) },
                { label: 'Capsule Collider', onClick: () => this.createPhysicsEntity('CapsuleCollider', entity) },
            ] },
        ];

        const items: ContextMenuItem[] = [];

        if (entity !== null) {
            items.push(
                { label: 'Duplicate', icon: icons.copy(14), onClick: () => this.duplicateEntity(entity) },
                { label: 'Copy', icon: icons.copy(14), onClick: () => { this.store_.selectEntity(entity); editor?.copySelected(); } },
                { label: 'Paste', icon: icons.template(14), disabled: !editor?.hasClipboard(), onClick: () => { this.store_.selectEntity(entity); editor?.pasteEntity(); } },
                { label: 'Delete', icon: icons.trash(14), onClick: () => this.store_.deleteEntity(entity) },
                { label: '', separator: true },
            );
        }

        items.push({ label: 'Create', icon: icons.plus(14), children: createChildren });

        if (entity === null) {
            items.push({ label: 'Paste', icon: icons.template(14), disabled: !editor?.hasClipboard(), onClick: () => { editor?.pasteEntity(); } });
        }

        if (entity !== null) {
            items.push({
                label: 'Add Component', children: [
                    { label: 'Interactable', disabled: has('Interactable'), onClick: () => this.addComponentToEntity(entity, 'Interactable') },
                    { label: 'Button', disabled: has('Button'), onClick: () => this.addComponentToEntity(entity, 'Button') },
                    { label: 'ScreenSpace', disabled: has('ScreenSpace'), onClick: () => this.addComponentToEntity(entity, 'ScreenSpace') },
                    { label: '', separator: true },
                    { label: 'RigidBody', disabled: has('RigidBody'), onClick: () => this.addComponentToEntity(entity, 'RigidBody') },
                    { label: 'BoxCollider', disabled: has('BoxCollider'), onClick: () => this.addComponentToEntity(entity, 'BoxCollider') },
                    { label: 'CircleCollider', disabled: has('CircleCollider'), onClick: () => this.addComponentToEntity(entity, 'CircleCollider') },
                    { label: 'CapsuleCollider', disabled: has('CapsuleCollider'), onClick: () => this.addComponentToEntity(entity, 'CapsuleCollider') },
                ],
            });

            items.push({ label: '', separator: true });

            const prefabChildren: ContextMenuItem[] = [
                { label: 'Save as Prefab...', icon: icons.package(14), onClick: () => this.saveEntityAsPrefab(entity) },
            ];
            if (this.store_.isPrefabRoot(entity as number)) {
                const instanceId = this.store_.getPrefabInstanceId(entity as number);
                const prefabPath = this.store_.getPrefabPath(entity as number);
                if (instanceId && prefabPath) {
                    const overridden = hasAnyOverrides(this.store_.scene, instanceId);
                    prefabChildren.push(
                        { label: '', separator: true },
                        { label: 'Revert Prefab', icon: icons.rotateCw(14), disabled: !overridden, onClick: () => this.store_.revertPrefabInstance(instanceId, prefabPath) },
                        { label: 'Apply to Prefab', icon: icons.check(14), disabled: !overridden, onClick: () => this.store_.applyPrefabOverrides(instanceId, prefabPath) },
                        { label: 'Unpack Prefab', icon: icons.package(14), onClick: () => this.store_.unpackPrefab(instanceId) },
                    );
                }
            }
            items.push({ label: 'Prefab', icon: icons.package(14), children: prefabChildren });
        }

        const location = entity !== null ? 'hierarchy.entity' : 'hierarchy.background';
        const ctx: ContextMenuContext = { location, entity: entity ?? undefined, entityData: entityData ?? undefined };
        const extensionItems = getContextMenuItems(location, ctx);
        if (extensionItems.length > 0) {
            items.push({ label: '', separator: true }, ...extensionItems);
        }

        showContextMenu({ x, y, items });
    }

    private createEntityWithComponent(componentType: string, parent: Entity | null): void {
        const newEntity = this.store_.createEntity(componentType, parent);

        this.store_.addComponent(newEntity, 'LocalTransform', getInitialComponentData('LocalTransform'));

        if (componentType === 'Text') {
            this.store_.addComponent(newEntity, 'UIRect', getInitialComponentData('UIRect'));
        }

        this.store_.addComponent(newEntity, componentType, getInitialComponentData(componentType));
    }

    private addComponentToEntity(entity: Entity, componentType: string): void {
        this.store_.addComponent(entity, componentType, getInitialComponentData(componentType));
    }

    private createPhysicsEntity(colliderType: string, parent: Entity | null): void {
        const newEntity = this.store_.createEntity(colliderType, parent);
        this.store_.addComponent(newEntity, 'LocalTransform', getInitialComponentData('LocalTransform'));
        this.store_.addComponent(newEntity, 'RigidBody', getInitialComponentData('RigidBody'));
        this.store_.addComponent(newEntity, colliderType, getInitialComponentData(colliderType));
    }

    private createButtonEntity(parent: Entity | null): void {
        const newEntity = this.store_.createEntity('Button', parent);
        this.store_.addComponent(newEntity, 'LocalTransform', getInitialComponentData('LocalTransform'));
        this.store_.addComponent(newEntity, 'Sprite', getInitialComponentData('Sprite'));
        this.store_.addComponent(newEntity, 'UIRect', getInitialComponentData('UIRect'));
        this.store_.addComponent(newEntity, 'Interactable', getInitialComponentData('Interactable'));
        this.store_.addComponent(newEntity, 'Button', getInitialComponentData('Button'));
    }

    private createTextInputEntity(parent: Entity | null): void {
        const newEntity = this.store_.createEntity('TextInput', parent);
        this.store_.addComponent(newEntity, 'LocalTransform', getInitialComponentData('LocalTransform'));
        const tiDefaults = getInitialComponentData('TextInput');
        this.store_.addComponent(newEntity, 'Sprite', {
            ...getInitialComponentData('Sprite'),
            color: tiDefaults.backgroundColor,
            size: { x: 200, y: 36 },
        });
        this.store_.addComponent(newEntity, 'UIRect', {
            ...getInitialComponentData('UIRect'),
            size: { x: 200, y: 36 },
        });
        this.store_.addComponent(newEntity, 'Interactable', getInitialComponentData('Interactable'));
        this.store_.addComponent(newEntity, 'TextInput', getInitialComponentData('TextInput'));
    }

    private createPanelEntity(parent: Entity | null): void {
        const newEntity = this.store_.createEntity('Panel', parent);
        this.store_.addComponent(newEntity, 'LocalTransform', getInitialComponentData('LocalTransform'));
        this.store_.addComponent(newEntity, 'Sprite', getInitialComponentData('Sprite'));
        this.store_.addComponent(newEntity, 'UIRect', getInitialComponentData('UIRect'));
        this.store_.addComponent(newEntity, 'UIMask', getInitialComponentData('UIMask'));
    }

    private createScreenSpaceRootEntity(parent: Entity | null): void {
        const newEntity = this.store_.createEntity('ScreenSpace Root', parent);
        this.store_.addComponent(newEntity, 'LocalTransform', getInitialComponentData('LocalTransform'));
        this.store_.addComponent(newEntity, 'UIRect', {
            ...getInitialComponentData('UIRect'),
            anchorMin: { x: 0, y: 0 },
            anchorMax: { x: 1, y: 1 },
        });
        this.store_.addComponent(newEntity, 'ScreenSpace', {});
    }

    private duplicateEntity(entity: Entity): void {
        const entityData = this.store_.getEntityData(entity as number);
        if (!entityData) return;

        const scene = this.store_.scene;
        const siblings = scene.entities
            .filter(e => e.parent === entityData.parent)
            .map(e => e.name);
        const siblingNames = new Set(siblings);
        const newName = generateUniqueName(entityData.name, siblingNames);

        const newEntity = this.store_.createEntity(
            newName,
            entityData.parent as Entity | null
        );

        for (const comp of entityData.components) {
            this.store_.addComponent(newEntity, comp.type, JSON.parse(JSON.stringify(comp.data)));
        }
    }

    private async saveEntityAsPrefab(entity: Entity): Promise<void> {
        const entityData = this.store_.getEntityData(entity as number);
        if (!entityData) return;

        const projectPath = getEditorInstance()?.projectPath;
        if (!projectPath) return;

        const projectDir = getParentDir(projectPath);
        const assetsDir = joinPath(projectDir, 'assets');

        const name = await showInputDialog({
            title: 'Save as Prefab',
            placeholder: 'Prefab name',
            defaultValue: entityData.name,
            confirmText: 'Save',
            validator: async (value) => {
                if (!value.trim()) return 'Name is required';
                if (/[<>:"/\\|?*\x00-\x1f]/.test(value.trim())) {
                    return 'Name contains invalid characters';
                }
                return null;
            },
        });

        if (!name) return;

        const fileName = name.trim().endsWith('.esprefab')
            ? name.trim()
            : `${name.trim()}.esprefab`;
        const filePath = joinPath(assetsDir, fileName);

        const success = await this.store_.saveAsPrefab(entity as number, filePath);
        if (!success) {
            console.error('[HierarchyPanel] Failed to save prefab:', filePath);
        }
    }

    private async createEntityFromPrefab(
        prefabPath: string,
        parent: Entity | null
    ): Promise<void> {
        const relativePath = this.toRelativePath(prefabPath);
        const uuid = getAssetDatabase().getUuid(relativePath) ?? relativePath;
        await this.store_.instantiatePrefab(uuid, parent);
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
