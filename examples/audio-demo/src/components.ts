import { defineComponent, defineTag } from 'esengine';

export const SFXTrigger = defineComponent('SFXTrigger', {
    cooldown: 0,
});

export const VolumeKnob = defineComponent('VolumeKnob', {
    volume: 1.0,
});

export const Visualizer = defineTag('Visualizer');
