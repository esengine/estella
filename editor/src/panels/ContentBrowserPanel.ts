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
}

export interface ContentBrowserOptions {
    projectPath?: string;
    onOpenScene?: (scenePath: string) => void;
}

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

function getAssetType(entry: DirectoryEntry): AssetItem['type'] {
    if (entry.isDirectory) return 'folder';

    const ext = getFileExtension(entry.name);
    switch (ext) {
        case '.esprefab':
            return 'prefab';
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
        case '.esmaterial':
            return 'material';
        case '.esshader':
            return 'shader';
        case '.skel':
        case '.atlas':
            return 'spine';
        case '.bmfont':
            return 'font';
        default:
            return 'file';
    }
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
    private currentItems_: AssetItem[] = [];
    private onOpenScene_: ((scenePath: string) => void) | null = null;
    private selectedAssetPath_: string | null = null;

    constructor(container: HTMLElement, store: EditorStore, options?: ContentBrowserOptions) {
        this.container_ = container;
        this.store_ = store;
        this.projectPath_ = options?.projectPath ?? null;
        this.onOpenScene_ = options?.onOpenScene ?? null;

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
                        <div class="es-content-breadcrumb"></div>
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
        this.breadcrumbContainer_ = this.container_.querySelector('.es-content-breadcrumb');

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

        this.breadcrumbContainer_?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const item = target.closest('.es-breadcrumb-item') as HTMLElement;
            if (!item) return;

            const path = item.dataset.path;
            if (path) {
                this.selectFolder(path);
            }
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

        this.gridContainer_?.addEventListener('dragstart', (e) => {
            const target = e.target as HTMLElement;
            const item = target.closest('.es-asset-item') as HTMLElement;
            if (!item) return;

            const path = item.dataset.path;
            const type = item.dataset.type;
            if (!path || !type) return;

            const assetData = this.currentItems_.find(i => i.path === path);
            if (!assetData) return;

            e.dataTransfer?.setData('application/esengine-asset', JSON.stringify({
                type: type,
                path: path,
                name: assetData.name,
            }));
            e.dataTransfer!.effectAllowed = 'copy';

            item.classList.add('es-dragging');
        });

        this.gridContainer_?.addEventListener('dragend', (e) => {
            const target = e.target as HTMLElement;
            const item = target.closest('.es-asset-item') as HTMLElement;
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

        const w = getSettingsValue<number>('project.designWidth') || 1920;
        const h = getSettingsValue<number>('project.designHeight') || 1080;
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

        const items = await this.loadCurrentFolderItems();
        this.currentItems_ = items;

        let filteredItems = items;
        if (this.searchFilter_) {
            filteredItems = items.filter((item) =>
                item.name.toLowerCase().includes(this.searchFilter_)
            );
        }

        const isDraggable = (type: AssetItem['type']) => type !== 'folder';

        this.gridContainer_.innerHTML = filteredItems
            .map(
                (item) => `
                <div class="es-asset-item${item.path === this.selectedAssetPath_ ? ' es-selected' : ''}"
                     data-path="${item.path}"
                     data-type="${item.type}"
                     ${isDraggable(item.type) ? 'draggable="true"' : ''}>
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
