import type { Entity } from 'esengine';
import type { EditorStore } from '../store/EditorStore';
import type { DirectoryEntry } from '../types/NativeFS';
import type { HierarchyState } from '../panels/hierarchy/HierarchyTypes';
import { icons } from '../utils/icons';
import { renderImageInspector } from '../panels/inspector/ImageInspector';
import { renderMaterialInspector } from '../panels/inspector/MaterialInspector';
import { renderBitmapFontInspector } from '../panels/inspector/BitmapFontInspector';
import { renderFolderInspector } from '../panels/inspector/FolderInspector';
import { renderScriptInspector, renderSceneInspector, renderFileInspector } from '../panels/inspector/FileInspector';
import { renderAnimClipInspector } from '../panels/inspector/AnimClipInspector';
import { renderAudioInspector } from '../panels/inspector/AudioInspector';

import { getInitialComponentData, getDefaultComponentData } from '../schemas/ComponentSchemas';
import { getGlobalPathResolver } from '../asset';
import { getPlatformAdapter } from '../platform/PlatformAdapter';
import { getEditorContext } from '../context/EditorContext';
import { getAssetDatabase } from './AssetDatabase';
import { AssetType } from '../constants/AssetTypes';
import { getEditorContainer } from '../container';
import { ASSET_TYPE, ASSET_EDITOR_TYPE } from '../container/tokens';

export type AssetPayload = { type: string; path: string; name: string };

export interface AssetTypeDescriptor {
    editorType: string | string[];
    displayType: string;
    displayName: string;
    icon: (size: number) => string;
    eventCategory: string | null;
    droppable: boolean;
    inspectorRenderer: ((container: HTMLElement, path: string, ...args: any[]) => Promise<void>) | null;
    createMenuEntry: { label: string; icon: (size: number) => string; create: (...args: any[]) => Promise<void> } | null;
    onDropToScene?: (store: EditorStore, asset: AssetPayload, worldX: number, worldY: number) => void;
    onCreateEntity?: (state: HierarchyState, asset: AssetPayload, parent: Entity | null) => Promise<void>;
}

export function registerAssetType(displayType: string, descriptor: AssetTypeDescriptor): void {
    const c = getEditorContainer();
    if (c.has(ASSET_TYPE, displayType)) {
        throw new Error(`Asset type '${displayType}' is already registered`);
    }
    c.provide(ASSET_TYPE, displayType, descriptor);
    const editorTypes = Array.isArray(descriptor.editorType)
        ? descriptor.editorType
        : [descriptor.editorType];
    for (const et of editorTypes) {
        c.provide(ASSET_EDITOR_TYPE, et, displayType);
    }
}

export function getAssetTypeDescriptor(displayType: string): AssetTypeDescriptor | undefined {
    return getEditorContainer().get(ASSET_TYPE, displayType);
}

export function getAllAssetTypes(): string[] {
    return [...getEditorContainer().getAll(ASSET_TYPE).keys()];
}

export function getDroppableTypes(): Set<string> {
    const result = new Set<string>();
    for (const [type, desc] of getEditorContainer().getAll(ASSET_TYPE)) {
        if (desc.droppable) {
            result.add(type);
        }
    }
    return result;
}

export function getDisplayType(editorType: string): string {
    return getEditorContainer().get(ASSET_EDITOR_TYPE, editorType) ?? editorType;
}

export function getAssetTypeIcon(displayType: string, size: number = 16): string {
    const desc = getEditorContainer().get(ASSET_TYPE, displayType);
    if (desc) {
        return desc.icon(size);
    }
    return icons.file(size);
}

export function getAssetTypeDisplayName(displayType: string): string {
    const desc = getEditorContainer().get(ASSET_TYPE, displayType);
    if (desc) {
        return desc.displayName;
    }
    return 'File';
}

export function getInspectorRenderer(displayType: string): AssetTypeDescriptor['inspectorRenderer'] {
    return getEditorContainer().get(ASSET_TYPE, displayType)?.inspectorRenderer ?? null;
}

// =========================================================================
// Helpers (used by builtin onDropToScene / onCreateEntity callbacks)
// =========================================================================

function toRelativePath(absolutePath: string): string {
    return getGlobalPathResolver().toRelativePath(absolutePath);
}

function loadImageSize(absolutePath: string): Promise<{ x: number; y: number } | null> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ x: img.naturalWidth, y: img.naturalHeight });
        img.onerror = () => resolve(null);
        img.src = getPlatformAdapter().convertFilePathToUrl(absolutePath);
    });
}

async function findAtlasFile(skeletonPath: string): Promise<string | null> {
    const pathResolver = getGlobalPathResolver();

    const sameNameAtlas = skeletonPath.replace(/\.(json|skel)$/i, '.atlas');
    const validation = await pathResolver.validatePath(sameNameAtlas);
    if (validation.exists) {
        return sameNameAtlas;
    }

    const dir = skeletonPath.substring(0, skeletonPath.lastIndexOf('/'));
    const absoluteDir = pathResolver.toAbsolutePath(dir);

    const fs = getEditorContext().fs;
    if (!fs) {
        return null;
    }

    try {
        const entries: DirectoryEntry[] = await fs.listDirectoryDetailed(absoluteDir);
        const atlasFiles = entries
            .filter(e => e.name.endsWith('.atlas'))
            .map(e => e.name);

        if (atlasFiles.length === 1) {
            return dir ? `${dir}/${atlasFiles[0]}` : atlasFiles[0];
        }

        if (atlasFiles.length > 1) {
            const baseName = skeletonPath
                .substring(skeletonPath.lastIndexOf('/') + 1)
                .replace(/\.(json|skel)$/i, '');

            const matching = atlasFiles.find(name =>
                name.replace('.atlas', '').toLowerCase().includes(baseName.toLowerCase().split('-')[0])
            );

            if (matching) {
                return dir ? `${dir}/${matching}` : matching;
            }

            return dir ? `${dir}/${atlasFiles[0]}` : atlasFiles[0];
        }
    } catch (err) {
        console.warn('[AssetTypeRegistry] Failed to scan directory for atlas files:', err);
    }

    return null;
}

async function createSpineEntityFromAsset(
    state: HierarchyState,
    asset: AssetPayload,
    parent: Entity | null,
): Promise<void> {
    const ext = asset.name.substring(asset.name.lastIndexOf('.')).toLowerCase();
    if (ext === '.atlas') return;

    const skeletonPath = toRelativePath(asset.path);
    const atlasPath = await findAtlasFile(skeletonPath);

    if (!atlasPath) {
        console.error(`[AssetTypeRegistry] No atlas file found for: ${skeletonPath}`);
        alert(`No atlas file found.\nPlease ensure there is an .atlas file in the same directory as the skeleton file.`);
        return;
    }

    const baseName = asset.name.replace(/\.[^.]+$/, '');
    const newEntity = state.store.createEntity(baseName, parent);
    state.store.addComponent(newEntity, 'Transform', getInitialComponentData('Transform'));
    state.store.addComponent(newEntity, 'SpineAnimation', {
        ...getInitialComponentData('SpineAnimation'),
        skeletonPath,
        atlasPath,
    });
}

// =========================================================================
// Builtin registration
// =========================================================================

export function registerBuiltinAssetTypes(registrar?: import('../container').PluginRegistrar): void {
    const reg = (displayType: string, descriptor: AssetTypeDescriptor) => {
        const r = registrar ?? getEditorContainer();
        if (r.has(ASSET_TYPE, displayType)) {
            throw new Error(`Asset type '${displayType}' is already registered`);
        }
        r.provide(ASSET_TYPE, displayType, descriptor);
        const editorTypes = Array.isArray(descriptor.editorType)
            ? descriptor.editorType
            : [descriptor.editorType];
        for (const et of editorTypes) {
            r.provide(ASSET_EDITOR_TYPE, et, displayType);
        }
    };
    reg(AssetType.IMAGE, {
        editorType: 'texture',
        displayType: AssetType.IMAGE,
        displayName: 'Image',
        icon: icons.image,
        eventCategory: 'texture',
        droppable: true,
        inspectorRenderer: (container, path, imageUrlRef) => renderImageInspector(container, path, imageUrlRef),
        createMenuEntry: null,
        onDropToScene(store, asset, worldX, worldY) {
            const baseName = asset.name.replace(/\.[^.]+$/, '');
            const newEntity = store.createEntity(baseName);

            const transformData = getInitialComponentData('Transform');
            transformData.position = { x: worldX, y: worldY, z: 0 };
            store.addComponent(newEntity, 'Transform', transformData);

            const relativePath = toRelativePath(asset.path);
            store.addComponent(newEntity, 'Sprite', {
                ...getInitialComponentData('Sprite'),
                texture: relativePath,
            });

            loadImageSize(asset.path).then(size => {
                if (size) {
                    const defaultSize = getDefaultComponentData('Sprite').size;
                    store.updateProperty(newEntity, 'Sprite', 'size', defaultSize, size);
                }
            });
        },
        onCreateEntity: async (state, asset, parent) => {
            const baseName = asset.name.replace(/\.[^.]+$/, '');
            const newEntity = state.store.createEntity(baseName, parent);

            state.store.addComponent(newEntity, 'Transform', getInitialComponentData('Transform'));
            state.store.addComponent(newEntity, 'Sprite', {
                ...getInitialComponentData('Sprite'),
                texture: toRelativePath(asset.path),
            });

            loadImageSize(asset.path).then(size => {
                if (size) {
                    state.store.updateProperty(newEntity, 'Sprite', 'size', { x: 32, y: 32 }, size);
                }
            });
        },
    });

    reg(AssetType.MATERIAL, {
        editorType: 'material',
        displayType: AssetType.MATERIAL,
        displayName: 'Material',
        icon: icons.settings,
        eventCategory: 'material',
        droppable: false,
        inspectorRenderer: (container, path) => renderMaterialInspector(container, path),
        createMenuEntry: null,
    });

    reg(AssetType.SHADER, {
        editorType: 'shader',
        displayType: AssetType.SHADER,
        displayName: 'Shader',
        icon: icons.code,
        eventCategory: 'shader',
        droppable: false,
        inspectorRenderer: null,
        createMenuEntry: null,
    });

    reg(AssetType.FONT, {
        editorType: 'bitmap-font',
        displayType: AssetType.FONT,
        displayName: 'BitmapFont',
        icon: icons.type,
        eventCategory: null,
        droppable: false,
        inspectorRenderer: (container, path) => renderBitmapFontInspector(container, path),
        createMenuEntry: null,
    });

    reg(AssetType.SPINE, {
        editorType: ['spine-atlas', 'spine-skeleton'],
        displayType: AssetType.SPINE,
        displayName: 'Spine',
        icon: icons.bone,
        eventCategory: 'spine',
        droppable: false,
        inspectorRenderer: null,
        createMenuEntry: null,
        onCreateEntity: createSpineEntityFromAsset,
    });

    reg(AssetType.ANIMCLIP, {
        editorType: 'anim-clip',
        displayType: AssetType.ANIMCLIP,
        displayName: 'Animation Clip',
        icon: icons.film,
        eventCategory: 'anim-clip',
        droppable: true,
        inspectorRenderer: (container, path) => renderAnimClipInspector(container, path),
        createMenuEntry: null,
        onDropToScene(store, asset, worldX, worldY) {
            const baseName = asset.name.replace(/\.[^.]+$/, '');
            const newEntity = store.createEntity(baseName);

            const transformData = getInitialComponentData('Transform');
            transformData.position = { x: worldX, y: worldY, z: 0 };
            store.addComponent(newEntity, 'Transform', transformData);

            store.addComponent(newEntity, 'Sprite', getInitialComponentData('Sprite'));

            const relativePath = toRelativePath(asset.path);
            store.addComponent(newEntity, 'SpriteAnimator', {
                ...getInitialComponentData('SpriteAnimator'),
                clip: relativePath,
            });
        },
        onCreateEntity: async (state, asset, parent) => {
            const baseName = asset.name.replace(/\.[^.]+$/, '');
            const newEntity = state.store.createEntity(baseName, parent);

            state.store.addComponent(newEntity, 'Transform', getInitialComponentData('Transform'));
            state.store.addComponent(newEntity, 'Sprite', getInitialComponentData('Sprite'));
            state.store.addComponent(newEntity, 'SpriteAnimator', {
                ...getInitialComponentData('SpriteAnimator'),
                clip: toRelativePath(asset.path),
            });
        },
    });

    reg(AssetType.TIMELINE, {
        editorType: 'timeline',
        displayType: AssetType.TIMELINE,
        displayName: 'Timeline',
        icon: icons.film,
        eventCategory: null,
        droppable: false,
        inspectorRenderer: null,
        createMenuEntry: null,
    });

    reg(AssetType.SCENE, {
        editorType: 'scene',
        displayType: AssetType.SCENE,
        displayName: 'Scene',
        icon: icons.layers,
        eventCategory: null,
        droppable: false,
        inspectorRenderer: (container, path) => renderSceneInspector(container, path),
        createMenuEntry: null,
    });

    reg(AssetType.PREFAB, {
        editorType: 'prefab',
        displayType: AssetType.PREFAB,
        displayName: 'Prefab',
        icon: icons.package,
        eventCategory: null,
        droppable: false,
        inspectorRenderer: null,
        createMenuEntry: null,
        onCreateEntity: async (state, asset, parent) => {
            const relativePath = toRelativePath(asset.path);
            const uuid = getAssetDatabase().getUuid(relativePath) ?? relativePath;
            await state.store.instantiatePrefab(uuid, parent);
        },
    });

    reg(AssetType.AUDIO, {
        editorType: 'audio',
        displayType: AssetType.AUDIO,
        displayName: 'Audio',
        icon: icons.volume,
        eventCategory: null,
        droppable: true,
        inspectorRenderer: (container, path) => renderAudioInspector(container, path),
        createMenuEntry: null,
        onDropToScene(store, asset, worldX, worldY) {
            const baseName = asset.name.replace(/\.[^.]+$/, '');
            const newEntity = store.createEntity(baseName);

            const transformData = getInitialComponentData('Transform');
            transformData.position = { x: worldX, y: worldY, z: 0 };
            store.addComponent(newEntity, 'Transform', transformData);

            store.addComponent(newEntity, 'AudioSource', {
                ...getInitialComponentData('AudioSource'),
                clip: toRelativePath(asset.path),
            });
        },
        onCreateEntity: async (state, asset, parent) => {
            const baseName = asset.name.replace(/\.[^.]+$/, '');
            const newEntity = state.store.createEntity(baseName, parent);

            state.store.addComponent(newEntity, 'Transform', getInitialComponentData('Transform'));
            state.store.addComponent(newEntity, 'AudioSource', {
                ...getInitialComponentData('AudioSource'),
                clip: toRelativePath(asset.path),
            });
        },
    });

    reg(AssetType.SCRIPT, {
        editorType: 'script',
        displayType: AssetType.SCRIPT,
        displayName: 'Script',
        icon: icons.code,
        eventCategory: null,
        droppable: false,
        inspectorRenderer: (container, path) => renderScriptInspector(container, path),
        createMenuEntry: null,
    });

    reg(AssetType.JSON, {
        editorType: 'json',
        displayType: AssetType.JSON,
        displayName: 'JSON',
        icon: icons.braces,
        eventCategory: null,
        droppable: false,
        inspectorRenderer: null,
        createMenuEntry: null,
        onCreateEntity: createSpineEntityFromAsset,
    });

    reg(AssetType.FOLDER, {
        editorType: 'folder',
        displayType: AssetType.FOLDER,
        displayName: 'Folder',
        icon: icons.folder,
        eventCategory: null,
        droppable: false,
        inspectorRenderer: (container, path) => renderFolderInspector(container, path),
        createMenuEntry: null,
    });

    reg(AssetType.FILE, {
        editorType: 'file',
        displayType: AssetType.FILE,
        displayName: 'File',
        icon: icons.file,
        eventCategory: null,
        droppable: false,
        inspectorRenderer: (container, path) => renderFileInspector(container, path, 'File'),
        createMenuEntry: null,
    });
}

export function resetAssetTypeRegistry(): void {
    const c = getEditorContainer();
    c.removeWhere(ASSET_TYPE, () => true);
    c.removeWhere(ASSET_EDITOR_TYPE, () => true);
}
