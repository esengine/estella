import { defineComponent } from '../component';
import type { Color, Entity } from '../types';

export interface ToggleTransition {
    normalColor: Color;
    hoveredColor: Color;
    pressedColor: Color;
    disabledColor: Color;
}

export interface ToggleData {
    isOn: boolean;
    graphicEntity: Entity;
    transition: ToggleTransition | null;
    enabled: boolean;
}

export const Toggle = defineComponent<ToggleData>('Toggle', {
    isOn: true,
    graphicEntity: 0 as Entity,
    transition: null,
    enabled: true,
});
