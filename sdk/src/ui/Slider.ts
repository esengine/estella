import { defineComponent } from '../component';
import type { Entity } from '../types';
import { FillDirection } from './uiTypes';

export { FillDirection } from './uiTypes';
export const SliderDirection = FillDirection;
export type SliderDirection = FillDirection;

export interface SliderData {
    value: number;
    minValue: number;
    maxValue: number;
    direction: FillDirection;
    fillEntity: Entity;
    handleEntity: Entity;
    wholeNumbers: boolean;
}

export const Slider = defineComponent<SliderData>('Slider', {
    value: 0,
    minValue: 0,
    maxValue: 1,
    direction: FillDirection.LeftToRight,
    fillEntity: 0 as Entity,
    handleEntity: 0 as Entity,
    wholeNumbers: false,
});
