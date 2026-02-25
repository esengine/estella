import { defineBuiltin } from '../component';
import type { Vec2, Vec4 } from '../types';

export const FlexDirection = { Row: 0, Column: 1, RowReverse: 2, ColumnReverse: 3 } as const;
export type FlexDirection = (typeof FlexDirection)[keyof typeof FlexDirection];

export const FlexWrap = { NoWrap: 0, Wrap: 1 } as const;
export type FlexWrap = (typeof FlexWrap)[keyof typeof FlexWrap];

export const JustifyContent = { Start: 0, Center: 1, End: 2, SpaceBetween: 3, SpaceAround: 4, SpaceEvenly: 5 } as const;
export type JustifyContent = (typeof JustifyContent)[keyof typeof JustifyContent];

export const AlignItems = { Start: 0, Center: 1, End: 2, Stretch: 3 } as const;
export type AlignItems = (typeof AlignItems)[keyof typeof AlignItems];

export interface FlexContainerData {
    direction: FlexDirection;
    wrap: FlexWrap;
    justifyContent: JustifyContent;
    alignItems: AlignItems;
    gap: Vec2;
    padding: Vec4;
}

export const FlexContainer = defineBuiltin<FlexContainerData>('FlexContainer', {
    direction: FlexDirection.Row,
    wrap: FlexWrap.NoWrap,
    justifyContent: JustifyContent.Start,
    alignItems: AlignItems.Stretch,
    gap: { x: 0, y: 0 },
    padding: { x: 0, y: 0, z: 0, w: 0 },
});
