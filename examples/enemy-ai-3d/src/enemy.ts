import {
    defineSystem, Query, Mut, GetWorld, Transform, Marker, NavAgent, Perception,
    setNavDestination, stopNavAgent,
} from 'esengine';
import type { Vec3 } from 'esengine';

/**
 * Chase what was seen; hold a post when nothing is.
 *
 * `Perception` reports the target on all three axes — a hunter on the ground and
 * a player on the terrace are not in the same place. The posts are scene-placed
 * `Marker`s, and one switched off is not in this query at all.
 */
export const chaseSystem = defineSystem(
    [Query(Perception, NavAgent), Query(Marker, Transform), GetWorld()],
    (hunters, markers, world) => {
        const posts: Vec3[] = [];
        for (const [, marker, at] of markers) {
            if (marker.type === 'patrol') posts.push(at.position);
        }

        for (const [entity, sight] of hunters) {
            if (sight.visible) {
                setNavDestination(world, entity, {
                    x: sight.targetX, y: sight.targetY, z: sight.targetZ,
                });
                continue;
            }
            if (posts.length === 0) {
                stopNavAgent(world, entity);
                continue;
            }
            // The nearest post, so three hunters spread over them rather than
            // queueing at one.
            const here = world.get(entity, Transform).position;
            let best = posts[0];
            let bestD = Infinity;
            for (const p of posts) {
                const d = (p.x - here.x) ** 2 + (p.z - here.z) ** 2;
                if (d < bestD) { bestD = d; best = p; }
            }
            setNavDestination(world, entity, best);
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
