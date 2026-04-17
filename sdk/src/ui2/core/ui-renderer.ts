import { defineBuiltin } from '../../component';
import type { Color, Vec2, Vec4 } from '../../types';

export const UIVisualType = {
    None: 0,
    SolidColor: 1,
    Image: 2,
    NineSlice: 3,
} as const;

export type UIVisualType = (typeof UIVisualType)[keyof typeof UIVisualType];

export interface UIRendererData {
    visualType: UIVisualType;
    texture: number;
    color: Color;
    uvOffset: Vec2;
    uvScale: Vec2;
    sliceBorder: Vec4;
    material: number;
    enabled: boolean;
}

export const UIRenderer = defineBuiltin<UIRendererData>('UIRenderer', {
    visualType: UIVisualType.None,
    texture: 0,
    color: { r: 1, g: 1, b: 1, a: 1 },
    uvOffset: { x: 0, y: 0 },
    uvScale: { x: 1, y: 1 },
    sliceBorder: { x: 0, y: 0, z: 0, w: 0 },
    material: 0,
    enabled: true,
});
