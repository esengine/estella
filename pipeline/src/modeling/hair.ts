// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  hair.ts — the `hair` step: cards growing out of a scalp, what they are cut from, and the bones that swing them.
 *
 *        A card is a ribbon of quads from a root on the surface, falling under its own weight and turned
 *        aside by the head it would go through. What looks like strands is a texture: alpha cuts each card into
 *        them, and the Hair shader lights them along the way they run. The cards take the place of the surface
 *        they grew from once the steps are done, because a mesh has one material: a head and its hair are two
 *        models. Until then the head stays, so that layer after layer can grow from it and fall around it.
 */
import { TriangleTree, trianglesOf } from './triangleTree';
import { triangulateFace } from './triangulate';
import { hash3 } from './hash';
import { add, boundsOf, compact, cross, dot, faceNormal, normalize, scale, selectFaces, sub, type Face, type FaceSelector, type PolyMesh, type Vec3 } from './polyMesh';
import type { RigJoint, SkinWeights } from './rig';

export interface HairParams {
    /** The scalp: where cards grow from. */
    faces: FaceSelector;
    /** How many. Default 300. */
    count?: number;
    /** How long a card is, in model units. Required unless `guides` say. */
    length?: number;
    /** Lines the hair follows, each from near the scalp to its ends: a ponytail, a fringe, a parting. A card takes the line starting nearest its root, and runs as long as it, in place of `droop` and `comb`. */
    guides?: readonly (readonly Vec3[])[];
    /** Along `guides`, how far cards close up onto the line by the end, 0..1: 1 gathers them into a lock. Default 0. */
    gather?: number;
    /** How wide at the root, in model units. Default a tenth of its length. */
    width?: number;
    /** Quads along a card: more follows a curve better. Default 6. */
    segments?: number;
    /** How much it falls, 0..1. 0 stands straight out, 1 drops at once. Default 0.7. */
    droop?: number;
    /** A way all of it is combed, added to where it grows. */
    comb?: Vec3;
    /** How unruly, 0..1: how far each card strays from its neighbours. Default 0.15. */
    spread?: number;
    /** How much shorter a card can be than `length`, 0..1. Default 0.3. */
    uneven?: number;
    /** How far a card waves from side to side, in model units. Default 0. */
    wave?: number;
    /** How much narrower its tip is than its root, 0..1. Default 0.6. */
    taper?: number;
    seed?: number;
    color?: readonly number[];
    /** The colour at the tip. Default `color`. */
    tipColor?: readonly number[];
    tag?: string;
}

/** Four strips in the strand texture, so that neighbouring cards are cut differently. */
const STRIPS = 4;
const unit = (a: number, b: number, c: number, seed: number): number => hash3(a, b, c, seed) * 0.5 + 0.5;
const MAX_CARDS = 20000;
const MAX_SEGMENTS = 24;

const distance = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

interface Guide { points: readonly Vec3[]; size: number; at(t: number): Vec3; way(t: number): Vec3 }

/** A line with its points rounded off, and read by the share of its length: a card has more rows than a guide has points. */
function guideOf(line: readonly Vec3[]): Guide {
    if (line.length < 2) throw new Error('each of `guides` needs two points or more');
    const round = (t: number): Vec3 => {
        const place = Math.max(0, Math.min(line.length - 1 - 1e-6, t * (line.length - 1)));
        const i = Math.floor(place);
        const w = place - i;
        const [p0, p1, p2, p3] = [line[Math.max(0, i - 1)]!, line[i]!, line[i + 1]!, line[Math.min(line.length - 1, i + 2)]!];
        const k = (a: number, b: number, c: number, e: number): number => 0.5 * (2 * b + (c - a) * w + (2 * a - 5 * b + 4 * c - e) * w * w + (3 * b - a - 3 * c + e) * w * w * w);
        return [k(p0[0], p1[0], p2[0], p3[0]), k(p0[1], p1[1], p2[1], p3[1]), k(p0[2], p1[2], p2[2], p3[2])];
    };
    const SAMPLES = 48;
    const lengths = [0];
    for (let i = 1; i <= SAMPLES; i++) lengths.push(lengths[i - 1]! + distance(round((i - 1) / SAMPLES), round(i / SAMPLES)));
    const size = lengths[SAMPLES]!;
    if (!(size > 0)) throw new Error('one of `guides` has no length');
    const at = (t: number): Vec3 => {
        const wanted = Math.max(0, Math.min(1, t)) * size;
        let i = 1;
        while (i < SAMPLES && lengths[i]! < wanted) i++;
        const span = lengths[i]! - lengths[i - 1]!;
        return round((i - 1 + (span > 0 ? (wanted - lengths[i - 1]!) / span : 0)) / SAMPLES);
    };
    return { points: line, size, at, way: (t) => normalize(sub(at(Math.min(1, t + 0.02)), at(Math.max(0, t - 0.02)))) };
}

export function hair(mesh: PolyMesh, p: HairParams): PolyMesh {
    const count = p.count ?? 300;
    const segments = p.segments ?? 6;
    const guides = p.guides?.length ? p.guides.map(guideOf) : null;
    if (!guides && !(p.length! > 0)) throw new Error(`length ${p.length} must be positive, or \`guides\` must say how far it runs`);
    if (p.gather !== undefined && !(p.gather >= 0 && p.gather <= 1)) throw new Error(`gather ${p.gather} must be 0..1`);
    if (!Number.isInteger(count) || count < 1 || count > MAX_CARDS) throw new Error(`count ${count} must be 1..${MAX_CARDS}`);
    if (!Number.isInteger(segments) || segments < 1 || segments > MAX_SEGMENTS) throw new Error(`segments ${segments} must be 1..${MAX_SEGMENTS}`);
    for (const [name, v] of [['droop', p.droop], ['spread', p.spread], ['uneven', p.uneven], ['taper', p.taper]] as const) {
        if (v !== undefined && !(v >= 0 && v <= 1)) throw new Error(`${name} ${v} must be 0..1`);
    }
    if (p.width !== undefined && !(p.width > 0)) throw new Error(`width ${p.width} must be positive`);
    const hit = selectFaces(mesh, p.faces).filter((f) => mesh.faces[f]!.card === undefined);
    if (hit.length === 0) throw new Error(`\`faces\` ${JSON.stringify(p.faces)} matched no face`);

    const seed = p.seed ?? 1;
    const droop = p.droop ?? 0.7, spread = p.spread ?? 0.15, uneven = p.uneven ?? 0.3, taper = p.taper ?? 0.6;
    const width = p.width ?? (guides ? guides[0]!.size : p.length!) * 0.1;
    const comb: Vec3 = p.comb ?? [0, 0, 0];
    const color = p.color ?? [0.25, 0.14, 0.07];
    const tip = p.tipColor ?? color;
    const tag = p.tag ?? 'hair';
    const surface = compact({ positions: mesh.positions, faces: mesh.faces.filter((f) => f.card === undefined) });
    const { min, max } = boundsOf(surface);
    const middle: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const reach = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) * 0.006;
    // The head and not the layers before: cards lie over each other, and hair does not push hair away.
    const tree = new TriangleTree(trianglesOf(surface));
    const firstCard = mesh.faces.reduce((next, f) => Math.max(next, (f.card ?? -1) + 1), 0);

    // Roots spread by area, so a large face does not go bald beside a small one.
    const pieces: { a: Vec3; b: Vec3; c: Vec3; n: Vec3; area: number }[] = [];
    for (const f of hit) {
        const face = mesh.faces[f]!;
        const n = faceNormal(mesh, face);
        for (const [a, b, c] of triangulateFace(mesh, face)) {
            const [pa, pb, pc] = [mesh.positions[a]!, mesh.positions[b]!, mesh.positions[c]!];
            pieces.push({ a: pa, b: pb, c: pc, n, area: Math.hypot(...cross(sub(pb, pa), sub(pc, pa))) / 2 });
        }
    }
    const running: number[] = [];
    let total = 0;
    for (const piece of pieces) { total += piece.area; running.push(total); }
    if (!(total > 0)) throw new Error('`faces` have no area to grow from');

    const positions: Vec3[] = [...mesh.positions];
    const faces: Face[] = [...mesh.faces];
    for (let index = 0; index < count; index++) {
        const card = firstCard + index;
        const r = (i: number): number => unit(index, i, 11, seed);
        let lo = 0, hi = pieces.length - 1;
        const pick = r(0) * total;
        while (lo < hi) { const m = (lo + hi) >> 1; if (running[m]! < pick) lo = m + 1; else hi = m; }
        const piece = pieces[lo]!;
        let [u, v] = [r(1), r(2)];
        if (u + v > 1) { u = 1 - u; v = 1 - v; }
        const root = add(add(scale(piece.a, 1 - u - v), scale(piece.b, u)), scale(piece.c, v));
        const out = piece.n;
        const stray: Vec3 = [(r(3) - 0.5) * 2 * spread, (r(4) - 0.5) * 2 * spread, (r(5) - 0.5) * 2 * spread];
        const nearest = guides ? guides.reduce((best, g) => (distance(g.points[0]!, root) < distance(best.points[0]!, root) ? g : best)) : null;
        const size = (nearest ? nearest.size : p.length!) * (1 - uneven * r(6));
        const step = size / segments;
        const fromLine = nearest ? sub(root, nearest.points[0]!) : ([0, 0, 0] as Vec3);
        // Each step leans further toward the ground, by as much as `droop` asks over the card's whole length.
        const pull = droop * 2.4 / segments;
        let d = normalize(add(add(out, comb), stray));
        let at = add(root, scale(out, step * 0.05));
        // The way across the card stays square to it, and its face stays toward the outside.
        const yaw = (r(7) - 0.5) * spread * 2;
        const start = positions.length;
        const strip = Math.floor(r(8) * STRIPS);
        const phase = r(9) * Math.PI * 2;
        const rows: { at: Vec3; side: Vec3 }[] = [];
        for (let s = 0; s <= segments; s++) {
            if (nearest) {
                const along = (s / segments) * (size / nearest.size);
                const closing = 1 - (p.gather ?? 0) * along;
                at = add(add(nearest.at(along), scale(fromLine, closing)), scale(stray, along * size));
                d = nearest.way(along);
                // Over the head, not through it: a line from behind the ear to the tie is a chord of the skull.
                // Outside is where the surface lies between a point and the middle of what it grew from.
                for (let tries = 0; tries < 100; tries++) {
                    const way = sub(middle, at);
                    const far = Math.hypot(way[0], way[1], way[2]);
                    if (far < 1e-9 || tree.blocked(at[0], at[1], at[2], way[0] / far, way[1] / far, way[2] / far, far)) break;
                    at = add(at, scale(way, -reach / far));
                }
            }
            const away = normalize(sub(at, middle));
            let across = cross(d, add(scale(out, 0.5), scale(away, 0.5)));
            if (dot(across, across) < 1e-8) across = cross(d, [0.3, 0.2, 0.9]);
            across = normalize(add(normalize(across), scale(d, yaw)));
            const t = s / segments;
            const sway = p.wave ? scale(across, Math.sin(t * 7 + phase) * p.wave * t) : [0, 0, 0] as Vec3;
            rows.push({ at: add(at, sway), side: scale(across, (width * (1 - taper * t)) / 2) });
            if (s === segments || nearest) continue;
            d = normalize(add(scale(d, 1 - pull), add(scale([0, -1, 0], pull), scale(comb, pull * 0.5))));
            // Turned aside rather than through: it slides over what it grows from.
            for (let tries = 0; tries < 6 && tree.blocked(at[0], at[1], at[2], d[0], d[1], d[2], step * 1.2); tries++) {
                d = normalize(add(d, scale(normalize(add(out, normalize(sub(at, middle)))), 0.5)));
            }
            at = add(at, scale(d, step));
        }
        rows.forEach((row, s) => {
            const v0 = 1 - s / segments;
            positions.push(sub(row.at, row.side), add(row.at, row.side));
            if (s === 0) return;
            const [l0, r0, l1, r1] = [start + (s - 1) * 2, start + (s - 1) * 2 + 1, start + s * 2, start + s * 2 + 1];
            const v1 = 1 - (s - 1) / segments;
            const [u0, u1] = [(strip + 0.02) / STRIPS, (strip + 0.98) / STRIPS];
            const t = (s - 0.5) / segments;
            const paint = [0, 1, 2].map((k) => color[k]! + (tip[k]! - color[k]!) * t);
            faces.push({
                v: [l0, l1, r1, r0], tag, smooth: true, card,
                color: [paint[0]!, paint[1]!, paint[2]!, 1] as const,
                cornerUvs: [[u0, v1], [u0, v0], [u1, v0], [u1, v1]],
            });
        });
    }
    return compact({ positions, faces });
}

/** Cards the mesh has, or nothing: hair has a material of its own. */
export const hasCards = (mesh: PolyMesh): boolean => mesh.faces.some((f) => f.card !== undefined);

/** Just the cards, once nothing more will grow from what they grew from. */
export const cardsOnly = (mesh: PolyMesh): PolyMesh => compact({ positions: mesh.positions, faces: mesh.faces.filter((f) => f.card !== undefined) });

export interface HairSway {
    /** Bone chains the cards are shared out among. Default 12. */
    chains?: number;
    /** Bones to a chain. Default 3. */
    bones?: number;
    /** How hard it goes back to where it was, 0..1. Default 0.08. */
    stiffness?: number;
    /** How much speed it loses each frame, 0..1. Default 0.3. */
    drag?: number;
    /** A ball it stays out of, in model units: the head. */
    collider?: { at: Vec3; radius: number };
}

/**
 * Chains down through the cards, and each card bound to its nearest. Not the weights a body is given, which are found
 * across a connected surface: a card is its own small surface, and only the way along it matters.
 */
export function hairRig(mesh: PolyMesh, sway: HairSway): { joints: RigJoint[]; skin: SkinWeights; chainRoots: number[] } {
    const cards = new Map<number, Face[]>();
    for (const face of mesh.faces) {
        if (face.card === undefined) continue;
        const at = cards.get(face.card);
        if (at) at.push(face); else cards.set(face.card, [face]);
    }
    const ids = [...cards.keys()];
    const chainCount = Math.min(sway.chains ?? 12, ids.length);
    const bones = sway.bones ?? 3;
    /** Where a card is, a share of the way along. */
    const along = (faces: Face[], t: number): Vec3 => {
        const i = Math.min(faces.length - 1, Math.floor(t * faces.length));
        const face = faces[i]!;
        const within = t * faces.length - i;
        const [l0, l1, r1, r0] = face.v as [number, number, number, number];
        const near = scale(add(mesh.positions[l0]!, mesh.positions[r0]!), 0.5);
        const far = scale(add(mesh.positions[l1]!, mesh.positions[r1]!), 0.5);
        return add(scale(near, 1 - within), scale(far, within));
    };
    const roots = ids.map((id) => along(cards.get(id)!, 0));

    // Centres spread as far apart as they will go, then settled: the same answer every time, as a random start would not give.
    const centres: Vec3[] = [roots[0]!];
    while (centres.length < chainCount) {
        let far = 0, best = -1;
        roots.forEach((q, i) => {
            const d = Math.min(...centres.map((c) => dot(sub(q, c), sub(q, c))));
            if (d > best) { best = d; far = i; }
        });
        centres.push(roots[far]!);
    }
    const owner = new Int32Array(ids.length);
    for (let pass = 0; pass < 6; pass++) {
        roots.forEach((q, i) => {
            let best = Infinity;
            centres.forEach((c, k) => { const d = dot(sub(q, c), sub(q, c)); if (d < best) { best = d; owner[i] = k; } });
        });
        centres.forEach((_, k) => {
            let sum: Vec3 = [0, 0, 0], n = 0;
            roots.forEach((q, i) => { if (owner[i] === k) { sum = add(sum, q); n++; } });
            if (n) centres[k] = scale(sum, 1 / n);
        });
    }

    const joints: RigJoint[] = [];
    let middle: Vec3 = [0, 0, 0];
    for (const q of roots) middle = add(middle, q);
    joints.push({ name: 'hair', at: scale(middle, 1 / roots.length), parent: -1, children: [] });
    const chainRoots: number[] = [];
    const firstBone: number[] = [];
    for (let k = 0; k < chainCount; k++) {
        const mine = ids.filter((_, i) => owner[i] === k);
        let parent = 0;
        firstBone.push(joints.length);
        chainRoots.push(joints.length);
        for (let b = 0; b <= bones; b++) {
            let sum: Vec3 = [0, 0, 0];
            for (const id of mine) sum = add(sum, along(cards.get(id)!, b / bones));
            const index = joints.length;
            joints.push({ name: `hair${k}.${b}`, at: mine.length ? scale(sum, 1 / mine.length) : centres[k]!, parent, children: [] });
            joints[parent]!.children.push(index);
            parent = index;
        }
    }

    const count = mesh.positions.length;
    const skin: SkinWeights = { joints: new Uint16Array(count * 4), weights: new Float32Array(count * 4), dominant: joints.map(() => 0) };
    const ownerOf = new Map(ids.map((id, i) => [id, owner[i]!]));
    for (const [id, faces] of cards) {
        const first = firstBone[ownerOf.get(id)!]!;
        faces.forEach((face, f) => {
            const [l0, l1, r1, r0] = face.v as [number, number, number, number];
            const put = (vertex: number, t: number): void => {
                const place = Math.min(bones - 1e-6, t * bones);
                const b = Math.floor(place);
                const w = place - b;
                skin.joints[vertex * 4] = first + b;
                skin.joints[vertex * 4 + 1] = first + b + 1;
                skin.weights[vertex * 4] = 1 - w;
                skin.weights[vertex * 4 + 1] = w;
                skin.dominant[w < 0.5 ? first + b : first + b + 1]!++;
            };
            put(l0, f / faces.length); put(r0, f / faces.length);
            put(l1, (f + 1) / faces.length); put(r1, (f + 1) / faces.length);
        });
    }
    return { joints, skin, chainRoots };
}

export interface HairMaps {
    /** What the cards are cut from: tone in colour, strands in alpha. Multiplies the cards' colour. */
    strands: { size: number; rgba: Uint8Array };
    /** Which way the strands run: all along v. */
    flow: { size: number; rgba: Uint8Array };
    /** Where each strand's highlight shifts along it. */
    shift: { size: number; rgba: Uint8Array };
}

const STRANDS_A_STRIP = 34;

/** The textures a card reads. Numbers, not pictures, so they are stored and read without sRGB. */
export function hairMaps(seed = 1, size = 512): HairMaps {
    const coverage = new Float32Array(size * size);
    const tone = new Float32Array(size * size).fill(0.75);
    const stripWide = size / STRIPS;
    for (let strip = 0; strip < STRIPS; strip++) {
        // Keeps clear of the strip's edges, so that nothing bleeds in from the next.
        const lo = strip * stripWide + 2, hi = (strip + 1) * stripWide - 2;
        for (let n = 0; n < STRANDS_A_STRIP; n++) {
            const r = (i: number): number => unit(strip, n, i, seed);
            // Thick in the middle of a card and thin to its edges, as a lock is.
            const offset = (r(0) + r(1) + r(2)) / 3;
            const x0 = lo + (hi - lo) * offset;
            const lean = (r(3) - 0.5) * stripWide * 0.25;
            const halfWidth = (0.9 + r(4) * 1.6) * (size / 512);
            // Short of the card's end: what is left of a strand there is thinner than a pixel, and breaks up into specks.
            const reach = 0.55 + r(5) * 0.37;
            const shade = 0.55 + r(6) * 0.45;
            for (let y = 0; y < size; y++) {
                const t = (y + 0.5) / size;
                if (t > reach) break;
                const left = t / reach;
                const middle = x0 + lean * t + Math.sin(t * 6 + r(7) * 6) * stripWide * 0.015;
                const w = halfWidth * (1 - 0.5 * left * left);
                const from = Math.max(Math.ceil(lo), Math.floor(middle - w - 1));
                const to = Math.min(Math.floor(hi), Math.ceil(middle + w + 1));
                for (let x = from; x <= to; x++) {
                    const a = Math.max(0, Math.min(1, w + 0.5 - Math.abs(x + 0.5 - middle))) * Math.min(1, (1 - left) * 10);
                    const at = y * size + x;
                    if (a > coverage[at]!) { coverage[at] = a; tone[at] = shade; }
                }
            }
        }
    }
    const strands = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {
        const v = Math.round(tone[i]! * 255);
        strands[i * 4] = v; strands[i * 4 + 1] = v; strands[i * 4 + 2] = v;
        strands[i * 4 + 3] = Math.round(coverage[i]! * 255);
    }
    const flow = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++) flow.set([128, 255, 128, 255], i * 4);
    const shiftSize = 128;
    const shift = new Uint8Array(shiftSize * shiftSize * 4);
    for (let y = 0; y < shiftSize; y++) {
        for (let x = 0; x < shiftSize; x++) {
            const v = Math.round(unit(x, Math.floor(y / 16), 3, seed) * 255);
            shift.set([v, v, v, 255], (y * shiftSize + x) * 4);
        }
    }
    return { strands: { size, rgba: strands }, flow: { size: 4, rgba: flow }, shift: { size: shiftSize, rgba: shift } };
}
