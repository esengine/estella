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
};
