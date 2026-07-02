// Shared tuning for the lighting demo. Kept in one place so the placing system
// and the fade-out system agree on the numbers (a placed light's intensity is
// faded back down from exactly the value it was spawned with).

// Colors a left-click cycles through, one per placed light.
export const LIGHT_COLORS = [
    { r: 1.0, g: 0.35, b: 0.30, a: 1 }, // red
    { r: 0.35, g: 1.0, b: 0.45, a: 1 }, // green
    { r: 0.40, g: 0.55, b: 1.0, a: 1 }, // blue
    { r: 1.0, g: 0.90, b: 0.70, a: 1 }, // warm white
];

export const PLACED_LIGHT_INTENSITY = 1.15;
export const PLACED_LIGHT_RADIUS = 260;
export const PLACED_LIGHT_SOFTNESS = 10;

// Box occluder placed by a right-click (world units, centered on the cursor).
export const OBSTACLE_SIZE = { x: 84, y: 84 };

// The GPU packs at most 16 lights and 8 occluders per frame; the scene already
// spends a torch + ambient + two pillars, so we cap the interactive placements
// well under those limits and fade the oldest out when the cap is reached.
export const MAX_LIGHTS = 10;
export const MAX_OBSTACLES = 6;

// Seconds an evicted / cleared entity takes to fade its light and sprite to zero
// before it despawns.
export const FADE_DURATION = 0.35;
