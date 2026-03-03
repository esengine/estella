import {
    defineSystem, Query, Mut, Res, Time, Transform,
} from 'esengine';
import { Orbit } from '../components';

export const animateSystem = defineSystem(
    [Query([Mut(Transform), Mut(Orbit)]), Res(Time)],
    (query, time) => {
        for (const [_entity, transform, orbit] of query) {
            orbit.angle += orbit.speed * time.delta;
            transform.position.x = Math.cos(orbit.angle) * orbit.radius;
            transform.position.y = Math.sin(orbit.angle) * orbit.radius;
        }
    },
    { name: 'AnimateSystem' }
);
