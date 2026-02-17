import type { Entity } from 'esengine';
import { fuzzyFilter } from '../../utils/fuzzy';
import type { HierarchyState } from './HierarchyTypes';

export function performSearch(state: HierarchyState): void {
    if (!state.searchFilter) {
        state.searchResults = [];
        state.selectedResultIndex = -1;
        return;
    }

    const scene = state.store.scene;
    const results = fuzzyFilter(
        scene.entities,
        state.searchFilter,
        (entity) => entity.name
    );

    state.searchResults = results.map(r => ({ entity: r.item, match: r.match }));
    state.selectedResultIndex = state.searchResults.length > 0 ? 0 : -1;
}

export function selectNextResult(state: HierarchyState): void {
    if (state.searchResults.length === 0) return;
    state.selectedResultIndex = (state.selectedResultIndex + 1) % state.searchResults.length;
    state.render();
}

export function selectPreviousResult(state: HierarchyState): void {
    if (state.searchResults.length === 0) return;
    state.selectedResultIndex = (state.selectedResultIndex - 1 + state.searchResults.length) % state.searchResults.length;
    state.render();
}

export function focusSelectedResult(state: HierarchyState): void {
    if (state.selectedResultIndex === -1 || state.selectedResultIndex >= state.searchResults.length) return;
    const result = state.searchResults[state.selectedResultIndex];
    state.store.selectEntity(result.entity.id as Entity);
}

export function clearSearch(state: HierarchyState): void {
    if (state.searchInput) {
        state.searchInput.value = '';
    }
    state.searchFilter = '';
    state.searchResults = [];
    state.selectedResultIndex = -1;
    state.render();
}
