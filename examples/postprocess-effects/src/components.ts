import { defineComponent, defineTag } from 'esengine';

// Heading + one-line hint that name the current effect.
export const TitleLabel = defineTag('TitleLabel');
export const HintLabel = defineTag('HintLabel');

// The two on-screen buttons that page through the effects.
export const PrevButton = defineTag('PrevButton');
export const NextButton = defineTag('NextButton');

// The scene-wide (global) post-process volume the gallery drives.
export const SceneVolume = defineTag('SceneVolume');

// Anything spawned for the current showcase — despawned as a group on switch.
export const ShowcaseOwned = defineTag('ShowcaseOwned');

// Circular motion for the backdrop sprites.
export const Orbit = defineComponent('Orbit', { speed: 1, radius: 100, angle: 0 });

// Horizontal ping-pong, used by the local-volume demo to sweep a volume across
// the fixed camera so its effect fades in and out by proximity.
export const Sweep = defineComponent('Sweep', { range: 300, speed: 1, t: 0 });
