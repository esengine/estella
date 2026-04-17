import { defineBuiltin } from '../../component';

export interface InteractableData {
    enabled: boolean;
    blockRaycast: boolean;
    raycastTarget: boolean;
}

export const Interactable = defineBuiltin<InteractableData>('Interactable', {
    enabled: true,
    blockRaycast: true,
    raycastTarget: true,
});

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
