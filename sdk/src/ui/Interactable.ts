import { defineComponent } from '../component';

export interface InteractableData {
    enabled: boolean;
}

export const Interactable = defineComponent<InteractableData>('Interactable', {
    enabled: true,
});
