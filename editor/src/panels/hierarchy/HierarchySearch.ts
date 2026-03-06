import type { Entity } from 'esengine';
import { fuzzyFilter } from '../../utils/fuzzy';
import type { HierarchyState } from './HierarchyTypes';
import { getEntityTypeCategory } from './HierarchyTree';

const TYPE_ALIASES: Record<string, string> = {
    ui: 'ui',
    physics: 'physics',
    phy: 'physics',
    audio: 'audio',
    sfx: 'audio',
    particle: 'particle',
    spine: 'spine',
    camera: 'default',
    cam: 'default',
};

function parseSearchQuery(query: string): { typeFilter: string | null; nameQuery: string } {
    const match = query.match(/^t:(\w+)(?:\s+(.*))?$/);
    if (match) {
        const alias = match[1].toLowerCase();
        const category = TYPE_ALIASES[alias] ?? alias;
        return { typeFilter: category, nameQuery: match[2]?.trim() ?? '' };
    }
    return { typeFilter: null, nameQuery: query };
}

export function performSearch(state: HierarchyState): void {
    if (!state.searchFilter) {
        state.searchResults = [];
        state.selectedResultIndex = -1;
        return;
    }

    const entities = state.runtimeEntities ?? state.store.scene.entities;
    const { typeFilter, nameQuery } = parseSearchQuery(state.searchFilter);

    let filtered = entities;
    if (typeFilter) {
        filtered = entities.filter(e => {
            const cat = getEntityTypeCategory(e);
            if (typeFilter === 'default') {
                return e.components.some(c => c.type === 'Camera');
            }
            return cat === typeFilter;
        });
    }

    if (!nameQuery) {
        state.searchResults = filtered.map(e => ({ entity: e, match: { score: 0, matches: [] } }));
    } else {
        const results = fuzzyFilter(filtered, nameQuery, (entity) => entity.name);
        state.searchResults = results.map(r => ({ entity: r.item, match: r.match }));
    }

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
