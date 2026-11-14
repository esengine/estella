// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    tree.ts
 * @brief   A tree in one step: a trunk that leans and forks into limbs, and a crown of leaf clumps on them.
 *
 * @details A tree written part by part is a trunk and a balloon: nobody writes forty limbs and clumps by hand, and what makes a tree
 *          read as one is that its crown hangs on its limbs. So the limbs are grown here (from the trunk, round it, rising and
 *          thinning, twigs off them) and a clump of leaves is put where each ends, and the whole is skinned as one body by the organic
 *          step, bark and leaves tagged and painted. The same numbers grow the same tree, and `detail` grows it three ways: 2 the tree
 *          itself, 1 without its twigs and coarser, 0 a stem and its crown's outline in a few dozen triangles, for a forest a
 *          kilometre off. A plant placed in thousands wants all three.
 */
import { organic, type OrganicPart } from './organic';
import { append, paint } from './modelOps';
import { stain } from './stain';
import type { PolyMesh, Vec3 } from './polyMesh';

export const TREE_SHAPES = ['round', 'tall', 'flat', 'bush', 'cone'] as const;
export type TreeShape = typeof TREE_SHAPES[number];

export interface TreeParams {
    /** From the ground to the top of the crown, in the model's units. */
    height: number;
    /** round: an oak, a crown as wide as it is tall. tall: a poplar or a birch. flat: an umbrella on long level limbs. bush: a crown that sits on the ground. cone: a conifer, in tiers. */
    shape?: TreeShape;
    /** How thick the trunk is, times what its height would have. */
    trunk?: number;
    /** How far the top stands off the foot, as a share of the height. */
    lean?: number;
    /** How many limbs leave the trunk (a conifer's tiers). */
    limbs?: number;
    /** How far the limbs reach, times what the shape would have. */
    spread?: number;
    /** How large the clumps of leaves are, times what the shape would have. */
    crown?: number;
    /** 2 the tree, 1 coarser and without twigs, 0 a stem and the outline of its crown. */
    detail?: number;
    /**
     * cards (default): the crown is leaves, flat cards of a sprig cut out by its picture's alpha, set over each clump and shaded by where
     * they sit in it. solid: one smooth body, a crown of clay, for a toy or for what is only ever seen far off. A tree at detail 0 is solid.
     */
    leaves?: 'cards' | 'solid';
    seed?: number;
    /** Linear colours. */
    bark?: readonly number[];
    leaf?: readonly number[];
    at?: Vec3;
}

interface Habit { top: number; limbs: number; rise: number; reach: number; flat: number; clump: number; girth: number }

const HABITS: Record<Exclude<TreeShape, 'cone'>, Habit> = {
    round: { top: 0.56, limbs: 5, rise: 34, reach: 0.30, flat: 0.78, clump: 0.19, girth: 0.040 },
    tall: { top: 0.70, limbs: 4, rise: 56, reach: 0.17, flat: 1.25, clump: 0.14, girth: 0.030 },
    flat: { top: 0.62, limbs: 6, rise: 14, reach: 0.40, flat: 0.48, clump: 0.17, girth: 0.042 },
    bush: { top: 0.22, limbs: 5, rise: 22, reach: 0.46, flat: 0.72, clump: 0.36, girth: 0.030 },
};

const BARK = [0.26, 0.17, 0.10], LEAF = [0.16, 0.36, 0.10];

function dice(seed: number): () => number {
    let s = (Math.imul(seed | 0, 2654435761) ^ 0x9e3779b9) >>> 0;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/** The parts of a tree: its wood as chains, its leaves as clumps. */
export function treeParts(p: TreeParams): OrganicPart[] {
    const grown = growTree(p);
    return [...grown.wood, ...grown.crown];
}

interface Clump { at: Vec3; radii: Vec3 }

/** A tree grown: its wood, its crown as bodies of leaf, and where each clump of leaves hangs. */
function growTree(p: TreeParams): { wood: OrganicPart[]; crown: OrganicPart[]; clumps: Clump[] } {
    const all = growParts(p);
    return { wood: all.parts.filter((part) => part.tag === 'bark'), crown: all.parts.filter((part) => part.tag === 'leaf'), clumps: all.clumps };
}

function growParts(p: TreeParams): { parts: OrganicPart[]; clumps: Clump[] } {
    const h = p.height, shape = p.shape ?? 'round', detail = p.detail ?? 2, r = dice(p.seed ?? 1);
    const parts: OrganicPart[] = [];
    if (shape === 'cone') {
        const girth = h * 0.022 * (p.trunk ?? 1), wide = h * 0.19 * (p.spread ?? 1), tiers = detail === 0 ? 2 : Math.max(3, Math.round(p.limbs ?? 5));
        const lx = (p.lean ?? 0) * h;
        parts.push({ shape: 'chain', tag: 'bark', points: [[0, -h * 0.05, 0, girth * 1.4], [lx * 0.5, h * 0.5, 0, girth * 0.8], [lx, h * 0.97, 0, girth * 0.25]] });
        const coneClumps: Clump[] = [];
        if (detail === 0) {
            // From far off a conifer is a spire: a broad lower half and a narrow upper one.
            parts.push({ shape: 'ellipsoid', tag: 'leaf', at: [lx * 0.45, h * 0.44, 0], radii: [wide * 0.92 * (p.crown ?? 1), h * 0.26, wide * 0.92 * (p.crown ?? 1)] });
            parts.push({ shape: 'ellipsoid', tag: 'leaf', at: [lx * 0.75, h * 0.74, 0], radii: [wide * 0.5 * (p.crown ?? 1), h * 0.24, wide * 0.5 * (p.crown ?? 1)] });
            return { parts, clumps: [] };
        }
        for (let t = 0; t < tiers; t++) {
            const u = tiers > 1 ? t / (tiers - 1) : 0, y = h * (0.2 + 0.68 * u), w = wide * (1 - 0.8 * u) * (0.9 + 0.2 * r()) * (p.crown ?? 1);
            const x = lx * (0.2 + 0.68 * u), skirt = h * 0.74 / tiers;
            // A tier is a skirt that droops: wide and thin below, a narrower lift above it.
            parts.push({ shape: 'ellipsoid', tag: 'leaf', at: [x, y, 0], radii: [w, skirt * 0.36, w] });
            parts.push({ shape: 'ellipsoid', tag: 'leaf', at: [x, y + skirt * 0.42, 0], radii: [w * 0.62, skirt * 0.62, w * 0.62] });
            coneClumps.push({ at: [x, y + skirt * 0.2, 0], radii: [w, skirt * 0.7, w] });
        }
        return { parts, clumps: coneClumps };
    }
    const habit = HABITS[shape];
    const girth = h * habit.girth * (p.trunk ?? 1), top = habit.top * h;
    const lean = (p.lean ?? 0.03) * h, turn = r() * Math.PI * 2, lx = Math.cos(turn) * lean, lz = Math.sin(turn) * lean;
    // The trunk: thick at the foot (and under the ground, so it stands in a slope), bending a little on its way up.
    const along = (t: number): Vec3 => [lx * t * t + Math.sin(t * 3 + turn) * girth * 0.5, top * t, lz * t * t + Math.cos(t * 2.3 + turn) * girth * 0.5];
    const stem: number[][] = [[0, -h * 0.07, 0, girth * 1.5]];
    for (const [t, thick] of [[0.12, 1.1], [0.45, 0.85], [0.8, 0.66], [1, 0.5]] as const) stem.push([...along(t), girth * thick]);
    parts.push({ shape: 'chain', tag: 'bark', points: detail === 0 ? [stem[0]!, stem[stem.length - 1]!] : stem });
    const count = Math.max(2, Math.round(p.limbs ?? habit.limbs)), clump = habit.clump * h * (p.crown ?? 1);
    const clumps: Clump[] = [];
    const leaves = (at: Vec3, size: number): void => {
        const c = clump * size * (0.85 + 0.4 * r());
        clumps.push({ at, radii: [c * (0.9 + 0.25 * r()), c * habit.flat, c * (0.9 + 0.25 * r())] });
    };
    for (let i = 0; i < count; i++) {
        // Round the trunk by the golden angle, so no two limbs stand over each other, each from a little higher than the last.
        const a = turn + i * 2.39996 + (r() - 0.5) * 0.5, t = 0.6 + 0.4 * (i / (count - 1)), from = along(t);
        const rise = (habit.rise + (r() - 0.5) * 22) * Math.PI / 180, len = habit.reach * h * (p.spread ?? 1) * (0.8 + 0.4 * r());
        const dx = Math.cos(a) * Math.cos(rise), dy = Math.sin(rise), dz = Math.sin(a) * Math.cos(rise);
        const mid: Vec3 = [from[0] + dx * len * 0.55, from[1] + dy * len * 0.55 + len * 0.06, from[2] + dz * len * 0.55];
        const end: Vec3 = [from[0] + dx * len, from[1] + dy * len + len * 0.2, from[2] + dz * len];
        if (detail > 0) parts.push({ shape: 'chain', tag: 'bark', points: [[...from, girth * 0.46], [...mid, girth * 0.3], [...end, girth * 0.16]] });
        leaves(end, 1);
        if (detail > 1) {
            // A twig off the limb's middle, to one side, with a smaller clump of its own: what fills a crown between its limbs.
            const b = a + (r() < 0.5 ? 1 : -1) * (0.7 + 0.5 * r()), tl = len * (0.45 + 0.2 * r());
            const tip: Vec3 = [mid[0] + Math.cos(b) * tl * 0.8, mid[1] + tl * 0.5, mid[2] + Math.sin(b) * tl * 0.8];
            parts.push({ shape: 'chain', tag: 'bark', points: [[...mid, girth * 0.24], [...tip, girth * 0.12]] });
            leaves(tip, 0.72);
        }
    }
    // The leader: the crown's top stands over the trunk.
    const crest = along(1);
    leaves([crest[0], crest[1] + clump * habit.flat * 0.7, crest[2]], shape === 'tall' ? 1.05 : 1.2);
    if (shape === 'tall') for (const t of [0.72, 0.86]) { const at = along(t); leaves([at[0] + (r() - 0.5) * clump, at[1], at[2] + (r() - 0.5) * clump], 0.95); }
    if (detail === 0) {
        // From far off a crown is its outline: one body as large as all its clumps together, and its top.
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (const c of clumps) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, c.at[k]! - c.radii[k]! * 0.9); hi[k] = Math.max(hi[k]!, c.at[k]! + c.radii[k]! * 0.9); }
        parts.push({ shape: 'ellipsoid', tag: 'leaf', at: [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2], radii: [(hi[0]! - lo[0]!) / 2, (hi[1]! - lo[1]!) / 2, (hi[2]! - lo[2]!) / 2] });
    } else {
        for (const c of clumps) parts.push({ shape: 'ellipsoid', tag: 'leaf', at: c.at, radii: c.radii, rotate: [(r() - 0.5) * 24, r() * 360, (r() - 0.5) * 24] });
    }
    return { parts, clumps };
}

export function tree(mesh: PolyMesh, p: TreeParams): PolyMesh {
    if (!(p.height > 0)) throw new Error(`height ${p.height} must be above 0: the top of the crown, in the model's units`);
    if (p.shape !== undefined && !TREE_SHAPES.includes(p.shape)) throw new Error(`shape ${JSON.stringify(p.shape)} must be one of ${TREE_SHAPES.join(', ')}`);
    const detail = p.detail ?? 2;
    if (![0, 1, 2].includes(detail)) throw new Error('detail is 2 (the tree), 1 (coarser, no twigs) or 0 (a stem and the outline of its crown, for far off)');
    if (p.leaves !== undefined && p.leaves !== 'cards' && p.leaves !== 'solid') throw new Error('leaves is cards (flat sprigs cut out by a picture) or solid (one smooth body)');
    for (const key of ['trunk', 'spread', 'crown'] as const) if (p[key] !== undefined && !(p[key]! > 0)) throw new Error(`${key} ${p[key]} must be above 0`);
    const h = p.height, bark = p.bark ?? BARK, leaf = p.leaf ?? LEAF;
    const cards = detail > 0 && (p.leaves ?? 'cards') === 'cards';
    const resolution = detail === 2 ? 112 : detail === 1 ? 60 : 24;
    const grown = growTree(p);
    const parts = cards ? grown.wood : [...grown.wood, ...grown.crown];
    // Wood thinner than a cell of the skin's grid would vanish from it: a twig is drawn no thinner than the grid can hold.
    let lo = Infinity, hi = -Infinity;
    for (const part of parts) for (const q of part.points ?? []) for (let k = 0; k < 3; k++) { lo = Math.min(lo, q[k]! - q[3]!); hi = Math.max(hi, q[k]! + q[3]!); }
    for (const part of parts) if (part.shape === 'ellipsoid') for (let k = 0; k < 3; k++) { lo = Math.min(lo, part.at![k]! - part.radii![k]!); hi = Math.max(hi, part.at![k]! + part.radii![k]!); }
    const least = Math.max(hi - lo, h * (cards ? 0.6 : 1)) / resolution * 0.95;
    const held = parts.map((part) => part.points ? { ...part, points: part.points.map((q) => [q[0]!, q[1]!, q[2]!, Math.max(q[3]!, least)]) }
        : part.radii ? { ...part, radii: [Math.max(part.radii[0]!, least), Math.max(part.radii[1]!, least), Math.max(part.radii[2]!, least)] as Vec3 } : part);
    let out = organic(mesh, {
        parts: held,
        resolution,
        blend: h * (detail === 0 ? 0.035 : 0.024),
        ...(detail > 0 && !cards ? { noise: { amplitude: h * 0.012, scale: h * 0.12, octaves: 2, seed: p.seed ?? 1 } } : {}),
        ...(p.at ? { at: p.at } : {}),
    });
    out = paint(out, { faces: 'bark', color: bark });
    // A crown is lit from above and deep underneath: what makes it read as clumps, and not as one balloon.
    const lit = [Math.min(leaf[0]! * 2.3 + 0.03, 1), Math.min(leaf[1]! * 1.65, 1), leaf[2]! * 1.3], deep = [leaf[0]! * 0.42, leaf[1]! * 0.55, leaf[2]! * 0.75];
    if (!cards) {
        out = paint(out, { faces: 'leaf', color: leaf });
        out = stain(out, { faces: 'leaf', color: lit, facing: [0, 1, 0], threshold: 0.2, softness: 0.6, amount: 0.75 });
        out = stain(out, { faces: 'leaf', color: deep, facing: [0, -1, 0], threshold: 0.1, softness: 0.5, amount: 0.7 });
        if (detail > 0) out = stain(out, { faces: 'leaf', color: deep, where: 'cavity', amount: 0.4 });
        // Every face reads the solid corner of a leaf picture, should it be drawn with one: a far tree shares its material with the near ones.
        return { ...out, faces: out.faces.map((f) => ({ ...f, cornerUvs: f.v.map(() => [LEAF_CORNER, LEAF_CORNER] as const) })) };
    }
    // The wood reads the leaf picture too (a model has one): at its corner, which is solid white, so bark is its own colour.
    out = { ...out, faces: out.faces.map((f) => (f.tag === 'bark' ? { ...f, cornerUvs: f.v.map(() => [LEAF_CORNER, LEAF_CORNER] as const) } : f)) };
    // The leaves: a few large tufts over each clump, facing out of it and overlapping, lighter toward its top and deeper under it
    // and inside. A crown painted this way is masses with a leafy edge, as it is seen from where a game stands, and not a count of leaves.
    const r = dice((p.seed ?? 1) * 7 + 3), off = p.at ?? [0, 0, 0];
    const perClump = detail === 2 ? 10 : 5;
    // A card is lit as the crown it is part of, not as the flat thing it is: from the way out of its clump and out of the whole crown.
    const sum = [0, 0, 0];
    for (const clump of grown.clumps) for (let k = 0; k < 3; k++) sum[k]! += (off[k]! + clump.at[k]!) / (grown.clumps.length || 1);
    const heart: Vec3 = [sum[0]!, sum[1]!, sum[2]!];
    for (const clump of grown.clumps) {
        const size = Math.max(clump.radii[0], clump.radii[2]) * (detail === 2 ? 1.5 : 1.8);
        for (let c = 0; c < perClump; c++) {
            // Ways out of the clump spread evenly round it (a golden turn apart), more of them up than down: the underside of a
            // crown is seen least and shades itself, and tufts thrown at random leave one side bare.
            const y = Math.min(-0.35 + 1.3 * ((c + 0.5) / perClump) + (r() - 0.5) * 0.2, 1), a = c * 2.39996 + r() * 0.6, flat = Math.sqrt(Math.max(1 - y * y, 0));
            const d: Vec3 = [Math.cos(a) * flat, y, Math.sin(a) * flat];
            const inside = c % 5 === 4 ? 0.2 : 0.55;
            const mid: Vec3 = [off[0]! + clump.at[0] + d[0] * clump.radii[0] * inside, off[1]! + clump.at[1] + d[1] * clump.radii[1] * inside, off[2]! + clump.at[2] + d[2] * clump.radii[2] * inside];
            // The tuft faces out of the clump, tipped a little its own way and turned about that at random.
            const tip: Vec3 = [d[0] + (r() - 0.5) * 0.5, d[1] + (r() - 0.5) * 0.5, d[2] + (r() - 0.5) * 0.5];
            const tl = Math.hypot(tip[0], tip[1], tip[2]) || 1;
            const n: Vec3 = [tip[0] / tl, tip[1] / tl, tip[2] / tl];
            const pick: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
            const side: Vec3 = [n[1] * pick[2] - n[2] * pick[1], n[2] * pick[0] - n[0] * pick[2], n[0] * pick[1] - n[1] * pick[0]];
            const sl = Math.hypot(side[0], side[1], side[2]) || 1, roll = r() * Math.PI * 2;
            const u: Vec3 = [side[0] / sl, side[1] / sl, side[2] / sl];
            const w: Vec3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
            const cu = Math.cos(roll), su = Math.sin(roll);
            const U: Vec3 = [u[0] * cu + w[0] * su, u[1] * cu + w[1] * su, u[2] * cu + w[2] * su];
            const V: Vec3 = [w[0] * cu - u[0] * su, w[1] * cu - u[1] * su, w[2] * cu - u[2] * su];
            const s = size * (0.85 + 0.3 * r()) / 2;
            const out3 = (q: Vec3): Vec3 => {
                const a2: Vec3 = [q[0] - off[0]! - clump.at[0], q[1] - off[1]! - clump.at[1], q[2] - off[2]! - clump.at[2]], b2: Vec3 = [q[0] - heart[0], q[1] - heart[1], q[2] - heart[2]];
                const la = Math.hypot(a2[0], a2[1], a2[2]) || 1, lb = Math.hypot(b2[0], b2[1], b2[2]) || 1;
                const s2: Vec3 = [a2[0] / la + b2[0] / lb, a2[1] / la + b2[1] / lb + 0.25, a2[2] / la + b2[2] / lb], ls = Math.hypot(s2[0], s2[1], s2[2]) || 1;
                return [s2[0] / ls, s2[1] / ls, s2[2] / ls];
            };
            const corner = (a1: number, b1: number): Vec3 => [mid[0] + U[0] * a1 * s + V[0] * b1 * s, mid[1] + U[1] * a1 * s + V[1] * b1 * s, mid[2] + U[2] * a1 * s + V[2] * b1 * s];
            const up = inside > 0.5 ? d[1] : d[1] * 0.3 - 0.35, tone = up >= 0 ? lit : deep, by = Math.min(Math.abs(up) * 0.5, 0.5), vary = 0.94 + 0.12 * r();
            const color = [0, 1, 2].map((k) => Math.min((leaf[k]! + (tone[k]! - leaf[k]!) * by) * vary, 1));
            const before = out.faces.length;
            const quad = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], lit4 = quad.map(out3);
            out = append(out, quad, [[0, 1, 2, 3]], { tag: 'leaf', color });
            const flip = r() < 0.5;
            const uv: [number, number][] = [[LEAF_EDGE, LEAF_EDGE], [1 - LEAF_EDGE, LEAF_EDGE], [1 - LEAF_EDGE, 1 - LEAF_EDGE], [LEAF_EDGE, 1 - LEAF_EDGE]];
            out = { ...out, faces: out.faces.map((f, i) => (i === before ? { ...f, cornerUvs: flip ? [uv[1]!, uv[0]!, uv[3]!, uv[2]!] : uv, cornerNormals: lit4 } : f)) };
        }
    }
    return out;
}

/** Where in the leaf picture the wood reads (a solid white corner), and how far in from every edge the tuft a card shows lies. */
const LEAF_CORNER = 0.03, LEAF_EDGE = 0.1;

/**
 * The picture a tree's leaf cards are cut out by: a tuft of leaves, solid at its heart and leaves at its rim, white (a card's own colour is the leaf's), clear round
 * it, with a solid corner the wood reads. `size` pixels a side, RGBA.
 */
export function treeLeafPicture(size = 256): Uint8Array {
    const rgba = new Uint8Array(size * size * 4), r = dice(91);
    const put = (x: number, y: number, tone: number, alpha: number): void => {
        if (x < 0 || y < 0 || x >= size || y >= size) return;
        const k = (y * size + x) * 4, a = Math.round(alpha * 255);
        if (a <= rgba[k + 3]!) return;
        const t = Math.round(tone * 255);
        rgba[k] = t; rgba[k + 1] = t; rgba[k + 2] = t; rgba[k + 3] = a;
    };
    // A leaf is a pointed oval lying along its own way, lighter toward its edge than along its rib.
    const lo = size * LEAF_EDGE, span = size - lo * 2, cx = lo + span / 2, cy = lo + span / 2;
    const leafAt = (ox: number, oy: number, turn: number, long: number, wide: number, shade: number): void => {
        const ca = Math.cos(turn), sa = Math.sin(turn), reach = Math.ceil(long);
        for (let y = Math.floor(oy - reach); y <= oy + reach; y++) for (let x = Math.floor(ox - reach); x <= ox + reach; x++) {
            const px = x - ox, py = y - oy, along = (px * ca + py * sa) / long, across = (-px * sa + py * ca) / wide;
            if (along < -1 || along > 1) continue;
            // A pointed oval: as wide as the way along leaves it.
            const edge = (1 - along * along) * (0.55 + 0.45 * (along < 0 ? 1 : 1 - along * 0.6));
            const inside = edge - Math.abs(across);
            if (inside <= 0) continue;
            // Where a leaf lies over the one under it its rim is in that one's shade: what parts leaf from leaf in a solid mass.
            put(x, y, shade * (0.74 + 0.26 * Math.min(inside * 2.4, 1)) * (0.9 + 0.1 * (along + 1) / 2), Math.min(inside * wide * 0.6, 1));
        }
    };
    // A tuft: leaves lying outward round a middle in rings, the inner over the outer as scales lie, close enough to leave no sky
    // inside it. Its heart is deeper than its rim, as the middle of a mass of leaves is.
    for (const [count, out, long] of [[4, 0.03, 0.085], [8, 0.09, 0.09], [12, 0.17, 0.095], [16, 0.25, 0.095], [20, 0.33, 0.095]] as const) {
        for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2 + r() * 0.5, d = span * out * (0.9 + 0.15 * r());
            leafAt(cx + Math.cos(a) * d, cy + Math.sin(a) * d, a + (r() - 0.5) * 0.8, span * long * (0.9 + 0.25 * r()), span * 0.05 * (0.9 + 0.25 * r()), (0.74 + 0.6 * out) * (0.9 + 0.1 * r()));
        }
    }
    // The corners the wood reads, whichever way up the picture is taken: solid white.
    const block = Math.ceil(size * LEAF_CORNER * 2.2);
    for (const [bx, by] of [[0, 0], [size - block, 0], [0, size - block], [size - block, size - block]] as const) {
        for (let y = by; y < by + block; y++) for (let x = bx; x < bx + block; x++) { const k = (y * size + x) * 4; rgba[k] = 255; rgba[k + 1] = 255; rgba[k + 2] = 255; rgba[k + 3] = 255; }
    }
    return rgba;
}
