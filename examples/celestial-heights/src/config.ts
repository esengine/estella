/** Half-extents of the walkable ground, in world units. */
export const WALK_HALF_W = 860;
export const WALK_HALF_H = 420;

/**
 * A 3/4 top-down view foreshortens depth, so a step "north" covers less ground
 * than a step "east". Vertical input is scaled by this to keep the two reading
 * as the same speed.
 */
export const DEPTH_FORESHORTEN = 0.6;
