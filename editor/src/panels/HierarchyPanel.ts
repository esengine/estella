/**
 * @file    HierarchyPanel.ts
 * @brief   Entity hierarchy tree panel
 */

import type { Entity } from 'esengine';
import type { EntityData, SceneData } from '../types/SceneTypes';
import type { EditorStore } from '../store/EditorStore';
import { icons } from '../utils/icons';
import { getGlobalPathResolver } from '../asset';
import { getDefaultComponentData } from '../schemas/ComponentSchemas';
import { showContextMenu } from '../ui/ContextMenu';
import { getEditorContext } from '../context/EditorContext';
import { getPlatformAdapter } from '../platform/PlatformAdapter';

type DropPosition = 'before' | 'after' | 'inside';

// =============================================================================
// HierarchyPanel
// =============================================================================

export class HierarchyPanel {
    private container_: HTMLElement;
    private store_: EditorStore;
    private treeContainer_: HTMLElement;
    private searchInput_: HTMLInputElement | null = null;
    private footerContainer_: HTMLElement | null = null;
    private unsubscribe_: (() => void) | null = null;
    private searchFilter_: string = '';
    private expandedIds_: Set<number> = new Set();
    private lastSelectedEntity_: Entity | null = null;

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
        this.searchInput_ = this.container_.querySelector('.es-hierarchy-search');
        this.footerContainer_ = this.container_.querySelector('.es-hierarchy-footer');

        this.setupEvents();
        this.unsubscribe_ = store.subscribe(() => this.render());
        this.render();
    }

    dispose(): void {
        if (this.unsubscribe_) {
            this.unsubscribe_();
            this.unsubscribe_ = null;
        }
    }

    private setupEvents(): void {
        const addBtn = this.container_.querySelector('[data-action="add"]');
        addBtn?.addEventListener('click', () => {
            const entity = this.store_.createEntity();
            this.store_.addComponent(entity, 'LocalTransform', getDefaultComponentData('LocalTransform'));
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
            item.classList.add('es-dragging');
        });

        this.treeContainer_.addEventListener('dragend', () => {
            this.treeContainer_.querySelectorAll('.es-dragging').forEach(el => {
                el.classList.remove('es-dragging');
            });
            this.clearDropIndicators();
        });

        this.treeContainer_.addEventListener('dragover', (e) => {
            const types = e.dataTransfer?.types ?? [];
            const hasAssetData = Array.from(types).includes('application/esengine-asset');
            const hasEntityData = Array.from(types).includes('application/esengine-entity');

            if (!hasAssetData && !hasEntityData) return;

            e.preventDefault();

            if (hasAssetData) {
                e.dataTransfer!.dropEffect = 'copy';
                this.clearDropIndicators();
                const target = e.target as HTMLElement;
                const item = target.closest('.es-hierarchy-item') as HTMLElement;
                if (item) {
                    item.classList.add('es-drag-over');
                } else {
                    this.treeContainer_.classList.add('es-drag-over');
                }
                return;
            }

            e.dataTransfer!.dropEffect = 'move';
            const target = e.target as HTMLElement;
            const item = target.closest('.es-hierarchy-item') as HTMLElement;
            this.clearDropIndicators();

            if (!item) {
                this.treeContainer_.classList.add('es-drag-over');
                return;
            }

            const position = this.getDropPosition(e, item);
            item.classList.add(`es-drop-${position}`);
        });

        this.treeContainer_.addEventListener('dragleave', (e) => {
            const relatedTarget = e.relatedTarget as HTMLElement;
            if (this.treeContainer_.contains(relatedTarget)) return;
            this.clearDropIndicators();
        });

        this.treeContainer_.addEventListener('drop', (e) => {
            e.preventDefault();
            this.clearDropIndicators();

            const assetDataStr = e.dataTransfer?.getData('application/esengine-asset');
            if (assetDataStr) {
                let assetData: { type: string; path: string; name: string };
                try {
                    assetData = JSON.parse(assetDataStr);
                } catch {
                    return;
                }
                const target = e.target as HTMLElement;
                const item = target.closest('.es-hierarchy-item') as HTMLElement;
                const parentEntity = item
                    ? parseInt(item.dataset.entityId ?? '', 10) as Entity
                    : null;
                this.createEntityFromAsset(assetData, parentEntity);
                return;
            }

            const entityIdStr = e.dataTransfer?.getData('application/esengine-entity');
            if (!entityIdStr) return;

            const draggedId = parseInt(entityIdStr, 10);
            if (isNaN(draggedId)) return;

            const target = e.target as HTMLElement;
            const item = target.closest('.es-hierarchy-item') as HTMLElement;

            if (!item) {
                const scene = this.store_.scene;
                const roots = scene.entities.filter(e => e.parent === null);
                this.store_.moveEntity(draggedId as Entity, null, roots.length);
                return;
            }

            const targetId = parseInt(item.dataset.entityId ?? '', 10);
            if (isNaN(targetId) || targetId === draggedId) return;

            if (this.isDescendantOf(draggedId, targetId)) return;

            const position = this.getDropPosition(e, item);
            const scene = this.store_.scene;
            const targetEntity = scene.entities.find(en => en.id === targetId);
            if (!targetEntity) return;

            if (position === 'inside') {
                this.store_.moveEntity(draggedId as Entity, targetId as Entity, targetEntity.children.length);
                this.expandedIds_.add(targetId);
            } else {
                const parentId = targetEntity.parent;
                if (parentId !== null) {
                    const parent = scene.entities.find(en => en.id === parentId);
                    if (!parent) return;
                    let idx = parent.children.indexOf(targetId);
                    if (position === 'after') idx++;
                    const draggedIdx = parent.children.indexOf(draggedId);
                    if (draggedIdx !== -1 && draggedIdx < idx) idx--;
                    this.store_.moveEntity(draggedId as Entity, parentId as Entity, idx);
                } else {
                    const roots = scene.entities.filter(en => en.parent === null);
                    let idx = roots.findIndex(en => en.id === targetId);
                    if (position === 'after') idx++;
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

    private clearDropIndicators(): void {
        this.treeContainer_.querySelectorAll('.es-drag-over, .es-drop-before, .es-drop-after, .es-drop-inside').forEach(el => {
            el.classList.remove('es-drag-over', 'es-drop-before', 'es-drop-after', 'es-drop-inside');
        });
        this.treeContainer_.classList.remove('es-drag-over');
    }

    private isDescendantOf(entityId: number, ancestorId: number): boolean {
        const scene = this.store_.scene;
        let current: number | null = entityId;
        while (current !== null) {
            if (current === ancestorId) return true;
            const entity = scene.entities.find(e => e.id === current);
            current = entity?.parent ?? null;
        }
        return false;
    }

    private async createEntityFromAsset(
        asset: { type: string; path: string; name: string },
        parent: Entity | null
    ): Promise<void> {
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

            this.store_.addComponent(newEntity, 'LocalTransform', getDefaultComponentData('LocalTransform'));

            this.store_.addComponent(newEntity, 'SpineAnimation', {
                ...getDefaultComponentData('SpineAnimation'),
                skeletonPath,
                atlasPath,
            });
        } else if (asset.type === 'image') {
            const newEntity = this.store_.createEntity(baseName, parent);

            this.store_.addComponent(newEntity, 'LocalTransform', getDefaultComponentData('LocalTransform'));

            this.store_.addComponent(newEntity, 'Sprite', {
                ...getDefaultComponentData('Sprite'),
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

        if (selectedEntity !== null && selectedEntity !== this.lastSelectedEntity_) {
            this.expandAncestors(selectedEntity, scene);
        }
        this.lastSelectedEntity_ = selectedEntity;

        let rootEntities = scene.entities.filter(e => e.parent === null);

        if (this.searchFilter_) {
            rootEntities = scene.entities.filter(e =>
                e.name.toLowerCase().includes(this.searchFilter_)
            );
        }

        this.treeContainer_.innerHTML = this.renderEntities(rootEntities, scene, selectedEntity, 0);

        if (this.footerContainer_) {
            const count = scene.entities.length;
            this.footerContainer_.textContent = `${count} ${count === 1 ? 'entity' : 'entities'}`;
        }

        if (selectedEntity !== null) {
            requestAnimationFrame(() => {
                const selectedItem = this.treeContainer_.querySelector('.es-selected');
                selectedItem?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            });
        }
    }

    private expandAncestors(entityId: Entity, scene: SceneData): void {
        const entity = scene.entities.find(e => e.id === entityId);
        if (!entity || entity.parent === null) return;

        let parentId: number | null = entity.parent;
        while (parentId !== null) {
            this.expandedIds_.add(parentId);
            const parent = scene.entities.find(e => e.id === parentId);
            parentId = parent?.parent ?? null;
        }
    }

    private getEntityIcon(entity: EntityData): string {
        const hasCamera = entity.components.some(c => c.type === 'Camera');
        const hasSprite = entity.components.some(c => c.type === 'Sprite');
        const hasText = entity.components.some(c => c.type === 'Text');
        const hasSpine = entity.components.some(c => c.type === 'SpineAnimation');

        if (hasCamera) return icons.camera(12);
        if (hasSpine) return icons.bone(12);
        if (hasText) return icons.type(12);
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

    private renderEntities(
        entities: EntityData[],
        scene: SceneData,
        selectedEntity: Entity | null,
        depth: number = 0
    ): string {
        return entities.map(entity => {
            const children = this.searchFilter_
                ? []
                : entity.children
                    .map(id => scene.entities.find(e => e.id === id))
                    .filter((e): e is EntityData => e !== undefined);
            const hasChildren = children.length > 0;
            const isSelected = entity.id === selectedEntity;
            const isExpanded = this.expandedIds_.has(entity.id);
            const icon = this.getEntityIcon(entity);
            const type = this.getEntityType(entity);
            const expandIcon = isExpanded ? icons.chevronDown(10) : icons.chevronRight(10);
            const isVisible = this.store_.isEntityVisible(entity.id);
            const visibilityIcon = isVisible ? icons.eye(10) : icons.eyeOff(10);
            const hiddenClass = isVisible ? '' : ' es-entity-hidden';

            return `
                <div class="es-hierarchy-item ${isSelected ? 'es-selected' : ''}${hiddenClass} ${hasChildren ? 'es-has-children' : ''} ${isExpanded ? 'es-expanded' : ''}"
                     data-entity-id="${entity.id}" style="--depth: ${depth}">
                    <div class="es-hierarchy-row" draggable="true" style="padding-left: ${8 + depth * 16}px">
                        ${hasChildren ? `<span class="es-hierarchy-expand">${expandIcon}</span>` : '<span class="es-hierarchy-spacer"></span>'}
                        <span class="es-hierarchy-visibility">${visibilityIcon}</span>
                        <span class="es-hierarchy-icon">${icon}</span>
                        <span class="es-hierarchy-name">${this.escapeHtml(entity.name)}</span>
                        <span class="es-hierarchy-type">${type}</span>
                    </div>
                    ${hasChildren && isExpanded ? `<div class="es-hierarchy-children">${this.renderEntities(children, scene, selectedEntity, depth + 1)}</div>` : ''}
                </div>
            `;
        }).join('');
    }

    private showEntityContextMenu(x: number, y: number, entity: Entity | null): void {
        const items = [
            { label: 'Create Entity', icon: icons.plus(14), onClick: () => {
                const newEntity = this.store_.createEntity(undefined, entity);
                this.store_.addComponent(newEntity, 'LocalTransform', getDefaultComponentData('LocalTransform'));
            } },
            { label: 'Create Sprite', icon: icons.image(14), onClick: () => this.createEntityWithComponent('Sprite', entity) },
            { label: 'Create Text', icon: icons.type(14), onClick: () => this.createEntityWithComponent('Text', entity) },
            { label: 'Create Spine', icon: icons.bone(14), onClick: () => this.createEntityWithComponent('SpineAnimation', entity) },
            { label: 'Create Camera', icon: icons.camera(14), onClick: () => this.createEntityWithComponent('Camera', entity) },
            { label: 'Create Canvas', icon: icons.template(14), onClick: () => this.createEntityWithComponent('Canvas', entity) },
            { label: '', separator: true },
        ];

        if (entity !== null) {
            items.push(
                { label: 'Duplicate', icon: icons.copy(14), onClick: () => this.duplicateEntity(entity) },
                { label: 'Delete', icon: icons.trash(14), onClick: () => this.store_.deleteEntity(entity) }
            );
        }

        showContextMenu({ x, y, items });
    }

    private createEntityWithComponent(componentType: string, parent: Entity | null): void {
        const newEntity = this.store_.createEntity(componentType, parent);

        this.store_.addComponent(newEntity, 'LocalTransform', getDefaultComponentData('LocalTransform'));

        if (componentType === 'Text') {
            this.store_.addComponent(newEntity, 'UIRect', getDefaultComponentData('UIRect'));
        }

        this.store_.addComponent(newEntity, componentType, getDefaultComponentData(componentType));
    }

    private duplicateEntity(entity: Entity): void {
        const entityData = this.store_.getEntityData(entity as number);
        if (!entityData) return;

        const newEntity = this.store_.createEntity(
            `${entityData.name}_copy`,
            entityData.parent as Entity | null
        );

        for (const comp of entityData.components) {
            this.store_.addComponent(newEntity, comp.type, { ...comp.data });
        }
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
