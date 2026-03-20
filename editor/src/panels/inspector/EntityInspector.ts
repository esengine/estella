import type { Entity } from 'esengine';
import type { ComponentData } from '../../types/SceneTypes';
import type { EditorStore } from '../../store/EditorStore';
import {
    getInitialComponentData,
} from '../../schemas/ComponentSchemas';
import { icons } from '../../utils/icons';
import { showAddComponentPopup } from '../AddComponentPopup';
import { escapeHtml } from './InspectorHelpers';
import {
    getInspectorSections,
    type InspectorContext,
    type InspectorSectionInstance,
} from './InspectorRegistry';

export { renderEntityHeader } from './EntityHeader';
export { renderComponent, renderTagComponent } from './ComponentRenderer';

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
    btn.innerHTML = `${icons.plus(12)} Add Component`;

    btn.addEventListener('click', () => {
        const existingTypes = existingComponents.map(c => c.type);
        showAddComponentPopup(btn, existingTypes, (componentName: string) => {
            const defaultData = getInitialComponentData(componentName);
            store.addComponent(entity, componentName, defaultData);
        });
    });

    wrapper.appendChild(btn);
    container.appendChild(wrapper);
}

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
