import {
    type PropertyEditorContext,
    type PropertyEditorInstance,
} from '../PropertyEditor';
import { getEditorContext } from '../../context/EditorContext';
import { getNavigationService, getProjectService } from '../../services';
import { getPlatformAdapter } from '../../platform/PlatformAdapter';
import { getAssetLibrary, isUUID } from '../../asset/AssetLibrary';
import type { NativeFS } from '../../types/NativeFS';
import { getAssetMimeType } from 'esengine';
import { AssetType } from '../../constants/AssetTypes';

export function getNativeFS(): NativeFS | null {
    return getEditorContext().fs ?? null;
}

export function getProjectDir(): string | null {
    const projectPath = getProjectService().projectPath;
    if (!projectPath) return null;
    return projectPath.replace(/\\/g, '/').replace(/\/[^/]+$/, '');
}

export function getMimeType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    return getAssetMimeType(ext) ?? 'image/png';
}

export function resolveDisplayName(ref: string): string {
    if (!ref) return '';
    if (isUUID(ref)) {
        const path = getAssetLibrary().getPath(ref);
        return path ?? ref;
    }
    return ref;
}

export async function checkAssetMissing(ref: string, input: HTMLInputElement): Promise<void> {
    if (!ref) {
        input.classList.remove('es-missing-asset');
        return;
    }
    const path = resolveToPath(ref);
    const projectDir = getProjectDir();
    const fs = getNativeFS();
    if (!path || !projectDir || !fs) return;
    const exists = await fs.exists(`${projectDir}/${path}`);
    input.classList.toggle('es-missing-asset', !exists);
}

export function resolveToPath(ref: string): string {
    if (!ref) return '';
    if (isUUID(ref)) {
        return getAssetLibrary().getPath(ref) ?? ref;
    }
    return ref;
}

export function navigateToAsset(assetPath: string): void {
    getNavigationService().navigateToAsset(assetPath);
}

export const BROWSE_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"></path></svg>`;
export const CLEAR_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
const ASSET_DRAG_MIME = 'application/esengine-asset';
const ASSETS_DIR_NAME = 'assets';

export function handleAssetDrop(
    wrapper: HTMLElement,
    acceptTypes: string[],
    onAccept: (relativePath: string, ref: string) => void
): void {
    wrapper.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer?.types.includes(ASSET_DRAG_MIME)) {
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
        const jsonData = e.dataTransfer?.getData(ASSET_DRAG_MIME);
        if (!jsonData) return;
        try {
            const assetData = JSON.parse(jsonData);
            if (acceptTypes.includes(assetData.type)) {
                const projectDir = getProjectDir();
                if (projectDir && assetData.path.startsWith(projectDir)) {
                    const relativePath = assetData.path.substring(projectDir.length + 1);
                    const uuid = getAssetLibrary().getUuid(relativePath);
                    onAccept(relativePath, uuid ?? relativePath);
                }
            }
        } catch (err) {
            console.error('Failed to parse drop data:', err);
        }
    });
}

export async function browseForAsset(
    dialogTitle: string,
    filterName: string,
    extensions: string[]
): Promise<{ relativePath: string; ref: string } | null> {
    const projectDir = getProjectDir();
    if (!projectDir) return null;

    const assetsDir = `${projectDir}/${ASSETS_DIR_NAME}`;
    try {
        const platform = getPlatformAdapter();
        const result = await platform.openFileDialog({
            title: dialogTitle,
            defaultPath: assetsDir,
            filters: [{ name: filterName, extensions }],
        });
        if (result) {
            const normalizedPath = result.replace(/\\/g, '/');
            const assetsIndex = normalizedPath.indexOf(`/${ASSETS_DIR_NAME}/`);
            if (assetsIndex !== -1) {
                const relativePath = normalizedPath.substring(assetsIndex + 1);
                const uuid = getAssetLibrary().getUuid(relativePath);
                return { relativePath, ref: uuid ?? relativePath };
            }
        }
    } catch (err) {
        console.error('Failed to open file dialog:', err);
    }
    return null;
}

interface AssetFileEditorConfig {
    acceptTypes: string[];
    dialogTitle: string;
    filterName: string;
    extensions: string[];
}

export function createAssetFileEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext,
    config: AssetFileEditorConfig
): PropertyEditorInstance {
    const { value, onChange } = ctx;

    const wrapper = document.createElement('div');
    wrapper.className = 'es-file-editor';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'es-input es-input-file es-asset-link';
    input.value = resolveDisplayName(String(value ?? ''));
    input.placeholder = 'None';
    input.readOnly = true;
    checkAssetMissing(String(value ?? ''), input);

    const browseBtn = document.createElement('button');
    browseBtn.className = 'es-btn es-btn-icon es-btn-browse';
    browseBtn.title = 'Browse';
    browseBtn.innerHTML = BROWSE_ICON;

    const clearBtn = document.createElement('button');
    clearBtn.className = 'es-btn es-btn-icon es-btn-clear';
    clearBtn.title = 'Clear';
    clearBtn.innerHTML = CLEAR_ICON;

    input.addEventListener('click', () => {
        if (input.value) navigateToAsset(input.value);
    });

    handleAssetDrop(wrapper, config.acceptTypes, (relativePath, ref) => {
        input.value = relativePath;
        onChange(ref);
    });

    browseBtn.addEventListener('click', async () => {
        const result = await browseForAsset(config.dialogTitle, config.filterName, config.extensions);
        if (result) {
            input.value = result.relativePath;
            onChange(result.ref);
        }
    });

    clearBtn.addEventListener('click', () => {
        input.value = '';
        onChange('');
    });

    wrapper.appendChild(input);
    wrapper.appendChild(browseBtn);
    wrapper.appendChild(clearBtn);
    container.appendChild(wrapper);

    return {
        update(v: unknown) {
            const ref = String(v ?? '');
            input.value = resolveDisplayName(ref);
            checkAssetMissing(ref, input);
        },
        dispose() {
            wrapper.remove();
        },
    };
}

export const ASSET_FILE_EDITORS: Record<string, AssetFileEditorConfig> = {
    'material-file': { acceptTypes: [AssetType.MATERIAL], dialogTitle: 'Select Material', filterName: 'Material Files', extensions: ['esmaterial'] },
    'bitmap-font-file': { acceptTypes: [AssetType.FONT], dialogTitle: 'Select BitmapFont', filterName: 'BitmapFont Files', extensions: ['bmfont'] },
    'anim-file': { acceptTypes: [AssetType.ANIMCLIP], dialogTitle: 'Select Animation Clip', filterName: 'Animation Clip', extensions: ['esanim'] },
    'timeline-file': { acceptTypes: [AssetType.TIMELINE], dialogTitle: 'Select Timeline', filterName: 'Timeline', extensions: ['estimeline'] },
    'audio-file': { acceptTypes: [AssetType.AUDIO], dialogTitle: 'Select Audio File', filterName: 'Audio', extensions: ['mp3', 'wav', 'ogg'] },
    'tilemap-file': { acceptTypes: [AssetType.TILEMAP], dialogTitle: 'Select Tilemap', filterName: 'Tiled Map', extensions: ['tmj'] },
};
