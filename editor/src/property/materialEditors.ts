/**
 * @file    materialEditors.ts
 * @brief   Property editors for material assets
 */

import {
    registerPropertyEditor,
    type PropertyEditorContext,
    type PropertyEditorInstance,
} from './PropertyEditor';
import { BLEND_MODE_OPTIONS } from '../types/MaterialMetadata';
import { getAssetMimeType } from 'esengine';
import { getPlatformAdapter } from '../platform/PlatformAdapter';
import { getEditorContext, getEditorInstance } from '../context/EditorContext';
import type { NativeFS } from '../types/NativeFS';

// =============================================================================
// Helpers
// =============================================================================

function getProjectDir(): string | null {
    const editor = getEditorInstance();
    const projectPath = editor?.projectPath;
    if (!projectPath) return null;
    return projectPath.replace(/\\/g, '/').replace(/\/[^/]+$/, '');
}

function navigateToAsset(assetPath: string): void {
    const editor = getEditorInstance();
    if (editor && typeof editor.navigateToAsset === 'function') {
        editor.navigateToAsset(assetPath);
    }
}

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
    browseBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"></path></svg>`;

    input.addEventListener('click', () => {
        if (input.value) {
            navigateToAsset(input.value);
        }
    });

    wrapper.addEventListener('dragover', (e) => {
        e.preventDefault();
        const data = e.dataTransfer?.types.includes('application/esengine-asset');
        if (data) {
            wrapper.classList.add('es-drag-over');
            e.dataTransfer!.dropEffect = 'copy';
        } else {
            e.dataTransfer!.dropEffect = 'none';
        }
    });

    wrapper.addEventListener('dragleave', () => {
        wrapper.classList.remove('es-drag-over');
    });

    wrapper.addEventListener('drop', (e) => {
        e.preventDefault();
        wrapper.classList.remove('es-drag-over');

        const jsonData = e.dataTransfer?.getData('application/esengine-asset');
        if (!jsonData) return;

        try {
            const assetData = JSON.parse(jsonData);
            if (assetData.type === 'shader') {
                const projectDir = getProjectDir();
                if (projectDir && assetData.path.startsWith(projectDir)) {
                    const relativePath = assetData.path.substring(projectDir.length + 1);
                    input.value = relativePath;
                    onChange(relativePath);
                }
            }
        } catch (err) {
            console.error('Failed to parse drop data:', err);
        }
    });

    browseBtn.addEventListener('click', async () => {
        const projectDir = getProjectDir();
        if (!projectDir) return;

        const assetsDir = `${projectDir}/assets`;

        try {
            const platform = getPlatformAdapter();
            const result = await platform.openFileDialog({
                title: 'Select Shader',
                defaultPath: assetsDir,
                filters: [{ name: 'Shader Files', extensions: ['esshader'] }],
            });
            if (result) {
                const normalizedPath = result.replace(/\\/g, '/');
                const assetsIndex = normalizedPath.indexOf('/assets/');
                if (assetsIndex !== -1) {
                    const relativePath = normalizedPath.substring(assetsIndex + 1);
                    input.value = relativePath;
                    onChange(relativePath);
                }
            }
        } catch (err) {
            console.error('Failed to open file dialog:', err);
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

function getNativeFS(): NativeFS | null {
    return getEditorContext().fs ?? null;
}

function getMimeType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    return getAssetMimeType(ext) ?? 'image/png';
}

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
    browseBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"></path></svg>`;

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

    wrapper.addEventListener('dragover', (e) => {
        e.preventDefault();
        const data = e.dataTransfer?.types.includes('application/esengine-asset');
        if (data) {
            wrapper.classList.add('es-drag-over');
            e.dataTransfer!.dropEffect = 'copy';
        } else {
            e.dataTransfer!.dropEffect = 'none';
        }
    });

    wrapper.addEventListener('dragleave', () => {
        wrapper.classList.remove('es-drag-over');
    });

    wrapper.addEventListener('drop', (e) => {
        e.preventDefault();
        wrapper.classList.remove('es-drag-over');

        const jsonData = e.dataTransfer?.getData('application/esengine-asset');
        if (!jsonData) return;

        try {
            const assetData = JSON.parse(jsonData);
            if (assetData.type === 'image') {
                const projectDir = getProjectDir();
                if (projectDir && assetData.path.startsWith(projectDir)) {
                    const relativePath = assetData.path.substring(projectDir.length + 1);
                    input.value = relativePath;
                    currentRef = relativePath;
                    onChange(relativePath);
                    updatePreview(relativePath);
                }
            }
        } catch (err) {
            console.error('Failed to parse drop data:', err);
        }
    });

    browseBtn.addEventListener('click', async () => {
        const projectDir = getProjectDir();
        if (!projectDir) return;

        const assetsDir = `${projectDir}/assets`;

        try {
            const platform = getPlatformAdapter();
            const result = await platform.openFileDialog({
                title: 'Select Texture',
                defaultPath: assetsDir,
                filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
            });
            if (result) {
                const normalizedPath = result.replace(/\\/g, '/');
                const assetsIndex = normalizedPath.indexOf('/assets/');
                if (assetsIndex !== -1) {
                    const relativePath = normalizedPath.substring(assetsIndex + 1);
                    input.value = relativePath;
                    currentRef = relativePath;
                    onChange(relativePath);
                    updatePreview(relativePath);
                }
            }
        } catch (err) {
            console.error('Failed to open file dialog:', err);
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

export function registerMaterialEditors(): void {
    registerPropertyEditor('blend-mode', createBlendModeEditor);
    registerPropertyEditor('shader-file', createShaderFileEditor);
    registerPropertyEditor('material-texture', createMaterialTextureEditor);
}
