import type { Entity } from 'esengine';
import type { EntityData } from '../../types/SceneTypes';
import type { EditorStore } from '../../store/EditorStore';
import type { FuzzyMatch } from '../../utils/fuzzy';

export type DropPosition = 'before' | 'after' | 'inside';

export const ROW_HEIGHT = 22;
export const OVERSCAN = 5;
export const SLOW_DOUBLE_CLICK_MIN = 300;
export const SLOW_DOUBLE_CLICK_MAX = 800;

export interface FlattenedRow {
    entity: EntityData;
    depth: number;
    hasChildren: boolean;
    isExpanded: boolean;
}

export interface HierarchyState {
    store: EditorStore;
    treeContainer: HTMLElement;
    visibleWindow: HTMLElement;
    scrollContent: HTMLElement;
    searchInput: HTMLInputElement | null;
    expandedIds: Set<number>;
    flatRows: FlattenedRow[];
    searchFilter: string;
    searchResults: Array<{ entity: EntityData; match: FuzzyMatch }>;
    selectedResultIndex: number;
    lastSelectedEntity: Entity | null;
    dragOverEntityId: number | null;
    dropPosition: DropPosition | null;
    draggingEntityId: number | null;
    renamingEntityId: number | null;
    lastClickEntityId: number | null;
    lastClickTime: number;
    playMode: boolean;
    render(): void;
    renderVisibleRows(): void;
}
