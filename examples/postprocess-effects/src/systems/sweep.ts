import { defineSystem, Query, Mut, Res, Time, Transform } from 'esengine';
import { Sweep } from '../components';

// Ping-pong a sweeping entity along x, so a local volume drifts through the
// fixed camera and its effect blends in and out by distance.
export const sweepSystem = defineSystem(
    [Query(Mut(Transform), Mut(Sweep)), Res(Time)],
    (query, time) => {
        for (const [, transform, sweep] of query) {
            sweep.t += time.delta;
            transform.position.x = Math.sin(sweep.t * sweep.speed) * sweep.range;
        }
    },
    { name: 'SweepSystem' },
);
