import { defineComponent } from '../component';

export interface BindingEntry {
    target: string;
    expression: string;
}

export interface DataBindingData {
    source: string;
    bindings: BindingEntry[];
}

export const DataBinding = defineComponent<DataBindingData>('DataBinding', {
    source: '',
    bindings: [],
});
