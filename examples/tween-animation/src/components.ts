import { defineComponent, defineTag } from 'esengine';

// One racing dot in the easing gallery. `index` selects its curve from
// EASINGS in config.ts (the scene assigns one index per row).
export const GalleryDot = defineComponent('GalleryDot', {
    index: 0,
});

// The hero that runs the looping sequence + parallel choreography.
export const Hero = defineTag('Hero');

// The comet that tweens to wherever you click.
export const Comet = defineTag('Comet');
