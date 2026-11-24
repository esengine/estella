// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    avoidance.ts
 * @brief   Steering round the bodies a route knows nothing about — the other
 *          agents walking it.
 *
 * A route is planned against the world, which does not move. Agents do, and a
 * dozen of them sent to one place all plan the same route and walk it as one
 * body. What each of them needs is a velocity that still heads for the next
 * waypoint and does not run into anyone: sampled rather than solved, because a
 * sample can be REJECTED for leaving the navigable world, and a velocity solved
 * from constraints has no natural place to ask that question.
 *
 * Reciprocal: every agent assumes the others are doing the same thing and each
 * takes half the avoidance, so two meeting head-on part rather than both dodging
 * the same way and meeting again.
 *
 * Pure and two-dimensional, in the ground plane — the axis an agent's own solver
 * carries is not one it steers on.
 */

/** What one agent needs to know about another to avoid it. */
export interface AvoidanceNeighbour {
    x: number;
    z: number;
    vx: number;
    vz: number;
    radius: number;
}

export interface AvoidanceOptions {
    /** How far ahead a collision is worth steering round, in seconds. */
    horizon: number;
    /** The agent's own top speed — candidates are sampled against it. */
    maxSpeed: number;
    /** Whether the agent may stand somewhere. A candidate that leaves the
     *  navigable world is refused however clear of other bodies it is. */
    canStand?: (x: number, z: number) => boolean;
    /** A stable surface predicate can wait until the sample could improve the choice. */
    deferSurfaceCheck?: boolean;
}

/** How far ahead a rejected sample is tested for leaving the world, in seconds. */
const LOOKAHEAD = 0.4;
/** Rings of candidate velocities around the desired one, and samples per ring. */
const RINGS = 2;
const DIVISIONS = 8;
const DIRECTIONS = Array.from({ length: DIVISIONS }, (_, i) => {
    const angle = (i / DIVISIONS) * Math.PI * 2;
    return { x: Math.cos(angle), z: Math.sin(angle) };
});
/** How much a candidate is penalised for not being the velocity that was wanted. */
const WEIGHT_DESIRED = 2;
/** …for turning away from the direction already being travelled. */
const WEIGHT_CURRENT = 0.75;
/** …for running into somebody soon. */
const WEIGHT_IMPACT = 2.5;
/**
 * …for passing on the wrong side. Two agents meeting head-on are a mirror of
 * each other, so every symmetric rule picks the same dodge for both and they meet
 * again: what parts them is a convention, and the convention is keep right.
 */
const WEIGHT_SIDE = 0.6;
/** Rest must not win forever when a collision-free detour is available. */
const WEIGHT_STOP = 1.5;

/**
 * The velocity to travel at: `desired` if nothing is in the way, otherwise the
 * best of a spread of alternatives around it.
 */
export function avoidVelocity(
    self: { x: number; z: number; vx: number; vz: number; radius: number },
    desired: { x: number; z: number },
    neighbours: readonly AvoidanceNeighbour[],
    opts: AvoidanceOptions,
): { x: number; z: number } {
    if (opts.maxSpeed <= 0) return { x: 0, z: 0 };
    const clear = (vx: number, vz: number): boolean => {
        if (!opts.canStand) return true;
        for (let i = 1; i <= 4; i++) {
            if (!opts.canStand(self.x + vx * LOOKAHEAD * i / 4, self.z + vz * LOOKAHEAD * i / 4)) return false;
        }
        return true;
    };
    if (neighbours.length === 0 && clear(desired.x, desired.z)) return { x: desired.x, z: desired.z };

    let bestX = 0;
    let bestZ = 0;
    let bestPenalty = Infinity;
    const speed = Math.max(opts.maxSpeed, 1e-3);
    const score = velocityScorer(self, desired, neighbours, opts.horizon, speed);

    const consider = (cx: number, cz: number): void => {
        const length = Math.hypot(cx, cz);
        const scale = length > speed ? speed / length : 1;
        const vx = cx * scale, vz = cz * scale;
        // Until there is a legal choice, reject blocked samples before scoring.
        // Once there is one, only a better score needs a surface query.
        const checkAfterScore = opts.deferSurfaceCheck && bestPenalty < Infinity;
        if (!checkAfterScore && !clear(vx, vz)) return;
        const scaledLength = scale === 1 ? length : Math.hypot(vx, vz);
        const penalty = score(vx, vz, scaledLength);
        if (penalty >= bestPenalty || (checkAfterScore && !clear(vx, vz))) return;
        bestPenalty = penalty; bestX = vx; bestZ = vz;
    };
    consider(desired.x, desired.z);
    consider(0, 0);

    for (let ring = 1; ring <= RINGS; ring++) {
        const spread = (ring / RINGS) * speed;
        for (const dir of DIRECTIONS) {
            const dx = dir.x * spread, dz = dir.z * spread;
            consider(desired.x + dx, desired.z + dz);
            // Desired-centred rings cannot step sideways/back when a parked
            // body is directly ahead. Sample the velocity disk itself as well.
            consider(dx, dz);
        }
    }
    return { x: bestX, z: bestZ };
}

function velocityScorer(
    self: AvoidanceNeighbour,
    desired: { x: number; z: number },
    neighbours: readonly AvoidanceNeighbour[],
    horizon: number,
    speed: number,
): (vx: number, vz: number, length: number) => number {
    const wantsMotion = Math.hypot(desired.x, desired.z) > 1e-6;
    // The velocity samples all see the same circles. Their separation and
    // right-hand direction only need to be computed once per neighbour.
    const bodies = neighbours.map(other => {
        const dx = other.x - self.x, dz = other.z - self.z;
        const radius = self.radius + other.radius;
        const toward = Math.hypot(dx, dz);
        return {
            dx, dz, distanceSqMinusRadiusSq: dx * dx + dz * dz - radius * radius,
            vx: other.vx, vz: other.vz, toward,
            rightX: toward < 1e-6 ? 0 : dz / toward,
            rightZ: toward < 1e-6 ? 0 : -dx / toward,
        };
    });

    return (vx, vz, length) => {
        let earliest = horizon;
        let side = 0;
        for (const other of bodies) {
            // Each side takes half the avoidance, so the closing velocity is read as
            // twice this candidate less what the two are already doing.
            const rvx = vx * 2 - self.vx - other.vx;
            const rvz = vz * 2 - self.vz - other.vz;
            const hit = sweep(other.dx, other.dz, other.distanceSqMinusRadiusSq, rvx, rvz, horizon);
            if (hit !== null && hit < earliest) earliest = hit;

            if (other.toward < 1e-6 || length < 1e-6) continue;
            // Right of the line to them, in the ground plane. Which of the two is
            // "right" is a convention; that both agents use the SAME one is the point.
            side += 0.5 - (vx * other.rightX + vz * other.rightZ) / (length * 2);
        }
        const deviation = Math.hypot(vx - desired.x, vz - desired.z) / speed;
        const turn = Math.hypot(vx - self.vx, vz - self.vz) / speed;
        // The nearer the impact, the sharper the cost — a collision a long way off is
        // not worth walking round.
        const impact = 1 / (0.1 + earliest / horizon);
        const stopping = wantsMotion
            ? WEIGHT_STOP * Math.max(0, 1 - length / speed) : 0;
        return WEIGHT_DESIRED * deviation + WEIGHT_CURRENT * turn + WEIGHT_IMPACT * impact
            + WEIGHT_SIDE * (side / Math.max(1, bodies.length)) + stopping;
    };
}

/**
 * Time until contact for separate circles. For overlapping circles, the time
 * needed to separate consumes that much of the safe lookahead horizon.
 */
function sweep(dx: number, dz: number, c: number, rvx: number, rvz: number, horizon: number): number | null {
    const a = rvx * rvx + rvz * rvz;
    if (a < 1e-8) return c <= 0 ? 0 : null;
    const b = dx * rvx + dz * rvz;
    const discriminant = b * b - a * c;
    if (discriminant <= 0) return null;
    const root = Math.sqrt(discriminant);
    if (c < 0) {
        if (b > 0) return 0; // The bodies would first move deeper into the overlap.
        // Positive exit root (b + root) / a, without cancellation for a shallow overlap.
        const timeToSeparate = -c / (root - b);
        return Math.max(0, horizon - timeToSeparate);
    }
    const tmin = (b - root) / a;
    return tmin >= 0 ? tmin : null;
}
