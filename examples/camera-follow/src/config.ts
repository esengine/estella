/** Half-extents of the roamable world (world units). */
export const WORLD_HALF_W = 1600;
export const WORLD_HALF_H = 1000;

/** Spacing of the dim ground-dot grid that makes camera motion visible. */
export const GRID_STEP = 200;

export const PLAYER_SIZE = 48;

/** FollowTarget tuning for the gameplay camera (see the README table). */
export const FOLLOW = {
    deadzone: 48,
    damping: 0.25,
};

/** The overview camera's ortho half-height — wide enough to frame the world. */
export const OVERVIEW_ORTHO = 1050;

/** setViewTarget blend duration (seconds) for the 1/2 camera hand-offs. */
export const BLEND_TIME = 1.2;

/** shakeCamera options for the Space impact (see the README table). */
export const SHAKE = {
    amplitude: 16,
    rotation: 0.02,
    frequency: 24,
    duration: 0.5,
};

/** Landmark blocks scattered across the world so scrolling reads at a glance. */
export const LANDMARKS: Array<{
    x: number; y: number; w: number; h: number;
    color: { r: number; g: number; b: number; a: number };
}> = [
    { x: -1200, y: 700, w: 180, h: 180, color: { r: 0.95, g: 0.45, b: 0.35, a: 1 } },
    { x: 1250, y: 640, w: 140, h: 260, color: { r: 0.4, g: 0.75, b: 1, a: 1 } },
    { x: -600, y: -750, w: 240, h: 120, color: { r: 0.55, g: 0.9, b: 0.45, a: 1 } },
    { x: 900, y: -680, w: 160, h: 160, color: { r: 0.95, g: 0.8, b: 0.35, a: 1 } },
    { x: -1350, y: -200, w: 120, h: 300, color: { r: 0.8, g: 0.55, b: 1, a: 1 } },
    { x: 1400, y: -100, w: 120, h: 220, color: { r: 0.4, g: 0.95, b: 0.85, a: 1 } },
    { x: 300, y: 850, w: 200, h: 100, color: { r: 1, g: 0.6, b: 0.8, a: 1 } },
    { x: -300, y: 250, w: 100, h: 100, color: { r: 1, g: 0.75, b: 0.45, a: 1 } },
    { x: 550, y: -250, w: 130, h: 130, color: { r: 0.6, g: 0.7, b: 1, a: 1 } },
];
