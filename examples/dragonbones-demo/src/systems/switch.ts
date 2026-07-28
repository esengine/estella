import {
    defineSystem, Query, Mut, Res, Time, Input, Text,
    DragonBonesAnimation,
} from 'esengine';
import { DragonBones } from 'esengine/dragonbones';
import { AnimState, Readout } from '../components';

/** The four animations the DragonBoy file ships, in the order the keys pick them. */
const CYCLE = ['stand', 'walk', 'jump', 'fall'];

/** Long enough to read the pose before it moves on, if nobody presses anything. */
const HOLD_SECONDS = 2.5;

/**
 * How long the crossfade takes. This is where DragonBones puts what Spine keeps
 * in a mix table: the blend is an argument to starting an animation, so it is
 * chosen per switch rather than configured once on the skeleton.
 */
const FADE_SECONDS = 0.25;

export const switchSystem = defineSystem(
    [
        Query(Mut(AnimState), DragonBonesAnimation),
        Query(Mut(Text), Readout),
        Res(DragonBones), Res(Input), Res(Time),
    ],
    (armatures, readouts, dragonBones, input, time) => {
        // Null until the side module lands — the plugin fetches it on the first
        // ask, so the opening frames of a run legitimately have no manager yet.
        if (!dragonBones) return;

        for (const [entity, state] of armatures) {
            let target = -1;
            for (let i = 0; i < CYCLE.length; i++) {
                if (input.isKeyPressed(`Digit${i + 1}`)) target = i;
            }

            state.timer += time.delta;
            if (target < 0 && state.timer >= HOLD_SECONDS) {
                target = (state.index + 1) % CYCLE.length;
            }
            if (target < 0) continue;

            state.index = target;
            state.timer = 0;
            dragonBones.fadeIn(entity, CYCLE[target], FADE_SECONDS, true);

            for (const [, text] of readouts) text.content = CYCLE[target];
        }
    },
    { name: 'SwitchSystem' },
);
