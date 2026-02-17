import { icons } from '../../utils/icons';
import { joinPath } from '../../utils/path';
import type { AssetItem, ContentBrowserState } from './ContentBrowserTypes';
import { getNativeFS, getAssetType, getAssetIcon, isImageFile, SEARCH_RESULTS_LIMIT } from './ContentBrowserTypes';
import type { ThumbnailCache } from './ThumbnailCache';
import { searchRecursive } from './AssetSearch';
import { findFolder } from './FolderTree';

export async function renderGrid(state: ContentBrowserState, thumbnailCache: ThumbnailCache): Promise<void> {
    if (!state.gridContainer) return;

    let items: AssetItem[];
    if (state.searchFilter) {
        items = await searchRecursive(state.currentPath, state.searchFilter);
    } else {
        items = await loadCurrentFolderItems(state);
    }
    state.currentItems = items;

    let filteredItems = items;
    if (state.searchFilter) {
        filteredItems = items.slice(0, SEARCH_RESULTS_LIMIT);
    }
    state.filteredItems = filteredItems;

    if (filteredItems.length === 0) {
        state.gridContainer.innerHTML = renderEmptyState(state.searchFilter);
        state.gridContainer.classList.remove('es-cb-list-view');
        if (state.footerContainer) {
            state.footerContainer.textContent = '0 items';
        }
        return;
    }

    const isDraggable = (type: AssetItem['type']) => type !== 'folder';

    if (state.viewMode === 'list') {
        state.gridContainer.classList.add('es-cb-list-view');
        state.gridContainer.innerHTML = filteredItems
            .map((item) => {
                const iconHtml = getItemIconHtml(item, 24, thumbnailCache);
                const subtext = item.relativePath
                    ? `<span class="es-cb-list-subpath">${item.relativePath}</span>`
                    : '';
                return `
                    <div class="es-cb-list-row${state.selectedPaths.has(item.path) ? ' es-selected' : ''}"
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
        state.gridContainer.classList.remove('es-cb-list-view');
        state.gridContainer.innerHTML = filteredItems
            .map((item) => {
                const iconHtml = getItemIconHtml(item, 32, thumbnailCache);
                const subtext = item.relativePath
                    ? `<div class="es-asset-subpath">${item.relativePath}</div>`
                    : '';
                return `
                    <div class="es-asset-item${state.selectedPaths.has(item.path) ? ' es-selected' : ''}"
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
            loadThumbnailFor(state, item.path, thumbnailCache);
        }
    }

    if (state.footerContainer) {
        const suffix = state.searchFilter && items.length > SEARCH_RESULTS_LIMIT
            ? ` (showing ${SEARCH_RESULTS_LIMIT} of ${items.length})`
            : '';
        state.footerContainer.textContent = `${filteredItems.length} items${suffix}`;
    }
}

function getItemIconHtml(item: AssetItem, size: number, thumbnailCache: ThumbnailCache): string {
    if (item.type === 'image' && isImageFile(item.name)) {
        const cached = thumbnailCache.get(item.path);
        if (cached) {
            return `<img src="${cached}" width="${size}" height="${size}" class="es-cb-thumbnail" alt="">`;
        }
        if (thumbnailCache.isLoading(item.path)) {
            return `<span class="es-cb-thumb-loading">${getAssetIcon(item.type, size)}</span>`;
        }
    }
    return getAssetIcon(item.type, size);
}

function loadThumbnailFor(state: ContentBrowserState, path: string, thumbnailCache: ThumbnailCache): void {
    thumbnailCache.load(path, () => {
        updateThumbnailInDom(state, path, thumbnailCache);
    });
}

function updateThumbnailInDom(state: ContentBrowserState, path: string, thumbnailCache: ThumbnailCache): void {
    if (!state.gridContainer) return;
    const dataUrl = thumbnailCache.get(path);
    if (!dataUrl) return;

    const selector = state.viewMode === 'list' ? '.es-cb-list-row' : '.es-asset-item';
    const items = state.gridContainer.querySelectorAll(selector);
    for (const el of items) {
        const htmlEl = el as HTMLElement;
        if (htmlEl.dataset.path !== path) continue;

        const iconContainer = state.viewMode === 'list'
            ? htmlEl.querySelector('.es-cb-list-icon')
            : htmlEl.querySelector('.es-asset-icon');
        if (iconContainer) {
            const size = state.viewMode === 'list' ? 24 : 32;
            iconContainer.innerHTML = `<img src="${dataUrl}" width="${size}" height="${size}" class="es-cb-thumbnail" alt="">`;
        }
        break;
    }
}

function renderEmptyState(searchFilter: string): string {
    if (searchFilter) {
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

async function loadCurrentFolderItems(state: ContentBrowserState): Promise<AssetItem[]> {
    const fs = getNativeFS();
    if (!fs || !state.currentPath) {
        return getFallbackItems(state);
    }

    try {
        const entries = await fs.listDirectoryDetailed(state.currentPath);

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
                path: joinPath(state.currentPath, e.name),
                type: getAssetType(e),
            }));
    } catch (err) {
        console.error('Failed to load folder items:', err);
        return getFallbackItems(state);
    }
}

function getFallbackItems(state: ContentBrowserState): AssetItem[] {
    const currentFolder = findFolder(state.rootFolder, state.currentPath);
    if (!currentFolder) return [];

    return currentFolder.children.map((child) => ({
        name: child.name,
        path: child.path,
        type: 'folder' as const,
    }));
}
