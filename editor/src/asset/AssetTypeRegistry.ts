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
import { getInitialComponentData, getDefaultComponentData } from '../schemas/ComponentSchemas';
import { getGlobalPathResolver } from '../asset';
import { getPlatformAdapter } from '../platform/PlatformAdapter';
import { getEditorContext } from '../context/EditorContext';
import { getAssetDatabase } from './AssetDatabase';

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

const registry_ = new Map<string, AssetTypeDescriptor>();
const editorTypeIndex_ = new Map<string, string>();

export function registerAssetType(displayType: string, descriptor: AssetTypeDescriptor): void {
    if (registry_.has(displayType)) {
        throw new Error(`Asset type '${displayType}' is already registered`);
    }
    registry_.set(displayType, descriptor);
    const editorTypes = Array.isArray(descriptor.editorType)
        ? descriptor.editorType
        : [descriptor.editorType];
    for (const et of editorTypes) {
        editorTypeIndex_.set(et, displayType);
    }
}

export function getAssetTypeDescriptor(displayType: string): AssetTypeDescriptor | undefined {
    return registry_.get(displayType);
}

export function getAllAssetTypes(): string[] {
    return [...registry_.keys()];
}

export function getDroppableTypes(): Set<string> {
    const result = new Set<string>();
    for (const [type, desc] of registry_) {
        if (desc.droppable) {
            result.add(type);
        }
    }
    return result;
}

export function getDisplayType(editorType: string): string {
    return editorTypeIndex_.get(editorType) ?? editorType;
}

export function getAssetTypeIcon(displayType: string, size: number = 16): string {
    const desc = registry_.get(displayType);
    if (desc) {
        return desc.icon(size);
    }
    return icons.file(size);
}

export function getAssetTypeDisplayName(displayType: string): string {
    const desc = registry_.get(displayType);
    if (desc) {
        return desc.displayName;
    }
    return 'File';
}

export function getInspectorRenderer(displayType: string): AssetTypeDescriptor['inspectorRenderer'] {
    return registry_.get(displayType)?.inspectorRenderer ?? null;
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

export function registerBuiltinAssetTypes(): void {
    registerAssetType('image', {
        editorType: 'texture',
        displayType: 'image',
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

    registerAssetType('material', {
        editorType: 'material',
        displayType: 'material',
        displayName: 'Material',
        icon: icons.settings,
        eventCategory: 'material',
        droppable: false,
        inspectorRenderer: (container, path) => renderMaterialInspector(container, path),
        createMenuEntry: null,
    });

    registerAssetType('shader', {
        editorType: 'shader',
        displayType: 'shader',
        displayName: 'Shader',
        icon: icons.code,
        eventCategory: 'shader',
        droppable: false,
        inspectorRenderer: null,
        createMenuEntry: null,
    });

    registerAssetType('font', {
        editorType: 'bitmap-font',
        displayType: 'font',
        displayName: 'BitmapFont',
        icon: icons.type,
        eventCategory: null,
        droppable: false,
        inspectorRenderer: (container, path) => renderBitmapFontInspector(container, path),
        createMenuEntry: null,
    });

    registerAssetType('spine', {
        editorType: ['spine-atlas', 'spine-skeleton'],
        displayType: 'spine',
        displayName: 'Spine',
        icon: icons.bone,
        eventCategory: 'spine',
        droppable: false,
        inspectorRenderer: null,
        createMenuEntry: null,
        onCreateEntity: createSpineEntityFromAsset,
    });

    registerAssetType('animclip', {
        editorType: 'anim-clip',
        displayType: 'animclip',
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

    registerAssetType('scene', {
        editorType: 'scene',
        displayType: 'scene',
        displayName: 'Scene',
        icon: icons.layers,
        eventCategory: null,
        droppable: false,
        inspectorRenderer: (container, path) => renderSceneInspector(container, path),
        createMenuEntry: null,
    });

    registerAssetType('prefab', {
        editorType: 'prefab',
        displayType: 'prefab',
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

    registerAssetType('audio', {
        editorType: 'audio',
        displayType: 'audio',
        displayName: 'Audio',
        icon: icons.volume,
        eventCategory: null,
        droppable: false,
        inspectorRenderer: null,
        createMenuEntry: null,
    });

    registerAssetType('script', {
        editorType: 'script',
        displayType: 'script',
        displayName: 'Script',
        icon: icons.code,
        eventCategory: null,
        droppable: false,
        inspectorRenderer: (container, path) => renderScriptInspector(container, path),
        createMenuEntry: null,
    });

    registerAssetType('json', {
        editorType: 'json',
        displayType: 'json',
        displayName: 'JSON',
        icon: icons.braces,
        eventCategory: null,
        droppable: false,
        inspectorRenderer: null,
        createMenuEntry: null,
        onCreateEntity: createSpineEntityFromAsset,
    });

    registerAssetType('folder', {
        editorType: 'folder',
        displayType: 'folder',
        displayName: 'Folder',
        icon: icons.folder,
        eventCategory: null,
        droppable: false,
        inspectorRenderer: (container, path) => renderFolderInspector(container, path),
        createMenuEntry: null,
    });

    registerAssetType('file', {
        editorType: 'file',
        displayType: 'file',
        displayName: 'File',
        icon: icons.file,
        eventCategory: null,
        droppable: false,
        inspectorRenderer: (container, path) => renderFileInspector(container, path, 'file'),
        createMenuEntry: null,
    });
}

export function resetAssetTypeRegistry(): void {
    registry_.clear();
    editorTypeIndex_.clear();
}
