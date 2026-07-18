import { defineSystem, Query, Mut, Res, Time, Transform } from 'esengine';
import { Bobber } from '../components';

// Registered through SceneConfig.systems, not main.ts: SceneManager installs it
// when a level loads, gates it to that scene's 'running' status, and removes it
// again on unload.
export const bobSystem = defineSystem(
    [Query(Mut(Transform), Bobber), Res(Time)],
    (query, time) => {
        for (const [_entity, transform, bob] of query) {
            transform.position.y =
                bob.baseY + Math.sin(time.elapsed * bob.speed + bob.phase) * bob.amplitude;
        }
    },
    { name: 'BobSystem' },
);
