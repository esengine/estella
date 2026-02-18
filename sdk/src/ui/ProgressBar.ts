import { defineComponent } from '../component';
import type { Entity } from '../types';
import { FillDirection } from './uiTypes';

export { FillDirection } from './uiTypes';
export const ProgressBarDirection = FillDirection;
export type ProgressBarDirection = FillDirection;

export interface ProgressBarData {
    value: number;
    fillEntity: Entity;
    direction: FillDirection;
}

export const ProgressBar = defineComponent<ProgressBarData>('ProgressBar', {
    value: 0,
    fillEntity: 0 as Entity,
    direction: FillDirection.LeftToRight,
});
