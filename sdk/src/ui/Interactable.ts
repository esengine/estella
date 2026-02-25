import { defineBuiltin } from '../component';

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
