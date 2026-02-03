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

    constructor(container: HTMLElement, store: EditorStore) {
        this.container_ = container;
        this.store_ = store;

        this.container_.className = 'es-inspector-panel';
        this.container_.innerHTML = `
            <div class="es-panel-header">
                <span class="es-panel-title">Inspector</span>
            </div>
            <div class="es-inspector-content"></div>
        `;

        this.contentContainer_ = this.container_.querySelector('.es-inspector-content')!;

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

        if (entity === this.currentEntity_) {
            this.updateEditors();
            return;
        }

        this.currentEntity_ = entity;
        this.disposeEditors();
        this.contentContainer_.innerHTML = '';

        if (entity === null) {
            this.contentContainer_.innerHTML = '<div class="es-inspector-empty">No entity selected</div>';
            return;
        }

        const entityData = this.store_.getSelectedEntityData();
        if (!entityData) return;

        this.renderEntityHeader(entityData.name, entity);

        for (const component of entityData.components) {
            this.renderComponent(entity, component);
        }

        this.renderAddComponentButton(entity, entityData.components);
    }

    private renderEntityHeader(name: string, entity: Entity): void {
        const header = document.createElement('div');
        header.className = 'es-inspector-entity-header';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'es-input es-entity-name-input';
        nameInput.value = name;

        nameInput.addEventListener('change', () => {
            this.store_.renameEntity(entity, nameInput.value);
        });

        header.appendChild(nameInput);
        this.contentContainer_.appendChild(header);
    }

    private renderComponent(entity: Entity, component: ComponentData): void {
        const section = document.createElement('div');
        section.className = 'es-component-section';

        const header = document.createElement('div');
        header.className = 'es-component-header';

        const title = document.createElement('span');
        title.className = 'es-component-title';
        title.textContent = component.type;

        const removeBtn = document.createElement('button');
        removeBtn.className = 'es-btn es-btn-icon es-btn-remove';
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', () => {
            this.store_.removeComponent(entity, component.type);
        });

        header.appendChild(title);
        header.appendChild(removeBtn);
        section.appendChild(header);

        const schema = getComponentSchema(component.type);
        if (schema) {
            const propsContainer = document.createElement('div');
            propsContainer.className = 'es-component-properties';

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
