import type { Entity } from '../types';
import type { World } from '../world';
import { CollectionView, CollectionItem, type CollectionViewData, type CollectionItemData } from './CollectionView';
import { getCollectionAdapter } from './CollectionAdapter';
import { getCollectionState } from './CollectionViewPlugin';

export function collectionGetItemEntity(world: World, collectionEntity: Entity, index: number): Entity | null {
    const state = getCollectionState(collectionEntity);
    if (state) return state.activeItems.get(index) ?? null;
    return null;
}

export function collectionRefreshItems(world: World, collectionEntity: Entity): void {
    const state = getCollectionState(collectionEntity);
    if (state) state.dirty = true;
}

export function collectionRefreshItem(world: World, collectionEntity: Entity, index: number): void {
    const itemEntity = collectionGetItemEntity(world, collectionEntity, index);
    if (!itemEntity) return;
    const adapter = getCollectionAdapter(collectionEntity);
    if (adapter) {
        adapter.bindItem(itemEntity, index, world);
    }
}

export function collectionInsertItems(world: World, collectionEntity: Entity, startIndex: number, count: number): void {
    const cv = world.get(collectionEntity, CollectionView) as CollectionViewData;
    cv.itemCount += count;
    cv.selectedIndices = cv.selectedIndices
        .map(i => i >= startIndex ? i + count : i);
    world.insert(collectionEntity, CollectionView, cv);
}

export function collectionRemoveItems(world: World, collectionEntity: Entity, startIndex: number, count: number): void {
    const cv = world.get(collectionEntity, CollectionView) as CollectionViewData;
    cv.itemCount = Math.max(0, cv.itemCount - count);
    cv.selectedIndices = cv.selectedIndices
        .filter(i => i < startIndex || i >= startIndex + count)
        .map(i => i >= startIndex + count ? i - count : i);
    world.insert(collectionEntity, CollectionView, cv);
}
