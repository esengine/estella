import { defineComponent } from '../component';

export type MaskMode = 'scissor' | 'stencil';

export interface UIMaskData {
    enabled: boolean;
    mode: MaskMode;
}

export const UIMask = defineComponent<UIMaskData>('UIMask', {
    enabled: true,
    mode: 'scissor',
});
