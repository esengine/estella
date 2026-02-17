import type { Entity } from 'esengine';
import type { HierarchyState } from './HierarchyTypes';

export function setupKeyboard(state: HierarchyState, scrollToEntity: (id: number) => void): void {
    state.treeContainer.addEventListener('keydown', (e) => {
        if (state.renamingEntityId !== null) {
            return;
        }

        if (e.key === 'F2') {
            e.preventDefault();
            const selected = state.store.selectedEntity;
            if (selected !== null) {
                state.renamingEntityId = selected as number;
                state.renderVisibleRows();
            }
            return;
        }

        if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            const roots = state.store.scene.entities.filter(ent => ent.parent === null);
            if (roots.length > 0) {
                state.store.selectEntities(roots.map(ent => ent.id));
            }
            return;
        }

        if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            if (state.store.selectedEntities.size > 1) {
                state.store.deleteSelectedEntities();
            } else {
                const selected = state.store.selectedEntity;
                if (selected !== null) {
                    state.store.deleteEntity(selected);
                }
            }
            return;
        }

        const selected = state.store.selectedEntity;
        const selectedIndex = selected !== null
            ? state.flatRows.findIndex(r => r.entity.id === (selected as number))
            : -1;

        switch (e.key) {
            case 'ArrowDown': {
                e.preventDefault();
                const nextIndex = selectedIndex + 1;
                if (nextIndex < state.flatRows.length) {
                    const nextEntity = state.flatRows[nextIndex].entity;
                    state.store.selectEntity(nextEntity.id as Entity, 'replace');
                    state.lastSelectedEntity = nextEntity.id as Entity;
                    scrollToEntity(nextEntity.id);
                }
                break;
            }
            case 'ArrowUp': {
                e.preventDefault();
                const prevIndex = selectedIndex - 1;
                if (prevIndex >= 0) {
                    const prevEntity = state.flatRows[prevIndex].entity;
                    state.store.selectEntity(prevEntity.id as Entity, 'replace');
                    state.lastSelectedEntity = prevEntity.id as Entity;
                    scrollToEntity(prevEntity.id);
                }
                break;
            }
            case 'ArrowRight': {
                e.preventDefault();
                if (selectedIndex === -1) break;
                const row = state.flatRows[selectedIndex];
                if (row.hasChildren && !row.isExpanded) {
                    state.expandedIds.add(row.entity.id);
                    state.render();
                } else if (row.hasChildren && row.isExpanded) {
                    const nextIndex = selectedIndex + 1;
                    if (nextIndex < state.flatRows.length) {
                        const child = state.flatRows[nextIndex].entity;
                        state.store.selectEntity(child.id as Entity, 'replace');
                        state.lastSelectedEntity = child.id as Entity;
                        scrollToEntity(child.id);
                    }
                }
                break;
            }
            case 'ArrowLeft': {
                e.preventDefault();
                if (selectedIndex === -1) break;
                const row = state.flatRows[selectedIndex];
                if (row.hasChildren && row.isExpanded) {
                    state.expandedIds.delete(row.entity.id);
                    state.render();
                } else if (row.entity.parent !== null) {
                    const parentIdx = state.flatRows.findIndex(r => r.entity.id === row.entity.parent);
                    if (parentIdx !== -1) {
                        const parentEntity = state.flatRows[parentIdx].entity;
                        state.store.selectEntity(parentEntity.id as Entity, 'replace');
                        state.lastSelectedEntity = parentEntity.id as Entity;
                        scrollToEntity(parentEntity.id);
                    }
                }
                break;
            }
            case 'Home': {
                e.preventDefault();
                if (state.flatRows.length > 0) {
                    const first = state.flatRows[0].entity;
                    state.store.selectEntity(first.id as Entity, 'replace');
                    state.lastSelectedEntity = first.id as Entity;
                    scrollToEntity(first.id);
                }
                break;
            }
            case 'End': {
                e.preventDefault();
                if (state.flatRows.length > 0) {
                    const last = state.flatRows[state.flatRows.length - 1].entity;
                    state.store.selectEntity(last.id as Entity, 'replace');
                    state.lastSelectedEntity = last.id as Entity;
                    scrollToEntity(last.id);
                }
                break;
            }
        }
    });
}

export function selectRange(state: HierarchyState, fromEntity: number, toEntity: number): void {
    const fromIndex = state.flatRows.findIndex(r => r.entity.id === fromEntity);
    const toIndex = state.flatRows.findIndex(r => r.entity.id === toEntity);

    if (fromIndex === -1 || toIndex === -1) return;

    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);
    const ids = state.flatRows.slice(start, end + 1).map(r => r.entity.id);
    state.store.selectEntities(ids);
}
