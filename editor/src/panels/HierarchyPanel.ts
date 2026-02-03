/**
 * @file    HierarchyPanel.ts
 * @brief   Entity hierarchy tree panel
 */

import type { Entity } from 'esengine';
import type { EntityData, SceneData } from '../types/SceneTypes';
import type { EditorStore } from '../store/EditorStore';
import { icons } from '../utils/icons';

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
            this.store_.createEntity();
        });

        this.searchInput_?.addEventListener('input', () => {
            this.searchFilter_ = this.searchInput_?.value.toLowerCase() ?? '';
            this.render();
        });

        this.treeContainer_.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const item = target.closest('.es-hierarchy-item') as HTMLElement;
            if (!item) return;

            const entityId = parseInt(item.dataset.entityId ?? '', 10);
            if (isNaN(entityId)) return;

            if (target.classList.contains('es-hierarchy-expand')) {
                item.classList.toggle('es-expanded');
                return;
            }

            this.store_.selectEntity(entityId as Entity);
        });

        this.treeContainer_.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const target = e.target as HTMLElement;
            const item = target.closest('.es-hierarchy-item') as HTMLElement;

            if (item) {
                const entityId = parseInt(item.dataset.entityId ?? '', 10);
                if (!isNaN(entityId)) {
                    this.showContextMenu(e.clientX, e.clientY, entityId as Entity);
                }
            } else {
                this.showContextMenu(e.clientX, e.clientY, null);
            }
        });
    }

    private render(): void {
        const scene = this.store_.scene;
        const selectedEntity = this.store_.selectedEntity;

        let rootEntities = scene.entities.filter(e => e.parent === null);

        if (this.searchFilter_) {
            rootEntities = scene.entities.filter(e =>
                e.name.toLowerCase().includes(this.searchFilter_)
            );
        }

        this.treeContainer_.innerHTML = this.renderEntities(rootEntities, scene, selectedEntity);

        if (this.footerContainer_) {
            const count = scene.entities.length;
            this.footerContainer_.textContent = `${count} ${count === 1 ? 'entity' : 'entities'}`;
        }
    }

    private getEntityIcon(entity: EntityData): string {
        const hasCamera = entity.components.some(c => c.type === 'Camera');
        const hasSprite = entity.components.some(c => c.type === 'Sprite');
        const hasText = entity.components.some(c => c.type === 'Text');

        if (hasCamera) return icons.camera(12);
        if (hasText) return icons.type(12);
        if (hasSprite) return icons.image(12);
        return icons.box(12);
    }

    private getEntityType(entity: EntityData): string {
        const hasCamera = entity.components.some(c => c.type === 'Camera');
        if (hasCamera) return 'Camera';
        return 'Entity';
    }

    private renderEntities(
        entities: EntityData[],
        scene: SceneData,
        selectedEntity: Entity | null
    ): string {
        return entities.map(entity => {
            const children = this.searchFilter_
                ? []
                : scene.entities.filter(e => e.parent === entity.id);
            const hasChildren = children.length > 0;
            const isSelected = entity.id === selectedEntity;
            const icon = this.getEntityIcon(entity);
            const type = this.getEntityType(entity);

            return `
                <div class="es-hierarchy-item ${isSelected ? 'es-selected' : ''} ${hasChildren ? 'es-has-children' : ''}"
                     data-entity-id="${entity.id}">
                    <div class="es-hierarchy-row">
                        <span class="es-hierarchy-visibility">${icons.eye(10)}</span>
                        ${hasChildren ? `<span class="es-hierarchy-expand">${icons.chevronRight(10)}</span>` : '<span class="es-hierarchy-spacer"></span>'}
                        <span class="es-hierarchy-icon">${icon}</span>
                        <span class="es-hierarchy-name">${this.escapeHtml(entity.name)}</span>
                        <span class="es-hierarchy-type">${type}</span>
                    </div>
                    ${hasChildren ? `<div class="es-hierarchy-children">${this.renderEntities(children, scene, selectedEntity)}</div>` : ''}
                </div>
            `;
        }).join('');
    }

    private showContextMenu(x: number, y: number, entity: Entity | null): void {
        const existingMenu = document.querySelector('.es-context-menu');
        existingMenu?.remove();

        const menu = document.createElement('div');
        menu.className = 'es-context-menu';
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;

        const items: { label: string; action: () => void }[] = [
            { label: 'Create Entity', action: () => this.store_.createEntity(undefined, entity) },
        ];

        if (entity !== null) {
            items.push(
                { label: 'Duplicate', action: () => this.duplicateEntity(entity) },
                { label: 'Delete', action: () => this.store_.deleteEntity(entity) }
            );
        }

        menu.innerHTML = items.map(item =>
            `<div class="es-context-menu-item">${item.label}</div>`
        ).join('');

        menu.querySelectorAll('.es-context-menu-item').forEach((el, i) => {
            el.addEventListener('click', () => {
                items[i].action();
                menu.remove();
            });
        });

        document.body.appendChild(menu);

        const closeMenu = (e: MouseEvent) => {
            if (!menu.contains(e.target as Node)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    }

    private duplicateEntity(entity: Entity): void {
        const entityData = this.store_.scene.entities.find(e => e.id === entity);
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
