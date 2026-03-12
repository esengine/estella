import { defineBuiltin } from '../component';
import type { Padding } from '../wasm.generated';

export const AlignSelf = { Auto: 0, Start: 1, Center: 2, End: 3, Stretch: 4 } as const;
export type AlignSelf = (typeof AlignSelf)[keyof typeof AlignSelf];

export interface FlexItemData {
    flexGrow: number;
    flexShrink: number;
    flexBasis: number;
    order: number;
    alignSelf: AlignSelf;
    margin: Padding;
    minWidth: number;
    minHeight: number;
    maxWidth: number;
    maxHeight: number;
    widthPercent: number;
    heightPercent: number;
}

export const FlexItem = defineBuiltin<FlexItemData>('FlexItem', {
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: -1,
    order: 0,
    alignSelf: AlignSelf.Auto,
    margin: { left: 0, top: 0, right: 0, bottom: 0 },
    minWidth: -1,
    minHeight: -1,
    maxWidth: -1,
    maxHeight: -1,
    widthPercent: -1,
    heightPercent: -1,
});
