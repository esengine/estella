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

/** What a pickup is, and how its tile reads in the pack. */
export const ITEM_KINDS = ['petal', 'shard', 'ember'] as const;
export type ItemKind = typeof ITEM_KINDS[number];

export const ITEM_COLOR: Record<string, { r: number; g: number; b: number; a: number }> = {
    petal: { r: 0.937, g: 0.588, b: 0.749, a: 1 },
    shard: { r: 0.545, g: 0.902, b: 0.918, a: 1 },
    ember: { r: 0.976, g: 0.706, b: 0.376, a: 1 },
};

/** How close Lyra has to be to pick something up, in world units. */
export const PICKUP_RADIUS = 70;
