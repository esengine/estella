/**
 * @file    materialEditors.ts
 * @brief   Property editors for material assets
 */

import {
    type PropertyEditorContext,
    type PropertyEditorInstance,
    type PropertyEditorFactory,
} from './PropertyEditor';
import type { PluginRegistrar } from '../container';
import { PROPERTY_EDITOR } from '../container/tokens';
import { BLEND_MODE_OPTIONS } from '../types/MaterialMetadata';
import {
    getProjectDir,
    getNativeFS,
    getMimeType,
    navigateToAsset,
    handleAssetDrop,
    browseForAsset,
    BROWSE_ICON,
} from './editors';
import { AssetType } from '../constants/AssetTypes';

// =============================================================================
// Blend Mode Editor
// =============================================================================

function createBlendModeEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const { value, onChange } = ctx;

    const select = document.createElement('select');
    select.className = 'es-input es-input-select';

    BLEND_MODE_OPTIONS.forEach(opt => {
        const option = document.createElement('option');
        option.value = String(opt.value);
        option.textContent = opt.label;
        if (opt.value === value) {
            option.selected = true;
        }
        select.appendChild(option);
    });

    select.addEventListener('change', () => {
        onChange(parseInt(select.value, 10));
    });

    container.appendChild(select);

    return {
        update(v: unknown) {
            select.value = String(v ?? 0);
        },
        dispose() {
            select.remove();
        },
    };
}

// =============================================================================
// Shader File Editor
// =============================================================================

function createShaderFileEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const { value, onChange } = ctx;

    const wrapper = document.createElement('div');
    wrapper.className = 'es-file-editor';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'es-input es-input-file es-asset-link';
    input.value = String(value ?? '');
    input.placeholder = 'None';
    input.readOnly = true;

    const browseBtn = document.createElement('button');
    browseBtn.className = 'es-btn es-btn-icon es-btn-browse';
    browseBtn.title = 'Browse';
    browseBtn.innerHTML = BROWSE_ICON;

    input.addEventListener('click', () => {
        if (input.value) navigateToAsset(input.value);
    });

    handleAssetDrop(wrapper, [AssetType.SHADER], (relativePath) => {
        input.value = relativePath;
        onChange(relativePath);
    });

    browseBtn.addEventListener('click', async () => {
        const result = await browseForAsset('Select Shader', 'Shader Files', ['esshader']);
        if (result) {
            input.value = result.relativePath;
            onChange(result.relativePath);
        }
    });

    wrapper.appendChild(input);
    wrapper.appendChild(browseBtn);
    container.appendChild(wrapper);

    return {
        update(v: unknown) {
            input.value = String(v ?? '');
        },
        dispose() {
            wrapper.remove();
        },
    };
}

// =============================================================================
// Material Texture Editor
// =============================================================================

function createMaterialTextureEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const { value, onChange } = ctx;
    let currentBlobUrl: string | null = null;
    let currentRef = '';
    let previewGeneration = 0;

    const wrapper = document.createElement('div');
    wrapper.className = 'es-texture-editor es-material-texture-editor';

    const preview = document.createElement('div');
    preview.className = 'es-texture-preview';

    const previewImg = document.createElement('img');
    previewImg.className = 'es-texture-preview-img';
    preview.appendChild(previewImg);

    const inputRow = document.createElement('div');
    inputRow.className = 'es-texture-input-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'es-input es-input-texture es-asset-link';
    input.value = (value && typeof value === 'string') ? value : '';
    input.placeholder = 'None';
    input.readOnly = true;

    const browseBtn = document.createElement('button');
    browseBtn.className = 'es-btn es-btn-icon es-btn-browse';
    browseBtn.title = 'Browse';
    browseBtn.innerHTML = BROWSE_ICON;

    const updatePreview = async (texturePath: string) => {
        const gen = ++previewGeneration;

        if (currentBlobUrl) {
            URL.revokeObjectURL(currentBlobUrl);
            currentBlobUrl = null;
        }

        const projectDir = getProjectDir();
        const fs = getNativeFS();

        if (texturePath && projectDir && fs) {
            const fullPath = `${projectDir}/${texturePath}`;
            try {
                const data = await fs.readBinaryFile(fullPath);
                if (gen !== previewGeneration) return;
                if (data) {
                    const blob = new Blob([data.buffer as ArrayBuffer], { type: getMimeType(texturePath) });
                    currentBlobUrl = URL.createObjectURL(blob);
                    previewImg.src = currentBlobUrl;
                    previewImg.style.display = 'block';
                    preview.classList.add('es-has-preview');
                    return;
                }
            } catch (err) {
                if (gen !== previewGeneration) return;
                console.warn('Failed to load texture preview:', err);
            }
        }

        previewImg.src = '';
        previewImg.style.display = 'none';
        preview.classList.remove('es-has-preview');
    };

    currentRef = (value && typeof value === 'string') ? value : '';
    updatePreview(currentRef);

    input.addEventListener('click', () => {
        if (input.value) {
            navigateToAsset(input.value);
        }
    });

    handleAssetDrop(wrapper, [AssetType.IMAGE], (relativePath) => {
        input.value = relativePath;
        currentRef = relativePath;
        onChange(relativePath);
        updatePreview(relativePath);
    });

    browseBtn.addEventListener('click', async () => {
        const result = await browseForAsset('Select Texture', 'Images', ['png', 'jpg', 'jpeg', 'webp']);
        if (result) {
            input.value = result.relativePath;
            currentRef = result.relativePath;
            onChange(result.relativePath);
            updatePreview(result.relativePath);
        }
    });

    inputRow.appendChild(input);
    inputRow.appendChild(browseBtn);
    wrapper.appendChild(preview);
    wrapper.appendChild(inputRow);
    container.appendChild(wrapper);

    return {
        update(v: unknown) {
            const newValue = String(v ?? '');
            input.value = newValue;
            if (newValue !== currentRef) {
                currentRef = newValue;
                updatePreview(newValue);
            }
        },
        dispose() {
            if (currentBlobUrl) {
                URL.revokeObjectURL(currentBlobUrl);
            }
            wrapper.remove();
        },
    };
}

// =============================================================================
// Register Material Editors
// =============================================================================

export function registerMaterialEditors(registrar: PluginRegistrar): void {
    const registerPropertyEditor = (type: string, factory: PropertyEditorFactory) => registrar.provide(PROPERTY_EDITOR, type, factory);
    registerPropertyEditor('blend-mode', createBlendModeEditor);
    registerPropertyEditor('shader-file', createShaderFileEditor);
    registerPropertyEditor('material-texture', createMaterialTextureEditor);
}
