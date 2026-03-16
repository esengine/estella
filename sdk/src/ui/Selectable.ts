import { defineBuiltin } from '../component';

export interface SelectableData {
    selected: boolean;
    group: number;
}

export const Selectable = defineBuiltin<SelectableData>('Selectable', {
    selected: false,
    group: 0,
});
