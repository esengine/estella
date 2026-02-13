import { defineComponent } from '../component';

export interface UIInteractionData {
    hovered: boolean;
    pressed: boolean;
    justPressed: boolean;
    justReleased: boolean;
}

export const UIInteraction = defineComponent<UIInteractionData>('UIInteraction', {
    hovered: false,
    pressed: false,
    justPressed: false,
    justReleased: false,
});
