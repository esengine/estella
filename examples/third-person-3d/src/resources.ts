import { defineResource } from 'esengine';

/** Where the runner starts, and where a restart puts it back. */
export const SPAWN = { x: 0, y: 60, z: 120 };
/** Below this there is no floor left to land on. */
export const VOID_Y = -400;

export const MAX_HEALTH = 100;
export const CORES_NEEDED = 3;
/** What holding shift costs in control: it is speed, not a second gear. */
export const SPRINT_SPEED = 520;
export const WALK_SPEED = 320;

export type RunPhase = 'playing' | 'paused' | 'dead' | 'won';

export interface RunData {
    phase: RunPhase;
    health: number;
    cores: number;
    /** Seconds of play, paused time excluded. */
    elapsed: number;
    /** Where the next death returns the runner to. */
    respawn: { x: number; y: number; z: number };
    /** What the runner may press E on this frame, and what that would do. */
    prompt: string;
    /** Set by input, consumed by the lifecycle: one edge per press. */
    restartPressed: boolean;
    pausePressed: boolean;
    interactPressed: boolean;
}

export const Run = defineResource<RunData>({
    phase: 'playing',
    health: MAX_HEALTH,
    cores: 0,
    elapsed: 0,
    respawn: { ...SPAWN },
    prompt: '',
    restartPressed: false,
    pausePressed: false,
    interactPressed: false,
}, 'Run');
