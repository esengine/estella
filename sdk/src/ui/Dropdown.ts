import { defineComponent } from '../component';
import type { Entity } from '../types';

export interface DropdownData {
    options: string[];
    selectedIndex: number;
    isOpen: boolean;
    listEntity: Entity;
    labelEntity: Entity;
}

export const Dropdown = defineComponent<DropdownData>('Dropdown', {
    options: [],
    selectedIndex: -1,
    isOpen: false,
    listEntity: 0 as Entity,
    labelEntity: 0 as Entity,
});
