import { defineComponent } from '../component';
import type { Color } from '../types';
import { INVALID_TEXTURE } from '../types';

export const ImageType = {
    Simple: 0,
    Sliced: 1,
    Tiled: 2,
    Filled: 3,
} as const;

export type ImageType = (typeof ImageType)[keyof typeof ImageType];

export const FillMethod = {
    Horizontal: 0,
    Vertical: 1,
} as const;

export type FillMethod = (typeof FillMethod)[keyof typeof FillMethod];

export const FillOrigin = {
    Left: 0,
    Right: 1,
    Bottom: 2,
    Top: 3,
} as const;

export type FillOrigin = (typeof FillOrigin)[keyof typeof FillOrigin];

export interface ImageData {
    texture: number;
    color: Color;
    imageType: number;
    fillMethod: number;
    fillOrigin: number;
    fillAmount: number;
    preserveAspect: boolean;
    tileSize: { x: number; y: number };
    layer: number;
    material: number;
    enabled: boolean;
}

export const Image = defineComponent<ImageData>('Image', {
    texture: INVALID_TEXTURE,
    color: { r: 1, g: 1, b: 1, a: 1 },
    imageType: ImageType.Simple,
    fillMethod: FillMethod.Horizontal,
    fillOrigin: FillOrigin.Left,
    fillAmount: 1,
    preserveAspect: false,
    tileSize: { x: 32, y: 32 },
    layer: 0,
    material: 0,
    enabled: true,
});
