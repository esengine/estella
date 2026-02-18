import { defineComponent } from '../component';
import type { Entity } from '../types';
import type { ColorTransition } from './uiTypes';

export type { ColorTransition } from './uiTypes';
export type ToggleTransition = ColorTransition;

export interface ToggleData {
    isOn: boolean;
    graphicEntity: Entity;
    group: Entity;
    transition: ColorTransition | null;
}

export const Toggle = defineComponent<ToggleData>('Toggle', {
    isOn: true,
    graphicEntity: 0 as Entity,
    group: 0 as Entity,
    transition: null,
});
