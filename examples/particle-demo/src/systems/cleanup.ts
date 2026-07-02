import {
    defineSystem, Query, Mut, Res, Time, Commands, Particle, ParticleAPI,
} from 'esengine';
import { Burst } from '../components';

// A firework emitter never stops itself, so despawn it once its particles have
// all died. The small age gate avoids removing it on the very first frame,
// before the burst has emitted (getAliveCount would still read 0).
export const cleanupSystem = defineSystem(
    [Query(Mut(Burst)), Res(Particle), Res(Time), Commands()],
    (bursts, particles: ParticleAPI, time, cmds) => {
        for (const [entity, burst] of bursts) {
            burst.age += time.delta;
            if (burst.age > 0.2 && particles.getAliveCount(entity) === 0) {
                cmds.despawn(entity);
            }
        }
    },
    { name: 'CleanupSystem' },
);
