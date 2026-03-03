import { defineComponent, defineTag } from 'esengine';

export const ProgressAnimator = defineComponent('ProgressAnimator', {
    speed: 0.3,
    direction: 1,
});

export const SliderLabel = defineTag('SliderLabel');
export const ToggleLabel = defineTag('ToggleLabel');
