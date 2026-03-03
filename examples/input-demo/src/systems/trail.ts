import {
    defineSystem, Query, Mut, Res, Time, Commands,
    Transform, Sprite,
} from 'esengine';
import { Trail } from '../components';

export const trailSystem = defineSystem(
    [Query([Mut(Transform), Mut(Sprite), Mut(Trail)]), Res(Time), Commands()],
    (query, time, cmds) => {
        for (const [entity, transform, sprite, trail] of query) {
            trail.lifetime -= time.delta;
            sprite.color.a = Math.max(0, trail.lifetime);
            transform.scale = {
                x: trail.lifetime * 1.5,
                y: trail.lifetime * 1.5,
                z: 1,
            };

            if (trail.lifetime <= 0) {
                cmds.despawn(entity);
            }
        }
    },
    { name: 'TrailSystem' }
);
