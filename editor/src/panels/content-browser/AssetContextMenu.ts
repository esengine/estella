import { icons } from '../../utils/icons';
import { showContextMenu, type ContextMenuItem } from '../../ui/ContextMenu';
import { getContextMenuItems, type ContextMenuContext } from '../../ui/ContextMenuRegistry';
import { getPlatformAdapter } from '../../platform/PlatformAdapter';
import { showInputDialog, showConfirmDialog } from '../../ui/dialog';
import { joinPath, getParentDir } from '../../utils/path';
import { getAssetLibrary } from '../../asset/AssetLibrary';
import { showErrorToast } from '../../ui/Toast';
import { createEmptyScene } from '../../types/SceneTypes';
import { getSettingsValue } from '../../settings';
import { DEFAULT_DESIGN_WIDTH, DEFAULT_DESIGN_HEIGHT } from 'esengine';
import type { AssetItem, ContentBrowserState } from './ContentBrowserTypes';
import { getNativeFS } from './ContentBrowserTypes';

export function showAssetContextMenu(state: ContentBrowserState, e: MouseEvent, path: string, type: AssetItem['type']): void {
    const fs = getNativeFS();
    const parentPath = getParentDir(path);
    const fileName = path.split('/').pop() ?? path;

    const items: ContextMenuItem[] = [
        {
            label: 'Show in Folder',
            icon: icons.folderOpen(14),
            onClick: () => { fs?.openFolder(parentPath); },
        },
        {
            label: 'Copy Path',
            icon: icons.copy(14),
            onClick: () => { navigator.clipboard.writeText(path); },
        },
        {
            label: 'Rename',
            icon: icons.pencil(14),
            onClick: () => renameAsset(state, path, type),
        },
        { separator: true, label: '' },
        {
            label: 'Delete',
            icon: icons.trash(14),
            onClick: () => deleteAsset(state, path, fileName),
        },
    ];

    const ctx: ContextMenuContext = { location: 'content-browser.asset', assetPath: path, assetType: type };
    const extensionItems = getContextMenuItems('content-browser.asset', ctx);
    if (extensionItems.length > 0) {
        items.push({ label: '', separator: true }, ...extensionItems);
    }

    showContextMenu({ x: e.clientX, y: e.clientY, items });
}

export function showMultiSelectContextMenu(state: ContentBrowserState, e: MouseEvent): void {
    const count = state.selectedPaths.size;
    const items: ContextMenuItem[] = [
        {
            label: `Delete ${count} items`,
            icon: icons.trash(14),
            onClick: () => deleteSelectedAssets(state),
        },
    ];

    showContextMenu({ x: e.clientX, y: e.clientY, items });
}

export function showFolderContextMenu(state: ContentBrowserState, e: MouseEvent, path: string): void {
    const fs = getNativeFS();

    const items: ContextMenuItem[] = [
        {
            label: 'Create',
            icon: icons.plus(14),
            children: [
                { label: 'Folder', icon: icons.folder(14), onClick: () => createNewFolder(state, path) },
                { label: '', separator: true },
                { label: 'Script', icon: icons.code(14), onClick: () => createNewScript(state, path) },
                { label: 'Material', icon: icons.settings(14), onClick: () => createNewMaterial(state, path) },
                { label: 'Shader', icon: icons.code(14), onClick: () => createNewShader(state, path) },
                { label: 'BitmapFont', icon: icons.type(14), onClick: () => createNewBitmapFont(state, path) },
                { label: 'Scene', icon: icons.layers(14), onClick: () => createNewScene(state, path) },
            ],
        },
        { label: '', separator: true },
        {
            label: 'Show in Folder',
            icon: icons.folderOpen(14),
            onClick: () => { fs?.openFolder(path); },
        },
        {
            label: 'Copy Path',
            icon: icons.copy(14),
            onClick: () => { navigator.clipboard.writeText(path); },
        },
        { label: '', separator: true },
        {
            label: 'Refresh',
            icon: icons.refresh(14),
            onClick: () => { state.refresh(); },
        },
    ];

    const ctx: ContextMenuContext = { location: 'content-browser.folder', assetPath: path, assetType: 'folder' };
    const extensionItems = getContextMenuItems('content-browser.folder', ctx);
    if (extensionItems.length > 0) {
        items.push({ label: '', separator: true }, ...extensionItems);
    }

    showContextMenu({ x: e.clientX, y: e.clientY, items });
}

export async function deleteSelectedAssets(state: ContentBrowserState): Promise<void> {
    const paths = Array.from(state.selectedPaths);
    const names = paths.map(p => p.split('/').pop() ?? p);
    const message = paths.length === 1
        ? `Are you sure you want to delete "${names[0]}"?`
        : `Are you sure you want to delete ${paths.length} items?`;

    const confirmed = await showConfirmDialog({
        title: 'Delete Assets',
        message,
        confirmText: 'Delete',
        danger: true,
    });

    if (!confirmed) return;

    const platform = getPlatformAdapter();
    for (const path of paths) {
        try {
            await platform.remove(path);
            const metaPath = `${path}.meta`;
            try { await platform.remove(metaPath); } catch { /* no .meta file */ }

            if (state.rootFolder) {
                const projectDir = state.rootFolder.path;
                const prefix = projectDir.endsWith('/') ? projectDir : projectDir + '/';
                if (path.startsWith(prefix)) {
                    getAssetLibrary().unregister(path.substring(prefix.length));
                }
            }
        } catch (err) {
            console.error('Failed to delete asset:', err);
            showErrorToast('Failed to delete asset', String(err));
        }
    }

    state.selectedPaths.clear();
    state.lastSelectedPath = null;
    state.refresh();
}

async function deleteAsset(state: ContentBrowserState, path: string, name: string): Promise<void> {
    const confirmed = await showConfirmDialog({
        title: 'Delete Asset',
        message: `Are you sure you want to delete "${name}"?`,
        confirmText: 'Delete',
        danger: true,
    });

    if (!confirmed) return;

    try {
        const platform = getPlatformAdapter();
        await platform.remove(path);

        const metaPath = `${path}.meta`;
        try { await platform.remove(metaPath); } catch { /* no .meta file */ }

        if (state.rootFolder) {
            const projectDir = state.rootFolder.path;
            const prefix = projectDir.endsWith('/') ? projectDir : projectDir + '/';
            if (path.startsWith(prefix)) {
                getAssetLibrary().unregister(path.substring(prefix.length));
            }
        }

        state.refresh();
    } catch (err) {
        console.error('Failed to delete asset:', err);
        showErrorToast('Failed to delete asset', String(err));
    }
}

export async function renameAsset(state: ContentBrowserState, path: string, type: AssetItem['type']): Promise<void> {
    const platform = getPlatformAdapter();
    const parentPath = getParentDir(path);
    const fileName = path.split('/').pop() ?? path;
    const dotIndex = fileName.lastIndexOf('.');
    const baseName = type === 'folder' || dotIndex <= 0 ? fileName : fileName.substring(0, dotIndex);
    const extension = type === 'folder' || dotIndex <= 0 ? '' : fileName.substring(dotIndex);

    const newName = await showInputDialog({
        title: 'Rename',
        placeholder: 'Name',
        defaultValue: baseName,
        confirmText: 'Rename',
        validator: async (value) => {
            if (!value.trim()) return 'Name is required';
            if (/[<>:"/\\|?*\x00-\x1f]/.test(value.trim())) {
                return 'Name contains invalid characters';
            }
            const newFileName = extension ? value.trim() + extension : value.trim();
            if (newFileName === fileName) return null;
            const newPath = `${parentPath}/${newFileName}`;
            if (await platform.exists(newPath)) {
                return 'A file with this name already exists';
            }
            return null;
        },
    });

    if (!newName) return;

    const trimmed = newName.trim();
    const newFileName = extension ? trimmed + extension : trimmed;
    if (newFileName === fileName) return;

    const newPath = `${parentPath}/${newFileName}`;

    try {
        await platform.rename(path, newPath);

        const metaPath = `${path}.meta`;
        if (await platform.exists(metaPath)) {
            await platform.rename(metaPath, `${newPath}.meta`);
        }

        if (state.rootFolder) {
            const projectDir = state.rootFolder.path;
            const prefix = projectDir.endsWith('/') ? projectDir : projectDir + '/';
            if (path.startsWith(prefix)) {
                getAssetLibrary().updatePath(
                    path.substring(prefix.length),
                    newPath.substring(prefix.length)
                );
            }
        }

        state.refresh();
    } catch (err) {
        console.error('Failed to rename asset:', err);
        showErrorToast('Failed to rename asset', String(err));
    }
}

async function createNewFolder(state: ContentBrowserState, parentPath: string): Promise<void> {
    const name = await promptFileName('New Folder', '', parentPath);
    if (!name) return;

    const platform = getPlatformAdapter();
    const folderPath = `${parentPath}/${name}`;

    try {
        await platform.mkdir(folderPath);
        state.refresh();
    } catch (err) {
        console.error('Failed to create folder:', err);
        showErrorToast('Failed to create folder', String(err));
    }
}

async function createNewScript(state: ContentBrowserState, parentPath: string): Promise<void> {
    const name = await promptFileName('NewScript', '.ts', parentPath);
    if (!name) return;

    const platform = getPlatformAdapter();
    const filePath = `${parentPath}/${name}`;

    const className = toClassName(name);
    const content = `import { defineComponent } from 'esengine';

export const ${className} = defineComponent('${className}', {
    value: 0,
});
`;

    try {
        await platform.writeTextFile(filePath, content);
        state.refresh();
    } catch (err) {
        console.error('Failed to create script:', err);
        showErrorToast('Failed to create script', String(err));
    }
}

async function createNewMaterial(state: ContentBrowserState, parentPath: string): Promise<void> {
    const name = await promptFileName('NewMaterial', '.esmaterial', parentPath);
    if (!name) return;

    const platform = getPlatformAdapter();
    const filePath = `${parentPath}/${name}`;

    const content = JSON.stringify({
        version: '1.0',
        type: 'material',
        shader: '',
        blendMode: 0,
        depthTest: false,
        properties: {},
    }, null, 2);

    try {
        await platform.writeTextFile(filePath, content);
        state.refresh();
    } catch (err) {
        console.error('Failed to create material:', err);
        showErrorToast('Failed to create material', String(err));
    }
}

async function createNewScene(state: ContentBrowserState, parentPath: string): Promise<void> {
    const name = await promptFileName('NewScene', '.esscene', parentPath);
    if (!name) return;

    const platform = getPlatformAdapter();
    const filePath = `${parentPath}/${name}`;

    const w = getSettingsValue<number>('project.designWidth') || DEFAULT_DESIGN_WIDTH;
    const h = getSettingsValue<number>('project.designHeight') || DEFAULT_DESIGN_HEIGHT;
    const scene = createEmptyScene(name.replace('.esscene', ''), { width: w, height: h });
    const content = JSON.stringify(scene, null, 2);

    try {
        await platform.writeTextFile(filePath, content);
        state.refresh();
        if (state.onOpenScene) {
            state.onOpenScene(filePath);
        }
    } catch (err) {
        console.error('Failed to create scene:', err);
        showErrorToast('Failed to create scene', String(err));
    }
}

async function createNewShader(state: ContentBrowserState, parentPath: string): Promise<void> {
    const name = await promptFileName('NewShader', '.esshader', parentPath);
    if (!name) return;

    const platform = getPlatformAdapter();
    const filePath = `${parentPath}/${name}`;
    const shaderName = name.replace('.esshader', '');

    const content = `#pragma shader "${shaderName}"

#pragma vertex
attribute vec2 a_position;
attribute vec2 a_texCoord;

uniform mat4 u_projection;
uniform mat4 u_model;

varying vec2 v_texCoord;

void main() {
    v_texCoord = a_texCoord;
    gl_Position = u_projection * u_model * vec4(a_position, 0.0, 1.0);
}
#pragma end

#pragma fragment
precision mediump float;

varying vec2 v_texCoord;

void main() {
    gl_FragColor = vec4(v_texCoord, 0.0, 1.0);
}
#pragma end
`;

    try {
        await platform.writeTextFile(filePath, content);
        state.refresh();
    } catch (err) {
        console.error('Failed to create shader:', err);
        showErrorToast('Failed to create shader', String(err));
    }
}

async function createNewBitmapFont(state: ContentBrowserState, parentPath: string): Promise<void> {
    const name = await promptFileName('NewFont', '.bmfont', parentPath);
    if (!name) return;

    const platform = getPlatformAdapter();
    const filePath = `${parentPath}/${name}`;

    const content = JSON.stringify({
        version: '1.0',
        type: 'label-atlas',
        glyphs: {},
    }, null, 2);

    try {
        await platform.writeTextFile(filePath, content);
        state.refresh();
    } catch (err) {
        console.error('Failed to create bitmap font:', err);
        showErrorToast('Failed to create bitmap font', String(err));
    }
}

async function promptFileName(defaultName: string, extension: string = '', parentPath?: string): Promise<string | null> {
    const platform = getPlatformAdapter();

    const name = await showInputDialog({
        title: 'Enter Name',
        placeholder: 'Name',
        defaultValue: defaultName,
        confirmText: 'Create',
        validator: async (value) => {
            if (!value.trim()) return 'Name is required';
            if (/[<>:"/\\|?*\x00-\x1f]/.test(value.trim())) {
                return 'Name contains invalid characters';
            }
            if (parentPath) {
                const fileName = extension && !value.trim().endsWith(extension)
                    ? value.trim() + extension
                    : value.trim();
                const fullPath = `${parentPath}/${fileName}`;
                if (await platform.exists(fullPath)) {
                    return 'A file with this name already exists';
                }
            }
            return null;
        },
    });

    if (!name) return null;

    const trimmed = name.trim();
    if (extension && !trimmed.endsWith(extension)) {
        return trimmed + extension;
    }
    return trimmed;
}

function toClassName(filename: string): string {
    const name = filename.replace(/\.(ts|js)$/, '');
    return name.charAt(0).toUpperCase() + name.slice(1);
}

export async function importDroppedFiles(state: ContentBrowserState, files: FileList): Promise<void> {
    const fs = getNativeFS();
    if (!fs || !state.currentPath) return;

    for (const file of Array.from(files)) {
        const destPath = joinPath(state.currentPath, file.name);
        const exists = await fs.exists(destPath);
        if (exists) {
            const overwrite = await showConfirmDialog({
                title: 'File Exists',
                message: `"${file.name}" already exists. Overwrite?`,
                confirmText: 'Overwrite',
            });
            if (!overwrite) continue;
        }

        const buffer = await file.arrayBuffer();
        await fs.writeBinaryFile(destPath, new Uint8Array(buffer));
    }
}

export async function saveDroppedEntityAsPrefab(state: ContentBrowserState, entityId: number): Promise<void> {
    const entityData = state.store.getEntityData(entityId);
    if (!entityData) return;

    const targetDir = state.currentPath;
    if (!targetDir) return;

    if (state.rootFolder) {
        const assetsDir = joinPath(state.rootFolder.path, 'assets');
        if (!targetDir.startsWith(assetsDir)) {
            showErrorToast('Cannot save prefab outside assets directory', 'Please navigate to the assets folder first');
            return;
        }
    }

    const platform = getPlatformAdapter();

    const name = await showInputDialog({
        title: 'Save as Prefab',
        placeholder: 'Prefab name',
        defaultValue: entityData.name,
        confirmText: 'Save',
        validator: async (value) => {
            if (!value.trim()) return 'Name is required';
            if (/[<>:"/\\|?*\x00-\x1f]/.test(value.trim())) {
                return 'Name contains invalid characters';
            }
            const fileName = value.trim().endsWith('.esprefab')
                ? value.trim()
                : `${value.trim()}.esprefab`;
            const fullPath = joinPath(targetDir, fileName);
            if (await platform.exists(fullPath)) {
                return 'A file with this name already exists';
            }
            return null;
        },
    });

    if (!name) return;

    const fileName = name.trim().endsWith('.esprefab')
        ? name.trim()
        : `${name.trim()}.esprefab`;
    const filePath = joinPath(targetDir, fileName);

    const success = await state.store.saveAsPrefab(entityId, filePath);
    if (success) {
        state.refresh();
    } else {
        showErrorToast('Failed to save prefab', filePath);
    }
}
