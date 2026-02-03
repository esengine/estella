/**
 * @file    ContentBrowserPanel.ts
 * @brief   Asset browser panel for managing project files
 */

import { icons } from '../utils/icons';

// =============================================================================
// Types
// =============================================================================

interface FolderNode {
    name: string;
    path: string;
    children: FolderNode[];
    expanded: boolean;
}

interface AssetItem {
    name: string;
    path: string;
    type: 'folder' | 'file';
}

// =============================================================================
// ContentBrowserPanel
// =============================================================================

export class ContentBrowserPanel {
    private container_: HTMLElement;
    private treeContainer_: HTMLElement | null = null;
    private gridContainer_: HTMLElement | null = null;
    private footerContainer_: HTMLElement | null = null;
    private searchInput_: HTMLInputElement | null = null;

    private rootFolder_: FolderNode;
    private currentPath_: string = 'assets';
    private searchFilter_: string = '';

    constructor(container: HTMLElement) {
        this.container_ = container;

        this.rootFolder_ = this.createMockFolderStructure();

        this.container_.classList.add('es-content-browser');
        this.container_.innerHTML = `
            <div class="es-content-browser-header">
                <span class="es-content-browser-title">${icons.folder(14)} Content Browser</span>
                <div class="es-content-browser-actions">
                    <button class="es-btn es-btn-icon" title="Minimize">${icons.chevronDown(12)}</button>
                    <button class="es-btn es-btn-icon" title="Close">${icons.x(12)}</button>
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
        this.render();
    }

    dispose(): void {
        // Cleanup
    }

    private createMockFolderStructure(): FolderNode {
        return {
            name: 'assets',
            path: 'assets',
            expanded: true,
            children: [
                { name: '.esengine', path: 'assets/.esengine', expanded: false, children: [] },
                { name: 'audio', path: 'assets/audio', expanded: false, children: [] },
                { name: 'fonts', path: 'assets/fonts', expanded: false, children: [] },
                { name: 'prefabs', path: 'assets/prefabs', expanded: false, children: [] },
                { name: 'scenes', path: 'assets/scenes', expanded: false, children: [] },
                { name: 'scripts', path: 'assets/scripts', expanded: false, children: [] },
                { name: 'shaders', path: 'assets/shaders', expanded: false, children: [] },
                { name: 'textures', path: 'assets/textures', expanded: false, children: [] },
            ],
        };
    }

    private setupEvents(): void {
        this.searchInput_?.addEventListener('input', () => {
            this.searchFilter_ = this.searchInput_?.value.toLowerCase() ?? '';
            this.renderGrid();
        });

        this.treeContainer_?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const item = target.closest('.es-folder-item') as HTMLElement;
            if (!item) return;

            const path = item.dataset.path;
            if (!path) return;

            if (target.closest('.es-folder-expand')) {
                this.toggleFolder(path);
            } else {
                this.selectFolder(path);
            }
        });

        this.gridContainer_?.addEventListener('dblclick', (e) => {
            const target = e.target as HTMLElement;
            const item = target.closest('.es-asset-item') as HTMLElement;
            if (!item) return;

            const path = item.dataset.path;
            const type = item.dataset.type;

            if (type === 'folder' && path) {
                this.selectFolder(path);
                this.expandFolder(path);
            }
        });
    }

    private toggleFolder(path: string): void {
        const folder = this.findFolder(this.rootFolder_, path);
        if (folder) {
            folder.expanded = !folder.expanded;
            this.renderTree();
        }
    }

    private expandFolder(path: string): void {
        const folder = this.findFolder(this.rootFolder_, path);
        if (folder) {
            folder.expanded = true;
            this.renderTree();
        }
    }

    private selectFolder(path: string): void {
        this.currentPath_ = path;
        this.renderTree();
        this.renderGrid();
    }

    private findFolder(node: FolderNode, path: string): FolderNode | null {
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
        if (!this.treeContainer_) return;
        this.treeContainer_.innerHTML = this.renderFolderNode(this.rootFolder_, 0);
    }

    private renderFolderNode(node: FolderNode, depth: number): string {
        const isSelected = node.path === this.currentPath_;
        const hasChildren = node.children.length > 0;
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

        if (node.expanded && hasChildren) {
            for (const child of node.children) {
                html += this.renderFolderNode(child, depth + 1);
            }
        }

        return html;
    }

    private renderGrid(): void {
        if (!this.gridContainer_) return;

        const currentFolder = this.findFolder(this.rootFolder_, this.currentPath_);
        if (!currentFolder) return;

        let items: AssetItem[] = currentFolder.children.map((child) => ({
            name: child.name,
            path: child.path,
            type: 'folder' as const,
        }));

        if (this.searchFilter_) {
            items = items.filter((item) =>
                item.name.toLowerCase().includes(this.searchFilter_)
            );
        }

        this.gridContainer_.innerHTML = items
            .map(
                (item) => `
                <div class="es-asset-item" data-path="${item.path}" data-type="${item.type}">
                    <div class="es-asset-icon">${icons.folder(32)}</div>
                    <div class="es-asset-name">${item.name}</div>
                </div>
            `
            )
            .join('');

        if (this.footerContainer_) {
            this.footerContainer_.textContent = `${items.length} items`;
        }
    }
}
