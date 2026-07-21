// Shared tuning for the sprite-animation showcase.

// Clips loaded from .esanim assets are registered under their project path.
export const CLIP_IDLE = 'assets/animations/idle.esanim';
export const CLIP_WALK = 'assets/animations/walk.esanim';
// The hop clip is registered from code at startup (see systems/setup.ts) —
// the second authoring path: a SpriteAnimClip built out of already-loaded frames.
// The state machine's own tuning (blend threshold, Idle↔Move hysteresis) lives
// in the authored controller, assets/animations/player.esanimator.
export const CLIP_HOP = 'hop';

// Movement (world px). `speed` is also the Animator's float parameter.
export const WALK_SPEED = 110;
export const RUN_SPEED = 210;
export const ACCEL = 900;
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
