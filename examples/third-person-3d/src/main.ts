// Movement is declared, not scripted — ThirdPersonController, ThirdPersonCamera
// and Hunter are components the scene carries. What a game DOES own is what an
// animation and a blow MEAN: dust under a footstep, sparks where a sword lands.
import {
    addSystemToSchedule, Schedule, defineSystem, EventReader, GetWorld, Res,
    AnimatorEvent, Damage, Transform, Particle, resolveChildEntity,
} from 'esengine';

/**
 * Dust on a footstep. The animator says WHEN a foot lands — a moment the walk
 * clip declares, not a guess from speed — and the effect under that character
 * answers. Nothing here reads a clip or a clock.
 */
const footstepDustSystem = defineSystem(
    [EventReader(AnimatorEvent), GetWorld(), Res(Particle)],
    (events, world, particles) => {
        for (const event of events) {
            if (event.name !== 'footstep') continue;
            const dust = resolveChildEntity(world, event.entity, 'FootDust');
            if (dust !== null) particles.play(dust);
        }
    },
    { name: 'FootstepDustSystem' },
);

/**
 * Sparks where a blow landed — moved to the contact point the blow carries,
 * which is the only moment it can be used: by the time this runs, the swing
 * that produced it has moved on. Driven by the blow, so nothing burns while
 * nothing is being hit, and by the same one for a player and for an enemy.
 */
const hitSparkSystem = defineSystem(
    [EventReader(Damage), GetWorld(), Res(Particle)],
    (blows, world, particles) => {
        for (const blow of blows) {
            const spark = world.findEntityByName('HitSpark');
            if (spark === null || !world.has(spark, Transform)) continue;
            world.update(spark, Transform, (t) => {
                t.position.x = blow.x; t.position.y = blow.y; t.position.z = blow.z;
            });
            particles.play(spark);
        }
    },
    { name: 'HitSparkSystem' },
);

addSystemToSchedule(Schedule.Update, footstepDustSystem);
addSystemToSchedule(Schedule.Update, hitSparkSystem);
