import { defineComponent, defineTag } from 'esengine';

// Marks the single light that tracks the mouse cursor every frame.
export const Torch = defineTag('Torch');

// Attached when a placed light or obstacle is evicted (the FIFO cap is hit) or
// cleared with C. The fade system counts `remaining` down, dims the entity, then
// despawns it.
export const Fading = defineComponent('Fading', {
    remaining: 0.35,
});
