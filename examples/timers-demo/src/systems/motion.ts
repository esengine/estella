// Per-frame motion stays on Time.delta — integration and smoothing belong to
// the frame loop. Timers only decide WHEN things happen (spawn, burst, despawn).
import {
    defineSystem, Query, Mut, Res, Time,
    Transform,
} from 'esengine';

import { Heart, Spark, Drifter } from '../components';

const GRAVITY = 420;

export const sparkSystem = defineSystem(
    [Query(Mut(Transform), Mut(Spark)), Res(Time)],
    (sparks, time) => {
        for (const [_entity, transform, spark] of sparks) {
            spark.vy -= GRAVITY * time.delta;
            transform.position.x += spark.vx * time.delta;
            transform.position.y += spark.vy * time.delta;
        }
    },
    { name: 'SparkSystem' }
);

export const drifterSystem = defineSystem(
    [Query(Mut(Transform), Drifter), Res(Time)],
    (drifters, time) => {
        for (const [_entity, transform, drifter] of drifters) {
            transform.position.y += drifter.vy * time.delta;
            transform.position.x =
                drifter.baseX + Math.sin(time.elapsed * 2 + drifter.phase) * 24;
        }
    },
    { name: 'DrifterSystem' }
);

// The heartbeat timer kicks scale up; this system only decays it back to 1.
export const heartDecaySystem = defineSystem(
    [Query(Mut(Transform), Heart), Res(Time)],
    (hearts, time) => {
        const k = Math.min(1, time.delta * 9);
        for (const [_entity, transform] of hearts) {
            transform.scale.x += (1 - transform.scale.x) * k;
            transform.scale.y += (1 - transform.scale.y) * k;
        }
    },
    { name: 'HeartDecaySystem' }
);
