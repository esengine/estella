import { defineBuiltin } from '../component';
import type { Vec2 } from '../types';
import type { Padding } from '../wasm.generated';

export const FlexDirection = { Row: 0, Column: 1, RowReverse: 2, ColumnReverse: 3 } as const;
export type FlexDirection = (typeof FlexDirection)[keyof typeof FlexDirection];

export const FlexWrap = { NoWrap: 0, Wrap: 1 } as const;
export type FlexWrap = (typeof FlexWrap)[keyof typeof FlexWrap];

export const JustifyContent = { Start: 0, Center: 1, End: 2, SpaceBetween: 3, SpaceAround: 4, SpaceEvenly: 5 } as const;
export type JustifyContent = (typeof JustifyContent)[keyof typeof JustifyContent];

export const AlignItems = { Start: 0, Center: 1, End: 2, Stretch: 3 } as const;
export type AlignItems = (typeof AlignItems)[keyof typeof AlignItems];

export const AlignContent = { Start: 0, Center: 1, End: 2, Stretch: 3, SpaceBetween: 4, SpaceAround: 5 } as const;
export type AlignContent = (typeof AlignContent)[keyof typeof AlignContent];

export interface FlexContainerData {
    direction: FlexDirection;
    wrap: FlexWrap;
    justifyContent: JustifyContent;
    alignItems: AlignItems;
    alignContent: AlignContent;
    gap: Vec2;
    padding: Padding;
}

export const FlexContainer = defineBuiltin<FlexContainerData>('FlexContainer', {
    direction: FlexDirection.Row,
    wrap: FlexWrap.NoWrap,
    justifyContent: JustifyContent.Start,
    alignItems: AlignItems.Stretch,
    alignContent: AlignContent.Start,
    gap: { x: 0, y: 0 },
    padding: { left: 0, top: 0, right: 0, bottom: 0 },
});
