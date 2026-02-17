import { icons } from '../../utils/icons';
import { joinPath } from '../../utils/path';
import type { FolderNode, ContentBrowserState } from './ContentBrowserTypes';
import { getNativeFS } from './ContentBrowserTypes';

export async function loadFolderChildren(folder: FolderNode): Promise<void> {
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

export async function toggleFolder(state: ContentBrowserState, path: string): Promise<void> {
    const folder = findFolder(state.rootFolder, path);
    if (folder) {
        folder.expanded = !folder.expanded;

        if (folder.expanded && !folder.loaded) {
            await loadFolderChildren(folder);
        }

        state.renderTree();
    }
}

export async function expandFolder(state: ContentBrowserState, path: string): Promise<void> {
    const folder = findFolder(state.rootFolder, path);
    if (folder) {
        folder.expanded = true;

        if (!folder.loaded) {
            await loadFolderChildren(folder);
        }

        state.renderTree();
    }
}

export function selectFolder(state: ContentBrowserState, path: string): void {
    state.currentPath = path;
    state.selectedPaths.clear();
    state.lastSelectedPath = null;
    state.renderTree();
    state.renderBreadcrumb();
    state.renderGrid();
}

export function findFolder(node: FolderNode | null, path: string): FolderNode | null {
    if (!node) return null;
    if (node.path === path) return node;
    for (const child of node.children) {
        const found = findFolder(child, path);
        if (found) return found;
    }
    return null;
}

export function collectExpandedPaths(node: FolderNode): string[] {
    const paths: string[] = [];
    if (node.expanded) {
        paths.push(node.path);
        for (const child of node.children) {
            paths.push(...collectExpandedPaths(child));
        }
    }
    return paths;
}

export function renderFolderNode(node: FolderNode, depth: number, currentPath: string): string {
    const isSelected = node.path === currentPath;
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
            html += renderFolderNode(child, depth + 1, currentPath);
        }
    }

    return html;
}
