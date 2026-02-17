import type { EditorStore, AssetType } from '../../store/EditorStore';
import { icons } from '../../utils/icons';
import { getParentDir, joinPath } from '../../utils/path';
import { getGlobalPathResolver } from '../../asset';
import type { ContentBrowserState, ContentBrowserOptions, FolderNode, AssetItem, ViewMode } from './ContentBrowserTypes';
import { getNativeFS, getNativeShell, VIEW_MODE_KEY, SEARCH_RESULTS_LIMIT } from './ContentBrowserTypes';
import { ThumbnailCache } from './ThumbnailCache';
import { loadFolderChildren, toggleFolder, expandFolder, selectFolder, findFolder, collectExpandedPaths, renderFolderNode } from './FolderTree';
import { renderGrid } from './AssetGrid';
import {
    showAssetContextMenu, showMultiSelectContextMenu, showFolderContextMenu,
    deleteSelectedAssets, renameAsset,
    importDroppedFiles, saveDroppedEntityAsPrefab,
} from './AssetContextMenu';

export class ContentBrowserPanel implements ContentBrowserState {
    container: HTMLElement;
    store: EditorStore;
    treeContainer: HTMLElement | null = null;
    gridContainer: HTMLElement | null = null;
    footerContainer: HTMLElement | null = null;
    searchInput: HTMLInputElement | null = null;
    breadcrumbContainer: HTMLElement | null = null;

    projectPath: string | null = null;
    rootFolder: FolderNode | null = null;
    currentPath: string = '';
    searchFilter: string = '';
    currentItems: AssetItem[] = [];
    filteredItems: AssetItem[] = [];
    onOpenScene: ((scenePath: string) => void) | null = null;
    selectedPaths = new Set<string>();
    lastSelectedPath: string | null = null;
    viewMode: ViewMode;

    private unwatchFn_: (() => void) | null = null;
    private refreshing_ = false;
    private refreshPending_ = false;
    private thumbnailCache_ = new ThumbnailCache();

    constructor(container: HTMLElement, store: EditorStore, options?: ContentBrowserOptions) {
        this.container = container;
        this.store = store;
        this.projectPath = options?.projectPath ?? null;
        this.onOpenScene = options?.onOpenScene ?? null;
        this.viewMode = (localStorage.getItem(VIEW_MODE_KEY) as ViewMode) || 'grid';

        if (this.projectPath) {
            this.currentPath = getParentDir(this.projectPath);
        }

        this.container.classList.add('es-content-browser');
        this.container.innerHTML = `
            <div class="es-content-browser-header">
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
                    <div class="es-content-browser-grid" tabindex="0" role="grid"></div>
                </div>
            </div>
            <div class="es-content-browser-footer">0 items</div>
        `;

        this.treeContainer = this.container.querySelector('.es-content-browser-tree');
        this.gridContainer = this.container.querySelector('.es-content-browser-grid');
        this.footerContainer = this.container.querySelector('.es-content-browser-footer');
        this.searchInput = this.container.querySelector('.es-content-search');
        this.breadcrumbContainer = this.container.querySelector('.es-content-breadcrumb');

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
        if (!this.rootFolder) return;

        const normalized = assetPath.replace(/\\/g, '/');
        const lastSlash = normalized.lastIndexOf('/');
        const folderPath = lastSlash > 0 ? normalized.substring(0, lastSlash) : this.rootFolder.path;

        const projectDir = this.rootFolder.path;
        const targetFolderPath = joinPath(projectDir, folderPath);

        const pathParts = folderPath.split('/').filter(p => p);
        let currentNode = this.rootFolder;

        for (const part of pathParts) {
            const childPath = joinPath(currentNode.path, part);
            let child = currentNode.children.find(c => c.path === childPath);

            if (!child) {
                if (!currentNode.loaded) {
                    await loadFolderChildren(currentNode);
                    child = currentNode.children.find(c => c.path === childPath);
                }
            }

            if (child) {
                child.expanded = true;
                if (!child.loaded) {
                    await loadFolderChildren(child);
                }
                currentNode = child;
            } else {
                break;
            }
        }

        this.currentPath = targetFolderPath;
        const fullAssetPath = joinPath(projectDir, normalized);
        this.selectedPaths.clear();
        this.selectedPaths.add(fullAssetPath);
        this.lastSelectedPath = fullAssetPath;

        this.renderTree();
        await this.renderGrid();

        requestAnimationFrame(() => {
            const selectedItem = this.gridContainer?.querySelector('.es-selected');
            selectedItem?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
    }

    render(): void {
        this.renderTree();
        this.renderBreadcrumb();
        this.renderGrid();
    }

    renderTree(): void {
        if (!this.treeContainer || !this.rootFolder) return;
        this.treeContainer.innerHTML = renderFolderNode(this.rootFolder, 0, this.currentPath);
    }

    renderBreadcrumb(): void {
        if (!this.breadcrumbContainer || !this.rootFolder) return;

        const rootPath = this.rootFolder.path;
        const crumbs: { name: string; path: string }[] = [];
        crumbs.push({ name: this.rootFolder.name, path: rootPath });

        if (this.currentPath && this.currentPath !== rootPath && this.currentPath.startsWith(rootPath)) {
            const relativePath = this.currentPath.substring(rootPath.length).replace(/^\//, '');
            const parts = relativePath.split('/').filter(p => p);

            let accumulatedPath = rootPath;
            for (const part of parts) {
                accumulatedPath = joinPath(accumulatedPath, part);
                crumbs.push({ name: part, path: accumulatedPath });
            }
        }

        this.breadcrumbContainer.innerHTML = crumbs
            .map((crumb, index) => {
                const isLast = index === crumbs.length - 1;
                const separator = isLast ? '' : `<span class="es-breadcrumb-separator">${icons.chevronRight(10)}</span>`;
                return `<span class="es-breadcrumb-item${isLast ? ' es-active' : ''}" data-path="${crumb.path}">${crumb.name}</span>${separator}`;
            })
            .join('');
    }

    async renderGrid(): Promise<void> {
        await renderGrid(this, this.thumbnailCache_);
    }

    async refresh(): Promise<void> {
        if (this.refreshing_) {
            this.refreshPending_ = true;
            return;
        }
        this.refreshing_ = true;
        try {
            if (this.rootFolder && this.projectPath) {
                this.rootFolder.loaded = false;
                await loadFolderChildren(this.rootFolder);

                const expandedPaths = collectExpandedPaths(this.rootFolder);
                for (const path of expandedPaths) {
                    const folder = findFolder(this.rootFolder, path);
                    if (folder && !folder.loaded) {
                        await loadFolderChildren(folder);
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

    private async initialize(): Promise<void> {
        if (this.projectPath) {
            await this.loadProjectDirectory();
            await this.setupFileWatcher();
        } else {
            this.rootFolder = this.createEmptyFolderStructure();
            this.render();
        }
    }

    private async loadProjectDirectory(): Promise<void> {
        const projectDir = getParentDir(this.projectPath!);
        this.currentPath = projectDir;

        this.rootFolder = {
            name: this.getProjectName(),
            path: projectDir,
            children: [],
            expanded: true,
            loaded: false,
        };

        await loadFolderChildren(this.rootFolder);
        this.render();
    }

    private getProjectName(): string {
        if (!this.projectPath) return 'Project';
        const normalized = this.projectPath.replace(/\\/g, '/');
        const parts = normalized.split('/');
        return parts[parts.length - 2] || 'Project';
    }

    private async setupFileWatcher(): Promise<void> {
        const fs = getNativeFS();
        if (!fs || !this.projectPath) return;

        const projectDir = getParentDir(this.projectPath);

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
        const btn = this.container.querySelector('.es-cb-view-toggle');
        if (!btn) return;
        btn.innerHTML = this.viewMode === 'grid' ? icons.layoutList(14) : icons.layoutGrid(14);
        btn.setAttribute('title', this.viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view');
    }

    private setupEvents(): void {
        this.searchInput?.addEventListener('input', () => {
            this.searchFilter = this.searchInput?.value.toLowerCase() ?? '';
            this.renderGrid();
        });

        this.breadcrumbContainer?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const item = target.closest('.es-breadcrumb-item') as HTMLElement;
            if (!item) return;
            const path = item.dataset.path;
            if (path) {
                selectFolder(this, path);
            }
        });

        const upBtn = this.container.querySelector('.es-cb-up-btn');
        upBtn?.addEventListener('click', () => {
            this.navigateToParent();
        });

        const viewToggle = this.container.querySelector('.es-cb-view-toggle');
        viewToggle?.addEventListener('click', () => {
            this.viewMode = this.viewMode === 'grid' ? 'list' : 'grid';
            localStorage.setItem(VIEW_MODE_KEY, this.viewMode);
            this.updateViewToggleButton();
            this.renderGrid();
        });

        this.treeContainer?.addEventListener('click', async (e) => {
            const target = e.target as HTMLElement;
            const item = target.closest('.es-folder-item') as HTMLElement;
            if (!item) return;
            const path = item.dataset.path;
            if (!path) return;

            if (target.closest('.es-folder-expand')) {
                await toggleFolder(this, path);
            } else {
                selectFolder(this, path);
            }
        });

        this.gridContainer?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const item = (target.closest('.es-asset-item') || target.closest('.es-cb-list-row')) as HTMLElement;

            if (!item) {
                this.selectedPaths.clear();
                this.lastSelectedPath = null;
                this.updateAssetSelection();
                return;
            }

            const path = item.dataset.path;
            if (!path) return;

            if (e.shiftKey && this.lastSelectedPath) {
                this.rangeSelect(this.lastSelectedPath, path);
            } else if (e.ctrlKey || e.metaKey) {
                if (this.selectedPaths.has(path)) {
                    this.selectedPaths.delete(path);
                } else {
                    this.selectedPaths.add(path);
                }
                this.lastSelectedPath = path;
            } else {
                this.selectedPaths.clear();
                this.selectedPaths.add(path);
                this.lastSelectedPath = path;
            }

            this.updateAssetSelection();
            this.notifyStoreSelection();
        });

        this.gridContainer?.addEventListener('dblclick', async (e) => {
            const target = e.target as HTMLElement;
            const item = (target.closest('.es-asset-item') || target.closest('.es-cb-list-row')) as HTMLElement;
            if (!item) return;

            const path = item.dataset.path;
            const type = item.dataset.type;

            if (type === 'folder' && path) {
                selectFolder(this, path);
                await expandFolder(this, path);
            } else if (path) {
                this.onAssetDoubleClick(path, type as AssetItem['type']);
            }
        });

        const refreshBtn = this.container.querySelector('.es-refresh-btn');
        refreshBtn?.addEventListener('click', () => {
            this.refresh();
        });

        this.gridContainer?.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const target = e.target as HTMLElement;
            const item = (target.closest('.es-asset-item') || target.closest('.es-cb-list-row')) as HTMLElement;

            if (item) {
                const path = item.dataset.path;
                const type = item.dataset.type;
                if (path) {
                    if (!this.selectedPaths.has(path)) {
                        this.selectedPaths.clear();
                        this.selectedPaths.add(path);
                        this.lastSelectedPath = path;
                        this.updateAssetSelection();
                    }

                    if (this.selectedPaths.size > 1) {
                        showMultiSelectContextMenu(this, e);
                    } else {
                        showAssetContextMenu(this, e, path, type as AssetItem['type']);
                    }
                }
            } else {
                showFolderContextMenu(this, e, this.currentPath);
            }
        });

        this.treeContainer?.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const target = e.target as HTMLElement;
            const item = target.closest('.es-folder-item') as HTMLElement;
            const path = item?.dataset.path ?? this.currentPath;
            if (path) {
                showFolderContextMenu(this, e, path);
            }
        });

        this.gridContainer?.addEventListener('dragstart', (e) => {
            const target = e.target as HTMLElement;
            const item = (target.closest('.es-asset-item') || target.closest('.es-cb-list-row')) as HTMLElement;
            if (!item) return;

            const path = item.dataset.path;
            const type = item.dataset.type;
            if (!path || !type) return;

            if (!this.selectedPaths.has(path)) {
                this.selectedPaths.clear();
                this.selectedPaths.add(path);
                this.lastSelectedPath = path;
                this.updateAssetSelection();
            }

            const dragItems = this.filteredItems.filter(i => this.selectedPaths.has(i.path));
            const payload = dragItems.map(i => ({ type: i.type, path: i.path, name: i.name }));

            e.dataTransfer?.setData('application/esengine-asset', JSON.stringify(
                payload.length === 1 ? payload[0] : payload
            ));
            e.dataTransfer!.effectAllowed = 'copy';

            item.classList.add('es-dragging');
        });

        this.gridContainer?.addEventListener('dragend', (e) => {
            const target = e.target as HTMLElement;
            const item = (target.closest('.es-asset-item') || target.closest('.es-cb-list-row')) as HTMLElement;
            item?.classList.remove('es-dragging');
        });

        this.gridContainer?.addEventListener('dragover', (e) => {
            const types = e.dataTransfer?.types ?? [];
            const typesArr = Array.from(types);
            if (!typesArr.includes('application/esengine-entity') && !typesArr.includes('Files')) return;
            e.preventDefault();
            e.dataTransfer!.dropEffect = 'copy';
            this.gridContainer?.classList.add('es-drag-over');
        });

        this.gridContainer?.addEventListener('dragleave', (e) => {
            const related = e.relatedTarget as HTMLElement;
            if (this.gridContainer?.contains(related)) return;
            this.gridContainer?.classList.remove('es-drag-over');
        });

        this.gridContainer?.addEventListener('drop', (e) => {
            this.gridContainer?.classList.remove('es-drag-over');

            if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
                e.preventDefault();
                importDroppedFiles(this, e.dataTransfer.files);
                return;
            }

            const entityIdStr = e.dataTransfer?.getData('application/esengine-entity');
            if (!entityIdStr) return;

            e.preventDefault();
            const entityId = parseInt(entityIdStr, 10);
            if (isNaN(entityId)) return;

            saveDroppedEntityAsPrefab(this, entityId);
        });

        this.gridContainer?.addEventListener('keydown', (e) => {
            this.handleKeyboardNavigation(e);
        });
    }

    private navigateToParent(): void {
        if (!this.rootFolder) return;
        if (this.currentPath === this.rootFolder.path) return;

        const parentPath = getParentDir(this.currentPath);
        if (parentPath) {
            selectFolder(this, parentPath);
        }
    }

    private rangeSelect(fromPath: string, toPath: string): void {
        const fromIndex = this.filteredItems.findIndex(i => i.path === fromPath);
        const toIndex = this.filteredItems.findIndex(i => i.path === toPath);
        if (fromIndex < 0 || toIndex < 0) return;

        const start = Math.min(fromIndex, toIndex);
        const end = Math.max(fromIndex, toIndex);

        this.selectedPaths.clear();
        for (let i = start; i <= end; i++) {
            this.selectedPaths.add(this.filteredItems[i].path);
        }
    }

    private notifyStoreSelection(): void {
        if (this.selectedPaths.size === 1) {
            const path = this.selectedPaths.values().next().value!;
            const item = this.filteredItems.find(i => i.path === path);
            if (item) {
                this.store.selectAsset({
                    path: item.path,
                    type: item.type as AssetType,
                    name: item.name,
                });
            }
        }
    }

    private handleKeyboardNavigation(e: KeyboardEvent): void {
        if (!this.gridContainer || this.filteredItems.length === 0) return;

        const isGrid = this.viewMode === 'grid';

        switch (e.key) {
            case 'ArrowRight':
            case 'ArrowLeft':
            case 'ArrowDown':
            case 'ArrowUp': {
                e.preventDefault();
                const currentIndex = this.lastSelectedPath
                    ? this.filteredItems.findIndex(i => i.path === this.lastSelectedPath)
                    : -1;

                let cols = 1;
                if (isGrid) {
                    const containerWidth = this.gridContainer.clientWidth - 24;
                    cols = Math.max(1, Math.floor(containerWidth / 80));
                }

                let nextIndex = currentIndex;
                if (e.key === 'ArrowRight') nextIndex = currentIndex + 1;
                else if (e.key === 'ArrowLeft') nextIndex = currentIndex - 1;
                else if (e.key === 'ArrowDown') nextIndex = currentIndex + cols;
                else if (e.key === 'ArrowUp') nextIndex = currentIndex - cols;

                if (nextIndex >= 0 && nextIndex < this.filteredItems.length) {
                    this.selectedPaths.clear();
                    this.selectedPaths.add(this.filteredItems[nextIndex].path);
                    this.lastSelectedPath = this.filteredItems[nextIndex].path;
                    this.updateAssetSelection();
                    this.notifyStoreSelection();

                    const el = this.gridContainer.children[nextIndex] as HTMLElement;
                    el?.scrollIntoView({ block: 'nearest' });
                }
                break;
            }
            case 'Enter': {
                e.preventDefault();
                if (this.selectedPaths.size !== 1) return;
                const path = this.selectedPaths.values().next().value!;
                const item = this.filteredItems.find(i => i.path === path);
                if (!item) return;

                if (item.type === 'folder') {
                    selectFolder(this, item.path);
                    expandFolder(this, item.path);
                } else {
                    this.onAssetDoubleClick(item.path, item.type);
                }
                break;
            }
            case 'Delete':
            case 'Backspace': {
                e.preventDefault();
                if (this.selectedPaths.size === 0) return;
                deleteSelectedAssets(this);
                break;
            }
            case 'F2': {
                e.preventDefault();
                if (this.selectedPaths.size !== 1) return;
                const path = this.selectedPaths.values().next().value!;
                const item = this.filteredItems.find(i => i.path === path);
                if (item) {
                    renameAsset(this, item.path, item.type);
                }
                break;
            }
            case 'a': {
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    this.selectedPaths.clear();
                    for (const item of this.filteredItems) {
                        this.selectedPaths.add(item.path);
                    }
                    this.updateAssetSelection();
                }
                break;
            }
        }
    }

    private updateAssetSelection(): void {
        if (!this.gridContainer) return;

        const selector = this.viewMode === 'list' ? '.es-cb-list-row' : '.es-asset-item';
        const items = this.gridContainer.querySelectorAll(selector);
        items.forEach((item) => {
            const el = item as HTMLElement;
            if (this.selectedPaths.has(el.dataset.path ?? '')) {
                el.classList.add('es-selected');
            } else {
                el.classList.remove('es-selected');
            }
        });
    }

    private onAssetDoubleClick(path: string, type: AssetItem['type']): void {
        if (type === 'scene' && this.onOpenScene) {
            this.onOpenScene(path);
            return;
        }

        if (type === 'prefab') {
            const resolver = getGlobalPathResolver();
            const relativePath = resolver.toRelativePath(path);
            this.store.enterPrefabEditMode(relativePath);
            return;
        }

        const shell = getNativeShell();
        if (!shell) return;

        if (type === 'script') {
            const projectDir = this.rootFolder?.path;
            if (projectDir) {
                shell.openInEditor(projectDir, path);
            }
        } else if (type === 'shader' || type === 'json') {
            shell.openFile(path);
        }
    }
}
