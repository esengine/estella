import type { Entity } from 'esengine';
import type { DropPosition, HierarchyState } from './HierarchyTypes';

export function setupDragAndDrop(
    state: HierarchyState,
    createEntityFromAsset: (asset: { type: string; path: string; name: string }, parent: Entity | null) => Promise<void>,
): void {
    state.treeContainer.addEventListener('dragstart', (e) => {
        if (state.playMode) { e.preventDefault(); return; }

        const target = e.target as HTMLElement;
        const row = target.closest('.es-hierarchy-row') as HTMLElement;
        const item = row?.parentElement as HTMLElement;
        if (!item?.classList.contains('es-hierarchy-item')) return;

        const entityId = item.dataset.entityId;
        if (!entityId) return;

        e.dataTransfer!.setData('application/esengine-entity', entityId);
        e.dataTransfer!.effectAllowed = 'move';
        state.draggingEntityId = parseInt(entityId, 10);
        item.classList.add('es-dragging');

        const onDragEnd = () => {
            row.removeEventListener('dragend', onDragEnd);
            state.draggingEntityId = null;
            state.dragOverEntityId = null;
            state.dropPosition = null;
            state.treeContainer.classList.remove('es-drag-over');
            state.renderVisibleRows();
        };
        row.addEventListener('dragend', onDragEnd);
    });

    state.treeContainer.addEventListener('dragover', (e) => {
        if (state.playMode) { e.preventDefault(); return; }

        const types = e.dataTransfer?.types ?? [];
        const hasAssetData = Array.from(types).includes('application/esengine-asset');
        const hasEntityData = Array.from(types).includes('application/esengine-entity');

        if (!hasAssetData && !hasEntityData) return;

        e.preventDefault();

        const target = e.target as HTMLElement;
        const item = target.closest('.es-hierarchy-item') as HTMLElement;
        const entityId = item ? parseInt(item.dataset.entityId ?? '', 10) : NaN;
        const newEntityId = isNaN(entityId) ? null : entityId;

        if (hasAssetData) {
            e.dataTransfer!.dropEffect = 'copy';
            if (newEntityId !== state.dragOverEntityId || state.dropPosition !== null) {
                state.dragOverEntityId = newEntityId;
                state.dropPosition = null;
                state.treeContainer.classList.toggle('es-drag-over', !item);
                state.renderVisibleRows();
            }
            return;
        }

        e.dataTransfer!.dropEffect = 'move';

        if (!item) {
            if (state.dragOverEntityId !== null) {
                state.dragOverEntityId = null;
                state.dropPosition = null;
                state.renderVisibleRows();
            }
            state.treeContainer.classList.add('es-drag-over');
            return;
        }

        state.treeContainer.classList.remove('es-drag-over');
        const position = getDropPosition(e, item);
        if (newEntityId !== state.dragOverEntityId || position !== state.dropPosition) {
            state.dragOverEntityId = newEntityId;
            state.dropPosition = position;
            state.renderVisibleRows();
        }
    });

    state.treeContainer.addEventListener('dragleave', (e) => {
        const relatedTarget = e.relatedTarget as HTMLElement;
        if (state.treeContainer.contains(relatedTarget)) return;
        state.dragOverEntityId = null;
        state.dropPosition = null;
        state.treeContainer.classList.remove('es-drag-over');
        state.renderVisibleRows();
    });

    state.treeContainer.addEventListener('drop', (e) => {
        if (state.playMode) { e.preventDefault(); return; }

        e.preventDefault();

        const assetDataStr = e.dataTransfer?.getData('application/esengine-asset');
        const entityIdStr = e.dataTransfer?.getData('application/esengine-entity');
        const target = e.target as HTMLElement;
        const dropItem = target.closest('.es-hierarchy-item') as HTMLElement;
        const dropTargetId = dropItem ? parseInt(dropItem.dataset.entityId ?? '', 10) : NaN;
        const dropPos = dropItem ? getDropPosition(e, dropItem) : null;

        state.dragOverEntityId = null;
        state.dropPosition = null;
        state.draggingEntityId = null;
        state.treeContainer.classList.remove('es-drag-over');

        if (assetDataStr) {
            let assetData: { type: string; path: string; name: string };
            try {
                assetData = JSON.parse(assetDataStr);
            } catch {
                return;
            }
            const parentEntity = !isNaN(dropTargetId) ? dropTargetId as Entity : null;
            createEntityFromAsset(assetData, parentEntity);
            return;
        }

        if (!entityIdStr) return;

        const draggedId = parseInt(entityIdStr, 10);
        if (isNaN(draggedId)) return;

        if (isNaN(dropTargetId)) {
            const scene = state.store.scene;
            const roots = scene.entities.filter(e => e.parent === null);
            state.store.moveEntity(draggedId as Entity, null, roots.length);
            return;
        }

        if (dropTargetId === draggedId || !dropPos) return;
        if (isDescendantOf(state, draggedId, dropTargetId)) return;

        const targetEntity = state.store.getEntityData(dropTargetId);
        if (!targetEntity) return;

        if (dropPos === 'inside') {
            state.store.moveEntity(draggedId as Entity, dropTargetId as Entity, targetEntity.children.length);
            state.expandedIds.add(dropTargetId);
        } else {
            const parentId = targetEntity.parent;
            if (parentId !== null) {
                const parent = state.store.getEntityData(parentId);
                if (!parent) return;
                let idx = parent.children.indexOf(dropTargetId);
                if (dropPos === 'after') idx++;
                const draggedIdx = parent.children.indexOf(draggedId);
                if (draggedIdx !== -1 && draggedIdx < idx) idx--;
                state.store.moveEntity(draggedId as Entity, parentId as Entity, idx);
            } else {
                const scene = state.store.scene;
                const roots = scene.entities.filter(en => en.parent === null);
                let idx = roots.findIndex(en => en.id === dropTargetId);
                if (dropPos === 'after') idx++;
                const draggedIdx = roots.findIndex(en => en.id === draggedId);
                if (draggedIdx !== -1 && draggedIdx < idx) idx--;
                state.store.moveEntity(draggedId as Entity, null, idx);
            }
        }
    });
}

function getDropPosition(e: DragEvent, item: HTMLElement): DropPosition {
    const row = item.querySelector('.es-hierarchy-row') as HTMLElement;
    const rect = row.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const ratio = y / rect.height;
    if (ratio < 0.25) return 'before';
    if (ratio > 0.75) return 'after';
    return 'inside';
}

function isDescendantOf(state: HierarchyState, entityId: number, ancestorId: number): boolean {
    let current: number | null = entityId;
    while (current !== null) {
        if (current === ancestorId) return true;
        const entity = state.store.getEntityData(current);
        current = entity?.parent ?? null;
    }
    return false;
}
