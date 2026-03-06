import {
    type PropertyEditorContext,
    type PropertyEditorInstance,
} from '../PropertyEditor';
import { getNavigationService } from '../../services';
import { INVALID_TEXTURE } from 'esengine';
import { AssetType } from '../../constants/AssetTypes';
import {
    getNativeFS,
    getProjectDir,
    getMimeType,
    resolveDisplayName,
    resolveToPath,
    checkAssetMissing,
    handleAssetDrop,
    browseForAsset,
    BROWSE_ICON,
    CLEAR_ICON,
} from './assetEditors';

export function createTextureEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const { value, onChange } = ctx;
    let currentBlobUrl: string | null = null;
    let currentRef = '';
    let previewGeneration = 0;

    const wrapper = document.createElement('div');
    wrapper.className = 'es-texture-editor';

    const preview = document.createElement('div');
    preview.className = 'es-texture-preview';
    preview.title = 'Click to locate in Content Browser';

    const previewImg = document.createElement('img');
    previewImg.className = 'es-texture-preview-img';
    preview.appendChild(previewImg);

    const inputRow = document.createElement('div');
    inputRow.className = 'es-texture-input-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'es-input es-input-texture es-asset-link';
    input.value = (value && typeof value === 'string' && value !== String(INVALID_TEXTURE)) ? resolveDisplayName(value) : '';
    input.placeholder = 'None';
    input.readOnly = true;

    const browseBtn = document.createElement('button');
    browseBtn.className = 'es-btn es-btn-icon es-btn-browse';
    browseBtn.title = 'Browse';
    browseBtn.innerHTML = BROWSE_ICON;

    const clearBtn = document.createElement('button');
    clearBtn.className = 'es-btn es-btn-icon es-btn-clear';
    clearBtn.title = 'Clear';
    clearBtn.innerHTML = CLEAR_ICON;

    const updatePreview = async (textureRef: string) => {
        const gen = ++previewGeneration;

        if (currentBlobUrl) {
            URL.revokeObjectURL(currentBlobUrl);
            currentBlobUrl = null;
        }

        const projectDir = getProjectDir();
        const fs = getNativeFS();
        const texturePath = resolveToPath(textureRef);

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

    const navigateToAssetPath = async (e: Event) => {
        e.stopPropagation();
        const displayPath = input.value;
        if (!displayPath) return;

        await getNavigationService().navigateToAsset(displayPath);
    };

    currentRef = (value && typeof value === 'string' && value !== String(INVALID_TEXTURE)) ? value : '';
    updatePreview(currentRef);
    checkAssetMissing(currentRef, input);

    input.addEventListener('click', navigateToAssetPath);
    preview.addEventListener('click', navigateToAssetPath);

    handleAssetDrop(wrapper, [AssetType.IMAGE], (relativePath, ref) => {
        input.value = relativePath;
        currentRef = ref;
        onChange(ref);
        updatePreview(ref);
    });

    browseBtn.addEventListener('click', async () => {
        const result = await browseForAsset('Select Texture', 'Images', ['png', 'jpg', 'jpeg', 'webp']);
        if (result) {
            input.value = result.relativePath;
            currentRef = result.ref;
            onChange(result.ref);
            updatePreview(result.ref);
        }
    });

    clearBtn.addEventListener('click', () => {
        input.value = '';
        currentRef = '';
        onChange('');
        updatePreview('');
    });

    inputRow.appendChild(input);
    inputRow.appendChild(browseBtn);
    inputRow.appendChild(clearBtn);
    wrapper.appendChild(preview);
    wrapper.appendChild(inputRow);
    container.appendChild(wrapper);

    return {
        update(v: unknown) {
            const raw = (typeof v === 'string') ? v : '';
            const newValue = (!raw || raw === String(INVALID_TEXTURE)) ? '' : raw;
            input.value = newValue ? resolveDisplayName(newValue) : '';
            if (newValue !== currentRef) {
                currentRef = newValue;
                updatePreview(newValue);
                checkAssetMissing(newValue, input);
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
