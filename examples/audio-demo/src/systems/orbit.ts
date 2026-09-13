import { defineSystem, Query, Mut, Res, Time, Transform } from 'esengine';
import type { TimeData } from 'esengine';
import { Orbiting } from '../components';

// How far the orbit dips below the listener, and how tall the ellipse is. Kept
// clear of the pads and the spectrum bars above it.
const CENTRE_Y = -150;
const RISE = 90;

// Carry the spatial source around the listener at the camera. Nothing here
// touches audio: the volume you hear and the ear it arrives at are the engine's
// answer to where this entity ended up.
export const orbitSystem = defineSystem(
    [Query(Mut(Transform), Orbiting), Res(Time)],
    (orbiters, time: TimeData) => {
        for (const [, transform, orbit] of orbiters) {
            const angle = time.elapsed * orbit.speed;
            transform.position = {
                x: Math.cos(angle) * orbit.radius,
                y: CENTRE_Y + Math.sin(angle) * RISE,
                z: 0,
            };
        }
    },
    { name: 'OrbitSystem' },
);
