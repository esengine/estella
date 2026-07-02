import { defineComponent, defineTag } from 'esengine';

// An invisible sprite that holds the particle texture, so runtime-spawned
// emitters can read its resolved texture handle (Commands can't set a texture by
// asset path/uuid — only a numeric handle).
export const TexHolder = defineTag('TexHolder');

// The heading text that shows the current showcase's name.
export const TitleLabel = defineTag('TitleLabel');

// The two on-screen buttons that page through the showcases.
export const PrevButton = defineTag('PrevButton');
export const NextButton = defineTag('NextButton');

// Every emitter that belongs to the current showcase — despawned as a group when
// the showcase changes.
export const ShowcaseEmitter = defineTag('ShowcaseEmitter');

// A one-shot firework spawned by clicking empty space. `age` gates the
// getAliveCount despawn so it isn't removed before it has emitted.
export const Burst = defineComponent('Burst', {
    age: 0,
});
