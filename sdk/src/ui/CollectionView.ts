import { defineComponent } from '../component';
import type { Entity } from '../types';

export const SelectionMode = {
    None: 0,
    Single: 1,
    Multiple: 2,
} as const;
export type SelectionMode = (typeof SelectionMode)[keyof typeof SelectionMode];

export interface CollectionViewData {
    itemCount: number;
    layout: string;
    virtualized: boolean;
    overscan: number;
    selectionMode: SelectionMode;
    selectedIndices: number[];
    itemPrefab: string;
}

export const CollectionView = defineComponent<CollectionViewData>('CollectionView', {
    itemCount: 0,
    layout: 'linear',
    virtualized: true,
    overscan: 2,
    selectionMode: SelectionMode.None,
    selectedIndices: [],
    itemPrefab: '',
});

export interface CollectionItemData {
    collectionEntity: Entity;
    dataIndex: number;
    selected: boolean;
}

export const CollectionItem = defineComponent<CollectionItemData>('CollectionItem', {
    collectionEntity: 0 as Entity,
    dataIndex: -1,
    selected: false,
}, { entityFields: ['collectionEntity'] });
