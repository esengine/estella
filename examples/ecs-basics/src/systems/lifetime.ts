import {
    defineSystem, Query, Mut, Res, Time, Commands, Sprite,
} from 'esengine';
import { Lifetime } from '../components';

export const lifetimeSystem = defineSystem(
    [Query([Mut(Lifetime), Mut(Sprite)]), Res(Time), Commands()],
    (query, time, cmds) => {
        for (const [entity, lifetime, sprite] of query) {
            lifetime.remaining -= time.delta;

            if (lifetime.remaining < 1) {
                sprite.color.a = Math.max(0, lifetime.remaining);
            }

            if (lifetime.remaining <= 0) {
                cmds.despawn(entity);
            }
        }
    },
    { name: 'LifetimeSystem' }
);
