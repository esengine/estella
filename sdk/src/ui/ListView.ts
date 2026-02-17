import { defineComponent } from '../component';
import type { Entity } from '../types';

export type ListViewItemRenderer = (index: number, entity: Entity) => void;

export interface ListViewData {
    itemHeight: number;
    itemCount: number;
    scrollY: number;
    overscan: number;
}

export const ListView = defineComponent<ListViewData>('ListView', {
    itemHeight: 40,
    itemCount: 0,
    scrollY: 0,
    overscan: 2,
});
