// Movement is declared, not scripted: ThirdPersonController and
// ThirdPersonCamera are components the scene carries. What a game DOES own is
// what an animation means — here, that a footstep throws up dust.
import {
    addSystemToSchedule, Schedule, defineSystem, EventReader, GetWorld, Res,
    AnimatorEvent, Particle, resolveChildEntity,
} from 'esengine';

/**
 * Dust on a footstep. The animator says WHEN a foot lands — it is a moment the
 * walk clip declares, not a guess from speed — and the effect under that
 * character is what answers. Nothing here reads a clip or a clock.
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

addSystemToSchedule(Schedule.Update, footstepDustSystem);
