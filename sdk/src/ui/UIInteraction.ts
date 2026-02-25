import { defineBuiltin } from '../component';

export interface UIInteractionData {
    hovered: boolean;
    pressed: boolean;
    justPressed: boolean;
    justReleased: boolean;
}

export const UIInteraction = defineBuiltin<UIInteractionData>('UIInteraction', {
    hovered: false,
    pressed: false,
    justPressed: false,
    justReleased: false,
});
