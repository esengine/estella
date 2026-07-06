import { defineComponent } from 'esengine';

/** Pulses the hit-flash material's u_flash from a sine wave. */
export const FlashPulse = defineComponent('FlashPulse', { speed: 6 });

/** Ping-pongs the dissolve material's u_progress between 0 and 1. */
export const DissolveLoop = defineComponent('DissolveLoop', { speed: 0.35 });
