import { defineComponent } from '../component';

export const LayoutDirection = {
    Horizontal: 0,
    Vertical: 1,
} as const;

export type LayoutDirection = (typeof LayoutDirection)[keyof typeof LayoutDirection];

export const ChildAlignment = {
    Start: 0,
    Center: 1,
    End: 2,
} as const;

export type ChildAlignment = (typeof ChildAlignment)[keyof typeof ChildAlignment];

export interface LayoutGroupData {
    direction: number;
    spacing: number;
    padding: { left: number; top: number; right: number; bottom: number };
    childAlignment: number;
    reverseOrder: boolean;
}

export const LayoutGroup = defineComponent<LayoutGroupData>('LayoutGroup', {
    direction: LayoutDirection.Horizontal,
    spacing: 0,
    padding: { left: 0, top: 0, right: 0, bottom: 0 },
    childAlignment: ChildAlignment.Start,
    reverseOrder: false,
});
