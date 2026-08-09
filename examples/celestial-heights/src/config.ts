/**
 * Sorting layer indices — the order of `features.rendering.sortingLayers` in
 * project.esproject. `Actors` is the y-sorted one, which is what makes a 3/4
 * view read: who is nearer the camera is decided by world Y, not by spawn order.
 */
export const SortingLayer = {
    Ground: 0,
    GroundDetail: 1,
    Actors: 2,
    Overhead: 3,
    Vfx: 4,
} as const;

/** Collision filter bits — `features.physics.collisionLayers`, as masks. */
export const Collide = {
    World: 1 << 0,
    Player: 1 << 1,
    Enemy: 1 << 2,
} as const;

/** Half-extents of the walkable room, in world units. */
export const ROOM_HALF_W = 800;
export const ROOM_HALF_H = 450;

/**
 * A 3/4 view foreshortens depth, so a step "north" covers less ground than a
 * step "east". Vertical input is scaled by this so the two read as one speed.
 */
export const DEPTH_FORESHORTEN = 0.6;

/**
 * Inside this radius an attack ignores its own arc. Something standing on top
 * of you has no direction to be in front of: the offset is a couple of units of
 * noise, so a facing cone rejects or accepts it at random.
 */
export const POINT_BLANK = 40;
