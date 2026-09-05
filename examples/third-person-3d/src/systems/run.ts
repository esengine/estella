import {
    defineSystem, Res, ResMut, Query, Mut,
    Input, Time, Transform, ThirdPersonController,
    type InputState, type TimeData,
} from 'esengine';
import { Runner, Checkpoint } from '../components';
import { Run, SPRINT_SPEED, WALK_SPEED, type RunData } from '../resources';

/**
 * The three keys the run itself listens for, taken as EDGES. A phase change
 * driven by `isKeyDown` fires every frame the key is held, which turns one
 * press of Escape into pause/unpause/pause for as long as a finger rests.
 */
export const runInputSystem = defineSystem(
    [Res(Input), ResMut(Run)],
    (input: InputState, runMut) => {
        const run = runMut.get() as RunData;
        run.pausePressed = input.isKeyPressed('Escape');
        run.restartPressed = input.isKeyPressed('KeyR');
        run.interactPressed = input.isKeyPressed('KeyE');
    },
    { name: 'RunInputSystem' },
);

/**
 * Sprint is a speed, not a gear: the controller already accelerates toward
 * whatever top speed it is given, so holding shift raises the target and
 * releasing it lets the same deceleration bring the character back down.
 */
export const sprintSystem = defineSystem(
    [Res(Input), Res(Run), Query(Mut(ThirdPersonController), Runner)],
    (input: InputState, run: RunData, runners) => {
        const wanted = run.phase === 'playing'
            && (input.isKeyDown('ShiftLeft') || input.isKeyDown('ShiftRight'))
            ? SPRINT_SPEED : WALK_SPEED;
        for (const [, controller] of runners) {
            controller.moveSpeed = wanted;
            // A paused or dead runner is not steering. The controller is the one
            // thing that reads the stick, so switching it off is the whole stop.
            controller.enabled = run.phase === 'playing';
        }
    },
    { name: 'SprintSystem' },
);

/** Play time, and the last checkpoint walked past. */
export const progressSystem = defineSystem(
    [Res(Time), ResMut(Run), Query(Transform, Runner), Query(Mut(Checkpoint), Transform)],
    (time: TimeData, runMut, runners, checkpoints) => {
        const run = runMut.get() as RunData;
        if (run.phase !== 'playing') return;
        run.elapsed += time.delta;

        for (const [, transform] of runners) {
            const z = transform.position.z;
            for (const [, point, at] of checkpoints) {
                if (point.reached || z > point.armZ) continue;
                point.reached = true;
                run.respawn = { x: at.position.x, y: at.position.y, z: at.position.z };
            }
        }
    },
    { name: 'ProgressSystem' },
);
