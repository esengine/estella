/**
 * @file    ContentBrowserPanel.ts
 * @brief   Asset browser panel for managing project files
 */

import type { EditorStore, AssetType } from '../store/EditorStore';
import { icons } from '../utils/icons';
import { showContextMenu, type ContextMenuItem } from '../ui/ContextMenu';
import { getContextMenuItems, type ContextMenuContext } from '../ui/ContextMenuRegistry';
import { getPlatformAdapter } from '../platform/PlatformAdapter';
import { showInputDialog, showConfirmDialog } from '../ui/dialog';
import { getEditorContext } from '../context/EditorContext';
import { joinPath, getParentDir } from '../utils/path';
import type { NativeFS, DirectoryEntry } from '../types/NativeFS';
import { getAssetLibrary } from '../asset/AssetLibrary';
import { getGlobalPathResolver } from '../asset';
import { showErrorToast } from '../ui/Toast';
import { createEmptyScene } from '../types/SceneTypes';
import { getSettingsValue } from '../settings';
import { DEFAULT_DESIGN_WIDTH, DEFAULT_DESIGN_HEIGHT, getEditorType } from 'esengine';

// =============================================================================
// Types
// =============================================================================

interface NativeShell {
    openFile(path: string): Promise<void>;
    openInEditor(projectPath: string, filePath: string): Promise<void>;
}

interface FolderNode {
    name: string;
    path: string;
    children: FolderNode[];
    expanded: boolean;
    loaded: boolean;
}

interface AssetItem {
    name: string;
    path: string;
    type: 'folder' | 'scene' | 'script' | 'image' | 'audio' | 'json' | 'material' | 'shader' | 'spine' | 'font' | 'prefab' | 'file';
    relativePath?: string;
}

type ViewMode = 'grid' | 'list';

export interface ContentBrowserOptions {
    projectPath?: string;
    onOpenScene?: (scenePath: string) => void;
}

const THUMBNAIL_CACHE_MAX = 200;
const THUMBNAIL_SIZE = 48;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);
const SEARCH_RESULTS_LIMIT = 100;
const VIEW_MODE_KEY = 'esengine.editor.contentBrowserView';

// =============================================================================
// Helpers
// =============================================================================

function getNativeFS(): NativeFS | null {
    return getEditorContext().fs ?? null;
}

function getNativeShell(): NativeShell | null {
    return getEditorContext().shell ?? null;
}

function getFileExtension(filename: string): string {
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

function getAssetType(entry: DirectoryEntry): AssetItem['type'] {
    if (entry.isDirectory) return 'folder';

    const ext = getFileExtension(entry.name);
    if (ext === '.ts' || ext === '.js') return 'script';

    const editorType = getEditorType(entry.name);
    return EDITOR_TYPE_TO_DISPLAY[editorType] ?? 'file';
}

function getAssetIcon(type: AssetItem['type'], size: number = 32): string {
    switch (type) {
        case 'folder':
            return icons.folder(size);
        case 'prefab':
            return icons.package(size);
        case 'scene':
            return icons.layers(size);
        case 'script':
            return icons.code(size);
        case 'image':
            return icons.image(size);
        case 'audio':
            return icons.volume(size);
        case 'json':
            return icons.braces(size);
        case 'material':
            return icons.settings(size);
        case 'shader':
            return icons.code(size);
        case 'spine':
            return icons.bone(size);
        case 'font':
            return icons.type(size);
        default:
            return icons.file(size);
    }
}

function isImageFile(name: string): boolean {
    return IMAGE_EXTENSIONS.has(getFileExtension(name));
}

// =============================================================================
// ThumbnailCache
// =============================================================================

class ThumbnailCache {
    private cache_ = new Map<string, string>();
    private loading_ = new Set<string>();

    get(path: string): string | undefined {
        return this.cache_.get(path);
    }

    isLoading(path: string): boolean {
        return this.loading_.has(path);
    }

    async load(path: string, onLoaded: () => void): Promise<void> {
        if (this.cache_.has(path) || this.loading_.has(path)) return;

        this.loading_.add(path);

        try {
            const fs = getNativeFS();
            if (!fs) return;

            const data = await fs.readBinaryFile(path);
            if (!data) return;

            const blob = new Blob([data.buffer as ArrayBuffer]);
            const url = URL.createObjectURL(blob);

            const img = new Image();
            await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject();
                img.src = url;
            });

            const canvas = document.createElement('canvas');
            canvas.width = THUMBNAIL_SIZE;
            canvas.height = THUMBNAIL_SIZE;
            const ctx = canvas.getContext('2d')!;

            const scale = Math.min(THUMBNAIL_SIZE / img.width, THUMBNAIL_SIZE / img.height);
            const w = img.width * scale;
            const h = img.height * scale;
            const x = (THUMBNAIL_SIZE - w) / 2;
            const y = (THUMBNAIL_SIZE - h) / 2;

            ctx.drawImage(img, x, y, w, h);

            const dataUrl = canvas.toDataURL('image/png');
            URL.revokeObjectURL(url);

            if (this.cache_.size >= THUMBNAIL_CACHE_MAX) {
                const firstKey = this.cache_.keys().next().value;
                if (firstKey) this.cache_.delete(firstKey);
            }

            this.cache_.set(path, dataUrl);
            onLoaded();
        } catch {
            // ignore load failures
        } finally {
            this.loading_.delete(path);
        }
    }
}

// =============================================================================
// ContentBrowserPanel
// =============================================================================

export class ContentBrowserPanel {
    private container_: HTMLElement;
    private store_: EditorStore;
    private treeContainer_: HTMLElement | null = null;
    private gridContainer_: HTMLElement | null = null;
    private footerContainer_: HTMLElement | null = null;
    private searchInput_: HTMLInputElement | null = null;
    private breadcrumbContainer_: HTMLElement | null = null;

    private projectPath_: string | null = null;
    private rootFolder_: FolderNode | null = null;
    private currentPath_: string = '';
    private searchFilter_: string = '';
    private unwatchFn_: (() => void) | null = null;
    private refreshing_ = false;
    private refreshPending_ = false;
    private currentItems_: AssetItem[] = [];
    private filteredItems_: AssetItem[] = [];
    private onOpenScene_: ((scenePath: string) => void) | null = null;
    private selectedPaths_ = new Set<string>();
    private lastSelectedPath_: string | null = null;
    private thumbnailCache_ = new ThumbnailCache();
    private viewMode_: ViewMode;

    constructor(container: HTMLElement, store: EditorStore, options?: ContentBrowserOptions) {
        this.container_ = container;
        this.store_ = store;
        this.projectPath_ = options?.projectPath ?? null;
        this.onOpenScene_ = options?.onOpenScene ?? null;
        this.viewMode_ = (localStorage.getItem(VIEW_MODE_KEY) as ViewMode) || 'grid';

        if (this.projectPath_) {
            this.currentPath_ = getParentDir(this.projectPath_);
        }

        this.container_.classList.add('es-content-browser');
        this.container_.innerHTML = `
            <div class="es-content-browser-header">
                <span class="es-content-browser-title">${icons.folder(14)} Content Browser</span>
                <div class="es-content-browser-actions">
                    <button class="es-btn es-btn-icon es-refresh-btn" title="Refresh">${icons.refresh(12)}</button>
                </div>
            </div>
            <div class="es-content-browser-body">
                <div class="es-content-browser-tree"></div>
                <div class="es-content-browser-main">
                    <div class="es-content-browser-toolbar">
                        <button class="es-btn es-btn-icon es-cb-up-btn" title="Parent folder">${icons.arrowUp(14)}</button>
                        <div class="es-content-breadcrumb"></div>
                        <input type="text" class="es-input es-content-search" placeholder="Search assets...">
                        <button class="es-btn es-btn-icon es-cb-view-toggle" title="Toggle view"></button>
                    </div>
                    <div class="es-content-browser-grid" tabindex="0"></div>
                </div>
            </div>
            <div class="es-content-browser-footer">0 items</div>
        `;

        this.treeContainer_ = this.container_.querySelector('.es-content-browser-tree');
        this.gridContainer_ = this.container_.querySelector('.es-content-browser-grid');
        this.footerContainer_ = this.container_.querySelector('.es-content-browser-footer');
        this.searchInput_ = this.container_.querySelector('.es-content-search');
        this.breadcrumbContainer_ = this.container_.querySelector('.es-content-breadcrumb');

        this.updateViewToggleButton();
        this.setupEvents();
        this.initialize();
    }

    dispose(): void {
        if (this.unwatchFn_) {
            this.unwatchFn_();
            this.unwatchFn_ = null;
        }
    }

    async navigateToAsset(assetPath: string): Promise<void> {
        if (!this.rootFolder_) return;

        const normalized = assetPath.replace(/\\/g, '/');
        const lastSlash = normalized.lastIndexOf('/');
        const folderPath = lastSlash > 0 ? normalized.substring(0, lastSlash) : this.rootFolder_.path;

        const projectDir = this.rootFolder_.path;
        const targetFolderPath = joinPath(projectDir, folderPath);

        const pathParts = folderPath.split('/').filter(p => p);
        let currentNode = this.rootFolder_;

        for (const part of pathParts) {
            const childPath = joinPath(currentNode.path, part);
            let child = currentNode.children.find(c => c.path === childPath);

            if (!child) {
                if (!currentNode.loaded) {
                    await this.loadFolderChildren(currentNode);
                    child = currentNode.children.find(c => c.path === childPath);
                }
            }

            if (child) {
                child.expanded = true;
                if (!child.loaded) {
                    await this.loadFolderChildren(child);
                }
                currentNode = child;
            } else {
                break;
            }
        }

        this.currentPath_ = targetFolderPath;
        const fullAssetPath = joinPath(projectDir, normalized);
        this.selectedPaths_.clear();
        this.selectedPaths_.add(fullAssetPath);
        this.lastSelectedPath_ = fullAssetPath;

        this.renderTree();
        await this.renderGrid();

        requestAnimationFrame(() => {
            const selectedItem = this.gridContainer_?.querySelector('.es-selected');
            selectedItem?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
    }

    private async initialize(): Promise<void> {
        if (this.projectPath_) {
            await this.loadProjectDirectory();
            await this.setupFileWatcher();
        } else {
            this.rootFolder_ = this.createEmptyFolderStructure();
            this.render();
        }
    }

    private async loadProjectDirectory(): Promise<void> {
        const projectDir = getParentDir(this.projectPath_!);
        this.currentPath_ = projectDir;

        this.rootFolder_ = {
            name: this.getProjectName(),
            path: projectDir,
            children: [],
            expanded: true,
            loaded: false,
        };

        await this.loadFolderChildren(this.rootFolder_);
        this.render();
    }

    private getProjectName(): string {
        if (!this.projectPath_) return 'Project';
        const normalized = this.projectPath_.replace(/\\/g, '/');
        const parts = normalized.split('/');
        return parts[parts.length - 2] || 'Project';
    }

    private async loadFolderChildren(folder: FolderNode): Promise<void> {
        const fs = getNativeFS();
        if (!fs) return;

        try {
            const entries = await fs.listDirectoryDetailed(folder.path);

            folder.children = entries
                .filter(e => e.isDirectory && !e.name.startsWith('.'))
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(e => ({
                    name: e.name,
                    path: joinPath(folder.path, e.name),
                    children: [],
                    expanded: false,
                    loaded: false,
                }));

            folder.loaded = true;
        } catch (err) {
            console.error('Failed to load folder:', folder.path, err);
        }
    }

    private async setupFileWatcher(): Promise<void> {
        const fs = getNativeFS();
        if (!fs || !this.projectPath_) return;

        const projectDir = getParentDir(this.projectPath_);

        try {
            this.unwatchFn_ = await fs.watchDirectory(
                projectDir,
                () => { this.refresh(); },
                { recursive: true }
            );
        } catch (err) {
            console.error('Failed to setup file watcher:', err);
        }
    }

    async refresh(): Promise<void> {
        if (this.refreshing_) {
            this.refreshPending_ = true;
            return;
        }
        this.refreshing_ = true;
        try {
            if (this.rootFolder_ && this.projectPath_) {
                this.rootFolder_.loaded = false;
                await this.loadFolderChildren(this.rootFolder_);

                const expandedPaths = this.collectExpandedPaths(this.rootFolder_);
                for (const path of expandedPaths) {
                    const folder = this.findFolder(this.rootFolder_, path);
                    if (folder && !folder.loaded) {
                        await this.loadFolderChildren(folder);
                    }
                }

                this.render();
            }
        } finally {
            this.refreshing_ = false;
            if (this.refreshPending_) {
                this.refreshPending_ = false;
                this.refresh();
            }
        }
    }

    private collectExpandedPaths(node: FolderNode): string[] {
        const paths: string[] = [];
        if (node.expanded) {
            paths.push(node.path);
            for (const child of node.children) {
                paths.push(...this.collectExpandedPaths(child));
            }
        }
        return paths;
    }

    private createEmptyFolderStructure(): FolderNode {
        return {
            name: 'Project',
            path: '',
            expanded: true,
            loaded: true,
            children: [
                { name: 'assets', path: 'assets', expanded: false, loaded: true, children: [] },
                { name: 'src', path: 'src', expanded: false, loaded: true, children: [] },
            ],
        };
    }

    private updateViewToggleButton(): void {
        const btn = this.container_.querySelector('.es-cb-view-toggle');
        if (!btn) return;
        btn.innerHTML = this.viewMode_ === 'grid' ? icons.layoutList(14) : icons.layoutGrid(14);
        btn.setAttribute('title', this.viewMode_ === 'grid' ? 'Switch to list view' : 'Switch to grid view');
    }

    private setupEvents(): void {
        this.searchInput_?.addEventListener('input', () => {
            this.searchFilter_ = this.searchInput_?.value.toLowerCase() ?? '';
            this.renderGrid();
        });

        this.breadcrumbContainer_?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const item = target.closest('.es-breadcrumb-item') as HTMLElement;
            if (!item) return;

            const path = item.dataset.path;
            if (path) {
                this.selectFolder(path);
            }
        });

        const upBtn = this.container_.querySelector('.es-cb-up-btn');
        upBtn?.addEventListener('click', () => {
            this.navigateToParent();
        });

        const viewToggle = this.container_.querySelector('.es-cb-view-toggle');
        viewToggle?.addEventListener('click', () => {
            this.viewMode_ = this.viewMode_ === 'grid' ? 'list' : 'grid';
            localStorage.setItem(VIEW_MODE_KEY, this.viewMode_);
            this.updateViewToggleButton();
            this.renderGrid();
        });

        this.treeContainer_?.addEventListener('click', async (e) => {
            const target = e.target as HTMLElement;
            const item = target.closest('.es-folder-item') as HTMLElement;
            if (!item) return;

            const path = item.dataset.path;
            if (!path) return;

            if (target.closest('.es-folder-expand')) {
                await this.toggleFolder(path);
            } else {
                this.selectFolder(path);
            }
        });

        this.gridContainer_?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const item = (target.closest('.es-asset-item') || target.closest('.es-cb-list-row')) as HTMLElement;

            if (!item) {
                this.selectedPaths_.clear();
                this.lastSelectedPath_ = null;
                this.updateAssetSelection();
                return;
            }

            const path = item.dataset.path;
            if (!path) return;

            if (e.shiftKey && this.lastSelectedPath_) {
                this.rangeSelect(this.lastSelectedPath_, path);
            } else if (e.ctrlKey || e.metaKey) {
                if (this.selectedPaths_.has(path)) {
                    this.selectedPaths_.delete(path);
                } else {
                    this.selectedPaths_.add(path);
                }
                this.lastSelectedPath_ = path;
            } else {
                this.selectedPaths_.clear();
                this.selectedPaths_.add(path);
                this.lastSelectedPath_ = path;
            }

            this.updateAssetSelection();
            this.notifyStoreSelection();
        });

        this.gridContainer_?.addEventListener('dblclick', async (e) => {
            const target = e.target as HTMLElement;
            const item = (target.closest('.es-asset-item') || target.closest('.es-cb-list-row')) as HTMLElement;
            if (!item) return;

            const path = item.dataset.path;
            const type = item.dataset.type;

            if (type === 'folder' && path) {
                this.selectFolder(path);
                await this.expandFolder(path);
            } else if (path) {
                this.onAssetDoubleClick(path, type as AssetItem['type']);
            }
        });

        const refreshBtn = this.container_.querySelector('.es-refresh-btn');
        refreshBtn?.addEventListener('click', () => {
            this.refresh();
        });

        this.gridContainer_?.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const target = e.target as HTMLElement;
            const item = (target.closest('.es-asset-item') || target.closest('.es-cb-list-row')) as HTMLElement;

            if (item) {
                const path = item.dataset.path;
                const type = item.dataset.type;
                if (path) {
                    if (!this.selectedPaths_.has(path)) {
                        this.selectedPaths_.clear();
                        this.selectedPaths_.add(path);
                        this.lastSelectedPath_ = path;
                        this.updateAssetSelection();
                    }

                    if (this.selectedPaths_.size > 1) {
                        this.showMultiSelectContextMenu(e);
                    } else {
                        this.showAssetContextMenu(e, path, type as AssetItem['type']);
                    }
                }
            } else {
                this.showFolderContextMenu(e, this.currentPath_);
            }
        });

        this.treeContainer_?.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const target = e.target as HTMLElement;
            const item = target.closest('.es-folder-item') as HTMLElement;
            const path = item?.dataset.path ?? this.currentPath_;
            if (path) {
                this.showFolderContextMenu(e, path);
            }
        });

        this.gridContainer_?.addEventListener('dragstart', (e) => {
            const target = e.target as HTMLElement;
            const item = (target.closest('.es-asset-item') || target.closest('.es-cb-list-row')) as HTMLElement;
            if (!item) return;

            const path = item.dataset.path;
            const type = item.dataset.type;
            if (!path || !type) return;

            if (!this.selectedPaths_.has(path)) {
                this.selectedPaths_.clear();
                this.selectedPaths_.add(path);
                this.lastSelectedPath_ = path;
                this.updateAssetSelection();
            }

            const dragItems = this.filteredItems_.filter(i => this.selectedPaths_.has(i.path));
            const payload = dragItems.map(i => ({ type: i.type, path: i.path, name: i.name }));

            e.dataTransfer?.setData('application/esengine-asset', JSON.stringify(
                payload.length === 1 ? payload[0] : payload
            ));
            e.dataTransfer!.effectAllowed = 'copy';

            item.classList.add('es-dragging');
        });

        this.gridContainer_?.addEventListener('dragend', (e) => {
            const target = e.target as HTMLElement;
            const item = (target.closest('.es-asset-item') || target.closest('.es-cb-list-row')) as HTMLElement;
            item?.classList.remove('es-dragging');
        });

        this.gridContainer_?.addEventListener('dragover', (e) => {
            const types = e.dataTransfer?.types ?? [];
            const typesArr = Array.from(types);
            if (!typesArr.includes('application/esengine-entity') && !typesArr.includes('Files')) return;
            e.preventDefault();
            e.dataTransfer!.dropEffect = 'copy';
            this.gridContainer_?.classList.add('es-drag-over');
        });

        this.gridContainer_?.addEventListener('dragleave', (e) => {
            const related = e.relatedTarget as HTMLElement;
            if (this.gridContainer_?.contains(related)) return;
            this.gridContainer_?.classList.remove('es-drag-over');
        });

        this.gridContainer_?.addEventListener('drop', (e) => {
            this.gridContainer_?.classList.remove('es-drag-over');

            if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
                e.preventDefault();
                this.importDroppedFiles(e.dataTransfer.files);
                return;
            }

            const entityIdStr = e.dataTransfer?.getData('application/esengine-entity');
            if (!entityIdStr) return;

            e.preventDefault();
            const entityId = parseInt(entityIdStr, 10);
            if (isNaN(entityId)) return;

            this.saveDroppedEntityAsPrefab(entityId);
        });

        this.gridContainer_?.addEventListener('keydown', (e) => {
            this.handleKeyboardNavigation(e);
        });
    }

    private navigateToParent(): void {
        if (!this.rootFolder_) return;
        if (this.currentPath_ === this.rootFolder_.path) return;

        const parentPath = getParentDir(this.currentPath_);
        if (parentPath) {
            this.selectFolder(parentPath);
        }
    }

    private rangeSelect(fromPath: string, toPath: string): void {
        const fromIndex = this.filteredItems_.findIndex(i => i.path === fromPath);
        const toIndex = this.filteredItems_.findIndex(i => i.path === toPath);
        if (fromIndex < 0 || toIndex < 0) return;

        const start = Math.min(fromIndex, toIndex);
        const end = Math.max(fromIndex, toIndex);

        this.selectedPaths_.clear();
        for (let i = start; i <= end; i++) {
            this.selectedPaths_.add(this.filteredItems_[i].path);
        }
    }

    private notifyStoreSelection(): void {
        if (this.selectedPaths_.size === 1) {
            const path = this.selectedPaths_.values().next().value!;
            const item = this.filteredItems_.find(i => i.path === path);
            if (item) {
                this.store_.selectAsset({
                    path: item.path,
                    type: item.type as AssetType,
                    name: item.name,
                });
            }
        }
    }

    private handleKeyboardNavigation(e: KeyboardEvent): void {
        if (!this.gridContainer_ || this.filteredItems_.length === 0) return;

        const isGrid = this.viewMode_ === 'grid';

        switch (e.key) {
            case 'ArrowRight':
            case 'ArrowLeft':
            case 'ArrowDown':
            case 'ArrowUp': {
                e.preventDefault();
                const currentIndex = this.lastSelectedPath_
                    ? this.filteredItems_.findIndex(i => i.path === this.lastSelectedPath_)
                    : -1;

                let cols = 1;
                if (isGrid) {
                    const containerWidth = this.gridContainer_.clientWidth - 24;
                    cols = Math.max(1, Math.floor(containerWidth / 80));
                }

                let nextIndex = currentIndex;
                if (e.key === 'ArrowRight') nextIndex = currentIndex + 1;
                else if (e.key === 'ArrowLeft') nextIndex = currentIndex - 1;
                else if (e.key === 'ArrowDown') nextIndex = currentIndex + cols;
                else if (e.key === 'ArrowUp') nextIndex = currentIndex - cols;

                if (nextIndex >= 0 && nextIndex < this.filteredItems_.length) {
                    this.selectedPaths_.clear();
                    this.selectedPaths_.add(this.filteredItems_[nextIndex].path);
                    this.lastSelectedPath_ = this.filteredItems_[nextIndex].path;
                    this.updateAssetSelection();
                    this.notifyStoreSelection();

                    const el = this.gridContainer_.children[nextIndex] as HTMLElement;
                    el?.scrollIntoView({ block: 'nearest' });
                }
                break;
            }
            case 'Enter': {
                e.preventDefault();
                if (this.selectedPaths_.size !== 1) return;
                const path = this.selectedPaths_.values().next().value!;
                const item = this.filteredItems_.find(i => i.path === path);
                if (!item) return;

                if (item.type === 'folder') {
                    this.selectFolder(item.path);
                    this.expandFolder(item.path);
                } else {
                    this.onAssetDoubleClick(item.path, item.type);
                }
                break;
            }
            case 'Delete':
            case 'Backspace': {
                e.preventDefault();
                if (this.selectedPaths_.size === 0) return;
                this.deleteSelectedAssets();
                break;
            }
            case 'F2': {
                e.preventDefault();
                if (this.selectedPaths_.size !== 1) return;
                const path = this.selectedPaths_.values().next().value!;
                const item = this.filteredItems_.find(i => i.path === path);
                if (item) {
                    this.renameAsset(item.path, item.type);
                }
                break;
            }
            case 'a': {
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    this.selectedPaths_.clear();
                    for (const item of this.filteredItems_) {
                        this.selectedPaths_.add(item.path);
                    }
                    this.updateAssetSelection();
                }
                break;
            }
        }
    }

    private async deleteSelectedAssets(): Promise<void> {
        const paths = Array.from(this.selectedPaths_);
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

                if (this.rootFolder_) {
                    const projectDir = this.rootFolder_.path;
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

        this.selectedPaths_.clear();
        this.lastSelectedPath_ = null;
        this.refresh();
    }

    private showMultiSelectContextMenu(e: MouseEvent): void {
        const count = this.selectedPaths_.size;
        const items: ContextMenuItem[] = [
            {
                label: `Delete ${count} items`,
                icon: icons.trash(14),
                onClick: () => this.deleteSelectedAssets(),
            },
        ];

        showContextMenu({ x: e.clientX, y: e.clientY, items });
    }

    private showAssetContextMenu(e: MouseEvent, path: string, type: AssetItem['type']): void {
        const fs = getNativeFS();
        const parentPath = getParentDir(path);
        const fileName = path.split('/').pop() ?? path;

        const items: ContextMenuItem[] = [
            {
                label: 'Show in Folder',
                icon: icons.folderOpen(14),
                onClick: () => {
                    fs?.openFolder(parentPath);
                },
            },
            {
                label: 'Copy Path',
                icon: icons.copy(14),
                onClick: () => {
                    navigator.clipboard.writeText(path);
                },
            },
            {
                label: 'Rename',
                icon: icons.pencil(14),
                onClick: () => this.renameAsset(path, type),
            },
            { separator: true, label: '' },
            {
                label: 'Delete',
                icon: icons.trash(14),
                onClick: () => this.deleteAsset(path, fileName),
            },
        ];

        const ctx: ContextMenuContext = { location: 'content-browser.asset', assetPath: path, assetType: type };
        const extensionItems = getContextMenuItems('content-browser.asset', ctx);
        if (extensionItems.length > 0) {
            items.push({ label: '', separator: true }, ...extensionItems);
        }

        showContextMenu({ x: e.clientX, y: e.clientY, items });
    }

    private async deleteAsset(path: string, name: string): Promise<void> {
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

            if (this.rootFolder_) {
                const projectDir = this.rootFolder_.path;
                const prefix = projectDir.endsWith('/') ? projectDir : projectDir + '/';
                if (path.startsWith(prefix)) {
                    getAssetLibrary().unregister(path.substring(prefix.length));
                }
            }

            this.refresh();
        } catch (err) {
            console.error('Failed to delete asset:', err);
            showErrorToast('Failed to delete asset', String(err));
        }
    }

    private async renameAsset(path: string, type: AssetItem['type']): Promise<void> {
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

            if (this.rootFolder_) {
                const projectDir = this.rootFolder_.path;
                const prefix = projectDir.endsWith('/') ? projectDir : projectDir + '/';
                if (path.startsWith(prefix)) {
                    getAssetLibrary().updatePath(
                        path.substring(prefix.length),
                        newPath.substring(prefix.length)
                    );
                }
            }

            this.refresh();
        } catch (err) {
            console.error('Failed to rename asset:', err);
            showErrorToast('Failed to rename asset', String(err));
        }
    }

    private showFolderContextMenu(e: MouseEvent, path: string): void {
        const fs = getNativeFS();

        const items: ContextMenuItem[] = [
            {
                label: 'Create',
                icon: icons.plus(14),
                children: [
                    {
                        label: 'Folder',
                        icon: icons.folder(14),
                        onClick: () => this.createNewFolder(path),
                    },
                    { label: '', separator: true },
                    {
                        label: 'Script',
                        icon: icons.code(14),
                        onClick: () => this.createNewScript(path),
                    },
                    {
                        label: 'Material',
                        icon: icons.settings(14),
                        onClick: () => this.createNewMaterial(path),
                    },
                    {
                        label: 'Shader',
                        icon: icons.code(14),
                        onClick: () => this.createNewShader(path),
                    },
                    {
                        label: 'BitmapFont',
                        icon: icons.type(14),
                        onClick: () => this.createNewBitmapFont(path),
                    },
                    {
                        label: 'Scene',
                        icon: icons.layers(14),
                        onClick: () => this.createNewScene(path),
                    },
                ],
            },
            { label: '', separator: true },
            {
                label: 'Show in Folder',
                icon: icons.folderOpen(14),
                onClick: () => {
                    fs?.openFolder(path);
                },
            },
            {
                label: 'Copy Path',
                icon: icons.copy(14),
                onClick: () => {
                    navigator.clipboard.writeText(path);
                },
            },
            { label: '', separator: true },
            {
                label: 'Refresh',
                icon: icons.refresh(14),
                onClick: () => {
                    this.refresh();
                },
            },
        ];

        const ctx: ContextMenuContext = { location: 'content-browser.folder', assetPath: path, assetType: 'folder' };
        const extensionItems = getContextMenuItems('content-browser.folder', ctx);
        if (extensionItems.length > 0) {
            items.push({ label: '', separator: true }, ...extensionItems);
        }

        showContextMenu({ x: e.clientX, y: e.clientY, items });
    }

    private async createNewFolder(parentPath: string): Promise<void> {
        const name = await this.promptFileName('New Folder', '', parentPath);
        if (!name) return;

        const platform = getPlatformAdapter();
        const folderPath = `${parentPath}/${name}`;

        try {
            await platform.mkdir(folderPath);
            this.refresh();
        } catch (err) {
            console.error('Failed to create folder:', err);
            showErrorToast('Failed to create folder', String(err));
        }
    }

    private async createNewScript(parentPath: string): Promise<void> {
        const name = await this.promptFileName('NewScript', '.ts', parentPath);
        if (!name) return;

        const platform = getPlatformAdapter();
        const filePath = `${parentPath}/${name}`;

        const className = this.toClassName(name);
        const content = `import { defineComponent } from 'esengine';

export const ${className} = defineComponent('${className}', {
    value: 0,
});
`;

        try {
            await platform.writeTextFile(filePath, content);
            this.refresh();
        } catch (err) {
            console.error('Failed to create script:', err);
            showErrorToast('Failed to create script', String(err));
        }
    }

    private async createNewMaterial(parentPath: string): Promise<void> {
        const name = await this.promptFileName('NewMaterial', '.esmaterial', parentPath);
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
            this.refresh();
        } catch (err) {
            console.error('Failed to create material:', err);
            showErrorToast('Failed to create material', String(err));
        }
    }

    private async createNewScene(parentPath: string): Promise<void> {
        const name = await this.promptFileName('NewScene', '.esscene', parentPath);
        if (!name) return;

        const platform = getPlatformAdapter();
        const filePath = `${parentPath}/${name}`;

        const w = getSettingsValue<number>('project.designWidth') || DEFAULT_DESIGN_WIDTH;
        const h = getSettingsValue<number>('project.designHeight') || DEFAULT_DESIGN_HEIGHT;
        const scene = createEmptyScene(name.replace('.esscene', ''), { width: w, height: h });
        const content = JSON.stringify(scene, null, 2);

        try {
            await platform.writeTextFile(filePath, content);
            this.refresh();
            if (this.onOpenScene_) {
                this.onOpenScene_(filePath);
            }
        } catch (err) {
            console.error('Failed to create scene:', err);
            showErrorToast('Failed to create scene', String(err));
        }
    }

    private async createNewShader(parentPath: string): Promise<void> {
        const name = await this.promptFileName('NewShader', '.esshader', parentPath);
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
            this.refresh();
        } catch (err) {
            console.error('Failed to create shader:', err);
            showErrorToast('Failed to create shader', String(err));
        }
    }

    private async createNewBitmapFont(parentPath: string): Promise<void> {
        const name = await this.promptFileName('NewFont', '.bmfont', parentPath);
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
            this.refresh();
        } catch (err) {
            console.error('Failed to create bitmap font:', err);
            showErrorToast('Failed to create bitmap font', String(err));
        }
    }

    private async promptFileName(defaultName: string, extension: string = '', parentPath?: string): Promise<string | null> {
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

    private toClassName(filename: string): string {
        const name = filename.replace(/\.(ts|js)$/, '');
        return name.charAt(0).toUpperCase() + name.slice(1);
    }

    private selectAsset(path: string): void {
        this.selectedPaths_.clear();
        this.selectedPaths_.add(path);
        this.lastSelectedPath_ = path;
        this.updateAssetSelection();
        this.notifyStoreSelection();
    }

    private updateAssetSelection(): void {
        if (!this.gridContainer_) return;

        const selector = this.viewMode_ === 'list' ? '.es-cb-list-row' : '.es-asset-item';
        const items = this.gridContainer_.querySelectorAll(selector);
        items.forEach((item) => {
            const el = item as HTMLElement;
            if (this.selectedPaths_.has(el.dataset.path ?? '')) {
                el.classList.add('es-selected');
            } else {
                el.classList.remove('es-selected');
            }
        });
    }

    private onAssetDoubleClick(path: string, type: AssetItem['type']): void {
        if (type === 'scene' && this.onOpenScene_) {
            this.onOpenScene_(path);
            return;
        }

        if (type === 'prefab') {
            const resolver = getGlobalPathResolver();
            const relativePath = resolver.toRelativePath(path);
            this.store_.enterPrefabEditMode(relativePath);
            return;
        }

        const shell = getNativeShell();
        if (!shell) return;

        if (type === 'script') {
            const projectDir = this.rootFolder_?.path;
            if (projectDir) {
                shell.openInEditor(projectDir, path);
            }
        } else if (type === 'shader' || type === 'json') {
            shell.openFile(path);
        }
    }

    private async toggleFolder(path: string): Promise<void> {
        const folder = this.findFolder(this.rootFolder_, path);
        if (folder) {
            folder.expanded = !folder.expanded;

            if (folder.expanded && !folder.loaded) {
                await this.loadFolderChildren(folder);
            }

            this.renderTree();
        }
    }

    private async expandFolder(path: string): Promise<void> {
        const folder = this.findFolder(this.rootFolder_, path);
        if (folder) {
            folder.expanded = true;

            if (!folder.loaded) {
                await this.loadFolderChildren(folder);
            }

            this.renderTree();
        }
    }

    private selectFolder(path: string): void {
        this.currentPath_ = path;
        this.selectedPaths_.clear();
        this.lastSelectedPath_ = null;
        this.renderTree();
        this.renderBreadcrumb();
        this.renderGrid();
    }

    private findFolder(node: FolderNode | null, path: string): FolderNode | null {
        if (!node) return null;
        if (node.path === path) return node;
        for (const child of node.children) {
            const found = this.findFolder(child, path);
            if (found) return found;
        }
        return null;
    }

    private render(): void {
        this.renderTree();
        this.renderBreadcrumb();
        this.renderGrid();
    }

    private renderTree(): void {
        if (!this.treeContainer_ || !this.rootFolder_) return;
        this.treeContainer_.innerHTML = this.renderFolderNode(this.rootFolder_, 0);
    }

    private renderBreadcrumb(): void {
        if (!this.breadcrumbContainer_ || !this.rootFolder_) return;

        const rootPath = this.rootFolder_.path;
        const currentPath = this.currentPath_;

        const crumbs: { name: string; path: string }[] = [];

        crumbs.push({ name: this.rootFolder_.name, path: rootPath });

        if (currentPath && currentPath !== rootPath && currentPath.startsWith(rootPath)) {
            const relativePath = currentPath.substring(rootPath.length).replace(/^\//, '');
            const parts = relativePath.split('/').filter(p => p);

            let accumulatedPath = rootPath;
            for (const part of parts) {
                accumulatedPath = joinPath(accumulatedPath, part);
                crumbs.push({ name: part, path: accumulatedPath });
            }
        }

        this.breadcrumbContainer_.innerHTML = crumbs
            .map((crumb, index) => {
                const isLast = index === crumbs.length - 1;
                const separator = isLast ? '' : `<span class="es-breadcrumb-separator">${icons.chevronRight(10)}</span>`;
                return `<span class="es-breadcrumb-item${isLast ? ' es-active' : ''}" data-path="${crumb.path}">${crumb.name}</span>${separator}`;
            })
            .join('');
    }

    private renderFolderNode(node: FolderNode, depth: number): string {
        const isSelected = node.path === this.currentPath_;
        const hasChildren = node.children.length > 0 || !node.loaded;
        const indent = depth * 16;

        let html = `
            <div class="es-folder-item ${isSelected ? 'es-selected' : ''}"
                 data-path="${node.path}"
                 style="padding-left: ${indent}px">
                ${hasChildren ? `<span class="es-folder-expand">${node.expanded ? icons.chevronDown(10) : icons.chevronRight(10)}</span>` : '<span class="es-folder-spacer"></span>'}
                <span class="es-folder-icon">${node.expanded ? icons.folderOpen(14) : icons.folder(14)}</span>
                <span class="es-folder-name">${node.name}</span>
            </div>
        `;

        if (node.expanded) {
            for (const child of node.children) {
                html += this.renderFolderNode(child, depth + 1);
            }
        }

        return html;
    }

    private async renderGrid(): Promise<void> {
        if (!this.gridContainer_) return;

        let items: AssetItem[];
        if (this.searchFilter_) {
            items = await this.searchRecursive(this.currentPath_, this.searchFilter_);
        } else {
            items = await this.loadCurrentFolderItems();
        }
        this.currentItems_ = items;

        let filteredItems = items;
        if (this.searchFilter_) {
            filteredItems = items.slice(0, SEARCH_RESULTS_LIMIT);
        }
        this.filteredItems_ = filteredItems;

        if (filteredItems.length === 0) {
            this.gridContainer_.innerHTML = this.renderEmptyState();
            this.gridContainer_.classList.remove('es-cb-list-view');
            if (this.footerContainer_) {
                this.footerContainer_.textContent = '0 items';
            }
            return;
        }

        const isDraggable = (type: AssetItem['type']) => type !== 'folder';

        if (this.viewMode_ === 'list') {
            this.gridContainer_.classList.add('es-cb-list-view');
            this.gridContainer_.innerHTML = filteredItems
                .map((item) => {
                    const iconHtml = this.getItemIconHtml(item, 24);
                    const subtext = item.relativePath
                        ? `<span class="es-cb-list-subpath">${item.relativePath}</span>`
                        : '';
                    return `
                    <div class="es-cb-list-row${this.selectedPaths_.has(item.path) ? ' es-selected' : ''}"
                         data-path="${item.path}"
                         data-type="${item.type}"
                         ${isDraggable(item.type) ? 'draggable="true"' : ''}>
                        <span class="es-cb-list-icon">${iconHtml}</span>
                        <span class="es-cb-list-name">${item.name}${subtext}</span>
                        <span class="es-cb-list-type">${item.type}</span>
                    </div>`;
                })
                .join('');
        } else {
            this.gridContainer_.classList.remove('es-cb-list-view');
            this.gridContainer_.innerHTML = filteredItems
                .map((item) => {
                    const iconHtml = this.getItemIconHtml(item, 32);
                    const subtext = item.relativePath
                        ? `<div class="es-asset-subpath">${item.relativePath}</div>`
                        : '';
                    return `
                    <div class="es-asset-item${this.selectedPaths_.has(item.path) ? ' es-selected' : ''}"
                         data-path="${item.path}"
                         data-type="${item.type}"
                         ${isDraggable(item.type) ? 'draggable="true"' : ''}>
                        <div class="es-asset-icon">${iconHtml}</div>
                        <div class="es-asset-name">${item.name}</div>
                        ${subtext}
                    </div>`;
                })
                .join('');
        }

        for (const item of filteredItems) {
            if (item.type === 'image' && isImageFile(item.name)) {
                this.loadThumbnailFor(item.path);
            }
        }

        if (this.footerContainer_) {
            const suffix = this.searchFilter_ && items.length > SEARCH_RESULTS_LIMIT
                ? ` (showing ${SEARCH_RESULTS_LIMIT} of ${items.length})`
                : '';
            this.footerContainer_.textContent = `${filteredItems.length} items${suffix}`;
        }
    }

    private getItemIconHtml(item: AssetItem, size: number): string {
        if (item.type === 'image' && isImageFile(item.name)) {
            const cached = this.thumbnailCache_.get(item.path);
            if (cached) {
                return `<img src="${cached}" width="${size}" height="${size}" class="es-cb-thumbnail" alt="">`;
            }
            if (this.thumbnailCache_.isLoading(item.path)) {
                return `<span class="es-cb-thumb-loading">${getAssetIcon(item.type, size)}</span>`;
            }
        }
        return getAssetIcon(item.type, size);
    }

    private loadThumbnailFor(path: string): void {
        this.thumbnailCache_.load(path, () => {
            this.updateThumbnailInDom(path);
        });
    }

    private updateThumbnailInDom(path: string): void {
        if (!this.gridContainer_) return;
        const dataUrl = this.thumbnailCache_.get(path);
        if (!dataUrl) return;

        const selector = this.viewMode_ === 'list' ? '.es-cb-list-row' : '.es-asset-item';
        const items = this.gridContainer_.querySelectorAll(selector);
        for (const el of items) {
            const htmlEl = el as HTMLElement;
            if (htmlEl.dataset.path !== path) continue;

            const iconContainer = this.viewMode_ === 'list'
                ? htmlEl.querySelector('.es-cb-list-icon')
                : htmlEl.querySelector('.es-asset-icon');
            if (iconContainer) {
                const size = this.viewMode_ === 'list' ? 24 : 32;
                iconContainer.innerHTML = `<img src="${dataUrl}" width="${size}" height="${size}" class="es-cb-thumbnail" alt="">`;
            }
            break;
        }
    }

    private renderEmptyState(): string {
        if (this.searchFilter_) {
            return `<div class="es-cb-empty-state">
                <div class="es-cb-empty-icon">${icons.search(32)}</div>
                <div class="es-cb-empty-text">No matching assets found</div>
            </div>`;
        }
        return `<div class="es-cb-empty-state">
            <div class="es-cb-empty-icon">${icons.folder(32)}</div>
            <div class="es-cb-empty-text">This folder is empty</div>
        </div>`;
    }

    private async searchRecursive(basePath: string, filter: string): Promise<AssetItem[]> {
        const fs = getNativeFS();
        if (!fs || !basePath) return [];

        const results: AssetItem[] = [];
        const stack = [basePath];

        while (stack.length > 0 && results.length < SEARCH_RESULTS_LIMIT * 2) {
            const dir = stack.pop()!;
            try {
                const entries = await fs.listDirectoryDetailed(dir);
                for (const entry of entries) {
                    if (entry.name.startsWith('.') || entry.name.endsWith('.meta')) continue;

                    const entryPath = joinPath(dir, entry.name);

                    if (entry.isDirectory) {
                        stack.push(entryPath);
                        if (entry.name.toLowerCase().includes(filter)) {
                            const relative = entryPath.substring(basePath.length).replace(/^\//, '');
                            results.push({
                                name: entry.name,
                                path: entryPath,
                                type: 'folder',
                                relativePath: relative,
                            });
                        }
                    } else if (entry.name.toLowerCase().includes(filter)) {
                        const relative = entryPath.substring(basePath.length).replace(/^\//, '');
                        results.push({
                            name: entry.name,
                            path: entryPath,
                            type: getAssetType(entry),
                            relativePath: relative,
                        });
                    }
                }
            } catch {
                // skip inaccessible directories
            }
        }

        return results.sort((a, b) => {
            if (a.type === 'folder' && b.type !== 'folder') return -1;
            if (a.type !== 'folder' && b.type === 'folder') return 1;
            return a.name.localeCompare(b.name);
        });
    }

    private async loadCurrentFolderItems(): Promise<AssetItem[]> {
        const fs = getNativeFS();
        if (!fs || !this.currentPath_) {
            return this.getFallbackItems();
        }

        try {
            const entries = await fs.listDirectoryDetailed(this.currentPath_);

            return entries
                .filter(e => !e.name.startsWith('.') && !e.name.endsWith('.meta'))
                .sort((a, b) => {
                    if (a.isDirectory !== b.isDirectory) {
                        return a.isDirectory ? -1 : 1;
                    }
                    return a.name.localeCompare(b.name);
                })
                .map(e => ({
                    name: e.name,
                    path: joinPath(this.currentPath_, e.name),
                    type: getAssetType(e),
                }));
        } catch (err) {
            console.error('Failed to load folder items:', err);
            return this.getFallbackItems();
        }
    }

    private getFallbackItems(): AssetItem[] {
        const currentFolder = this.findFolder(this.rootFolder_, this.currentPath_);
        if (!currentFolder) return [];

        return currentFolder.children.map((child) => ({
            name: child.name,
            path: child.path,
            type: 'folder' as const,
        }));
    }

    private async importDroppedFiles(files: FileList): Promise<void> {
        const fs = getNativeFS();
        if (!fs || !this.currentPath_) return;

        for (const file of Array.from(files)) {
            const destPath = joinPath(this.currentPath_, file.name);
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

    private async saveDroppedEntityAsPrefab(entityId: number): Promise<void> {
        const entityData = this.store_.getEntityData(entityId);
        if (!entityData) return;

        const targetDir = this.currentPath_;
        if (!targetDir) return;

        if (this.rootFolder_) {
            const assetsDir = joinPath(this.rootFolder_.path, 'assets');
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

        const success = await this.store_.saveAsPrefab(entityId, filePath);
        if (success) {
            this.refresh();
        } else {
            showErrorToast('Failed to save prefab', filePath);
        }
    }
}
