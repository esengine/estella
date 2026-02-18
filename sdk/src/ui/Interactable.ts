import { defineComponent } from '../component';

export interface InteractableData {
    enabled: boolean;
    blockRaycast: boolean;
    raycastTarget: boolean;
}

export const Interactable = defineComponent<InteractableData>('Interactable', {
    enabled: true,
    blockRaycast: true,
    raycastTarget: true,
});
