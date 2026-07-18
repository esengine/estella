import {
    defineSystem, Query, Mut, Res, Time, Transform, UICameraInfo,
} from 'esengine';
import type { UICameraData } from 'esengine';
import { Comet, Follower, Dasher } from '../components';
import { COMET, FOLLOW_STIFFNESS, DASH_DURATION } from '../config';

// Moves all three emitters. The trails need no per-frame code: the engine
// records each entity's world position whenever it has moved farther than its
// TrailRenderer.minVertexDistance.
export const motionSystem = defineSystem(
    [
        Query(Mut(Transform), Comet),
        Query(Mut(Transform), Follower),
        Query(Mut(Transform), Mut(Dasher)),
        Res(Time),
        Res(UICameraInfo),
    ],
    (comets, followers, dashers, time, camera: UICameraData) => {
        // Comet: x/y run sinusoids at different frequencies (Lissajous), so the
        // path keeps crossing itself and the trail's fade-out is easy to read.
        const phase = time.elapsed * COMET.speed;
        for (const [, transform] of comets) {
            transform.position.x = COMET.centerX + COMET.radiusX * Math.sin(COMET.freqX * phase);
            transform.position.y = COMET.centerY + COMET.radiusY * Math.sin(COMET.freqY * phase + Math.PI / 2);
        }

        // Follower: frame-rate-independent exponential ease toward the cursor.
        if (camera.valid) {
            const blend = 1 - Math.exp(-FOLLOW_STIFFNESS * time.delta);
            for (const [, transform] of followers) {
                transform.position.x += (camera.worldMouseX - transform.position.x) * blend;
                transform.position.y += (camera.worldMouseY - transform.position.y) * blend;
            }
        }

        // Dasher: advance an in-flight dash with an ease-out cubic, so most of
        // the distance is covered in the first frames — that speed spike is what
        // stretches the wide burst trail.
        for (const [, transform, dash] of dashers) {
            if (!dash.active) continue;
            dash.t = Math.min(dash.t + time.delta / DASH_DURATION, 1);
            const ease = 1 - Math.pow(1 - dash.t, 3);
            transform.position.x = dash.fromX + (dash.toX - dash.fromX) * ease;
            transform.position.y = dash.fromY + (dash.toY - dash.fromY) * ease;
            if (dash.t >= 1) dash.active = false;
        }
    },
    { name: 'MotionSystem' },
);
