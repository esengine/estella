import { defineComponent } from '../component';
import type { Color, Entity } from '../types';
import type { ColorTransition } from './uiTypes';

export type { ColorTransition } from './uiTypes';
export type ToggleTransition = ColorTransition;

export interface ToggleData {
    isOn: boolean;
    graphicEntity: Entity;
    group: Entity;
    transition: ColorTransition | null;
    onColor: Color;
    offColor: Color;
}

export const Toggle = defineComponent<ToggleData>('Toggle', {
    isOn: true,
    graphicEntity: 0 as Entity,
    group: 0 as Entity,
    transition: null,
    onColor: { r: 0.2, g: 0.6, b: 1, a: 1 },
    offColor: { r: 0.4, g: 0.4, b: 0.4, a: 1 },
}, { entityFields: ['graphicEntity', 'group'] });
