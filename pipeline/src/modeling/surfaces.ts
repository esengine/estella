// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  surfaces.ts — `lathe` and `loft`: curved solids from a handful of numbers.
 *
 *        A lathe turns a half-outline round an axis: a vase, a glass, a column. A loft
 *        joins cross-sections along a path: a pipe, a handle, a bottle, a hull. `curve`
 *        rounds what is given through its own points, so an agent states the few that
 *        matter and the surface between them follows.
 */
import { append, type Placed } from './modelOps';
import { add, cross, dot, length, normalize, scale, sub, type PolyMesh, type Vec3 } from './polyMesh';

const DEG = Math.PI / 180;
const EPS = 1e-6;

/**
 * Catmull-Rom through @p points, `steps` segments for each span; the points themselves stay exactly where they are.
 * A point given twice stops the curve there, which is how a corner is kept. Works on any tuple length.
 */
export function curveThrough(points: readonly (readonly number[])[], steps: number, closed: boolean): number[][] {
    if (steps <= 1 || points.length < 3) return points.map((p) => [...p]);
    const n = points.length;
    const at = (i: number): readonly number[] => (closed ? points[((i % n) + n) % n]! : points[Math.max(0, Math.min(n - 1, i))]!);
    const out: number[][] = [];
    const spans = closed ? n : n - 1;
    for (let i = 0; i < spans; i++) {
        const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
        // Nothing to walk between a doubled point's two copies, and either side of it the neighbour's tangent now stops there: the corner.
        if (p1.every((v, k) => Math.abs(v - p2[k]!) < EPS)) continue;
        for (let s = 0; s < steps; s++) {
            const t = s / steps;
            const [t2, t3] = [t * t, t * t * t];
            out.push(p1.map((_, k) => 0.5 * (2 * p1[k]! + (p2[k]! - p0[k]!) * t + (2 * p0[k]! - 5 * p1[k]! + 4 * p2[k]! - p3[k]!) * t2
                + (3 * p1[k]! - p0[k]! - 3 * p2[k]! + p3[k]!) * t3)));
        }
    }
    if (!closed) out.push([...points[n - 1]!]);
    return out;
}

const samePoint = (a: readonly number[], b: readonly number[]): boolean => a.every((v, k) => Math.abs(v - b[k]!) < EPS);

function withoutRepeats(points: number[][], closed: boolean): number[][] {
    const out = points.filter((p, i) => i === 0 || !samePoint(p, points[i - 1]!));
    if (closed && out.length > 1 && samePoint(out[0]!, out[out.length - 1]!)) out.pop();
    return out;
}

/** Winds every loop to agree with its neighbours across their shared edges, each connected piece starting from its first. */
function agreeing(loops: readonly number[][]): number[][] {
    const out = loops.map((l) => [...l]);
    const onEdge = new Map<string, number[]>();
    out.forEach((loop, f) => loop.forEach((v, i) => {
        const w = loop[(i + 1) % loop.length]!;
        const key = v < w ? `${v}:${w}` : `${w}:${v}`;
        const at = onEdge.get(key);
        if (at) at.push(f); else onEdge.set(key, [f]);
    }));
    const runs = (loop: readonly number[], a: number, b: number): boolean => loop.some((v, i) => v === a && loop[(i + 1) % loop.length] === b);
    const seen = new Set<number>();
    for (let start = 0; start < out.length; start++) {
        if (seen.has(start)) continue;
        seen.add(start);
        const queue = [start];
        while (queue.length) {
            const f = queue.pop()!;
            const loop = out[f]!;
            loop.forEach((v, i) => {
                const w = loop[(i + 1) % loop.length]!;
                for (const g of onEdge.get(v < w ? `${v}:${w}` : `${w}:${v}`)!) {
                    if (seen.has(g)) continue;
                    seen.add(g);
                    // A neighbour must run a shared edge the other way.
                    if (runs(out[g]!, v, w)) out[g]!.reverse();
                    queue.push(g);
                }
            });
        }
    }
    return out;
}

/** The loops wound consistently and facing out, whichever way the caller walked its outline. */
function facingOut(positions: readonly Vec3[], loops: readonly number[][]): number[][] {
    const wound = agreeing(loops);
    let v = 0;
    for (const loop of wound) {
        for (let i = 1; i + 1 < loop.length; i++) {
            v += dot(positions[loop[0]!]!, cross(positions[loop[i]!]!, positions[loop[i + 1]!]!));
        }
    }
    return v < 0 ? wound.map((l) => [...l].reverse()) : wound;
}

export interface LatheParams extends Placed {
    /** The half-outline, as [distance from the axis, height]. An end at distance 0 closes on the axis. */
    profile: readonly (readonly [number, number])[];
    sides?: number;
    /** How far round, in degrees. Default the whole way. */
    arc?: number;
    /** The outline is a loop: a ring or a tyre, with a hole down the axis. */
    closed?: boolean;
    /** Segments between given points; 1 keeps them straight. */
    curve?: number;
    axis?: 'x' | 'y' | 'z';
}

export function lathe(mesh: PolyMesh, p: LatheParams): PolyMesh {
    const sides = p.sides ?? 32;
    const arc = p.arc ?? 360;
    const closed = p.closed === true;
    if (!Number.isInteger(sides) || sides < 3) throw new Error(`sides ${sides} must be a whole number of at least 3`);
    if (arc <= 0 || arc > 360) throw new Error(`arc ${arc} must be more than 0 and at most 360 degrees`);
    if (p.profile.length < 2) throw new Error(`a profile needs at least 2 points, not ${p.profile.length}`);
    if (p.profile.some((q) => q[0] < 0)) throw new Error('a profile point cannot have a negative distance from the axis; [distance, height]');

    const outline = withoutRepeats(curveThrough(p.profile, p.curve ?? 1, closed), closed).map((q) => [Math.max(q[0]!, 0), q[1]!] as const);
    const count = outline.length;
    if (count < 2) throw new Error('the profile has no length');
    const onAxis = outline.map((q) => q[0] < EPS);
    const whole = arc >= 360;
    if (closed && onAxis.some(Boolean)) throw new Error('a closed profile cannot touch the axis: it would pinch there');
    if (onAxis.slice(1, -1).some(Boolean)) {
        throw new Error('only the two ends of a profile can touch the axis: a point on it mid-way pinches the surface to nothing. Build two lathes, or move it off');
    }
    if (count === 2 && onAxis[0] && onAxis[1]) throw new Error('the profile lies along the axis, so turning it makes nothing');

    const steps = whole ? sides : sides + 1;
    const positions: Vec3[] = [];
    const ringIndex: number[][] = outline.map(([r, h], i) => {
        if (onAxis[i]) {
            positions.push([0, h, 0]);
            return Array.from({ length: steps }, () => positions.length - 1);
        }
        return Array.from({ length: steps }, (_, s) => {
            const t = (s / sides) * arc * DEG;
            positions.push([Math.sin(t) * r, h, Math.cos(t) * r]);
            return positions.length - 1;
        });
    });

    const loops: number[][] = [];
    const rows = closed ? count : count - 1;
    for (let i = 0; i < rows; i++) {
        const lower = ringIndex[i]!, upper = ringIndex[(i + 1) % count]!;
        for (let s = 0; s < sides; s++) {
            const next = whole ? (s + 1) % sides : s + 1;
            const loop = [lower[s]!, lower[next]!, upper[next]!, upper[s]!].filter((v, n, all) => v !== all[(n + 1) % all.length]);
            if (loop.length >= 3) loops.push(loop);
        }
    }
    if (whole) {
        // An open outline with an end off the axis has a disc there.
        if (!closed) {
            if (!onAxis[0]) loops.push([...ringIndex[0]!]);
            if (!onAxis[count - 1]) loops.push([...ringIndex[count - 1]!]);
        }
    } else {
        // A slice: wedge-shaped ends where the outline stops off the axis, and two flat cut faces, all closing along one axis line.
        const axisAt = (i: number): number => {
            if (onAxis[i]) return ringIndex[i]![0]!;
            positions.push([0, outline[i]![1], 0]);
            return positions.length - 1;
        };
        const firstAxis = closed ? -1 : axisAt(0), lastAxis = closed ? -1 : axisAt(count - 1);
        if (!closed) {
            if (!onAxis[0]) loops.push([firstAxis, ...ringIndex[0]!]);
            if (!onAxis[count - 1]) loops.push([lastAxis, ...ringIndex[count - 1]!]);
        }
        const cut = (s: number): number[] => {
            const loop = outline.map((_, i) => ringIndex[i]![s]!);
            if (closed) return loop;
            if (!onAxis[count - 1]) loop.push(lastAxis);
            if (!onAxis[0]) loop.push(firstAxis);
            return loop;
        };
        loops.push(cut(0), cut(sides));
    }

    const moved = rotateAxis(positions, p.axis ?? 'y');
    return append(mesh, moved, facingOut(moved, loops), p);
}

const rotateAxis = (positions: readonly Vec3[], axis: 'x' | 'y' | 'z'): Vec3[] => {
    if (axis === 'y') return [...positions];
    // Rotations, not swaps: a swap would mirror the solid and turn it inside out.
    return axis === 'x' ? positions.map((q) => [q[1], -q[0], q[2]] as Vec3) : positions.map((q) => [q[0], -q[2], q[1]] as Vec3);
};

// ---- Loft ------------------------------------------------------------------------

export interface LoftSection {
    /** Where its centre is. */
    at?: Vec3;
    /** A circle. */
    radius?: number;
    /** An ellipse: across, and up. */
    radii?: readonly [number, number];
    /** A rectangle: across, and up. */
    size?: readonly [number, number];
    /** Any outline in the section's plane: [across, up]. */
    points?: readonly (readonly [number, number])[];
    /** Turns it about the path, in degrees. */
    twist?: number;
    /** Scales it. For a pipe's taper from one `section`. */
    scale?: number;
}

export interface LoftParams extends Placed {
    /** Each with its own `at` and shape. */
    sections?: readonly LoftSection[];
    /** Or one shape carried along these points. */
    path?: readonly Vec3[];
    section?: LoftSection;
    /** With `path`: a scale for each of its points. */
    scales?: readonly number[];
    /** The points round a section where shapes differ or are round. */
    sides?: number;
    /** Joins the last section back to the first: a ring, a tyre. */
    closed?: boolean;
    /** Segments between sections; 1 keeps them straight. */
    curve?: number;
}

function outlineOf(s: LoftSection, sides: number): { ring: [number, number][]; corners: boolean } {
    const given = [s.radius !== undefined, s.radii !== undefined, s.size !== undefined, s.points !== undefined].filter(Boolean).length;
    if (given !== 1) throw new Error(`a section needs exactly one of radius, radii, size, points; this one has ${given}`);
    let ring: [number, number][];
    let corners = false;
    if (s.radius !== undefined || s.radii !== undefined) {
        const [a, b] = s.radii ?? [s.radius!, s.radius!];
        if (a <= 0 || b <= 0) throw new Error('a section\'s radius must be positive');
        ring = Array.from({ length: sides }, (_, i) => {
            const t = (i / sides) * Math.PI * 2;
            return [Math.cos(t) * a, Math.sin(t) * b] as [number, number];
        });
    } else if (s.size) {
        const [w, h] = [s.size[0] / 2, s.size[1] / 2];
        if (w <= 0 || h <= 0) throw new Error('a section\'s size must be positive');
        ring = [[w, -h], [w, h], [-w, h], [-w, -h]];
        corners = true;
    } else {
        ring = s.points!.map((q) => [q[0], q[1]]);
        corners = true;
        if (ring.length < 3) throw new Error(`a section's outline needs at least 3 points, not ${ring.length}`);
    }
    // Counter-clockwise, whichever way it was walked: the walls join corner to corner, so all sections must agree.
    let area = 0;
    ring.forEach((a, i) => {
        const b = ring[(i + 1) % ring.length]!;
        area += a[0] * b[1] - b[0] * a[1];
    });
    if (Math.abs(area) < EPS) throw new Error('a section\'s outline encloses no area');
    if (area < 0) ring.reverse();
    const k = s.scale ?? 1;
    if (k <= 0) throw new Error(`a section's scale ${k} must be positive`);
    const twist = (s.twist ?? 0) * DEG;
    const [c, n] = [Math.cos(twist), Math.sin(twist)];
    return { ring: ring.map(([u, v]) => [(c * u - n * v) * k, (n * u + c * v) * k]), corners };
}

/** @p ring walked at even steps, @p count of them, so differing shapes can be joined corner to corner. */
function resample(ring: readonly [number, number][], count: number): [number, number][] {
    if (ring.length === count) return [...ring];
    const lens = ring.map((a, i) => Math.hypot(ring[(i + 1) % ring.length]![0] - a[0], ring[(i + 1) % ring.length]![1] - a[1]));
    const total = lens.reduce((a, b) => a + b, 0);
    const out: [number, number][] = [];
    let edge = 0, walked = 0;
    for (let i = 0; i < count; i++) {
        const want = (i / count) * total;
        while (edge < ring.length - 1 && walked + lens[edge]! < want) { walked += lens[edge]!; edge++; }
        const t = lens[edge]! > 0 ? (want - walked) / lens[edge]! : 0;
        const [a, b] = [ring[edge]!, ring[(edge + 1) % ring.length]!];
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    return out;
}

/** The turn of @p ring that lies closest to @p previous: without it, two shapes of different starts join with a wring in them. */
function aligned(ring: [number, number][], previous: readonly [number, number][]): [number, number][] {
    let best = 0, bestCost = Infinity;
    for (let shift = 0; shift < ring.length; shift++) {
        let cost = 0;
        for (let i = 0; i < ring.length; i++) {
            const q = ring[(i + shift) % ring.length]!, r = previous[i]!;
            cost += (q[0] - r[0]) ** 2 + (q[1] - r[1]) ** 2;
        }
        if (cost < bestCost - EPS) { bestCost = cost; best = shift; }
    }
    return ring.map((_, i) => ring[(i + best) % ring.length]!);
}

export function loft(mesh: PolyMesh, p: LoftParams): PolyMesh {
    const closed = p.closed === true;
    const sides = p.sides ?? 24;
    if (!Number.isInteger(sides) || sides < 3) throw new Error(`sides ${sides} must be a whole number of at least 3`);
    if (p.sections && p.path) throw new Error('give `sections`, or `path` with `section`, not both');
    if (p.path && !p.section) throw new Error('`path` carries a `section`: give one');
    if (p.scales && (!p.path || p.scales.length !== p.path.length)) throw new Error('`scales` goes with `path`, one for each of its points');

    const sections: LoftSection[] = p.sections
        ? p.sections.map((s) => ({ ...s }))
        : (p.path ?? []).map((at, i) => ({ ...p.section!, at, scale: (p.section!.scale ?? 1) * (p.scales?.[i] ?? 1) }));
    if (sections.length < 2) throw new Error(`a loft needs at least 2 sections, not ${sections.length}`);
    if (closed && sections.length < 3) throw new Error('a closed loft needs at least 3 sections');

    const centres = sections.map((s, i) => {
        if (!s.at) throw new Error(`section ${i} has no \`at\``);
        return s.at;
    });
    centres.forEach((c, i) => {
        const next = centres[i + 1];
        if (next && length(sub(next, c)) < EPS) throw new Error(`sections ${i} and ${i + 1} are at the same place, so there is no way along the path between them`);
    });

    // One corner count for all: as given if every section agrees, else walked evenly.
    const shapes = sections.map((s, i) => {
        try {
            return outlineOf(s, sides);
        } catch (e) {
            throw new Error(`section ${i}: ${(e as Error).message}`);
        }
    });
    const counts = new Set(shapes.map((s) => s.ring.length));
    const corners = counts.size === 1 ? [...counts][0]! : sides;
    let previous: [number, number][] | null = null;
    const rings2d = shapes.map(({ ring }) => {
        let r = resample(ring, corners);
        if (previous && counts.size !== 1) r = aligned(r, previous);
        previous = r;
        return r;
    });

    // The frame is carried along the path rather than worked out afresh, so a bend does not spin the section about it.
    const count = sections.length;
    const tangentAt = (i: number): Vec3 => {
        const before = closed ? centres[(i + count - 1) % count]! : centres[Math.max(0, i - 1)]!;
        const after = closed ? centres[(i + 1) % count]! : centres[Math.min(count - 1, i + 1)]!;
        return normalize(sub(after, before));
    };
    const first = tangentAt(0);
    let right = normalize(cross(Math.abs(first[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0], first));
    if (Math.abs(first[1]) > 0.99) right = normalize(cross([0, 0, -1], first));
    const world: number[][][] = sections.map((_, i) => {
        const t = tangentAt(i);
        right = normalize(sub(right, scale(t, dot(right, t))));
        const up = cross(t, right);
        return rings2d[i]!.map(([u, v]) => [...add(add(centres[i]!, scale(right, u)), scale(up, v))]);
    });

    // Curved column by column: each corner runs its own smooth line through its sections.
    const steps = p.curve ?? 1;
    const columns = Array.from({ length: corners }, (_, c) => curveThrough(world.map((ring) => ring[c]!), steps, closed));
    const rows = columns[0]!.length;
    const positions: Vec3[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < corners; c++) positions.push(columns[c]![r] as unknown as Vec3);
    const index = (r: number, c: number): number => r * corners + (c % corners);

    const loops: number[][] = [];
    const spans = closed ? rows : rows - 1;
    for (let r = 0; r < spans; r++) {
        const next = (r + 1) % rows;
        for (let c = 0; c < corners; c++) loops.push([index(r, c), index(r, c + 1), index(next, c + 1), index(next, c)]);
    }
    if (!closed) {
        loops.push(Array.from({ length: corners }, (_, c) => index(0, c)));
        loops.push(Array.from({ length: corners }, (_, c) => index(rows - 1, c)));
    }
    return append(mesh, positions, facingOut(positions, loops), p);
}
