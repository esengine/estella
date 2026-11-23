// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  groomGrow.ts — a groom grown from parameters: hair made in the engine rather than brought in from a DCC tool.
 *
 *        A `.esgroom` that has `grow` in place of `curves` is a recipe. Each of its groups is grown the way a hair tool's node chain does it:
 *
 *          1. Roots are scattered on the scalp, an ellipsoid, above a hairline that runs from the forehead past the ears to the nape.
 *          2. Guides: a few hundred strands are walked from their roots, combed away from the part (or along `comb`), lifted off the scalp
 *             by `lift`, bent down by gravity over `stiffness` metres, and kept off the head and the `collide` ellipsoids (shoulders, back).
 *             A strand from higher on the head lies further out (`volume`), so the crown's hair falls over the nape's.
 *          3. Strands: every rendered strand follows the guides nearest its root, combed the same way (never across the part).
 *          4. Clump: a strand draws toward its nearest guide toward the tip, so hair hangs in locks rather than as a sheet.
 *          5. Wave, frizz and flyaways shape each strand; `cut` trims at a height and `lengthJitter` staggers the ends.
 *
 *        Deterministic: the same recipe and seed grow the same hair on every device. Positions are in metres, Y up, as a curves file's.
 */
import type { CurveGroup, CurveSet, GroomCurves } from './groomFormat';

export type Vec3 = [number, number, number];

/** An ellipsoid: a head, a shoulder, a back. */
export interface GrowEllipsoid {
    center: Vec3;
    /** Half its size along x, y and z, in metres. */
    radii: Vec3;
}

/** The scalp the roots grow from, and where on it hair grows. */
export interface GrowScalp extends GrowEllipsoid {
    /**
     * The hairline, as the elevation it sits at (degrees above the scalp's middle, negative below) at the forehead, over the ears and at the
     * nape; between them it runs smoothly. Hair grows above it.
     */
    hairline?: { front?: number; side?: number; back?: number };
}

/** The parameters one group of hair grows from. Lengths in metres unless a field says otherwise. */
export interface GrowGroup {
    name?: string;
    scalp: GrowScalp;
    /** Strands drawn. A full head of long hair reads as one from about 20000. */
    strands?: number;
    /** Guide strands, which the drawn ones follow and clump to. */
    guides?: number;
    /** Points per strand: more for longer or wavier hair. */
    points?: number;
    /** The length of a strand, root to tip. */
    length?: number;
    /** How much shorter a strand may be at random: 0.2 has them end anywhere between 80% and 100% of `length`. */
    lengthJitter?: number;
    /**
     * Where the hair is parted: from the hairline at `azimuth` degrees (0 the middle of the forehead, positive toward +x) back over the top to
     * the crown at `crown` degrees of elevation on the back of the head (90 the very top). Hair is combed away from the part. Absent: no part,
     * every strand combed toward `comb`.
     */
    part?: { azimuth?: number; crown?: number };
    /** A direction the hair is combed toward (default straight back, [0, 0, -1]); with a part, mixed in by `combWeight`. */
    comb?: Vec3;
    /** How much of `comb` a parted strand takes, 0 to 1. */
    combWeight?: number;
    /** How far a strand leaves the scalp along its normal before it is combed flat: 0 lies flat, 1 stands straight out. */
    lift?: number;
    /** Over how many metres a strand keeps the direction it was combed in before it hangs: more is stiffer, fuller hair. */
    stiffness?: number;
    /** How far out the hair from the top of the head lies over the hair from below it: the hair's thickness on the head. */
    volume?: number;
    /** What else the hair rests on: shoulders, the back, the chest. The scalp is always one. */
    collide?: GrowEllipsoid[];
    /** How much a strand draws toward its lock (its nearest guide) at the tip, 0 to 1. */
    clump?: number;
    /** How the clumping grows along the strand: 1 evenly, more keeps the roots apart and gathers only the ends. */
    clumpShape?: number;
    /** A wave across each lock: `amplitude` either way, one wave per `wavelength`, starting `start` of the way down (0 to 1). */
    wave?: { amplitude?: number; wavelength?: number; start?: number };
    /** Each point's random stray, at the tip: fine, unruly hair. */
    frizz?: number;
    /** The share of strands (0 to 1) that stray far more than `frizz` says: the loose hairs round a head. */
    flyaway?: number;
    /** A cut: strands end where they reach this height (`y`), give or take `jitter`. */
    cut?: { y: number; jitter?: number };
    /** sRGB colours, 0 to 1, at the root and the tip; each strand lighter or darker by up to `jitter`. */
    color?: { root?: Vec3; tip?: Vec3; jitter?: number };
    /** The strand's width at the root and at the tip, in centimetres (a human hair is about 0.008). */
    width?: { root?: number; tip?: number };
}

/** What a `.esgroom`'s `grow` holds: one entry per group, in order; the document's `groups` hold the settings of the same groups. */
export interface GrowRecipe {
    seed?: number;
    groups: GrowGroup[];
}

/** The most strands and points a group may ask for: past these a recipe is a mistake, not a head of hair. */
export const GROW_LIMITS = Object.freeze({ strands: 200_000, guides: 4_000, points: 64 });

const DEG = Math.PI / 180;

function rng(seed: number): () => number {
    let a = (seed >>> 0) || 0x9e3779b9;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
function norm(a: Vec3, fallback: Vec3 = [0, -1, 0]): Vec3 {
    const l = len(a);
    return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : fallback;
}
const smooth = (x: number): number => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

function num(v: unknown, fallback: number, min: number, max: number): number {
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}
function vec(v: unknown, fallback: Vec3): Vec3 {
    return Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? [v[0], v[1], v[2]] : fallback;
}
function ellipsoid(e: Partial<GrowEllipsoid> | undefined, what: string): GrowEllipsoid {
    const radii = vec(e?.radii, [0, 0, 0]);
    if (!(radii[0] > 0 && radii[1] > 0 && radii[2] > 0)) throw new Error(`${what} needs "radii", three sizes above zero in metres`);
    return { center: vec(e?.center, [0, 0, 0]), radii };
}

/** The elevation the hairline sits at, at azimuth `az` (radians, 0 the forehead). */
function hairlineAt(h: Required<NonNullable<GrowScalp['hairline']>>, az: number): number {
    const a = Math.abs(az) / DEG;
    return (a <= 90 ? h.front + (h.side - h.front) * smooth(a / 90) : h.side + (h.back - h.side) * smooth((a - 90) / 90)) * DEG;
}

/** A point on the ellipsoid in the direction (on the unit sphere) `d`, and the surface's normal there. */
function onEllipsoid(e: GrowEllipsoid, d: Vec3): { p: Vec3; n: Vec3 } {
    const p: Vec3 = [e.center[0] + d[0] * e.radii[0], e.center[1] + d[1] * e.radii[1], e.center[2] + d[2] * e.radii[2]];
    const n = norm([d[0] / e.radii[0], d[1] / e.radii[1], d[2] / e.radii[2]]);
    return { p, n };
}
const dirAt = (az: number, el: number): Vec3 => [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];

/** Out of the ellipsoid grown by `by`, if inside it. */
function pushOut(p: Vec3, e: GrowEllipsoid, by: number): Vec3 {
    const rx = e.radii[0] + by, ry = e.radii[1] + by, rz = e.radii[2] + by;
    const qx = (p[0] - e.center[0]) / rx, qy = (p[1] - e.center[1]) / ry, qz = (p[2] - e.center[2]) / rz;
    const q = Math.hypot(qx, qy, qz);
    if (q >= 1 || q < 1e-9) return p;
    return [e.center[0] + (qx / q) * rx, e.center[1] + (qy / q) * ry, e.center[2] + (qz / q) * rz];
}

interface Root { p: Vec3; n: Vec3; d: Vec3; az: number; el: number; layer: number; flow: Vec3 }

/** A group's parameters with every default in, checked. */
function resolve(g: GrowGroup, index: number) {
    const what = `grow group ${index}${g.name ? ` (${g.name})` : ''}`;
    if (!g || typeof g !== 'object') throw new Error(`${what} is not an object`);
    const scalp = ellipsoid(g.scalp, `${what}: "scalp"`);
    const h = g.scalp.hairline ?? {};
    return {
        what,
        name: typeof g.name === 'string' ? g.name : `Hair${index}`,
        scalp,
        hairline: { front: num(h.front, 30, -90, 90), side: num(h.side, 0, -90, 90), back: num(h.back, -40, -90, 90) },
        strands: Math.round(num(g.strands, 20000, 1, GROW_LIMITS.strands)),
        guides: Math.round(num(g.guides, 400, 1, GROW_LIMITS.guides)),
        points: Math.round(num(g.points, 24, 2, GROW_LIMITS.points)),
        length: num(g.length, 0.5, 0.001, 10),
        lengthJitter: num(g.lengthJitter, 0.1, 0, 1),
        part: g.part ? { azimuth: num(g.part.azimuth, 0, -180, 180) * DEG, crown: num(g.part.crown, 70, -90, 90) * DEG } : null,
        comb: norm(vec(g.comb, [0, 0, -1]), [0, 0, -1]),
        combWeight: num(g.combWeight, 0, 0, 1),
        lift: num(g.lift, 0.15, 0, 1),
        stiffness: num(g.stiffness, 0.06, 0.001, 10),
        volume: num(g.volume, 0.02, 0, 1),
        collide: (Array.isArray(g.collide) ? g.collide : []).map((e, i) => ellipsoid(e, `${what}: collide[${i}]`)),
        clump: num(g.clump, 0.5, 0, 1),
        clumpShape: num(g.clumpShape, 1.5, 0.1, 10),
        wave: { amplitude: num(g.wave?.amplitude, 0, 0, 1), wavelength: num(g.wave?.wavelength, 0.1, 0.001, 10), start: num(g.wave?.start, 0.2, 0, 1) },
        frizz: num(g.frizz, 0.002, 0, 1),
        flyaway: num(g.flyaway, 0.01, 0, 1),
        cut: g.cut && typeof g.cut.y === 'number' && Number.isFinite(g.cut.y) ? { y: g.cut.y, jitter: num(g.cut.jitter, 0.01, 0, 10) } : null,
        rootColor: vec(g.color?.root, [0.32, 0.22, 0.14]),
        tipColor: vec(g.color?.tip, [0.62, 0.48, 0.32]),
        colorJitter: num(g.color?.jitter, 0.08, 0, 1),
        rootWidth: num(g.width?.root, 0.008, 0, 10),
        tipWidth: num(g.width?.tip, 0.004, 0, 10),
    };
}
type Resolved = ReturnType<typeof resolve>;

/** The part line, as points on the scalp from the forehead's hairline to the crown. */
function partLine(r: Resolved): Vec3[] {
    if (!r.part) return [];
    const az0 = r.part.azimuth;
    const el0 = hairlineAt(r.hairline, az0);
    const a = dirAt(az0, el0);
    const b = dirAt(Math.PI, r.part.crown);
    const out: Vec3[] = [];
    // Along the great circle from a to b, the short way over the top.
    const omega = Math.acos(Math.min(1, Math.max(-1, dot(a, b))));
    for (let i = 0; i <= 32; i++) {
        const t = i / 32;
        const d: Vec3 = omega < 1e-6 ? a : norm(add(scale(a, Math.sin((1 - t) * omega) / Math.sin(omega)), scale(b, Math.sin(t * omega) / Math.sin(omega))));
        out.push(onEllipsoid(r.scalp, d).p);
    }
    return out;
}

/** The way a root is combed: away from the nearest point of the part, along the scalp; toward `comb` where there is no part. */
function combAt(r: Resolved, line: Vec3[], p: Vec3, n: Vec3): Vec3 {
    const flat = (v: Vec3): Vec3 => sub(v, scale(n, dot(v, n)));
    const toward = flat(r.comb);
    if (line.length === 0) return norm(toward, norm(flat([0, -1, 0]), [0, 0, -1]));
    let best = line[0]!, bestD = Infinity;
    for (let i = 0; i + 1 < line.length; i++) {
        const a = line[i]!, ab = sub(line[i + 1]!, a);
        const t = clamp01(dot(sub(p, a), ab) / Math.max(dot(ab, ab), 1e-12));
        const q = add(a, scale(ab, t));
        const d = len(sub(p, q));
        if (d < bestD) { bestD = d; best = q; }
    }
    let away = flat(sub(p, best));
    // On the part itself: to the side the point is on.
    if (len(away) < 1e-6) away = flat([Math.sign(p[0] - r.scalp.center[0]) || 1, 0, 0]);
    return norm(add(norm(away), scale(norm(toward, [0, 0, 0]), r.combWeight)), norm(away));
}

/** Roots on the scalp above its hairline: evenly spread (a Fibonacci sphere) or at random. */
function scatter(r: Resolved, line: Vec3[], count: number, random: (() => number) | null): Root[] {
    const lowest = Math.sin(Math.min(r.hairline.front, r.hairline.side, r.hairline.back) * DEG);
    const at = (y: number, az: number): Root | null => {
        const el = Math.asin(Math.min(1, Math.max(-1, y)));
        const hl = hairlineAt(r.hairline, az);
        if (el < hl) return null;
        const d = dirAt(az, el);
        const { p, n } = onEllipsoid(r.scalp, d);
        return { p, n, d, az, el, layer: clamp01((el - hl) / Math.max(Math.PI / 2 - hl, 1e-3)), flow: combAt(r, line, p, n) };
    };
    // Even y over the band above the lowest hairline is even area on the sphere (Archimedes).
    if (random) {
        const roots: Root[] = [];
        for (let i = 0; i < count * 50 && roots.length < count; i++) {
            const root = at(lowest + (1 - lowest) * random(), (random() * 2 - 1) * Math.PI);
            if (root) roots.push(root);
        }
        return roots;
    }
    // Evenly: a Fibonacci lattice over the band, made denser until as many of its points as were asked for lie above the hairline.
    const golden = Math.PI * (3 - Math.sqrt(5));
    let total = count;
    for (let attempt = 0; attempt < 8; attempt++) {
        const roots: Root[] = [];
        for (let k = 0; k < total; k++) {
            const root = at(lowest + (1 - lowest) * ((k + 0.5) / total), ((k * golden) % (2 * Math.PI)) - Math.PI);
            if (root) roots.push(root);
        }
        if (roots.length >= count || roots.length === 0 && attempt > 0) return roots.slice(0, count);
        total = Math.ceil(total * Math.min(count / Math.max(roots.length, 1), 50) * 1.02) + 1;
    }
    return [];
}

/** A guide walked from its root: combed, lifted, hanging under gravity, kept off the head and what it rests on. */
function walk(r: Resolved, root: Root, out: Vec3[]): void {
    const seg = r.length / (r.points - 1);
    const off = 0.0015 + r.volume * root.layer;
    let dir = norm(add(scale(root.flow, 1 - r.lift), scale(root.n, r.lift)));
    let p = root.p;
    out.length = 0;
    out.push(p);
    for (let k = 1; k < r.points; k++) {
        dir = norm(add(dir, [0, -seg / r.stiffness, 0]));
        let q = add(p, scale(dir, seg));
        q = keepOff(r, q, off);
        // The direction it actually went: along a surface it slid over, not into it.
        dir = norm(sub(q, p), dir);
        // Kept a segment long, so a strand pushed round the head does not stretch.
        q = add(p, scale(dir, seg));
        q = keepOff(r, q, off);
        out.push(q);
        p = q;
    }
}

function keepOff(r: Resolved, p: Vec3, off: number): Vec3 {
    let q = pushOut(p, r.scalp, off);
    for (const e of r.collide) q = pushOut(q, e, off * 0.5);
    return q;
}

const hyp3 = (x: number, y: number, z: number): number => Math.sqrt(x * x + y * y + z * z);

/** The point `upTo` of the way along the polyline of `n` points in `src`, laid out again as `n` points evenly along it, into `dst` at `at`. */
function resampleInto(src: Float64Array, n: number, upTo: number, cum: Float64Array, dst: Float32Array, at: number): void {
    cum[0] = 0;
    for (let i = 1; i < n; i++) {
        const a = (i - 1) * 3, b = i * 3;
        cum[i] = cum[i - 1]! + hyp3(src[b]! - src[a]!, src[b + 1]! - src[a + 1]!, src[b + 2]! - src[a + 2]!);
    }
    const total = cum[n - 1]! * upTo;
    let j = 1;
    for (let k = 0; k < n; k++) {
        const s = (total * k) / (n - 1);
        while (j < n - 1 && cum[j]! < s) j++;
        const span = cum[j]! - cum[j - 1]!;
        const t = span > 0 ? clamp01((s - cum[j - 1]!) / span) : 0;
        const a = (j - 1) * 3, b = j * 3, o = at + k * 3;
        dst[o] = src[a]! + (src[b]! - src[a]!) * t;
        dst[o + 1] = src[a + 1]! + (src[b + 1]! - src[a + 1]!) * t;
        dst[o + 2] = src[a + 2]! + (src[b + 2]! - src[a + 2]!) * t;
    }
}

/** Out of the ellipsoid grown by `by`, in place, for the point at `i` of `p`. */
function pushOutAt(p: Float64Array, i: number, e: GrowEllipsoid, by: number): void {
    const rx = e.radii[0] + by, ry = e.radii[1] + by, rz = e.radii[2] + by;
    const qx = (p[i]! - e.center[0]) / rx, qy = (p[i + 1]! - e.center[1]) / ry, qz = (p[i + 2]! - e.center[2]) / rz;
    const q = Math.sqrt(qx * qx + qy * qy + qz * qz);
    if (q >= 1 || q < 1e-9) return;
    p[i] = e.center[0] + (qx / q) * rx; p[i + 1] = e.center[1] + (qy / q) * ry; p[i + 2] = e.center[2] + (qz / q) * rz;
}

/** Grows one group's strands and guides. */
function growGroup(r: Resolved, seed: number): CurveGroup {
    const random = rng(seed);
    const line = partLine(r);
    const guideRoots = scatter(r, line, r.guides, null);
    if (guideRoots.length === 0) throw new Error(`${r.what}: no scalp lies above its hairline, so nothing grows`);
    const n = r.points;
    const G = guideRoots.length;
    // Every guide's points, guide after guide: n xyz each.
    const guides = new Float64Array(G * n * 3);
    const walked: Vec3[] = [];
    guideRoots.forEach((root, gi) => { walk(r, root, walked); walked.forEach((q, k) => guides.set(q, (gi * n + k) * 3)); });
    const gx = new Float64Array(G), gy = new Float64Array(G), gz = new Float64Array(G);
    const fx = new Float64Array(G), fy = new Float64Array(G), fz = new Float64Array(G);
    guideRoots.forEach((g, i) => { gx[i] = g.p[0]; gy[i] = g.p[1]; gz[i] = g.p[2]; fx[i] = g.flow[0]; fy[i] = g.flow[1]; fz[i] = g.flow[2]; });
    // The guide roots in a grid of cells about two guides across, so a strand looks at the guides round it and not at all of them.
    let area = 0;
    { const [a, b, c] = r.scalp.radii; area = 4 * Math.PI * Math.pow((Math.pow(a * b, 1.6) + Math.pow(a * c, 1.6) + Math.pow(b * c, 1.6)) / 3, 1 / 1.6); }
    const cell = Math.max(2.5 * Math.sqrt(area / G), 1e-4);
    const cellOf = (v: number): number => Math.floor(v / cell);
    // Small enough to stay a small integer, which a Map looks up fast: a cell index is within ±512 for any head.
    const keyOf = (x: number, y: number, z: number): number => ((x + 512) & 1023) * 1048576 + ((y + 512) & 1023) * 1024 + ((z + 512) & 1023);
    const grid = new Map<number, number[]>();
    for (let i = 0; i < G; i++) {
        const key = keyOf(cellOf(gx[i]!), cellOf(gy[i]!), cellOf(gz[i]!));
        let list = grid.get(key);
        if (!list) grid.set(key, list = []);
        list.push(i);
    }
    // Each lock's wave starts where its own does.
    const phase = guideRoots.map(() => random() * Math.PI * 2);
    const roots = scatter(r, line, r.strands, random);

    const R = roots.length;
    const positions = new Float32Array(R * n * 3);
    const radii = new Float32Array(R * n);
    const colors = new Uint8Array(R * n * 4);
    const rootUV = new Float32Array(R * 2);
    const clumpIds = new Uint32Array(R);
    const pts = new Float64Array(n * 3);
    const cum = new Float64Array(n);
    const nearI = new Int32Array(4), nearD = new Float64Array(4), w = new Float64Array(4);
    const cx = r.scalp.center[0], cz = r.scalp.center[2];
    const amp = r.wave.amplitude, waveK = (2 * Math.PI) / r.wave.wavelength;
    const clumpAt = Float64Array.from({ length: n }, (_, k) => r.clump * Math.pow(k / (n - 1), r.clumpShape));
    let found = 0, rfx = 0, rfy = 0, rfz = 0, rpx = 0, rpy = 0, rpz = 0;
    const consider = (i: number): void => {
        if (fx[i]! * rfx + fy[i]! * rfy + fz[i]! * rfz < 0.2) return;
        const dx = gx[i]! - rpx, dy = gy[i]! - rpy, dz = gz[i]! - rpz;
        const d = dx * dx + dy * dy + dz * dz;
        if (found === 4 && d >= nearD[3]!) return;
        let at = found < 4 ? found++ : 3;
        while (at > 0 && nearD[at - 1]! > d) { nearD[at] = nearD[at - 1]!; nearI[at] = nearI[at - 1]!; at--; }
        nearD[at] = d; nearI[at] = i;
    };
    let made = 0;
    for (const root of roots) {
        const [px, py, pz] = root.p;
        // The guides nearest this root that are combed the same way: never one from across the part.
        found = 0;
        rfx = root.flow[0]; rfy = root.flow[1]; rfz = root.flow[2]; rpx = px; rpy = py; rpz = pz;
        // The cells round the root; all of them where those hold too few (a sparse patch, or the far side of a part).
        const ix = cellOf(px), iy = cellOf(py), iz = cellOf(pz);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
            const list = grid.get(keyOf(ix + a, iy + b, iz + c));
            if (list) for (const i of list) consider(i);
        }
        if (found < 4) { found = 0; for (let i = 0; i < G; i++) consider(i); }
        if (found === 0) continue;
        let wsum = 0;
        for (let j = 0; j < found; j++) { w[j] = 1 / Math.max(nearD[j]!, 1e-10); wsum += w[j]!; }
        const lock = nearI[0]!;
        const L = lock * n * 3;
        const off = 0.0015 + r.volume * root.layer;
        const fly = random() < r.flyaway;
        const frizz = r.frizz * (fly ? 10 : 1);
        const myPhase = phase[lock]! + (random() - 0.5) * 0.6;
        // Interpolated (the root's own place, moved as the nearby guides move), then clumped toward the lock's own strand toward the tip.
        for (let k = 0; k < n; k++) {
            const c = clumpAt[k]!;
            let x = px, y = py, z = pz;
            for (let j = 0; j < found; j++) {
                const g = nearI[j]! * n * 3, s = w[j]! / wsum;
                x += (guides[g + k * 3]! - guides[g]!) * s;
                y += (guides[g + k * 3 + 1]! - guides[g + 1]!) * s;
                z += (guides[g + k * 3 + 2]! - guides[g + 2]!) * s;
            }
            const tx = guides[L + k * 3]! + (px - guides[L]!) * (1 - r.clump);
            const ty = guides[L + k * 3 + 1]! + (py - guides[L + 1]!) * (1 - r.clump);
            const tz = guides[L + k * 3 + 2]! + (pz - guides[L + 2]!) * (1 - r.clump);
            pts[k * 3] = x + (tx - x) * c; pts[k * 3 + 1] = y + (ty - y) * c; pts[k * 3 + 2] = z + (tz - z) * c;
        }
        // Wave and frizz, across the strand; kept off the head and what it rests on.
        let s = 0;
        for (let k = 1; k < n; k++) {
            const t = k / (n - 1), i = k * 3;
            let ax = pts[i]! - pts[i - 3]!, ay = pts[i + 1]! - pts[i - 2]!, az = pts[i + 2]! - pts[i - 1]!;
            const al = Math.sqrt(ax * ax + ay * ay + az * az);
            s += al;
            const a = amp * smooth((t - r.wave.start) / 0.25);
            if (a > 0 && al > 1e-12) {
                ax /= al; ay /= al; az /= al;
                let ox = pts[i]! - cx, oz = pts[i + 2]! - cz;
                const ol = Math.sqrt(ox * ox + oz * oz);
                if (ol > 1e-9) { ox /= ol; oz /= ol; } else { ox = 0; oz = 1; }
                // Across the strand: along x outward (outward lies flat).
                let sx = ay * oz, sy = az * ox - ax * oz, sz = -ay * ox;
                const sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
                if (sl > 1e-9) { sx /= sl; sy /= sl; sz /= sl; } else { sx = 1; sy = 0; sz = 0; }
                const ph = waveK * s + myPhase, sn = a * Math.sin(ph), cs = 0.35 * a * Math.cos(ph);
                pts[i] += sx * sn + ox * cs; pts[i + 1] += sy * sn; pts[i + 2] += sz * sn + oz * cs;
            }
            if (frizz > 0) {
                const f = frizz * t * t * 2;
                pts[i] += (random() - 0.5) * f; pts[i + 1] += (random() - 0.5) * f; pts[i + 2] += (random() - 0.5) * f;
            }
            pushOutAt(pts, i, r.scalp, off);
            for (const e of r.collide) pushOutAt(pts, i, e, off * 0.5);
        }
        // Where it ends: its own length, and the cut.
        let upTo = 1 - r.lengthJitter * random();
        if (r.cut) {
            const yCut = r.cut.y + (random() - 0.5) * 2 * r.cut.jitter;
            let run = 0, total = 0;
            for (let k = 1; k < n; k++) total += hyp3(pts[k * 3]! - pts[k * 3 - 3]!, pts[k * 3 + 1]! - pts[k * 3 - 2]!, pts[k * 3 + 2]! - pts[k * 3 - 1]!);
            for (let k = 1; k < n; k++) {
                const ay = pts[k * 3 - 2]!, by = pts[k * 3 + 1]!;
                const seg = hyp3(pts[k * 3]! - pts[k * 3 - 3]!, by - ay, pts[k * 3 + 2]! - pts[k * 3 - 1]!);
                if (by < yCut && ay >= yCut) {
                    upTo = Math.min(upTo, (run + seg * ((ay - yCut) / Math.max(ay - by, 1e-9))) / Math.max(total, 1e-9));
                    break;
                }
                run += seg;
            }
        }
        if (upTo <= 0.02) continue;
        resampleInto(pts, n, upTo, cum, positions, made * n * 3);
        const shade = 1 + (random() * 2 - 1) * r.colorJitter;
        for (let k = 0; k < n; k++) {
            const t = k / (n - 1), v = made * n + k;
            radii[v] = ((r.rootWidth + (r.tipWidth - r.rootWidth) * t) / 100) * 0.5;
            for (let c = 0; c < 3; c++) colors[v * 4 + c] = Math.round(clamp01((r.rootColor[c]! + (r.tipColor[c]! - r.rootColor[c]!) * t) * shade) * 255);
            colors[v * 4 + 3] = 255;
        }
        rootUV[made * 2] = root.az / (2 * Math.PI) + 0.5;
        rootUV[made * 2 + 1] = root.el / Math.PI + 0.5;
        clumpIds[made] = lock;
        made++;
    }

    const strands: CurveSet = {
        counts: new Uint16Array(made).fill(n),
        positions: positions.slice(0, made * n * 3),
        radii: radii.slice(0, made * n),
        rootUV: rootUV.slice(0, made * 2),
        colors: colors.slice(0, made * n * 4),
        clumpIds: clumpIds.slice(0, made),
    };
    const guideSet: CurveSet = {
        counts: new Uint16Array(G).fill(n),
        positions: Float32Array.from(guides),
        radii: new Float32Array(G * n).fill((r.rootWidth / 100) * 0.5),
    };
    return { name: r.name, strands, guides: guideSet };
}

/** Every group's parameters checked and filled in, without growing anything: what a tool shows before it grows. Throws on a bad recipe. */
export function checkGrowRecipe(recipe: GrowRecipe): void {
    if (!recipe || !Array.isArray(recipe.groups) || recipe.groups.length === 0) throw new Error('"grow" needs "groups", one or more');
    recipe.groups.forEach((g, i) => resolve(g, i));
}

/** Grows the curves a recipe describes. Throws, saying which group and what, on one it cannot grow. */
export function growGroom(recipe: GrowRecipe): GroomCurves {
    checkGrowRecipe(recipe);
    const seed = Math.round(num(recipe.seed, 1, 0, 2 ** 31));
    return { groups: recipe.groups.map((g, i) => growGroup(resolve(g, i), seed * 7919 + i * 104729)) };
}
