import { defineComponent } from '../component';

export interface InteractableData {
    enabled: boolean;
    blockRaycast: boolean;
}

export const Interactable = defineComponent<InteractableData>('Interactable', {
    enabled: true,
    blockRaycast: true,
});
