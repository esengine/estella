import {
    defineSystem, Query, Mut, Res, Time, Transform,
} from 'esengine';
import { Mover } from '../components';

/**
 * Moves every entity by its direction and speed, once per frame.
 *
 * @compiled
 * A promise, not a hint: anything the subset cannot lower is a build error here
 * rather than a silent fall back to the interpreter.
 */
export const moveSystem = defineSystem(
    [Query(Mut(Transform), Mover), Res(Time)],
    (query, time) => {
        for (const [_entity, transform, mover] of query) {
            transform.position.x += mover.directionX * mover.speed * time.delta;
            transform.position.y += mover.directionY * mover.speed * time.delta;
        }
    },
    { name: 'MoveSystem' }
);
