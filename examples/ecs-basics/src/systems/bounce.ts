import {
    defineSystem, Query, Mut, Transform,
} from 'esengine';
import { Mover, Bouncer } from '../components';

const HALF_WIDTH = 400;
const HALF_HEIGHT = 300;

export const bounceSystem = defineSystem(
    [Query([Transform, Mut(Mover), Bouncer])],
    (query) => {
        for (const [_entity, transform, mover] of query) {
            if (transform.position.x > HALF_WIDTH || transform.position.x < -HALF_WIDTH) {
                mover.directionX *= -1;
            }
            if (transform.position.y > HALF_HEIGHT || transform.position.y < -HALF_HEIGHT) {
                mover.directionY *= -1;
            }
        }
    },
    { name: 'BounceSystem' }
);
