import type { Entity } from 'esengine';
import type { EntityData } from '../../types/SceneTypes';
import type { FuzzyMatch } from '../../utils/fuzzy';
import { icons } from '../../utils/icons';
import { escapeHtml } from '../../utils/html';
import type { FlattenedRow, HierarchyState } from './HierarchyTypes';
import { getPlayModeService } from '../../services/PlayModeService';

export function buildFlatRows(state: HierarchyState): FlattenedRow[] {
    const rows: FlattenedRow[] = [];
    const scene = state.store.scene;

    if (state.searchFilter) {
        for (const result of state.searchResults) {
            rows.push({
                entity: result.entity,
                depth: 0,
                hasChildren: false,
                isExpanded: false,
            });
        }
        return rows;
    }

    const roots = scene.entities.filter(e => e.parent === null);
    flattenDFS(state, roots, 0, rows);
    return rows;
}

function flattenDFS(state: HierarchyState, entities: EntityData[], depth: number, rows: FlattenedRow[]): void {
    for (const entity of entities) {
        const children = entity.children
            .map(id => state.store.getEntityData(id))
            .filter((e): e is EntityData => e !== null);
        const hasChildren = children.length > 0;
        const isExpanded = state.expandedIds.has(entity.id);

        rows.push({ entity, depth, hasChildren, isExpanded });

        if (hasChildren && isExpanded) {
            flattenDFS(state, children, depth + 1, rows);
        }
    }
}

export function expandAncestors(state: HierarchyState, entityId: Entity): void {
    const entity = state.store.getEntityData(entityId as number);
    if (!entity || entity.parent === null) return;

    let parentId: number | null = entity.parent;
    while (parentId !== null) {
        state.expandedIds.add(parentId);
        const parent = state.store.getEntityData(parentId);
        parentId = parent?.parent ?? null;
    }
}

const ENTITY_ICON_PRIORITY: Array<[string, (size: number) => string]> = [
    ['Camera', icons.camera],
    ['SpineAnimation', icons.bone],
    ['Text', icons.type],
    ['BitmapText', icons.type],
    ['TextInput', icons.type],
    ['Sprite', icons.image],
];

export function getEntityIcon(entity: EntityData): string {
    if (entity.prefab?.isRoot) return icons.package(12);

    let bestIdx = ENTITY_ICON_PRIORITY.length;
    for (const comp of entity.components) {
        const idx = ENTITY_ICON_PRIORITY.findIndex(([type]) => type === comp.type);
        if (idx !== -1 && idx < bestIdx) {
            bestIdx = idx;
            if (bestIdx === 0) break;
        }
    }

    return bestIdx < ENTITY_ICON_PRIORITY.length
        ? ENTITY_ICON_PRIORITY[bestIdx][1](12)
        : icons.box(12);
}

const ENTITY_TYPE_PRIORITY: Array<[string, string]> = [
    ['Camera', 'Camera'],
    ['SpineAnimation', 'Spine'],
];

export function getEntityType(entity: EntityData): string {
    for (const [compType, label] of ENTITY_TYPE_PRIORITY) {
        if (entity.components.some(c => c.type === compType)) return label;
    }
    return 'Entity';
}

export function renderSingleRow(state: HierarchyState, row: FlattenedRow, selectedEntity: Entity | null): string {
    const { entity, depth, hasChildren, isExpanded } = row;
    const icon = getEntityIcon(entity);
    const type = getEntityType(entity);
    const expandIcon = isExpanded ? icons.chevronDown(10) : icons.chevronRight(10);
    const inPlayMode = state.playMode;

    const isVisible = inPlayMode ? true : state.store.isEntityVisible(entity.id);
    const visibilityIcon = isVisible ? icons.eye(10) : icons.eyeOff(10);

    let itemClass = 'es-hierarchy-item';
    if (inPlayMode) {
        if (entity.id === getPlayModeService().selectedEntityId) itemClass += ' es-selected';
    } else {
        if (state.store.selectedEntities.has(entity.id)) itemClass += ' es-selected';
    }
    if (!isVisible) itemClass += ' es-entity-hidden';
    if (!inPlayMode) {
        if (entity.prefab?.isRoot) itemClass += ' es-prefab-root';
        else if (entity.prefab) itemClass += ' es-prefab-child';
    }
    if (hasChildren) itemClass += ' es-has-children';
    if (isExpanded) itemClass += ' es-expanded';
    if (!inPlayMode && entity.id === state.draggingEntityId) itemClass += ' es-dragging';
    if (!inPlayMode && entity.id === state.dragOverEntityId) {
        if (state.dropPosition) {
            itemClass += ` es-drop-${state.dropPosition}`;
        } else {
            itemClass += ' es-drag-over';
        }
    }

    const match = state.searchFilter ? state.searchResults.find(r => r.entity.id === entity.id)?.match : null;
    if (state.searchFilter && match) {
        const resultIdx = state.searchResults.findIndex(r => r.entity.id === entity.id);
        if (resultIdx === state.selectedResultIndex) {
            itemClass += ' es-search-selected';
        }
    }

    const nameHtml = renderEntityName(entity.name, match);
    const ariaExpanded = hasChildren ? ` aria-expanded="${isExpanded}"` : '';
    const draggable = inPlayMode ? 'false' : 'true';

    return `<div class="${itemClass}" data-entity-id="${entity.id}" role="treeitem"${ariaExpanded}>
            <div class="es-hierarchy-row" draggable="${draggable}" style="padding-left: ${8 + depth * 16}px">
                ${hasChildren ? `<span class="es-hierarchy-expand">${expandIcon}</span>` : '<span class="es-hierarchy-spacer"></span>'}
                ${inPlayMode ? '' : `<span class="es-hierarchy-visibility">${visibilityIcon}</span>`}
                <span class="es-hierarchy-icon">${icon}</span>
                <span class="es-hierarchy-name">${nameHtml}</span>
                <span class="es-hierarchy-type">${type}</span>
            </div>
        </div>`;
}

function renderEntityName(name: string, match: FuzzyMatch | null | undefined): string {
    if (!match || match.matches.length === 0) {
        return escapeHtml(name);
    }

    let html = '';
    for (let i = 0; i < name.length; i++) {
        if (match.matches.includes(i)) {
            html += `<mark class="es-search-highlight">${escapeHtml(name[i])}</mark>`;
        } else {
            html += escapeHtml(name[i]);
        }
    }
    return html;
}
