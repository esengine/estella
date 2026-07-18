import type { TimerHandle } from 'esengine';

// Module state shared between the build system (which wires timers to buttons),
// the timer callbacks, and the HUD. Handles are kept here so any button can
// pause / resume / cancel a timer created elsewhere.
export const game = {
    built: false,
    beats: 0,
    spawned: 0,
    spawnerPaused: false,
    spawner: null as TimerHandle | null,
    countdown: null as TimerHandle | null,
    status: 'Timers tick in PreUpdate — press a button.',
};
