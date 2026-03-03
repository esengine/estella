import {
    defineSystem, Query, Mut, Res, Time, Transform,
} from 'esengine';
import { Mover } from '../components';

export const moveSystem = defineSystem(
    [Query([Mut(Transform), Mover]), Res(Time)],
    (query, time) => {
        for (const [_entity, transform, mover] of query) {
            transform.position.x += mover.directionX * mover.speed * time.delta;
            transform.position.y += mover.directionY * mover.speed * time.delta;
        }
    },
    { name: 'MoveSystem' }
);
