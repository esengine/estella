import { defineComponent, defineTag } from 'esengine';

// The project's declaration entry (src/components.ts): user component/tag
// definitions only — no systems. The editor extracts schemas from here so the
// inspector knows their fields without running project code.

/** Elliptical-orbit motion parameters for a drifting shape. */
export const Orbit = defineComponent('Orbit', {
    rx: 400,
    ry: 300,
    speed: 0.5,
    phase: 0,
});

/** Marks a shape the minimap plots (its Sprite provides color and size). */
export const Blip = defineTag('Blip');

/** Marks the corner quad whose Sprite.texture is the minimap RenderTexture. */
export const Minimap = defineTag('Minimap');
