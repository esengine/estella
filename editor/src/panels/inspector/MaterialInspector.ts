/**
 * @file    MaterialInspector.ts
 * @brief   Material file inspector with shader properties editing
 */

import type { MaterialMetadata } from '../../types/MaterialMetadata';
import {
    parseMaterialMetadata,
    serializeMaterialMetadata,
    BLEND_MODE_OPTIONS,
} from '../../types/MaterialMetadata';
import {
    parseShaderProperties,
    getDefaultPropertyValue,
    type ShaderProperty,
} from '../../shader/ShaderPropertyParser';
import { getPlatformAdapter } from '../../platform/PlatformAdapter';
import { icons } from '../../utils/icons';
import { getNativeFS, getProjectDir, getAssetServer, escapeHtml, renderError } from './InspectorHelpers';
import { createShaderFileInput, createPropertyEditorForType } from './SharedEditors';

export async function renderMaterialInspector(
    container: HTMLElement,
    path: string
): Promise<void> {
    const fs = getNativeFS();
    const platform = getPlatformAdapter();
    if (!fs) {
        renderError(container, 'File system not available');
        return;
    }

    const content = await fs.readFile(path);
    if (!content) {
        renderError(container, 'Failed to load material file');
        return;
    }

    const metadata = parseMaterialMetadata(content);
    if (!metadata) {
        renderError(container, 'Invalid material file');
        return;
    }

    let currentMaterialMetadata: MaterialMetadata = metadata;
    let currentShaderProperties: ShaderProperty[] = [];

    const saveMaterial = async () => {
        try {
            const json = serializeMaterialMetadata(currentMaterialMetadata);
            await platform.writeTextFile(path, json);
        } catch (err) {
            console.error('Failed to save material:', err);
        }
    };

    const shaderSection = document.createElement('div');
    shaderSection.className = 'es-component-section es-collapsible es-expanded';
    shaderSection.innerHTML = `
        <div class="es-component-header es-collapsible-header">
            <span class="es-collapse-icon">${icons.chevronDown(12)}</span>
            <span class="es-component-icon">${icons.code(14)}</span>
            <span class="es-component-title">Shader</span>
        </div>
        <div class="es-component-properties es-collapsible-content">
            <div class="es-property-row">
                <label class="es-property-label">Shader</label>
                <div class="es-property-editor es-shader-editor-container"></div>
            </div>
        </div>
    `;

    const shaderHeader = shaderSection.querySelector('.es-collapsible-header');
    shaderHeader?.addEventListener('click', () => {
        shaderSection.classList.toggle('es-expanded');
    });

    const shaderEditorContainer = shaderSection.querySelector('.es-shader-editor-container')!;
    createShaderFileInput(shaderEditorContainer as HTMLElement, metadata.shader, async (newPath) => {
        currentMaterialMetadata.shader = newPath;
        await saveMaterial();
        await reloadShaderProperties(container, path, currentMaterialMetadata, saveMaterial);
    });

    container.appendChild(shaderSection);

    const renderSection = document.createElement('div');
    renderSection.className = 'es-component-section es-collapsible es-expanded';
    renderSection.innerHTML = `
        <div class="es-component-header es-collapsible-header">
            <span class="es-collapse-icon">${icons.chevronDown(12)}</span>
            <span class="es-component-icon">${icons.settings(14)}</span>
            <span class="es-component-title">Render Settings</span>
        </div>
        <div class="es-component-properties es-collapsible-content">
            <div class="es-property-row">
                <label class="es-property-label">Blend Mode</label>
                <div class="es-property-editor es-blend-mode-container"></div>
            </div>
            <div class="es-property-row">
                <label class="es-property-label">Depth Test</label>
                <div class="es-property-editor es-depth-test-container"></div>
            </div>
        </div>
    `;

    const renderHeader = renderSection.querySelector('.es-collapsible-header');
    renderHeader?.addEventListener('click', () => {
        renderSection.classList.toggle('es-expanded');
    });

    const blendContainer = renderSection.querySelector('.es-blend-mode-container')!;
    const blendSelect = document.createElement('select');
    blendSelect.className = 'es-input es-input-select';
    BLEND_MODE_OPTIONS.forEach(opt => {
        const option = document.createElement('option');
        option.value = String(opt.value);
        option.textContent = opt.label;
        if (opt.value === metadata.blendMode) {
            option.selected = true;
        }
        blendSelect.appendChild(option);
    });
    blendSelect.addEventListener('change', async () => {
        const newBlendMode = parseInt(blendSelect.value, 10);
        currentMaterialMetadata.blendMode = newBlendMode;
        await saveMaterial();

        const assetServer = getAssetServer();
        if (assetServer) {
            const projectDir = getProjectDir();
            if (projectDir && path.startsWith(projectDir)) {
                const relativePath = path.substring(projectDir.length + 1);
                assetServer.updateMaterialBlendMode(relativePath, newBlendMode);
            }
        }
    });
    blendContainer.appendChild(blendSelect);

    const depthContainer = renderSection.querySelector('.es-depth-test-container')!;
    const depthCheckbox = document.createElement('input');
    depthCheckbox.type = 'checkbox';
    depthCheckbox.className = 'es-input es-input-checkbox';
    depthCheckbox.checked = metadata.depthTest;
    depthCheckbox.addEventListener('change', async () => {
        currentMaterialMetadata.depthTest = depthCheckbox.checked;
        await saveMaterial();
    });
    depthContainer.appendChild(depthCheckbox);

    container.appendChild(renderSection);

    await renderMaterialProperties(container, path, metadata, saveMaterial);
}

async function reloadShaderProperties(
    container: HTMLElement,
    materialPath: string,
    metadata: MaterialMetadata,
    saveMaterial: () => Promise<void>
): Promise<void> {
    const propsSections = container.querySelectorAll('.es-material-properties-section');
    propsSections.forEach(s => s.remove());

    await renderMaterialProperties(container, materialPath, metadata, saveMaterial);
}

async function renderMaterialProperties(
    container: HTMLElement,
    materialPath: string,
    metadata: MaterialMetadata,
    saveMaterial: () => Promise<void>
): Promise<void> {
    if (!metadata.shader) return;

    const fs = getNativeFS();
    const projectDir = getProjectDir();
    if (!fs || !projectDir) return;

    const shaderFullPath = `${projectDir}/${metadata.shader}`;
    const shaderContent = await fs.readFile(shaderFullPath);
    if (!shaderContent) return;

    const shaderInfo = parseShaderProperties(shaderContent);
    if (!shaderInfo.valid || shaderInfo.properties.length === 0) return;

    const groupedProps = new Map<string, ShaderProperty[]>();
    const ungroupedProps: ShaderProperty[] = [];

    for (const prop of shaderInfo.properties) {
        if (prop.group) {
            const group = groupedProps.get(prop.group) ?? [];
            group.push(prop);
            groupedProps.set(prop.group, group);
        } else {
            ungroupedProps.push(prop);
        }
    }

    if (ungroupedProps.length > 0) {
        renderPropertyGroup(container, 'Properties', ungroupedProps, metadata, saveMaterial, materialPath);
    }

    for (const [groupName, props] of groupedProps) {
        renderPropertyGroup(container, groupName, props, metadata, saveMaterial, materialPath);
    }
}

function renderPropertyGroup(
    container: HTMLElement,
    groupName: string,
    properties: ShaderProperty[],
    metadata: MaterialMetadata,
    saveMaterial: () => Promise<void>,
    materialPath: string
): void {
    const propsSection = document.createElement('div');
    propsSection.className = 'es-component-section es-collapsible es-expanded es-material-properties-section';
    propsSection.innerHTML = `
        <div class="es-component-header es-collapsible-header">
            <span class="es-collapse-icon">${icons.chevronDown(12)}</span>
            <span class="es-component-icon">${icons.settings(14)}</span>
            <span class="es-component-title">${escapeHtml(groupName)}</span>
        </div>
        <div class="es-component-properties es-collapsible-content"></div>
    `;

    const propsHeader = propsSection.querySelector('.es-collapsible-header');
    propsHeader?.addEventListener('click', () => {
        propsSection.classList.toggle('es-expanded');
    });

    const propsContainer = propsSection.querySelector('.es-component-properties')!;

    for (const prop of properties) {
        const row = document.createElement('div');
        row.className = 'es-property-row';

        const label = document.createElement('label');
        label.className = 'es-property-label';
        label.textContent = prop.displayName;

        const editorContainer = document.createElement('div');
        editorContainer.className = 'es-property-editor';

        const value = metadata.properties[prop.name] ?? getDefaultPropertyValue(prop.type);

        createPropertyEditorForType(editorContainer, prop, value, async (newValue) => {
            metadata.properties[prop.name] = newValue;
            await saveMaterial();

            const assetServer = getAssetServer();
            const projectDir = getProjectDir();
            if (assetServer && projectDir && materialPath.startsWith(projectDir)) {
                const relativePath = materialPath.substring(projectDir.length + 1);
                assetServer.updateMaterialUniform(relativePath, prop.name, newValue);
            }
        });

        row.appendChild(label);
        row.appendChild(editorContainer);
        propsContainer.appendChild(row);
    }

    container.appendChild(propsSection);
}
