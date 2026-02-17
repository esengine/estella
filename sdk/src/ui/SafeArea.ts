import { defineComponent } from '../component';

export interface SafeAreaData {
    applyTop: boolean;
    applyBottom: boolean;
    applyLeft: boolean;
    applyRight: boolean;
}

export const SafeArea = defineComponent<SafeAreaData>('SafeArea', {
    applyTop: true,
    applyBottom: true,
    applyLeft: true,
    applyRight: true,
});
