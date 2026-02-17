import type { EditorStore, AssetType } from '../../store/EditorStore';
import type { NativeFS, DirectoryEntry } from '../../types/NativeFS';
import { icons } from '../../utils/icons';
import { getEditorContext } from '../../context/EditorContext';
import { getEditorType } from 'esengine';

export interface NativeShell {
    openFile(path: string): Promise<void>;
    openInEditor(projectPath: string, filePath: string): Promise<void>;
}

export interface FolderNode {
    name: string;
    path: string;
    children: FolderNode[];
    expanded: boolean;
    loaded: boolean;
}

export interface AssetItem {
    name: string;
    path: string;
    type: 'folder' | 'scene' | 'script' | 'image' | 'audio' | 'json' | 'material' | 'shader' | 'spine' | 'font' | 'prefab' | 'file';
    relativePath?: string;
}

export type ViewMode = 'grid' | 'list';

export interface ContentBrowserOptions {
    projectPath?: string;
    onOpenScene?: (scenePath: string) => void;
}

export const THUMBNAIL_CACHE_MAX = 200;
export const THUMBNAIL_SIZE = 48;
export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);
export const SEARCH_RESULTS_LIMIT = 100;
export const VIEW_MODE_KEY = 'esengine.editor.contentBrowserView';

export interface ContentBrowserState {
    store: EditorStore;
    container: HTMLElement;
    treeContainer: HTMLElement | null;
    gridContainer: HTMLElement | null;
    footerContainer: HTMLElement | null;
    searchInput: HTMLInputElement | null;
    breadcrumbContainer: HTMLElement | null;
    projectPath: string | null;
    rootFolder: FolderNode | null;
    currentPath: string;
    searchFilter: string;
    currentItems: AssetItem[];
    filteredItems: AssetItem[];
    onOpenScene: ((scenePath: string) => void) | null;
    selectedPaths: Set<string>;
    lastSelectedPath: string | null;
    viewMode: ViewMode;
    render(): void;
    renderTree(): void;
    renderBreadcrumb(): void;
    renderGrid(): Promise<void>;
    refresh(): Promise<void>;
}

export function getNativeFS(): NativeFS | null {
    return getEditorContext().fs ?? null;
}

export function getNativeShell(): NativeShell | null {
    return getEditorContext().shell ?? null;
}

export function getFileExtension(filename: string): string {
    const dotIndex = filename.lastIndexOf('.');
    return dotIndex > 0 ? filename.substring(dotIndex).toLowerCase() : '';
}

const EDITOR_TYPE_TO_DISPLAY: Record<string, AssetItem['type']> = {
    'texture': 'image',
    'material': 'material',
    'shader': 'shader',
    'spine-atlas': 'spine',
    'spine-skeleton': 'spine',
    'bitmap-font': 'font',
    'prefab': 'prefab',
    'json': 'json',
    'audio': 'audio',
    'scene': 'scene',
};

export function getAssetType(entry: DirectoryEntry): AssetItem['type'] {
    if (entry.isDirectory) return 'folder';

    const ext = getFileExtension(entry.name);
    if (ext === '.ts' || ext === '.js') return 'script';

    const editorType = getEditorType(entry.name);
    return EDITOR_TYPE_TO_DISPLAY[editorType] ?? 'file';
}

export function getAssetIcon(type: AssetItem['type'], size: number = 32): string {
    switch (type) {
        case 'folder': return icons.folder(size);
        case 'prefab': return icons.package(size);
        case 'scene': return icons.layers(size);
        case 'script': return icons.code(size);
        case 'image': return icons.image(size);
        case 'audio': return icons.volume(size);
        case 'json': return icons.braces(size);
        case 'material': return icons.settings(size);
        case 'shader': return icons.code(size);
        case 'spine': return icons.bone(size);
        case 'font': return icons.type(size);
        default: return icons.file(size);
    }
}

export function isImageFile(name: string): boolean {
    return IMAGE_EXTENSIONS.has(getFileExtension(name));
}
