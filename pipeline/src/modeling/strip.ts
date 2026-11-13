// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  strip.ts — the `strip` step: a band of one thickness, none, carried along a path.
 *
 *        A leaf, a blade of grass, a ribbon, a banner, a strap. A `loft` makes these as thin solids, six faces round
 *        where two would do, and with no place for a picture: its texture comes from a projection. A strip is the
 *        surface itself, with a picture laid along it from end to end, so a leaf drawn once (its veins, its torn edge
 *        cut out by its alpha) is the leaf on every strip that reads it.
 *
 *        It is open, so a model of strips draws both sides, and a model that wants its other steps closed should keep
 *        its strips to themselves.
 */
import { append, type Placed } from './modelOps';
import { curveThrough } from './surfaces';
import { add, cross, dot, length, normalize, scale, sub, type PolyMesh, type Vec3 } from './polyMesh';

export interface StripParams extends Placed {
    /** The line down its middle, from its root to its tip. */
    path: readonly Vec3[];
    /** Its width where `widths` is 1. */
    width: number;
    /** Width along it at even steps from root to tip, as shares of `width`: [0.4, 1, 0.1] is a leaf. Default 1 all along. */
    widths?: readonly number[];
    /** The side its face looks to where it starts; it is carried along from there. Default [0, 1, 0]. */
    up?: Vec3;
    /** How far its edges rise above its middle, as a share of half its width: a folded leaf. Default 0, flat. */
    cup?: number;
    /** Degrees it turns about its own length, from root to tip. */
    twist?: number;
    /** Segments between the path's points; 1 keeps them straight. */
    curve?: number;
    /** The part of the picture it shows, [u0, v0, u1, v1], across then along: one leaf out of a sheet of them. Default the whole of it. */
    region?: readonly number[];
}

function widthAt(widths: readonly number[] | undefined, t: number): number {
    if (!widths || widths.length === 0) return 1;
    if (widths.length === 1) return widths[0]!;
    const f = Math.min(1, Math.max(0, t)) * (widths.length - 1);
    const i = Math.min(widths.length - 2, Math.floor(f));
    return widths[i]! + (widths[i + 1]! - widths[i]!) * (f - i);
}

export function strip(mesh: PolyMesh, p: StripParams): PolyMesh {
    if (!(p.width > 0)) throw new Error(`width ${p.width} must be positive`);
    if (p.widths?.some((w) => !(w >= 0))) throw new Error('`widths` must each be 0 or more');
    if (p.region && (p.region.length !== 4 || p.region.some((v) => !(v >= 0 && v <= 1)))) throw new Error('`region` must be [u0, v0, u1, v1], each 0..1');
    const cup = p.cup ?? 0;
    const centres = curveThrough(p.path, p.curve ?? 1, false) as unknown as Vec3[];
    if (centres.length < 2) throw new Error(`a strip needs a path of at least 2 points, not ${centres.length}`);
    const walked = [0];
    for (let i = 1; i < centres.length; i++) {
        const step = length(sub(centres[i]!, centres[i - 1]!));
        if (step < 1e-9) throw new Error(`points ${i - 1} and ${i} of the path are at the same place`);
        walked.push(walked[i - 1]! + step);
    }
    const whole = walked.at(-1)!;

    const tangentAt = (i: number): Vec3 => normalize(sub(centres[Math.min(centres.length - 1, i + 1)]!, centres[Math.max(0, i - 1)]!));
    const first = tangentAt(0);
    const wanted = p.up ?? [0, 1, 0];
    let across = cross(wanted, first);
    if (length(across) < 1e-6) {
        if (p.up) throw new Error('`up` runs along the path where it starts: give one that points off it');
        across = cross([0, 0, -1], first);
    }
    across = normalize(across);

    // Two columns flat, three folded: the fold needs a line down the middle to fold on.
    const columns = cup !== 0 ? [-1, 0, 1] : [-1, 1];
    const [u0, v0, u1, v1] = p.region ?? [0, 0, 1, 1];
    const positions: Vec3[] = [];
    const uvs: [number, number][] = [];
    centres.forEach((centre, i) => {
        const t = walked[i]! / whole;
        const tangent = tangentAt(i);
        // Carried, not found afresh: a bend then does not roll the strip about its own length.
        across = normalize(sub(across, scale(tangent, dot(across, tangent))));
        const turn = ((p.twist ?? 0) * t * Math.PI) / 180;
        const face = cross(tangent, across);
        const right = add(scale(across, Math.cos(turn)), scale(face, Math.sin(turn)));
        const up = cross(tangent, right);
        // Never quite nothing: a tip of no width is faces of no area, which shade as noise.
        const half = Math.max(p.width * 1e-4, (p.width / 2) * widthAt(p.widths, t));
        for (const c of columns) {
            positions.push(add(add(centre, scale(right, c * half)), scale(up, Math.abs(c) * cup * half)));
            uvs.push([u0 + (u1 - u0) * (c + 1) / 2, v0 + (v1 - v0) * t]);
        }
    });

    const per = columns.length;
    const loops: number[][] = [];
    for (let r = 0; r < centres.length - 1; r++) {
        for (let c = 0; c < per - 1; c++) loops.push([r * per + c, r * per + c + 1, (r + 1) * per + c + 1, (r + 1) * per + c]);
    }
    const base = mesh.faces.length;
    const out = append(mesh, positions, loops, p);
    return {
        positions: out.positions,
        faces: out.faces.map((f, i) => (i < base ? f : { ...f, cornerUvs: loops[i - base]!.map((v) => uvs[v]!) })),
    };
}
