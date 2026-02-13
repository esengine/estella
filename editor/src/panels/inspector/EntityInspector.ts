/**
 * @file    EntityInspector.ts
 * @brief   Entity inspector rendering: header, components, add-component button
 */

import type { Entity } from 'esengine';
import type { ComponentData } from '../../types/SceneTypes';
import type { EditorStore } from '../../store/EditorStore';
import { createPropertyEditor } from '../../property/PropertyEditor';
import {
    getComponentSchema,
    getDefaultComponentData,
    isComponentRemovable,
} from '../../schemas/ComponentSchemas';
import { icons } from '../../utils/icons';
import { showAddComponentPopup } from '../AddComponentPopup';
import { getEditorContext, getEditorInstance } from '../../context/EditorContext';
import { getPlatformAdapter } from '../../platform/PlatformAdapter';
import { getAssetLibrary, isUUID } from '../../asset/AssetLibrary';
import {
    type EditorInfo,
    escapeHtml,
    getComponentIcon,
    getProjectDir,
} from './InspectorHelpers';
import { isPropertyOverridden } from '../../prefab';
import {
    getComponentInspector,
    getInspectorSections,
    type InspectorContext,
    type InspectorSectionInstance,
} from './InspectorRegistry';

// =============================================================================
// Global Augmentation
// =============================================================================

declare global {
    interface Window {
        __esengine_componentSourceMap?: Map<string, string>;
    }
}

// =============================================================================
// Entity Header
// =============================================================================

export function renderEntityHeader(
    container: HTMLElement,
    name: string,
    entity: Entity,
    store: EditorStore
): void {
    const isVisible = store.isEntityVisible(entity as number);
    const visibilityIcon = isVisible ? icons.eye(14) : icons.eyeOff(14);

    const entityData = store.getEntityData(entity as number);
    const entityIcon = entityData?.prefab?.isRoot ? icons.package(16) : icons.box(16);

    const header = document.createElement('div');
    header.className = 'es-inspector-entity-header';
    header.innerHTML = `
        <span class="es-entity-icon">${entityIcon}</span>
        <input type="text" class="es-entity-name-input" value="${escapeHtml(name)}">
        <span class="es-entity-visibility">${visibilityIcon}</span>
        <span class="es-entity-id">ID:${entity}</span>
    `;

    const input = header.querySelector('.es-entity-name-input') as HTMLInputElement;
    input.addEventListener('change', () => {
        const newName = input.value.trim();
        if (newName && newName !== name) {
            store.renameEntity(entity, newName);
        }
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            input.blur();
        } else if (e.key === 'Escape') {
            input.value = name;
            input.blur();
        }
    });

    const visBtn = header.querySelector('.es-entity-visibility');
    visBtn?.addEventListener('click', () => {
        store.toggleVisibility(entity as number);
    });

    container.appendChild(header);

    if (entityData?.prefab) {
        renderPrefabInfoBar(container, entity, entityData, store);
    }
}

function renderPrefabInfoBar(
    container: HTMLElement,
    entity: Entity,
    entityData: import('../../types/SceneTypes').EntityData,
    store: EditorStore
): void {
    const prefab = entityData.prefab!;
    const pathDisplay = prefab.prefabPath.split('/').pop() ?? prefab.prefabPath;

    const bar = document.createElement('div');
    bar.className = 'es-prefab-info-bar';
    bar.innerHTML = `
        ${icons.package(12)}
        <span class="es-prefab-info-path es-prefab-info-link" title="${escapeHtml(prefab.prefabPath)}">${escapeHtml(pathDisplay)}</span>
    `;

    const pathEl = bar.querySelector('.es-prefab-info-link');
    pathEl?.addEventListener('click', () => {
        getEditorInstance()?.navigateToAsset(prefab.prefabPath);
    });

    if (prefab.isRoot) {
        const revertBtn = document.createElement('button');
        revertBtn.className = 'es-btn';
        revertBtn.textContent = 'Revert';
        revertBtn.addEventListener('click', () => {
            store.revertPrefabInstance(prefab.instanceId, prefab.prefabPath);
        });

        const applyBtn = document.createElement('button');
        applyBtn.className = 'es-btn';
        applyBtn.textContent = 'Apply';
        applyBtn.addEventListener('click', () => {
            store.applyPrefabOverrides(prefab.instanceId, prefab.prefabPath);
        });

        bar.appendChild(revertBtn);
        bar.appendChild(applyBtn);
    }

    container.appendChild(bar);
}

// =============================================================================
// Component Rendering
// =============================================================================

export function renderComponent(
    container: HTMLElement,
    entity: Entity,
    component: ComponentData,
    store: EditorStore,
    editors: EditorInfo[]
): void {
    const schema = getComponentSchema(component.type);
    if (!schema) {
        console.warn(`[Inspector] No schema found for component "${component.type}"`);
    }
    if (schema?.category === 'tag') {
        renderTagComponent(container, entity, component, store);
        return;
    }

    const section = document.createElement('div');
    section.className = 'es-component-section es-collapsible es-expanded';

    const icon = getComponentIcon(component.type);
    const removable = isComponentRemovable(component.type);

    const header = document.createElement('div');
    header.className = 'es-component-header es-collapsible-header';
    header.innerHTML = `
        <span class="es-collapse-icon">${icons.chevronDown(12)}</span>
        <span class="es-component-icon">${icon}</span>
        <span class="es-component-title">${component.type}</span>
        ${removable ? `<button class="es-btn es-btn-icon es-btn-remove">${icons.x(12)}</button>` : ''}
    `;

    if (removable) {
        const removeBtn = header.querySelector('.es-btn-remove');
        removeBtn?.addEventListener('click', () => {
            store.removeComponent(entity, component.type);
        });
    }

    header.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.es-btn-remove')) return;
        section.classList.toggle('es-expanded');
    });

    if (schema?.category === 'script') {
        header.addEventListener('dblclick', () => {
            const sourceMap = window.__esengine_componentSourceMap;
            const scriptPath = sourceMap?.get(component.type);
            if (!scriptPath) return;
            const projectDir = getProjectDir();
            if (projectDir) {
                getEditorContext().shell?.openInEditor(projectDir, scriptPath);
            }
        });
    }

    section.appendChild(header);

    const customInspector = getComponentInspector(component.type);
    if (customInspector) {
        const propsContainer = document.createElement('div');
        propsContainer.className = 'es-component-properties es-collapsible-content';
        customInspector.render(propsContainer, {
            store,
            entity,
            componentType: component.type,
            componentData: component.data,
            onChange: (property, oldValue, newValue) => {
                store.updateProperty(entity, component.type, property, oldValue, newValue);
            },
        });
        section.appendChild(propsContainer);
        container.appendChild(section);
        return;
    }

    if (schema) {
        const propsContainer = document.createElement('div');
        propsContainer.className = 'es-component-properties es-collapsible-content';

        for (const propMeta of schema.properties) {
            if (propMeta.name === '*') {
                const editorContainer = document.createElement('div');
                editorContainer.className = 'es-property-editor es-property-editor-full';

                const defaults = getDefaultComponentData(component.type);
                const fullData = { ...defaults, ...component.data };

                const editor = createPropertyEditor(editorContainer, {
                    value: fullData,
                    meta: propMeta,
                    onChange: (changes) => {
                        const arr = changes as { property: string; oldValue: unknown; newValue: unknown }[];
                        store.updateProperties(entity, component.type, arr);
                    },
                    componentData: component.data,
                    getComponentValue: (name: string) => component.data[name],
                });

                if (editor) {
                    editors.push({
                        editor,
                        componentType: component.type,
                        propertyName: '*',
                    });
                }

                propsContainer.appendChild(editorContainer);
                continue;
            }

            const row = document.createElement('div');
            row.className = 'es-property-row';

            const entityData = store.getEntityData(entity as number);
            if (entityData?.prefab && isPropertyOverridden(
                store.scene,
                entity as number,
                component.type,
                propMeta.name
            )) {
                row.classList.add('es-overridden');
            }

            const label = document.createElement('label');
            label.className = 'es-property-label';
            label.textContent = propMeta.name;

            const editorContainer = document.createElement('div');
            editorContainer.className = 'es-property-editor';

            let currentValue = component.data[propMeta.name];
            if (currentValue === undefined) {
                const defaults = getDefaultComponentData(component.type);
                currentValue = defaults[propMeta.name];
            }
            const editor = createPropertyEditor(editorContainer, {
                value: currentValue,
                meta: propMeta,
                onChange: (newValue) => {
                    store.updateProperty(
                        entity,
                        component.type,
                        propMeta.name,
                        currentValue,
                        newValue
                    );
                },
                componentData: component.data,
                getComponentValue: (name: string) => component.data[name],
            });

            if (editor) {
                editors.push({
                    editor,
                    componentType: component.type,
                    propertyName: propMeta.name,
                });
            }

            row.appendChild(label);
            row.appendChild(editorContainer);

            if (component.type === 'Sprite' && propMeta.name === 'size') {
                const resetBtn = createSpriteSizeResetButton(entity, component, store);
                row.appendChild(resetBtn);
            }

            propsContainer.appendChild(row);
        }

        section.appendChild(propsContainer);
    } else {
        const rawView = document.createElement('pre');
        rawView.className = 'es-component-raw';
        rawView.textContent = JSON.stringify(component.data, null, 2);
        section.appendChild(rawView);
    }

    container.appendChild(section);
}

// =============================================================================
// Tag Component
// =============================================================================

export function renderTagComponent(
    container: HTMLElement,
    entity: Entity,
    component: ComponentData,
    store: EditorStore
): void {
    const row = document.createElement('div');
    row.className = 'es-component-section es-component-tag-row';
    row.innerHTML = `
        <span class="es-component-icon">${icons.tag(14)}</span>
        <span class="es-component-title">${component.type}</span>
        <button class="es-btn es-btn-icon es-btn-remove">${icons.x(12)}</button>
    `;

    const removeBtn = row.querySelector('.es-btn-remove');
    removeBtn?.addEventListener('click', () => {
        store.removeComponent(entity, component.type);
    });

    container.appendChild(row);
}

// =============================================================================
// Sprite Size Reset
// =============================================================================

function resolveTexturePath(ref: string): string {
    if (!ref) return '';
    if (isUUID(ref)) {
        return getAssetLibrary().getPath(ref) ?? ref;
    }
    return ref;
}

function createSpriteSizeResetButton(
    entity: Entity,
    component: ComponentData,
    store: EditorStore
): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'es-btn es-btn-icon es-btn-reset-size';
    btn.title = 'Reset to image size';
    btn.innerHTML = icons.maximize(12);

    btn.addEventListener('click', () => {
        const texture = component.data.texture;
        if (!texture) return;

        const relativePath = resolveTexturePath(texture);
        if (!relativePath) return;

        const projectDir = getProjectDir();
        if (!projectDir) return;

        const absolutePath = `${projectDir}/${relativePath}`;
        const img = new window.Image();
        img.onload = () => {
            const oldSize = component.data.size ?? getDefaultComponentData('Sprite').size;
            const newSize = { x: img.naturalWidth, y: img.naturalHeight };
            store.updateProperty(entity, 'Sprite', 'size', oldSize, newSize);
        };
        img.src = getPlatformAdapter().convertFilePathToUrl(absolutePath);
    });

    return btn;
}

// =============================================================================
// Add Component Button
// =============================================================================

export function renderAddComponentButton(
    container: HTMLElement,
    entity: Entity,
    existingComponents: ComponentData[],
    store: EditorStore
): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'es-add-component-wrapper';

    const btn = document.createElement('button');
    btn.className = 'es-btn es-btn-add-component';
    btn.textContent = 'Add Component';

    btn.addEventListener('click', () => {
        const existingTypes = existingComponents.map(c => c.type);
        showAddComponentPopup(existingTypes, (componentName: string) => {
            const defaultData = getDefaultComponentData(componentName);
            store.addComponent(entity, componentName, defaultData);
        });
    });

    wrapper.appendChild(btn);
    container.appendChild(wrapper);
}

// =============================================================================
// Extension Sections
// =============================================================================

export function renderEntityExtensionSections(
    container: HTMLElement,
    entity: Entity,
    store: EditorStore
): InspectorSectionInstance[] {
    const sections = getInspectorSections('entity');
    const ctx: InspectorContext = { store, entity };
    const instances: InspectorSectionInstance[] = [];

    for (const desc of sections) {
        if (desc.visible && !desc.visible(ctx)) continue;

        const wrapper = document.createElement('div');
        wrapper.className = 'es-component-section es-collapsible es-expanded';

        const header = document.createElement('div');
        header.className = 'es-component-header es-collapsible-header';
        header.innerHTML = `
            <span class="es-collapse-icon">${icons.chevronDown(12)}</span>
            ${desc.icon ? `<span class="es-component-icon">${desc.icon}</span>` : ''}
            <span class="es-component-title">${escapeHtml(desc.title)}</span>
        `;
        header.addEventListener('click', () => {
            wrapper.classList.toggle('es-expanded');
        });
        wrapper.appendChild(header);

        const content = document.createElement('div');
        content.className = 'es-component-properties es-collapsible-content';
        wrapper.appendChild(content);

        const instance = desc.render(content, ctx);
        instances.push(instance);

        container.appendChild(wrapper);
    }

    return instances;
}

export function renderAssetExtensionSections(
    container: HTMLElement,
    assetPath: string,
    assetType: string,
    store: EditorStore
): InspectorSectionInstance[] {
    const sections = getInspectorSections('asset');
    const ctx: InspectorContext = { store, assetPath, assetType: assetType as any };
    const instances: InspectorSectionInstance[] = [];

    for (const desc of sections) {
        if (desc.visible && !desc.visible(ctx)) continue;

        const wrapper = document.createElement('div');
        wrapper.className = 'es-component-section es-collapsible es-expanded';

        const header = document.createElement('div');
        header.className = 'es-component-header es-collapsible-header';
        header.innerHTML = `
            <span class="es-collapse-icon">${icons.chevronDown(12)}</span>
            ${desc.icon ? `<span class="es-component-icon">${desc.icon}</span>` : ''}
            <span class="es-component-title">${escapeHtml(desc.title)}</span>
        `;
        header.addEventListener('click', () => {
            wrapper.classList.toggle('es-expanded');
        });
        wrapper.appendChild(header);

        const content = document.createElement('div');
        content.className = 'es-component-properties es-collapsible-content';
        wrapper.appendChild(content);

        const instance = desc.render(content, ctx);
        instances.push(instance);

        container.appendChild(wrapper);
    }

    return instances;
}
