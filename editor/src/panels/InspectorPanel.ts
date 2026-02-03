/**
 * @file    InspectorPanel.ts
 * @brief   Entity inspector panel for editing components
 */

import type { Entity } from 'esengine';
import type { ComponentData } from '../types/SceneTypes';
import type { EditorStore } from '../store/EditorStore';
import {
    createPropertyEditor,
    type PropertyEditorInstance,
} from '../property/PropertyEditor';
import { getComponentSchema, getAllComponentSchemas } from '../schemas/ComponentSchemas';
import { icons } from '../utils/icons';

// =============================================================================
// InspectorPanel
// =============================================================================

export class InspectorPanel {
    private container_: HTMLElement;
    private store_: EditorStore;
    private contentContainer_: HTMLElement;
    private unsubscribe_: (() => void) | null = null;
    private editors_: PropertyEditorInstance[] = [];
    private currentEntity_: Entity | null = null;
    private currentComponentCount_: number = 0;

    private footerContainer_: HTMLElement | null = null;

    constructor(container: HTMLElement, store: EditorStore) {
        this.container_ = container;
        this.store_ = store;

        this.container_.className = 'es-inspector-panel';
        this.container_.innerHTML = `
            <div class="es-panel-header">
                <span class="es-panel-title">${icons.settings(14)} Inspector</span>
                <div class="es-panel-actions">
                    <button class="es-btn es-btn-icon" title="Minimize">${icons.chevronDown(12)}</button>
                    <button class="es-btn es-btn-icon" title="Close">${icons.x(12)}</button>
                </div>
            </div>
            <div class="es-inspector-toolbar">
                <button class="es-btn es-btn-icon" title="Lock">${icons.lock()}</button>
                <button class="es-btn es-btn-icon" title="Debug">${icons.bug()}</button>
                <div class="es-toolbar-spacer"></div>
                <button class="es-btn es-btn-icon" title="Add Component">${icons.plus()}</button>
                <button class="es-btn es-btn-icon" title="Settings">${icons.settings()}</button>
            </div>
            <div class="es-inspector-content"></div>
            <div class="es-inspector-footer">0 components</div>
        `;

        this.contentContainer_ = this.container_.querySelector('.es-inspector-content')!;
        this.footerContainer_ = this.container_.querySelector('.es-inspector-footer');

        this.unsubscribe_ = store.subscribe(() => this.render());
        this.render();
    }

    dispose(): void {
        this.disposeEditors();
        if (this.unsubscribe_) {
            this.unsubscribe_();
            this.unsubscribe_ = null;
        }
    }

    private render(): void {
        const entity = this.store_.selectedEntity;
        const entityData = entity !== null ? this.store_.getSelectedEntityData() : null;
        const componentCount = entityData?.components.length ?? 0;

        const entityChanged = entity !== this.currentEntity_;
        const componentsChanged = componentCount !== this.currentComponentCount_;

        if (!entityChanged && !componentsChanged) {
            this.updateEditors();
            return;
        }

        this.currentEntity_ = entity;
        this.currentComponentCount_ = componentCount;
        this.disposeEditors();
        this.contentContainer_.innerHTML = '';

        if (entity === null || !entityData) {
            this.contentContainer_.innerHTML = '<div class="es-inspector-empty">No entity selected</div>';
            this.updateFooter(0);
            return;
        }

        this.renderEntityHeader(entityData.name, entity);
        this.renderTagsSection(entity);

        for (const component of entityData.components) {
            this.renderComponent(entity, component);
        }

        this.renderAddComponentButton(entity, entityData.components);
        this.updateFooter(entityData.components.length + 1);
    }

    private updateFooter(count: number): void {
        if (this.footerContainer_) {
            this.footerContainer_.textContent = `${count} ${count === 1 ? 'component' : 'components'}`;
        }
    }

    private renderEntityHeader(name: string, entity: Entity): void {
        const header = document.createElement('div');
        header.className = 'es-inspector-entity-header';
        header.innerHTML = `
            <span class="es-entity-icon">${icons.box(16)}</span>
            <span class="es-entity-name">${this.escapeHtml(name)}</span>
            <span class="es-entity-id">ID:${entity}</span>
        `;
        this.contentContainer_.appendChild(header);
    }

    private renderTagsSection(entity: Entity): void {
        const section = document.createElement('div');
        section.className = 'es-component-section es-collapsible es-expanded';
        section.innerHTML = `
            <div class="es-component-header es-collapsible-header">
                <span class="es-collapse-icon">${icons.chevronDown(12)}</span>
                <span class="es-component-icon">${icons.check(14)}</span>
                <span class="es-component-title">Tags</span>
                <button class="es-btn es-btn-icon es-btn-remove">${icons.x(12)}</button>
            </div>
            <div class="es-component-properties es-collapsible-content">
                <div class="es-property-row">
                    <label class="es-property-label">active</label>
                    <div class="es-property-editor">
                        <input type="checkbox" class="es-input-checkbox" checked>
                    </div>
                </div>
                <div class="es-property-row">
                    <label class="es-property-label">visible</label>
                    <div class="es-property-editor">
                        <input type="checkbox" class="es-input-checkbox" checked>
                    </div>
                </div>
                <div class="es-property-row">
                    <label class="es-property-label">static</label>
                    <div class="es-property-editor">
                        <input type="checkbox" class="es-input-checkbox">
                    </div>
                </div>
            </div>
        `;

        const header = section.querySelector('.es-collapsible-header');
        header?.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('.es-btn-remove')) return;
            section.classList.toggle('es-expanded');
        });

        this.contentContainer_.appendChild(section);
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    private getComponentIcon(type: string): string {
        switch (type) {
            case 'LocalTransform':
            case 'WorldTransform':
                return icons.move(14);
            case 'Sprite':
                return icons.image(14);
            case 'Camera':
                return icons.camera(14);
            case 'Text':
                return icons.type(14);
            default:
                return icons.settings(14);
        }
    }

    private renderComponent(entity: Entity, component: ComponentData): void {
        const section = document.createElement('div');
        section.className = 'es-component-section es-collapsible es-expanded';

        const icon = this.getComponentIcon(component.type);

        const header = document.createElement('div');
        header.className = 'es-component-header es-collapsible-header';
        header.innerHTML = `
            <span class="es-collapse-icon">${icons.chevronDown(12)}</span>
            <span class="es-component-icon">${icon}</span>
            <span class="es-component-title">${component.type}</span>
            <button class="es-btn es-btn-icon es-btn-remove">${icons.x(12)}</button>
        `;

        const removeBtn = header.querySelector('.es-btn-remove');
        removeBtn?.addEventListener('click', () => {
            this.store_.removeComponent(entity, component.type);
        });

        header.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('.es-btn-remove')) return;
            section.classList.toggle('es-expanded');
        });

        section.appendChild(header);

        const schema = getComponentSchema(component.type);
        if (schema) {
            const propsContainer = document.createElement('div');
            propsContainer.className = 'es-component-properties es-collapsible-content';

            for (const propMeta of schema.properties) {
                const row = document.createElement('div');
                row.className = 'es-property-row';

                const label = document.createElement('label');
                label.className = 'es-property-label';
                label.textContent = propMeta.name;

                const editorContainer = document.createElement('div');
                editorContainer.className = 'es-property-editor';

                const currentValue = component.data[propMeta.name];
                const editor = createPropertyEditor(editorContainer, {
                    value: currentValue,
                    meta: propMeta,
                    onChange: (newValue) => {
                        this.store_.updateProperty(
                            entity,
                            component.type,
                            propMeta.name,
                            currentValue,
                            newValue
                        );
                    },
                });

                if (editor) {
                    this.editors_.push(editor);
                }

                row.appendChild(label);
                row.appendChild(editorContainer);
                propsContainer.appendChild(row);
            }

            section.appendChild(propsContainer);
        } else {
            const rawView = document.createElement('pre');
            rawView.className = 'es-component-raw';
            rawView.textContent = JSON.stringify(component.data, null, 2);
            section.appendChild(rawView);
        }

        this.contentContainer_.appendChild(section);
    }

    private renderAddComponentButton(entity: Entity, existingComponents: ComponentData[]): void {
        const wrapper = document.createElement('div');
        wrapper.className = 'es-add-component-wrapper';

        const btn = document.createElement('button');
        btn.className = 'es-btn es-btn-add-component';
        btn.textContent = 'Add Component';

        btn.addEventListener('click', () => {
            this.showAddComponentMenu(btn, entity, existingComponents);
        });

        wrapper.appendChild(btn);
        this.contentContainer_.appendChild(wrapper);
    }

    private showAddComponentMenu(
        anchor: HTMLElement,
        entity: Entity,
        existingComponents: ComponentData[]
    ): void {
        const existingTypes = new Set(existingComponents.map(c => c.type));
        const availableSchemas = getAllComponentSchemas().filter(
            s => !existingTypes.has(s.name)
        );

        if (availableSchemas.length === 0) return;

        const existingMenu = document.querySelector('.es-context-menu');
        existingMenu?.remove();

        const rect = anchor.getBoundingClientRect();
        const menu = document.createElement('div');
        menu.className = 'es-context-menu';
        menu.style.left = `${rect.left}px`;
        menu.style.top = `${rect.bottom}px`;

        availableSchemas.forEach(schema => {
            const item = document.createElement('div');
            item.className = 'es-context-menu-item';
            item.textContent = schema.name;

            item.addEventListener('click', () => {
                const defaultData = this.createDefaultComponentData(schema.name);
                this.store_.addComponent(entity, schema.name, defaultData);
                menu.remove();
            });

            menu.appendChild(item);
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

    private createDefaultComponentData(type: string): Record<string, unknown> {
        const schema = getComponentSchema(type);
        if (!schema) return {};

        const data: Record<string, unknown> = {};
        for (const prop of schema.properties) {
            switch (prop.type) {
                case 'number':
                    data[prop.name] = 0;
                    break;
                case 'string':
                    data[prop.name] = '';
                    break;
                case 'boolean':
                    data[prop.name] = false;
                    break;
                case 'vec2':
                    data[prop.name] = { x: 0, y: 0 };
                    break;
                case 'vec3':
                    data[prop.name] = { x: 0, y: 0, z: 0 };
                    break;
                case 'vec4':
                    data[prop.name] = { x: 0, y: 0, z: 0, w: 1 };
                    break;
                case 'color':
                    data[prop.name] = { x: 1, y: 1, z: 1, w: 1 };
                    break;
                case 'enum':
                    data[prop.name] = prop.options?.[0]?.value ?? 0;
                    break;
            }
        }
        return data;
    }

    private updateEditors(): void {
        // TODO: Update existing editors with new values
    }

    private disposeEditors(): void {
        for (const editor of this.editors_) {
            editor.dispose();
        }
        this.editors_ = [];
    }
}
