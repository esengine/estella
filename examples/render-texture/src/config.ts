/** Half-extents of the world the shapes roam (world units). The camera only
 *  shows ±640 × ±360 of it, so most shapes spend time offscreen — which is
 *  what makes the minimap worth having. */
export const WORLD_HALF_W = 1600;
export const WORLD_HALF_H = 1000;

/** Half-extents of what the static scene camera shows (orthoSize 360 at 16:9). */
export const VIEW_HALF_W = 640;
export const VIEW_HALF_H = 360;

/** Spacing/size of the dim ground-dot grid that gives the world some texture. */
export const GRID_STEP = 200;
export const GRID_DOT = 12;

/**
 * Minimap RenderTexture resolutions the R key cycles through (all 16:10, the
 * world's aspect ratio, so nothing stretches). The on-screen quad keeps the
 * same DISPLAY size, so switching resolution visibly changes fidelity: 96×60
 * is chunky pixels, 768×480 is crisp.
 */
export const MINIMAP_RESOLUTIONS = [
    { w: 96, h: 60 },
    { w: 192, h: 120 },
    { w: 384, h: 240 },
    { w: 768, h: 480 },
];
export const MINIMAP_START_RESOLUTION = 2;

/** On-screen size and placement of the minimap quad (world units; the camera
 *  is static at the origin so world units == design pixels here). */
export const MINIMAP_DISPLAY = { w: 320, h: 200 };
export const MINIMAP_MARGIN = 20;
export const MINIMAP_LAYER = 10;

/** World-space margin painted around the world border inside the minimap. */
export const MINIMAP_PAD = 80;

/** Blips are drawn at twice their true size on the map for legibility. */
export const BLIP_SCALE = 2;

/** The drifting shapes: orbit ellipse, angular speed (rad/s), start phase,
 *  sprite size, and color. Negative speed = counter-clockwise. */
export const SHAPES: Array<{
    rx: number; ry: number; speed: number; phase: number;
    size: number;
    color: { r: number; g: number; b: number; a: number };
}> = [
    { rx: 420, ry: 260, speed: 0.7, phase: 0.0, size: 64, color: { r: 0.95, g: 0.45, b: 0.35, a: 1 } },
    { rx: 700, ry: 430, speed: -0.45, phase: 1.3, size: 80, color: { r: 0.4, g: 0.75, b: 1, a: 1 } },
    { rx: 950, ry: 600, speed: 0.32, phase: 2.4, size: 56, color: { r: 0.55, g: 0.9, b: 0.45, a: 1 } },
    { rx: 1180, ry: 740, speed: -0.24, phase: 4.1, size: 72, color: { r: 0.95, g: 0.8, b: 0.35, a: 1 } },
    { rx: 1400, ry: 880, speed: 0.18, phase: 5.2, size: 90, color: { r: 0.8, g: 0.55, b: 1, a: 1 } },
    { rx: 560, ry: 820, speed: 0.55, phase: 3.0, size: 48, color: { r: 0.4, g: 0.95, b: 0.85, a: 1 } },
    { rx: 1250, ry: 350, speed: -0.6, phase: 0.8, size: 60, color: { r: 1, g: 0.6, b: 0.8, a: 1 } },
];
