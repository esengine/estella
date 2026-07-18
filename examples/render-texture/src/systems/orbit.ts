import { defineSystem, Query, Mut, Res, Time, Transform } from 'esengine';
import { Orbit } from '../components';

// Drifts each shape along its ellipse. Most orbits reach far beyond the
// camera's ±640 × ±360 view, so shapes keep leaving the screen — watch the
// minimap to see where they went.
export const orbitSystem = defineSystem(
    [Query(Mut(Transform), Mut(Orbit)), Res(Time)],
    (query, time) => {
        for (const [, transform, orbit] of query) {
            orbit.phase += orbit.speed * time.delta;
            transform.position.x = Math.cos(orbit.phase) * orbit.rx;
            transform.position.y = Math.sin(orbit.phase) * orbit.ry;
        }
    },
    { name: 'OrbitSystem' },
);
