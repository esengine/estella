import type { Color } from 'esengine';

// Panel + row geometry (a canvas-centred panel laid out as a flex column; each
// row places its label + widget slot by absolute insets).
export const PANEL_W = 460;
export const PANEL_H = 452;
export const PANEL_PAD = 24;
export const ROW_GAP = 16;
export const TITLE_H = 30;
export const ROW_H = 40;
export const LABEL_W = 132;
export const SLOT_W = 244;

// Slider track width in px (== world units at canvas scale 1). The drag system
// reuses this to map the pointer's world x back to a 0..100 value.
export const SLIDER_W = SLOT_W;
export const SLIDER_H = 18;
export const PROGRESS_H = 14;
export const CONTROL_H = 34;

// Progress bar auto-animation speed, in progress-fraction per second.
export const PROGRESS_SPEED = 0.5;

// Dropdown accent choices — selecting one re-tints the slider fill + progress
// fill, showing a dropdown driving live theme state.
export interface Accent {
    name: string;
    color: Color;
}

export const ACCENTS: Accent[] = [
    { name: 'Azure', color: { r: 0.25, g: 0.56, b: 0.96, a: 1 } },
    { name: 'Emerald', color: { r: 0.20, g: 0.78, b: 0.52, a: 1 } },
    { name: 'Amber', color: { r: 0.98, g: 0.72, b: 0.22, a: 1 } },
    { name: 'Rose', color: { r: 0.96, g: 0.36, b: 0.52, a: 1 } },
];
