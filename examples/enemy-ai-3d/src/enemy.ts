import {
    defineSystem, Query, Mut, GetWorld, Transform, NavAgent, Perception,
    setNavDestination, stopNavAgent,
} from 'esengine';

/**
 * Chase what was seen, in three dimensions.
 *
 * `Perception` reports where the target IS, on all three axes — a hunter on the
 * ground and a player on the terrace are not in the same place, and a chase that
 * dropped the third axis would send it to the spot below.
 */
export const chaseSystem = defineSystem(
    [Query(Perception, NavAgent), GetWorld()],
    (hunters, world) => {
        for (const [entity, sight] of hunters) {
            if (sight.visible) {
                setNavDestination(world, entity, {
                    x: sight.targetX, y: sight.targetY, z: sight.targetZ,
                });
            } else {
                stopNavAgent(world, entity);
            }
        }
    },
    { name: 'ChaseSystem' },
);

/** How fast a hunter turns to look at what it sees, in turns per second. */
const TURN_RATE = 6;

/**
 * Look at the target while it is in sight. The direction is `Perception`'s, not
 * the route's: a hunter coming round a corner is already facing the player it
 * cannot walk straight at, which is the whole reason the direction is reported.
 */
export const faceTargetSystem = defineSystem(
    [Query(Mut(Transform), Perception)],
    (hunters) => {
        for (const [, transform, sight] of hunters) {
            if (!sight.visible) continue;
            // A model's forward is -Z, so the yaw that points at (dirX, dirZ) is
            // measured from there. Only the yaw: a hunter does not lean.
            const yaw = Math.atan2(sight.dirX, -sight.dirZ);
            const half = yaw / 2;
            const rotation = transform.rotation;
            const wantY = Math.sin(half);
            const wantW = Math.cos(half);
            const t = Math.min(1, TURN_RATE / 60);
            rotation.x = 0;
            rotation.z = 0;
            rotation.y += (wantY - rotation.y) * t;
            rotation.w += (wantW - rotation.w) * t;
            const length = Math.hypot(rotation.y, rotation.w) || 1;
            rotation.y /= length;
            rotation.w /= length;
        }
    },
    { name: 'FaceTargetSystem' },
);
