import { defineComponent } from '../component';
import type { Entity } from '../types';

export enum ProgressBarDirection {
    LeftToRight = 0,
    RightToLeft = 1,
    BottomToTop = 2,
    TopToBottom = 3,
}

export interface ProgressBarData {
    value: number;
    fillEntity: Entity;
    direction: number;
}

export const ProgressBar = defineComponent<ProgressBarData>('ProgressBar', {
    value: 0,
    fillEntity: 0 as Entity,
    direction: ProgressBarDirection.LeftToRight,
});
