import { defineResource, defineSystem, Query, Mut, Res, ResMut, Input, Time, Camera } from 'esengine';
import { Shot } from './components';

/** Seconds a shot holds before the director cuts to the next on its own. */
const HOLD = 7;
/** The priority the live shot gets; every other shot camera gets 0. */
const LIVE_PRIORITY = 10;

/** Which shot is live, and how long it has been. */
export const ShotState = defineResource({ live: 1, held: 0 }, 'ShotState');

// The whole of the directing: pick a shot and raise its camera above the others.
// The engine does the rest: the Camera Brain in the scene blends to the camera
// with the highest priority, and each camera already rides, aims and drifts by
// its own components.
export const shotDirectorSystem = defineSystem(
    [Res(Input), Res(Time), ResMut(ShotState), Query(Mut(Camera), Shot)],
    (input, time, state, cameras) => {
        let count = 0;
        for (const _ of cameras) count++;
        if (count === 0) return;

        let pick = 0;
        for (let key = 1; key <= count; key++) {
            if (input.isKeyPressed(`Digit${key}`)) pick = key;
        }
        state.modify((shots) => {
            shots.held += time.delta;
            if (pick === 0 && shots.held >= HOLD) pick = (shots.live % count) + 1;
            if (pick !== 0) {
                shots.live = pick;
                shots.held = 0;
            }
        });

        const live = state.get().live;
        for (const [, camera, shot] of cameras) {
            const priority = shot.key === live ? LIVE_PRIORITY : 0;
            if (camera.priority !== priority) camera.priority = priority;
        }
    },
    { name: 'ShotDirector' },
);
