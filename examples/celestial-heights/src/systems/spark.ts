import {
    defineSystem, Query, Mut, Res, EventReader, GetWorld,
    Transform, ParticleEmitter, Particle,
} from 'esengine';
import { DamageDealt } from '../events';
import { session } from '../state';

/**
 * A hit throws sparks. One authored emitter is moved and replayed rather than a
 * new one spawned per blow: a burst is over in a quarter of a second, and the
 * texture reference stays in the scene where whoever draws it can find it.
 */
export const hitSparkSystem = defineSystem(
    [EventReader(DamageDealt), Query(Mut(Transform), ParticleEmitter), Res(Particle), GetWorld()],
    (blows, emitters, particles, world) => {
        if (!session.effects) return;
        for (const blow of blows) {
            if (!world.has(blow.target, Transform)) continue;
            const at = world.get(blow.target, Transform).position;
            for (const [entity, transform] of emitters) {
                transform.position.x = at.x;
                transform.position.y = at.y;
                // ENGINE-GAP(particles-simulate-but-do-not-draw): this burst runs
                // and ages out on schedule; nothing of it appears on screen.
                particles.play(entity);
                break;
            }
        }
    },
    { name: 'HitSparkSystem' },
);
