import { defineComponent } from '../component';

export interface ToggleGroupData {
    allowSwitchOff: boolean;
}

export const ToggleGroup = defineComponent<ToggleGroupData>('ToggleGroup', {
    allowSwitchOff: false,
});
