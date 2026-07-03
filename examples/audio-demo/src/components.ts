import { defineComponent, defineTag } from 'esengine';

// A drum pad. `index` selects its sample; `cooldown` debounces retriggers.
export const Pad = defineComponent('Pad', { index: 0, cooldown: 0 });

// The looping-beat toggle button, and its live On/Off label.
export const BeatToggle = defineTag('BeatToggle');
export const BeatLabel = defineTag('BeatLabel');

// A bus-volume button: clicking cycles `bus`'s volume. VolumeLabel is the live
// percentage readout for the same bus.
export const VolumeKnob = defineComponent('VolumeKnob', { bus: 'master', volume: 1 });
export const VolumeLabel = defineComponent('VolumeLabel', { bus: 'master' });

// A spectrum bar: reads analyser bin `index` each frame to set its height.
export const VisualizerBar = defineComponent('VisualizerBar', { index: 0 });
