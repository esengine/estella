import { defineBuiltin } from '../../component';

export interface GridLayoutData {
    direction: number;          // 0=Vertical, 1=Horizontal
    crossAxisCount: number;
    itemSize: { x: number; y: number };
    spacing: { x: number; y: number };
}

export const GridLayoutDirection = {
    Vertical: 0,
    Horizontal: 1,
} as const;

export const GridLayout = defineBuiltin<GridLayoutData>('GridLayout', {
    direction: GridLayoutDirection.Vertical,
    crossAxisCount: 3,
    itemSize: { x: 100, y: 100 },
    spacing: { x: 4, y: 4 },
});
