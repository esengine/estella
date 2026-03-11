import { Dialog } from '../dialog';
import { icons } from '../../utils/icons';
import type { AssetPickerOptions, AssetPickerResult } from './AssetPickerTypes';
import type { AssetItem, FolderNode, ViewMode } from '../../panels/content-browser/ContentBrowserTypes';
import { getNativeFS, getAssetType, getAssetIcon, isImageFile, getFileExtension, SEARCH_RESULTS_LIMIT } from '../../panels/content-browser/ContentBrowserTypes';
import { ThumbnailCache } from '../../panels/content-browser/ThumbnailCache';
import { loadFolderChildren, findFolder, renderFolderNode } from '../../panels/content-browser/FolderTree';
import { searchRecursive } from '../../panels/content-browser/AssetSearch';
import { renderItemsHtml } from '../../panels/content-browser/AssetGrid';
import { getGlobalPathResolver } from '../../asset';
import { getAssetDatabase } from '../../asset/AssetDatabase';
import { joinPath } from '../../utils/path';

const PICKER_WIDTH = 680;
const PICKER_HEIGHT = 480;
const SEARCH_DEBOUNCE_MS = 200;

export async function showAssetPicker(options: AssetPickerOptions & { multiSelect: true }): Promise<AssetPickerResult[] | null>;
export async function showAssetPicker(options?: AssetPickerOptions): Promise<AssetPickerResult | null>;
export async function showAssetPicker(options: AssetPickerOptions = {}): Promise<AssetPickerResult | AssetPickerResult[] | null> {
    const resolver = getGlobalPathResolver();
    const projectDir = resolver.getProjectDir();
    if (!projectDir) return null;

    const assetsPath = options.initialPath ?? joinPath(projectDir, 'assets');
    const thumbnailCache = new ThumbnailCache();
    const selectedPaths = new Set<string>();

    let currentPath = assetsPath;
    let viewMode: ViewMode = 'grid';
    let searchFilter = '';
    let searchTimer: ReturnType<typeof setTimeout> | null = null;
    let currentItems: AssetItem[] = [];

    const rootFolder: FolderNode = {
        name: 'assets',
        path: assetsPath,
        children: [],
        expanded: true,
        loaded: false,
    };
    await loadFolderChildren(rootFolder);

    const content = document.createElement('div');
    content.className = 'es-picker-content';
    content.style.height = `${PICKER_HEIGHT}px`;

    content.innerHTML = `
        <div class="es-picker-toolbar">
            <div class="es-picker-search-wrap">
                ${icons.search(14)}
                <input type="text" class="es-picker-search" placeholder="Search assets...">
            </div>
            <button class="es-picker-view-toggle" title="Toggle view">${icons.list(14)}</button>
        </div>
        <div class="es-picker-body">
            <div class="es-picker-tree"></div>
            <div class="es-picker-grid es-content-browser-grid"></div>
        </div>
        <div class="es-picker-footer">0 items</div>
    `;

    const treeEl = content.querySelector('.es-picker-tree') as HTMLElement;
    const gridEl = content.querySelector('.es-picker-grid') as HTMLElement;
    const footerEl = content.querySelector('.es-picker-footer') as HTMLElement;
    const searchInput = content.querySelector('.es-picker-search') as HTMLInputElement;
    const viewToggle = content.querySelector('.es-picker-view-toggle') as HTMLButtonElement;

    function filterByType(items: AssetItem[]): AssetItem[] {
        if (!options.allowedTypes?.length && !options.extensions?.length) return items;
        return items.filter(item => {
            if (item.type === 'folder') return true;
            if (options.allowedTypes?.length && options.allowedTypes.includes(item.type)) return true;
            if (options.extensions?.length) {
                const ext = getFileExtension(item.name).replace('.', '');
                return options.extensions.includes(ext);
            }
            return false;
        });
    }

    async function loadItems(): Promise<AssetItem[]> {
        if (searchFilter) {
            const results = await searchRecursive(assetsPath, searchFilter);
            return results.slice(0, SEARCH_RESULTS_LIMIT);
        }

        const fs = getNativeFS();
        if (!fs) return [];

        try {
            const entries = await fs.listDirectoryDetailed(currentPath);
            return entries
                .filter(e => !e.name.startsWith('.') && !e.name.endsWith('.meta'))
                .sort((a, b) => {
                    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
                    return a.name.localeCompare(b.name);
                })
                .map(e => ({
                    name: e.name,
                    path: joinPath(currentPath, e.name),
                    type: getAssetType(e),
                }));
        } catch {
            return [];
        }
    }

    function renderTree(): void {
        treeEl.innerHTML = renderFolderNode(rootFolder, 0, currentPath);
    }

    async function renderGrid(): Promise<void> {
        const items = await loadItems();
        currentItems = filterByType(items);

        if (currentItems.length === 0) {
            gridEl.classList.remove('es-cb-list-view');
            gridEl.innerHTML = `
                <div class="es-cb-empty-state">
                    <div class="es-cb-empty-icon">${searchFilter ? icons.search(32) : icons.folder(32)}</div>
                    <div class="es-cb-empty-text">${searchFilter ? 'No matching assets' : 'Empty folder'}</div>
                </div>`;
            footerEl.textContent = '0 items';
            return;
        }

        if (viewMode === 'list') {
            gridEl.classList.add('es-cb-list-view');
        } else {
            gridEl.classList.remove('es-cb-list-view');
        }

        gridEl.innerHTML = renderItemsHtml({
            items: currentItems,
            viewMode,
            selectedPaths,
            thumbnailCache,
            draggable: false,
        });

        for (const item of currentItems) {
            if (item.type === 'image' && isImageFile(item.name)) {
                thumbnailCache.load(item.path, () => updateThumbnail(item.path));
            }
        }

        footerEl.textContent = `${currentItems.length} items`;
    }

    function updateThumbnail(path: string): void {
        const dataUrl = thumbnailCache.get(path);
        if (!dataUrl) return;
        const selector = viewMode === 'list' ? '.es-cb-list-row' : '.es-asset-item';
        for (const el of gridEl.querySelectorAll(selector)) {
            const htmlEl = el as HTMLElement;
            if (htmlEl.dataset.path !== path) continue;
            const iconContainer = viewMode === 'list'
                ? htmlEl.querySelector('.es-cb-list-icon')
                : htmlEl.querySelector('.es-asset-icon');
            if (iconContainer) {
                const size = viewMode === 'list' ? 24 : 32;
                iconContainer.innerHTML = `<img src="${dataUrl}" width="${size}" height="${size}" class="es-cb-thumbnail" alt="">`;
            }
            break;
        }
    }

    function updateSelectButton(): void {
        dialog.setButtonEnabled(1, selectedPaths.size > 0);
    }

    function handleGridClick(e: MouseEvent): void {
        const target = e.target as HTMLElement;
        const row = target.closest('.es-asset-item, .es-cb-list-row') as HTMLElement | null;
        if (!row) return;

        const path = row.dataset.path;
        const type = row.dataset.type;
        if (!path) return;

        if (type === 'folder') {
            currentPath = path;
            selectedPaths.clear();
            const folder = findFolder(rootFolder, path);
            if (folder) {
                folder.expanded = true;
                if (!folder.loaded) {
                    loadFolderChildren(folder).then(() => { renderTree(); renderGrid(); });
                    return;
                }
            }
            renderTree();
            renderGrid();
            updateSelectButton();
            return;
        }

        if (options.multiSelect) {
            if (selectedPaths.has(path)) {
                selectedPaths.delete(path);
            } else {
                selectedPaths.add(path);
            }
        } else {
            selectedPaths.clear();
            selectedPaths.add(path);
        }

        for (const el of gridEl.querySelectorAll('.es-selected')) {
            el.classList.remove('es-selected');
        }
        for (const el of gridEl.querySelectorAll('.es-asset-item, .es-cb-list-row')) {
            const htmlEl = el as HTMLElement;
            if (selectedPaths.has(htmlEl.dataset.path ?? '')) {
                htmlEl.classList.add('es-selected');
            }
        }
        updateSelectButton();
    }

    function handleGridDblClick(e: MouseEvent): void {
        const target = e.target as HTMLElement;
        const row = target.closest('.es-asset-item, .es-cb-list-row') as HTMLElement | null;
        if (!row) return;
        const type = row.dataset.type;
        if (type === 'folder') return;
        if (selectedPaths.size > 0) {
            dialog.close({ action: 'confirm' });
        }
    }

    async function handleTreeClick(e: MouseEvent): Promise<void> {
        const target = e.target as HTMLElement;
        const folderItem = target.closest('.es-folder-item') as HTMLElement | null;
        if (!folderItem) return;

        const path = folderItem.dataset.path;
        if (!path) return;

        const expandEl = target.closest('.es-folder-expand');
        const folder = findFolder(rootFolder, path);

        if (expandEl && folder) {
            folder.expanded = !folder.expanded;
            if (folder.expanded && !folder.loaded) {
                await loadFolderChildren(folder);
            }
            renderTree();
        } else {
            currentPath = path;
            selectedPaths.clear();
            if (folder && !folder.loaded) {
                folder.expanded = true;
                await loadFolderChildren(folder);
            } else if (folder) {
                folder.expanded = true;
            }
            renderTree();
            renderGrid();
            updateSelectButton();
        }
    }

    gridEl.addEventListener('click', handleGridClick);
    gridEl.addEventListener('dblclick', handleGridDblClick);
    treeEl.addEventListener('click', (e) => handleTreeClick(e as MouseEvent));

    searchInput.addEventListener('input', () => {
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            searchFilter = searchInput.value.trim();
            selectedPaths.clear();
            renderGrid();
            updateSelectButton();
        }, SEARCH_DEBOUNCE_MS);
    });

    viewToggle.addEventListener('click', () => {
        viewMode = viewMode === 'grid' ? 'list' : 'grid';
        viewToggle.innerHTML = viewMode === 'grid' ? icons.list(14) : icons.grid(14);
        renderGrid();
    });

    function buildResults(): AssetPickerResult[] {
        const db = getAssetDatabase();
        const results: AssetPickerResult[] = [];
        for (const absPath of selectedPaths) {
            const relativePath = resolver.toRelativePath(absPath);
            const name = absPath.split('/').pop() ?? '';
            const uuid = db.getUuid(relativePath) ?? null;
            results.push({ relativePath, uuid, name });
        }
        return results;
    }

    const dialog = new Dialog({
        title: options.title ?? 'Select Asset',
        content,
        width: PICKER_WIDTH,
        closeOnOverlay: true,
        className: 'es-picker-dialog',
        buttons: [
            { label: 'Cancel', role: 'cancel' },
            { label: 'Select', role: 'confirm', primary: true, disabled: true },
        ],
    });

    renderTree();
    renderGrid();

    const result = await dialog.open();

    if (searchTimer) clearTimeout(searchTimer);

    if (result.action !== 'confirm') return null;

    const picked = buildResults();
    if (picked.length === 0) return null;

    return options.multiSelect ? picked : picked[0];
}
