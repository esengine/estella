import { SaveManager } from 'esengine';

/**
 * What a run is, written down. Deliberately the state a player would notice
 * losing — where they were, how hurt, what they had already killed — and not a
 * dump of the world, which would break the moment a scene is re-authored.
 */
export interface RunState {
    /** Packaged scene name, the id `SceneManager.switchTo` takes. */
    area: string;
    x: number;
    y: number;
    health: number;
    /** Names of enemies already killed in that area. */
    slain: string[];
    locale: string;
    /** Item kind → count. */
    pack: Record<string, number>;
}

export const SLOT = 'run';

export const saves = new SaveManager({ version: 1 });
