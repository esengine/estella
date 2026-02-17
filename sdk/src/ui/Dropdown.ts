import { defineComponent } from '../component';

export interface DropdownData {
    options: string[];
    selectedIndex: number;
    isOpen: boolean;
    listEntity: number;
    labelEntity: number;
}

export const Dropdown = defineComponent<DropdownData>('Dropdown', {
    options: [],
    selectedIndex: -1,
    isOpen: false,
    listEntity: 0,
    labelEntity: 0,
});
