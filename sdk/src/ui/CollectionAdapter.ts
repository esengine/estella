import type { Entity } from '../types';
import type { World } from '../world';

export interface CollectionAdapter {
    makeItem(entity: Entity, world: World): void;
    bindItem(entity: Entity, index: number, world: World): void;
    unbindItem?(entity: Entity, index: number, world: World): void;
    getItemType?(index: number): string;
}

const adapterMap = new Map<Entity, CollectionAdapter>();

export function setCollectionAdapter(entity: Entity, adapter: CollectionAdapter): void {
    adapterMap.set(entity, adapter);
}

export function getCollectionAdapter(entity: Entity): CollectionAdapter | null {
    return adapterMap.get(entity) ?? null;
}

export function removeCollectionAdapter(entity: Entity): void {
    adapterMap.delete(entity);
}
