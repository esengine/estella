import {
    defineSystem, Query, Mut, Res, Time, Input,
    SpineAnimation,
} from 'esengine';
import { Spine } from 'esengine/spine';
import { AnimState } from '../components';

const CYCLE = ['idle', 'walk', 'run', 'jump', 'shoot'];
const ONE_SHOT = new Set(['jump', 'shoot']); // played once, the skeleton settles back

const HOLD_SECONDS = 2.5;

export const switchSystem = defineSystem(
    [Query(Mut(AnimState), SpineAnimation), Res(Spine), Res(Input), Res(Time)],
    (query, spine, input, time) => {
        for (const [entity, state] of query) {
            let target = -1;
            for (let i = 0; i < CYCLE.length; i++) {
                if (input.isKeyPressed(`Digit${i + 1}`)) target = i;
            }

            state.timer += time.delta;
            if (target < 0 && state.timer >= HOLD_SECONDS) {
                target = (state.index + 1) % CYCLE.length;
            }

            if (target >= 0) {
                state.index = target;
                state.timer = 0;
                const name = CYCLE[target];
                spine.setAnimation(entity, name, !ONE_SHOT.has(name));
            }
        }
    },
    { name: 'SwitchSystem' }
);
