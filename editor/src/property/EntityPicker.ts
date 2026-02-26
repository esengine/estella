import { getEditorInstance } from '../context/EditorContext';
import type { EntityData } from '../types/SceneTypes';

export interface EntityPickerOptions {
    anchorEl: HTMLElement;
    currentValue: number;
    onSelect: (entityId: number) => void;
    onClose: () => void;
}

interface FlatEntry {
    entity: EntityData;
    depth: number;
}

export function openEntityPicker(options: EntityPickerOptions): () => void {
    const { anchorEl, currentValue, onSelect, onClose } = options;

    const overlay = document.createElement('div');
    overlay.className = 'es-entity-picker-overlay';

    const popup = document.createElement('div');
    popup.className = 'es-entity-picker-popup';

    const searchInput = document.createElement('input');
    searchInput.className = 'es-entity-picker-search';
    searchInput.type = 'text';
    searchInput.placeholder = 'Search entities...';
    popup.appendChild(searchInput);

    const list = document.createElement('div');
    list.className = 'es-entity-picker-list';
    popup.appendChild(list);

    const flatEntries = buildFlatList();
    let filter = '';

    function buildFlatList(): FlatEntry[] {
        const editor = getEditorInstance();
        const entities = editor?.store.scene.entities;
        if (!entities) return [];

        const childMap = new Map<number | null, EntityData[]>();
        for (const e of entities) {
            const parent = e.parent;
            if (!childMap.has(parent)) childMap.set(parent, []);
            childMap.get(parent)!.push(e);
        }

        const result: FlatEntry[] = [];
        function walk(parentId: number | null, depth: number) {
            const children = childMap.get(parentId);
            if (!children) return;
            for (const child of children) {
                result.push({ entity: child, depth });
                walk(child.id, depth + 1);
            }
        }
        walk(null, 0);
        return result;
    }

    function renderList() {
        list.innerHTML = '';

        const noneRow = document.createElement('div');
        noneRow.className = 'es-entity-picker-item';
        if (currentValue === 0) noneRow.classList.add('es-selected');
        noneRow.textContent = '(None)';
        noneRow.addEventListener('click', () => {
            onSelect(0);
            close();
        });
        list.appendChild(noneRow);

        const lowerFilter = filter.toLowerCase();
        for (const entry of flatEntries) {
            const name = entry.entity.name;
            if (lowerFilter && !name.toLowerCase().includes(lowerFilter)) continue;

            const row = document.createElement('div');
            row.className = 'es-entity-picker-item';
            if (entry.entity.id === currentValue) row.classList.add('es-selected');
            row.style.paddingLeft = `${8 + entry.depth * 16}px`;

            if (lowerFilter) {
                const idx = name.toLowerCase().indexOf(lowerFilter);
                const before = name.slice(0, idx);
                const match = name.slice(idx, idx + lowerFilter.length);
                const after = name.slice(idx + lowerFilter.length);
                row.innerHTML = `${escapeHtml(before)}<mark>${escapeHtml(match)}</mark>${escapeHtml(after)}`;
            } else {
                row.textContent = name;
            }

            row.addEventListener('click', () => {
                onSelect(entry.entity.id);
                close();
            });
            list.appendChild(row);
        }
    }

    searchInput.addEventListener('input', () => {
        filter = searchInput.value;
        renderList();
    });

    renderList();
    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    positionPopup(popup, anchorEl);
    searchInput.focus();

    overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) {
            close();
        }
    });

    function onKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKeydown);

    function close() {
        document.removeEventListener('keydown', onKeydown);
        overlay.remove();
        onClose();
    }

    return close;
}

function positionPopup(popup: HTMLElement, anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    const popupHeight = 280;
    const popupWidth = 220;

    let top = rect.bottom + 4;
    let left = rect.left;

    if (top + popupHeight > window.innerHeight) {
        top = rect.top - popupHeight - 4;
    }
    if (left + popupWidth > window.innerWidth) {
        left = window.innerWidth - popupWidth - 8;
    }
    if (left < 0) left = 4;
    if (top < 0) top = 4;

    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
    popup.style.width = `${popupWidth}px`;
    popup.style.maxHeight = `${popupHeight}px`;
}

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
