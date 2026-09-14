import {
    defineSystem, Query, Res, Time, Input, Animator,
    AnimatorController, AnimatorControllerAPI,
} from 'esengine';

/** Seconds a held key takes to carry a parameter across its whole range. */
const TRAVEL = 0.4;

/**
 * One stick, both rigs. The characters are posed from the same three numbers on
 * purpose: what differs on screen is then the SKELETONS, which is the thing
 * worth looking at — the knight has none of these clips and none of the hero's
 * bone names.
 */
const stick = { speed: 0, stance: 0, reach: 0 };

const ease = (value: number, target: number, step: number): number => {
    const gap = target - value;
    return Math.abs(gap) <= step ? target : value + Math.sign(gap) * step;
};

export const driveSystem = defineSystem(
    [Query(Animator), Res(Input), Res(Time), Res(AnimatorController)],
    (rigs, input, time, ctrl: AnimatorControllerAPI) => {
        const step = time.delta / TRAVEL;
        const held = (...keys: string[]): number => (keys.some((k) => input.isKeyDown(k)) ? 1 : 0);

        // Eased rather than set: a blend plane is only being blended while the
        // sample is between its stops, and a key that jumps 0 → 1 would never
        // show a frame of it.
        stick.speed = ease(stick.speed, held('KeyW', 'ArrowUp'), step);
        stick.stance = ease(stick.stance, held('KeyC', 'ControlLeft'), step);
        stick.reach = ease(stick.reach, held('Space'), step);

        for (const [entity] of rigs) {
            ctrl.setFloat(entity, 'speed', stick.speed);
            ctrl.setFloat(entity, 'stance', stick.stance);
            ctrl.setFloat(entity, 'reach', stick.reach);
        }
    },
);
