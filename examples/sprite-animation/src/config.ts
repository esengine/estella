// Shared tuning for the sprite-animation showcase.

// Clips loaded from .esanim assets are registered under their project path.
export const CLIP_IDLE = 'assets/animations/idle.esanim';
export const CLIP_WALK = 'assets/animations/walk.esanim';
// The hop clip is registered from code at startup (see systems/setup.ts) —
// the second authoring path: a SpriteAnimClip built out of already-loaded frames.
export const CLIP_HOP = 'hop';

// The controller name the scene's Animator component references.
export const CONTROLLER = 'alien';

// Movement (world px). `speed` is also the Animator's float parameter, so the
// blend threshold below is in the same unit.
export const WALK_SPEED = 110;
export const RUN_SPEED = 210;
export const ACCEL = 900;
/** Above this |speed| the Move blend selects the fast (run) row. */
export const RUN_BLEND_AT = 150;
/** Idle↔Move hysteresis thresholds on the `speed` parameter. */
export const MOVE_ENTER = 20;
export const MOVE_EXIT = 15;
/** How far the player may roam from the centre. */
export const RANGE_X = 180;

// Hop: a short arc in code while the Hop state plays its non-looping clip.
// Duration matches the clip's summed frame durations, so the arc lands exactly
// when the exit-time transition returns the state machine to Idle.
export const HOP_DURATION = 0.44;
export const HOP_HEIGHT = 46;

// Footstep dust (spawned by the walk clip's frame events).
export const PUFF_LIFE = 0.5;

/** Standing baseline: feet rest on the ground bar. */
export const BASE_Y = -27;
