import type { RunState } from './save';

/**
 * Session state that is not a component: what a run condition asks about (which
 * by definition cannot take a `World`), and what has to survive a scene swap —
 * scene-owned entities do not.
 */
export const session = {
    paused: false,
    /** A loaded run waiting for its area to finish arriving. */
    restore: null as RunState | null,
    /** Area name → the enemies it was authored with. */
    enemiesByArea: {} as Record<string, string[]>,
    savedAt: 0,
    /** Item kind → how many Lyra is carrying. */
    inventory: {} as Record<string, number>,
    inventoryOpen: false,
    /** Settings: whether hit sparks and other flourishes are drawn. */
    effects: true,
    /** Seconds left of the fallen screen; > 0 means the run is over and waiting. */
    fallenFor: 0,
    /**
     * Lyra's health, carried between areas. Each area authors its own Lyra, so
     * without this a gate is a full heal — which is not a door, it is a rest
     * stop, and it flattens everything the areas were trying to build up.
     * `null` until the first area has been played.
     */
    vitality: null as number | null,
};

/** Whether the world is being held still — by the player, or by her death. */
export function frozen(): boolean {
    return session.paused || session.fallenFor > 0;
}
