// Movement is declared, not scripted: ThirdPersonController and
// ThirdPersonCamera are components the scene carries. What a game DOES own is
// what an animation and a blow MEAN — here, dust under a footstep and sparks
// where a sword lands.
import {
    addSystemToSchedule, Schedule, defineSystem, EventReader, GetWorld, Res,
    AnimatorEvent, Damage, Children, ParticleEmitter, Particle, resolveChildEntity,
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
 * Sparks where a blow landed. Driven by the blow itself, so nothing burns while
 * nothing is being hit — and by the effect the TARGET carries, so the engine
 * never has to know which sword makes which sparks.
 */
const hitSparkSystem = defineSystem(
    [EventReader(Damage), GetWorld(), Res(Particle)],
    (blows, world, particles) => {
        for (const blow of blows) {
            if (!world.has(blow.target, Children)) continue;
            for (const child of world.get(blow.target, Children).entities) {
                if (world.has(child, ParticleEmitter)) particles.play(child);
            }
        }
    },
    { name: 'HitSparkSystem' },
);

addSystemToSchedule(Schedule.Update, footstepDustSystem);
addSystemToSchedule(Schedule.Update, hitSparkSystem);
