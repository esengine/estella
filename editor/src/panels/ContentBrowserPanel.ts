/**
 * @file    ContentBrowserPanel.ts
 * @brief   Asset browser panel for managing project files
 */

import type { EditorStore, AssetType } from '../store/EditorStore';
import { icons } from '../utils/icons';
import { showContextMenu } from '../ui/ContextMenu';

// =============================================================================
// Types
// =============================================================================

interface DirectoryEntry {
    name: string;
    isDirectory: boolean;
    isFile: boolean;
}

interface FileChangeEvent {
    type: 'create' | 'modify' | 'remove' | 'rename' | 'any';
    paths: string[];
}

interface NativeFS {
    listDirectoryDetailed(path: string): Promise<DirectoryEntry[]>;
    watchDirectory(
        path: string,
        callback: (event: FileChangeEvent) => void,
        options?: { recursive?: boolean }
    ): Promise<() => void>;
    openFolder(path: string): Promise<boolean>;
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
    type: 'folder' | 'scene' | 'script' | 'image' | 'audio' | 'json' | 'file';
}

export interface ContentBrowserOptions {
    projectPath?: string;
    onOpenScene?: (scenePath: string) => void;
}

// =============================================================================
// Helpers
// =============================================================================

function getNativeFS(): NativeFS | null {
    return (window as any).__esengine_fs ?? null;
}

function joinPath(...parts: string[]): string {
    return parts.join('/').replace(/\\/g, '/').replace(/\/+/g, '/');
}

function getParentPath(path: string): string {
    const normalized = path.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash > 0 ? normalized.substring(0, lastSlash) : normalized;
}

function getFileExtension(filename: string): string {
    const dotIndex = filename.lastIndexOf('.');
    return dotIndex > 0 ? filename.substring(dotIndex).toLowerCase() : '';
}

function getAssetType(entry: DirectoryEntry): AssetItem['type'] {
    if (entry.isDirectory) return 'folder';

    const ext = getFileExtension(entry.name);
    switch (ext) {
        case '.esscene':
            return 'scene';
        case '.ts':
        case '.js':
            return 'script';
        case '.png':
        case '.jpg':
        case '.jpeg':
        case '.gif':
        case '.webp':
        case '.bmp':
            return 'image';
        case '.mp3':
        case '.wav':
        case '.ogg':
        case '.flac':
            return 'audio';
        case '.json':
            return 'json';
        default:
            return 'file';
    }
}

function getAssetIcon(type: AssetItem['type'], size: number = 32): string {
    switch (type) {
        case 'folder':
            return icons.folder(size);
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
        default:
            return icons.file(size);
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

    private projectPath_: string | null = null;
    private rootFolder_: FolderNode | null = null;
    private currentPath_: string = '';
    private searchFilter_: string = '';
    private unwatchFn_: (() => void) | null = null;
    private currentItems_: AssetItem[] = [];
    private onOpenScene_: ((scenePath: string) => void) | null = null;
    private selectedAssetPath_: string | null = null;

    constructor(container: HTMLElement, store: EditorStore, options?: ContentBrowserOptions) {
        this.container_ = container;
        this.store_ = store;
        this.projectPath_ = options?.projectPath ?? null;
        this.onOpenScene_ = options?.onOpenScene ?? null;

        if (this.projectPath_) {
            this.currentPath_ = getParentPath(this.projectPath_);
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
                        <input type="text" class="es-input es-content-search" placeholder="Search assets...">
                    </div>
                    <div class="es-content-browser-grid"></div>
                </div>
            </div>
            <div class="es-content-browser-footer">0 items</div>
        `;

        this.treeContainer_ = this.container_.querySelector('.es-content-browser-tree');
        this.gridContainer_ = this.container_.querySelector('.es-content-browser-grid');
        this.footerContainer_ = this.container_.querySelector('.es-content-browser-footer');
        this.searchInput_ = this.container_.querySelector('.es-content-search');

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
        this.selectedAssetPath_ = fullAssetPath;

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
        const projectDir = getParentPath(this.projectPath_!);
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

        const projectDir = getParentPath(this.projectPath_);

        try {
            this.unwatchFn_ = await fs.watchDirectory(
                projectDir,
                (event) => {
                    console.log('File change:', event);
                    this.refresh();
                },
                { recursive: true }
            );
        } catch (err) {
            console.error('Failed to setup file watcher:', err);
        }
    }

    async refresh(): Promise<void> {
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

    private setupEvents(): void {
        this.searchInput_?.addEventListener('input', () => {
            this.searchFilter_ = this.searchInput_?.value.toLowerCase() ?? '';
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
            const item = target.closest('.es-asset-item') as HTMLElement;
            if (!item) return;

            const path = item.dataset.path;
            if (path) {
                this.selectAsset(path);
            }
        });

        this.gridContainer_?.addEventListener('dblclick', async (e) => {
            const target = e.target as HTMLElement;
            const item = target.closest('.es-asset-item') as HTMLElement;
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
            const item = target.closest('.es-asset-item') as HTMLElement;

            if (item) {
                const path = item.dataset.path;
                const type = item.dataset.type;
                if (path) {
                    this.showAssetContextMenu(e, path, type as AssetItem['type']);
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
    }

    private showAssetContextMenu(e: MouseEvent, path: string, type: AssetItem['type']): void {
        const fs = getNativeFS();
        const parentPath = getParentPath(path);

        showContextMenu({
            x: e.clientX,
            y: e.clientY,
            items: [
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
                { separator: true, label: '' },
                {
                    label: 'Delete',
                    icon: icons.trash(14),
                    disabled: true,
                },
            ],
        });
    }

    private showFolderContextMenu(e: MouseEvent, path: string): void {
        const fs = getNativeFS();

        showContextMenu({
            x: e.clientX,
            y: e.clientY,
            items: [
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
                { separator: true, label: '' },
                {
                    label: 'Refresh',
                    icon: icons.refresh(14),
                    onClick: () => {
                        this.refresh();
                    },
                },
            ],
        });
    }

    private selectAsset(path: string): void {
        this.selectedAssetPath_ = path;
        this.updateAssetSelection();

        const item = this.currentItems_.find(i => i.path === path);
        if (item) {
            this.store_.selectAsset({
                path: item.path,
                type: item.type as AssetType,
                name: item.name,
            });
        }
    }

    private updateAssetSelection(): void {
        if (!this.gridContainer_) return;

        const items = this.gridContainer_.querySelectorAll('.es-asset-item');
        items.forEach((item) => {
            const el = item as HTMLElement;
            if (el.dataset.path === this.selectedAssetPath_) {
                el.classList.add('es-selected');
            } else {
                el.classList.remove('es-selected');
            }
        });
    }

    private onAssetDoubleClick(path: string, type: AssetItem['type']): void {
        if (type === 'scene' && this.onOpenScene_) {
            this.onOpenScene_(path);
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
        this.renderTree();
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
        this.renderGrid();
    }

    private renderTree(): void {
        if (!this.treeContainer_ || !this.rootFolder_) return;
        this.treeContainer_.innerHTML = this.renderFolderNode(this.rootFolder_, 0);
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

        const items = await this.loadCurrentFolderItems();
        this.currentItems_ = items;

        let filteredItems = items;
        if (this.searchFilter_) {
            filteredItems = items.filter((item) =>
                item.name.toLowerCase().includes(this.searchFilter_)
            );
        }

        this.gridContainer_.innerHTML = filteredItems
            .map(
                (item) => `
                <div class="es-asset-item${item.path === this.selectedAssetPath_ ? ' es-selected' : ''}" data-path="${item.path}" data-type="${item.type}">
                    <div class="es-asset-icon">${getAssetIcon(item.type)}</div>
                    <div class="es-asset-name">${item.name}</div>
                </div>
            `
            )
            .join('');

        if (this.footerContainer_) {
            this.footerContainer_.textContent = `${filteredItems.length} items`;
        }
    }

    private async loadCurrentFolderItems(): Promise<AssetItem[]> {
        const fs = getNativeFS();
        if (!fs || !this.currentPath_) {
            return this.getFallbackItems();
        }

        try {
            const entries = await fs.listDirectoryDetailed(this.currentPath_);

            return entries
                .filter(e => !e.name.startsWith('.'))
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
}
