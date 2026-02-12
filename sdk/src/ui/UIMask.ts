import { defineComponent } from '../component';

export interface UIMaskData {
    enabled: boolean;
}

export const UIMask = defineComponent<UIMaskData>('UIMask', {
    enabled: true,
});
