import { defineComponent } from '../component';

export enum SliderDirection {
    LeftToRight,
    RightToLeft,
    BottomToTop,
    TopToBottom,
}

export interface SliderData {
    value: number;
    minValue: number;
    maxValue: number;
    direction: SliderDirection;
    fillEntity: number;
    handleEntity: number;
    wholeNumbers: boolean;
    enabled: boolean;
}

export const Slider = defineComponent<SliderData>('Slider', {
    value: 0,
    minValue: 0,
    maxValue: 1,
    direction: SliderDirection.LeftToRight,
    fillEntity: 0,
    handleEntity: 0,
    wholeNumbers: false,
    enabled: true,
});
