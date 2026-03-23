import { defineBuiltin } from '../component';

export const MaskMode = {
    Scissor: 0,
    Stencil: 1,
    Alpha: 2,
} as const;
export type MaskMode = (typeof MaskMode)[keyof typeof MaskMode];

export interface UIMaskData {
    enabled: boolean;
    mode: MaskMode;
    maskTexture: number;
    inverted: boolean;
}

export const UIMask = defineBuiltin<UIMaskData>('UIMask', {
    enabled: true,
    mode: MaskMode.Scissor,
    maskTexture: 0,
    inverted: false,
});
