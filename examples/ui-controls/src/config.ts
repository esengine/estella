import type { Color } from 'esengine';

// Widget sizes for the code-instantiated factories (px == world units at canvas
// scale 1); the panel + row geometry lives in the scene.
export const SLIDER_W = 244;
export const SLIDER_H = 18;
export const PROGRESS_H = 14;
export const CONTROL_H = 34;

// Progress bar auto-animation speed, in progress-fraction per second.
export const PROGRESS_SPEED = 0.5;

// Dropdown accent choices — selecting one re-tints the slider + progress fill.
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
