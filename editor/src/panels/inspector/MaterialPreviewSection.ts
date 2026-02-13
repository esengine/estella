/**
 * @file    MaterialPreviewSection.ts
 * @brief   Material preview panel for the inspector, showing shader properties and overrides
 */

import type { Entity } from 'esengine';
import type { ComponentData } from '../../types/SceneTypes';
import type { EditorStore } from '../../store/EditorStore';
import {
    ShaderPropertyType,
    getDefaultPropertyValue,
    parseShaderProperties,
    type ShaderProperty,
    type ParsedShaderInfo,
} from '../../shader/ShaderPropertyParser';
import { icons } from '../../utils/icons';
import { escapeHtml, getNativeFS, getProjectDir, openAssetInBrowser } from './InspectorHelpers';
import {
    createFloatEditor,
    createIntEditor,
    createVec2Editor,
    createVec3Editor,
    createVec4Editor,
    createColorEditor,
    deepEqual,
} from './SharedEditors';

// =============================================================================
// Types
// =============================================================================

export interface MaterialPreviewState {
    container: HTMLElement;
    expanded: boolean;
}

// =============================================================================
// Public API
// =============================================================================

export function renderMaterialPreview(
    state: MaterialPreviewState,
    entity: Entity,
    components: ComponentData[],
    store: EditorStore
): void {
    const spriteComp = components.find(c => c.type === 'Sprite');
    const materialPath = spriteComp?.data?.material as string | undefined;
    if (!materialPath) {
        hideMaterialPreview(state);
        return;
    }
    renderMaterialPreviewContent(state, entity, spriteComp!, materialPath, store);
}

export function hideMaterialPreview(state: MaterialPreviewState): void {
    state.container.innerHTML = '';
}

// =============================================================================
// Internal: Header Setup
// =============================================================================

function setupMaterialPreviewHeader(state: MaterialPreviewState): void {
    const header = state.container.querySelector('.es-material-preview-header');
    header?.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.es-material-preview-open-btn')) return;
        state.expanded = !state.expanded;
        if (state.expanded) {
            state.container.classList.add('es-expanded');
        } else {
            state.container.classList.remove('es-expanded');
        }
    });
}

// =============================================================================
// Internal: Content Rendering
// =============================================================================

async function renderMaterialPreviewContent(
    state: MaterialPreviewState,
    entity: Entity,
    spriteComp: ComponentData,
    materialPath: string,
    store: EditorStore
): Promise<void> {
    const fileName = materialPath.split('/').pop() ?? materialPath;

    state.container.innerHTML = `
        <div class="es-material-preview-header">
            <span class="es-material-preview-title">
                ${icons.chevronRight(12)} Material Preview
            </span>
            <button class="es-btn es-material-preview-open-btn">Open Material</button>
        </div>
        <div class="es-material-preview-content">
            <div class="es-material-preview-name">${escapeHtml(fileName)}</div>
            <div class="es-material-preview-properties"></div>
            <div class="es-material-preview-status"></div>
        </div>
    `;

    if (state.expanded) {
        state.container.classList.add('es-expanded');
    } else {
        state.container.classList.remove('es-expanded');
    }

    setupMaterialPreviewHeader(state);

    const openBtn = state.container.querySelector('.es-material-preview-open-btn');
    openBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        openAssetInBrowser(materialPath);
    });

    const propsContainer = state.container.querySelector('.es-material-preview-properties')!;
    const statusContainer = state.container.querySelector('.es-material-preview-status')!;

    const shaderInfo = await loadShaderInfoForMaterial(materialPath);
    if (!shaderInfo || !shaderInfo.valid || shaderInfo.properties.length === 0) {
        propsContainer.innerHTML = '<div class="es-material-preview-empty">No shader properties</div>';
        statusContainer.textContent = '';
        return;
    }

    const materialDefaults = await loadMaterialDefaults(materialPath);
    const currentOverrides = (spriteComp.data.materialOverrides as Record<string, unknown>) ?? {};

    const editableProps = shaderInfo.properties.filter(p => p.type !== ShaderPropertyType.Texture);
    let overrideCount = 0;

    for (const prop of editableProps) {
        const isOverridden = prop.name in currentOverrides;
        const value = isOverridden
            ? currentOverrides[prop.name]
            : (materialDefaults[prop.name] ?? getDefaultPropertyValue(prop.type));

        if (isOverridden) overrideCount++;

        const row = document.createElement('div');
        row.className = `es-material-preview-row${isOverridden ? ' es-overridden' : ''}`;

        const label = document.createElement('label');
        label.className = 'es-property-label';
        label.textContent = prop.displayName;

        const editorContainer = document.createElement('div');
        editorContainer.className = 'es-property-editor';

        createMaterialPreviewEditor(editorContainer, prop, value, (newValue) => {
            handleMaterialOverrideChange(
                entity,
                store,
                prop.name,
                newValue,
                materialDefaults[prop.name] ?? getDefaultPropertyValue(prop.type),
                currentOverrides
            );
        });

        row.appendChild(label);
        row.appendChild(editorContainer);

        if (isOverridden) {
            const resetBtn = document.createElement('button');
            resetBtn.className = 'es-btn es-btn-icon es-btn-reset-override';
            resetBtn.title = 'Reset to material default';
            resetBtn.innerHTML = icons.refresh(12);
            resetBtn.addEventListener('click', () => {
                handleMaterialOverrideReset(entity, store, prop.name, currentOverrides);
            });
            row.appendChild(resetBtn);
        }

        propsContainer.appendChild(row);
    }

    if (overrideCount > 0) {
        statusContainer.textContent = `${overrideCount} override${overrideCount > 1 ? 's' : ''} active`;
    } else {
        statusContainer.textContent = 'No overrides';
    }
}

// =============================================================================
// Internal: Shader / Material Loading
// =============================================================================

async function loadShaderInfoForMaterial(materialPath: string): Promise<ParsedShaderInfo | null> {
    const fs = getNativeFS();
    const projectDir = getProjectDir();
    if (!fs || !projectDir) return null;

    const materialFullPath = `${projectDir}/${materialPath}`;
    const materialContent = await fs.readFile(materialFullPath);
    if (!materialContent) return null;

    try {
        const material = JSON.parse(materialContent);
        if (!material.shader) return null;

        const shaderPath = material.shader.startsWith('/')
            ? material.shader
            : material.shader.startsWith('assets/')
                ? material.shader
                : `${materialPath.substring(0, materialPath.lastIndexOf('/'))}/${material.shader}`;

        const shaderFullPath = `${projectDir}/${shaderPath}`;
        const shaderContent = await fs.readFile(shaderFullPath);
        if (!shaderContent) return null;

        return parseShaderProperties(shaderContent);
    } catch {
        return null;
    }
}

async function loadMaterialDefaults(materialPath: string): Promise<Record<string, unknown>> {
    const fs = getNativeFS();
    const projectDir = getProjectDir();
    if (!fs || !projectDir) return {};

    const materialFullPath = `${projectDir}/${materialPath}`;
    const materialContent = await fs.readFile(materialFullPath);
    if (!materialContent) return {};

    try {
        const material = JSON.parse(materialContent);
        return material.properties ?? {};
    } catch {
        return {};
    }
}

// =============================================================================
// Internal: Property Editor Factory
// =============================================================================

function createMaterialPreviewEditor(
    container: HTMLElement,
    prop: ShaderProperty,
    value: unknown,
    onChange: (value: unknown) => void
): void {
    switch (prop.type) {
        case ShaderPropertyType.Float:
            createFloatEditor(container, value as number, onChange, prop.min, prop.max, prop.step);
            break;
        case ShaderPropertyType.Int:
            createIntEditor(container, value as number, onChange, prop.min, prop.max, prop.step);
            break;
        case ShaderPropertyType.Vec2:
            createVec2Editor(container, value as { x: number; y: number }, onChange);
            break;
        case ShaderPropertyType.Vec3:
            createVec3Editor(container, value as { x: number; y: number; z: number }, onChange);
            break;
        case ShaderPropertyType.Vec4:
            createVec4Editor(container, value as { x: number; y: number; z: number; w: number }, onChange);
            break;
        case ShaderPropertyType.Color:
            createColorEditor(container, value as { r: number; g: number; b: number; a: number }, onChange);
            break;
        default:
            container.textContent = 'Unknown type';
    }
}

// =============================================================================
// Internal: Override Handlers
// =============================================================================

function handleMaterialOverrideChange(
    entity: Entity,
    store: EditorStore,
    propName: string,
    newValue: unknown,
    defaultValue: unknown,
    currentOverrides: Record<string, unknown>
): void {
    const newOverrides = { ...currentOverrides };
    if (deepEqual(newValue, defaultValue)) {
        delete newOverrides[propName];
    } else {
        newOverrides[propName] = newValue;
    }
    const oldOverrides = currentOverrides;
    const finalOverrides = Object.keys(newOverrides).length > 0 ? newOverrides : undefined;
    store.updateProperty(
        entity,
        'Sprite',
        'materialOverrides',
        Object.keys(oldOverrides).length > 0 ? oldOverrides : undefined,
        finalOverrides
    );
}

function handleMaterialOverrideReset(
    entity: Entity,
    store: EditorStore,
    propName: string,
    currentOverrides: Record<string, unknown>
): void {
    const newOverrides = { ...currentOverrides };
    delete newOverrides[propName];
    const oldOverrides = currentOverrides;
    const finalOverrides = Object.keys(newOverrides).length > 0 ? newOverrides : undefined;
    store.updateProperty(
        entity,
        'Sprite',
        'materialOverrides',
        Object.keys(oldOverrides).length > 0 ? oldOverrides : undefined,
        finalOverrides
    );
}
