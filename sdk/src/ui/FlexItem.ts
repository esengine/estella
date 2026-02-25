import { defineBuiltin } from '../component';

export interface FlexItemData {
    flexGrow: number;
    flexShrink: number;
    flexBasis: number;
    order: number;
}

export const FlexItem = defineBuiltin<FlexItemData>('FlexItem', {
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: -1,
    order: 0,
});
