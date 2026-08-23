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
}

/** How far ahead a rejected sample is tested for leaving the world, in seconds. */
const LOOKAHEAD = 0.4;
/** Rings of candidate velocities around the desired one, and samples per ring. */
const RINGS = 2;
const DIVISIONS = 8;
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
    if (neighbours.length === 0) return { x: desired.x, z: desired.z };

    let bestX = desired.x;
    let bestZ = desired.z;
    let bestPenalty = Infinity;
    const speed = Math.max(opts.maxSpeed, 1e-3);

    for (let ring = 0; ring <= RINGS; ring++) {
        const count = ring === 0 ? 1 : DIVISIONS;
        const spread = (ring / RINGS) * speed;
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            const cx = desired.x + Math.cos(angle) * spread;
            const cz = desired.z + Math.sin(angle) * spread;
            const length = Math.hypot(cx, cz);
            // Nothing is gained by sampling faster than the agent can go.
            const scale = length > speed ? speed / length : 1;
            const vx = cx * scale;
            const vz = cz * scale;
            if (opts.canStand && !opts.canStand(self.x + vx * LOOKAHEAD, self.z + vz * LOOKAHEAD)) {
                continue;
            }
            const penalty = score(self, desired, vx, vz, neighbours, opts, speed);
            if (penalty >= bestPenalty) continue;
            bestPenalty = penalty;
            bestX = vx;
            bestZ = vz;
        }
    }
    return { x: bestX, z: bestZ };
}

function score(
    self: { x: number; z: number; vx: number; vz: number; radius: number },
    desired: { x: number; z: number },
    vx: number, vz: number,
    neighbours: readonly AvoidanceNeighbour[],
    opts: AvoidanceOptions,
    speed: number,
): number {
    let earliest = opts.horizon;
    let side = 0;
    const length = Math.hypot(vx, vz);
    for (const other of neighbours) {
        // Each side takes half the avoidance, so the closing velocity is read as
        // twice this candidate less what the two are already doing.
        const rvx = vx * 2 - self.vx - other.vx;
        const rvz = vz * 2 - self.vz - other.vz;
        const hit = sweep(self.x, self.z, self.radius + other.radius,
            rvx, rvz, other.x, other.z);
        if (hit !== null && hit < earliest) earliest = hit;

        const dx = other.x - self.x;
        const dz = other.z - self.z;
        const toward = Math.hypot(dx, dz);
        if (toward < 1e-6 || length < 1e-6) continue;
        // Right of the line to them, in the ground plane. Which of the two is
        // "right" is a convention; that both agents use the SAME one is the point.
        const rightX = dz / toward;
        const rightZ = -dx / toward;
        side += 0.5 - (vx * rightX + vz * rightZ) / (length * 2);
    }
    const deviation = Math.hypot(vx - desired.x, vz - desired.z) / speed;
    const turn = Math.hypot(vx - self.vx, vz - self.vz) / speed;
    // The nearer the impact, the sharper the cost — a collision a long way off is
    // not worth walking round.
    const impact = 1 / (0.1 + earliest / opts.horizon);
    return WEIGHT_DESIRED * deviation + WEIGHT_CURRENT * turn + WEIGHT_IMPACT * impact
        + WEIGHT_SIDE * (side / neighbours.length);
}

/**
 * When two circles closing at `(rvx, rvz)` touch, or null if they never do. For a
 * pair that overlaps the touch has happened, so the answer is negative: half of
 * it, made positive, is what such a pair scores with, so the way out that leaves
 * fastest reads as the safest.
 */
function sweep(
    ax: number, az: number, radius: number,
    rvx: number, rvz: number,
    bx: number, bz: number,
): number | null {
    const dx = bx - ax;
    const dz = bz - az;
    const c = dx * dx + dz * dz - radius * radius;
    const a = rvx * rvx + rvz * rvz;
    if (a < 1e-8) return c <= 0 ? 0 : null;
    const b = dx * rvx + dz * rvz;
    const discriminant = b * b - a * c;
    if (discriminant <= 0) return null;
    const root = Math.sqrt(discriminant);
    const tmin = (b - root) / a;
    const tmax = (b + root) / a;
    if (tmin < 0 && tmax > 0) return -tmin * 0.5;
    return tmin >= 0 ? tmin : null;
}
