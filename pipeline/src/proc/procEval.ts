// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  procEval.ts — runs a rules graph: plots in, parts out, and what every node did.
 *
 *        Each node is run once, in the order written, over everything its input made. A node that works on plots works on
 *        the plots its `where` and `tag` let through and passes the others on unchanged, and every node passes parts on
 *        unchanged, so a graph reads as a list of things done to a place. Every number may be a sum (`"=w * 0.4"`) worked
 *        out per plot, reading the plot's x, z, w, d, yaw, y, its index i of n, its id, its own numbers and the graph's
 *        params. rand(id) is the same for the same plot from run to run, and different from plot to plot.
 */
import { evaluate, type ExprValue } from '../modeling/modelExpr';
import { MESH_NAMES, PROC_OPS, ProcBuildError, type MeshName, type Num, type ProcComponent, type ProcNode, type ProcSource } from './procSource';

export interface Plot {
    kind: 'plot';
    /** Centre on the ground, size along its own x and z, turn, floor height. */
    x: number; z: number; w: number; d: number; yaw: number; y: number;
    id: number;
    attrs: Record<string, number>;
    tags: string[];
}

export interface Part {
    kind: 'part';
    name: string;
    mesh: MeshName;
    /** Centre and full size, in the source's units. */
    x: number; y: number; z: number;
    sx: number; sy: number; sz: number;
    /** Rotation as a quaternion [x, y, z, w]. */
    q: [number, number, number, number];
    /** Linear colour, 0..1. */
    color: [number, number, number];
    shadows: boolean;
    id: number;
    tags: string[];
}

export type Item = Plot | Part;

export interface ProcEnv {
    /** The ground's height at a place, in the source's units; what `ground` reads. */
    ground?: (x: number, z: number) => number;
    /** Components of other files, when a `use` names one by path (reserved). */
    resolve?: (name: string) => ProcComponent | null;
}

export interface ProcNodeReport { id: string; op: string; plots: number; parts: number; dropped?: number; untouched?: number }
export interface ProcReport {
    nodes: ProcNodeReport[];
    groups: { name: string; parts: number }[];
    parts: number;
    /** Where the parts reach, in the source's units: [x, y, z] low and high. */
    bounds: { min: [number, number, number]; max: [number, number, number] } | null;
    warnings: string[];
}
export interface ProcResult {
    groups: { name: string; parts: Part[] }[];
    report: ProcReport;
    /** What the node named by `probe` made, plots and parts, when one was asked for: what an editor previews. */
    probe?: Item[] | null;
}

/** More than this many plots and parts at once is a mistake in a count, not a place. */
export const PROC_ITEM_LIMIT = 400_000;

const DEG = Math.PI / 180;

/** A stable id from a parent id and an index: what rand(id) reads. */
function mix(a: number, b: number, salt: number): number {
    let h = (a ^ 0x9e3779b9) >>> 0;
    h = Math.imul(h ^ (b + 0x7f4a7c15), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13) ^ salt, 0xc2b2ae35) >>> 0;
    return (h ^ (h >>> 16)) % 10_000_019;
}
/** A number 0..1 from a key, for the evaluator's own choices (where a scatter falls, where a subdivide cuts). */
function unit01(...keys: number[]): number {
    let h = 2166136261;
    for (const k of keys) h = Math.imul(h ^ (k | 0), 16777619) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
const hashText = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h; };

type Quat = [number, number, number, number];
const qMul = (a: Quat, b: Quat): Quat => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qYaw = (deg: number): Quat => [0, Math.sin(deg * DEG / 2), 0, Math.cos(deg * DEG / 2)];
const qAxis = (ax: number, ay: number, az: number, deg: number): Quat => {
    const l = Math.hypot(ax, ay, az) || 1, s = Math.sin(deg * DEG / 2);
    return [ax / l * s, ay / l * s, az / l * s, Math.cos(deg * DEG / 2)];
};
/** The turn that takes +y to the direction @p d. */
function qUpTo(dx: number, dy: number, dz: number): Quat {
    const l = Math.hypot(dx, dy, dz) || 1;
    const [x, y, z] = [dx / l, dy / l, dz / l];
    if (1 + y < 1e-9) return [1, 0, 0, 0];
    const q: Quat = [z, 0, -x, 1 + y];
    const n = Math.hypot(...q);
    return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}
/** Rotates a vector by a quaternion. */
export function qRotate(q: Quat, v: [number, number, number]): [number, number, number] {
    const [qx, qy, qz, qw] = q;
    const tx = 2 * (qy * v[2] - qz * v[1]), ty = 2 * (qz * v[0] - qx * v[2]), tz = 2 * (qx * v[1] - qy * v[0]);
    return [v[0] + qw * tx + (qy * tz - qz * ty), v[1] + qw * ty + (qz * tx - qx * tz), v[2] + qw * tz + (qx * ty - qy * tx)];
}

/** A place in a plot's own frame, on the ground. */
function toWorld(p: { x: number; z: number; yaw: number }, lx: number, lz: number): [number, number] {
    const c = Math.cos(p.yaw * DEG), s = Math.sin(p.yaw * DEG);
    return [p.x + lx * c + lz * s, p.z - lx * s + lz * c];
}

const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

class Run {
    readonly warnings: string[] = [];
    readonly reports: ProcNodeReport[] = [];
    private count = 0;
    /** Inside a component or a repeat: what its nodes do is the calling node's, and is not reported once per call. */
    private nested = 0;
    /** The top-level node whose output is kept for a preview, and what it made. */
    probeId: string | null = null;
    probed: Item[] | null = null;
    constructor(readonly source: ProcSource, readonly env: ProcEnv) {}

    // ------------------------------------------------------------------ values
    scopeOf(base: Map<string, ExprValue>, p: Plot | null, i: number, n: number): Map<string, ExprValue> {
        const s = new Map(base);
        s.set('i', i); s.set('n', n);
        if (p) {
            s.set('x', p.x); s.set('z', p.z); s.set('w', p.w); s.set('d', p.d); s.set('yaw', p.yaw); s.set('y', p.y); s.set('id', p.id);
            for (const [k, v] of Object.entries(p.attrs)) s.set(k, v);
        }
        return s;
    }

    num(v: unknown, scope: ReadonlyMap<string, ExprValue>, what: string): number {
        if (typeof v === 'number') return v;
        if (typeof v === 'string' && v.startsWith('=')) {
            const r = evaluate(v.slice(1), scope);
            if (typeof r !== 'number') throw new Error(`${what} must come to a number, and "${v}" is a list`);
            return r;
        }
        throw new Error(`${what} must be a number or a sum written "=..."; it is ${JSON.stringify(v)}`);
    }
    vec(v: unknown, n: number, scope: ReadonlyMap<string, ExprValue>, what: string): number[] {
        if (typeof v === 'string' && v.startsWith('=')) {
            const r = evaluate(v.slice(1), scope);
            if (!Array.isArray(r) || r.length !== n || !r.every((x) => typeof x === 'number')) throw new Error(`${what} must come to a list of ${n} numbers`);
            return r as number[];
        }
        if (!Array.isArray(v) || v.length !== n) throw new Error(`${what} must be a list of ${n} numbers`);
        return v.map((x, k) => this.num(x, scope, `${what}[${k}]`));
    }
    color(v: unknown, jitter: number, key: number, scope: ReadonlyMap<string, ExprValue>): [number, number, number] {
        let rgb: number[];
        if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) {
            const n = parseInt(v.slice(1), 16);
            rgb = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
        } else if (v === undefined) {
            rgb = [0.8, 0.8, 0.8];
        } else {
            rgb = this.vec(v, 3, scope, 'color');
        }
        const k = jitter > 0 ? 1 + (unit01(key, 77) * 2 - 1) * jitter : 1;
        return rgb.map((c) => lin(Math.min(1, Math.max(0, c * k)))) as [number, number, number];
    }

    // ------------------------------------------------------------------ the graph
    runNodes(nodes: readonly ProcNode[], base: Map<string, ExprValue>, input: Item[] | null, label: string): { byId: Map<string, Item[]>; last: Item[]; outputs: { name: string; parts: Part[] }[] } {
        const byId = new Map<string, Item[]>();
        if (input) byId.set('in', input);
        let last: Item[] = input ?? [];
        let outputs: { name: string; parts: Part[] }[] = [];
        nodes.forEach((node, index) => {
            const name = node.id ?? `${label}#${index}`;
            try {
                const spec = PROC_OPS[node.op]!;
                let items: Item[];
                if (node.op === 'output') {
                    // A part goes on through every node after the one that made it, so two inputs of the output can hold the
                    // same part: it belongs to the first that names it, and is drawn once.
                    const seen = new Set<Part>();
                    outputs = node.inputs!.map((ref) => ({ name: ref, parts: byId.get(ref)!.filter((it): it is Part => it.kind === 'part' && !seen.has(it) && (seen.add(it), true)) }));
                    items = outputs.flatMap((g) => g.parts);
                } else if (spec.many) {
                    items = node.inputs!.flatMap((ref) => byId.get(ref)!);
                } else if (spec.source) {
                    items = this.source1(node, base, hashText(name));
                } else {
                    const from = typeof node.input === 'string' ? byId.get(node.input)! : last;
                    items = this.apply(node, from, base, hashText(name), name);
                }
                this.count += items.length;
                if (items.length > PROC_ITEM_LIMIT) throw new Error(`it makes ${items.length} plots and parts, past the ${PROC_ITEM_LIMIT} a graph may: a count or a size is wrong`);
                if (node.id) byId.set(node.id, items);
                if (this.nested === 0 && this.probeId !== null && node.id === this.probeId) this.probed = items;
                last = items;
                const plots = items.filter((it) => it.kind === 'plot').length;
                if (this.nested === 0) {
                    this.reports.push({ id: name, op: node.op, plots, parts: items.length - plots });
                    if (items.length === 0 && node.op !== 'output') this.warnings.push(`${name} (${node.op}) made nothing`);
                }
            } catch (e) {
                if (e instanceof ProcBuildError) throw e;
                throw new ProcBuildError(`${name} (${node.op}): ${(e as Error).message}`, node.id ?? null, node.op, { cause: e });
            }
        });
        return { byId, last, outputs };
    }

    private plotFrom(node: ProcNode, scope: Map<string, ExprValue>, at: number[], size: number[], yaw: number, id: number): Plot {
        const attrs: Record<string, number> = {};
        const set = node.set as Record<string, Num> | undefined;
        if (set) for (const [k, v] of Object.entries(set)) attrs[k] = this.num(v, scope, `set.${k}`);
        return { kind: 'plot', x: at[0]!, z: at[1]!, w: size[0]!, d: size[1]!, yaw, y: 0, id, attrs, tags: [...((node.tags as string[] | undefined) ?? [])] };
    }

    private source1(node: ProcNode, base: Map<string, ExprValue>, salt: number): Item[] {
        const s = this.scopeOf(base, null, 0, 1);
        switch (node.op) {
            case 'rect':
                return [this.plotFrom(node, s, this.vec(node.at ?? [0, 0], 2, s, 'at'), this.vec(node.size, 2, s, 'size'), this.num(node.yaw ?? 0, s, 'yaw'), mix(salt, 0, 1))];
            case 'plots': {
                const items = node.items as Record<string, unknown>[];
                if (!Array.isArray(items)) throw new Error('`items` is a list of { at, size, yaw?, set?, tags? }');
                return items.map((it, i) => {
                    const si = this.scopeOf(base, null, i, items.length);
                    const p = this.plotFrom({ op: 'rect', set: it.set, tags: it.tags } as ProcNode, si, this.vec(it.at, 2, si, `items[${i}].at`), this.vec(it.size, 2, si, `items[${i}].size`), this.num(it.yaw ?? 0, si, `items[${i}].yaw`), mix(salt, i, 2));
                    return p;
                });
            }
            case 'ring': {
                const n = Math.round(this.num(node.count, s, 'count'));
                const at = this.vec(node.at ?? [0, 0], 2, s, 'at'), start = this.num(node.start ?? 0, s, 'start'), squash = this.num(node.squash ?? 1, s, 'squash');
                const out: Plot[] = [];
                for (let k = 0; k < n; k++) {
                    const sk = this.scopeOf(base, null, k, n); sk.set('k', k);
                    const r = this.num(node.radius, sk, 'radius'), size = this.vec(node.size, 2, sk, 'size');
                    const a = start + (k / n) * 360;
                    const x = at[0]! + Math.sin(a * DEG) * r, z = at[1]! + Math.cos(a * DEG) * r * squash;
                    const p = this.plotFrom(node, sk, [x, z], size, a, mix(salt, k, 3));
                    p.attrs.k = k;
                    out.push(p);
                }
                return out;
            }
            case 'line': {
                const pts = node.points as unknown[];
                if (!Array.isArray(pts) || pts.length < 2) throw new Error('`points` is a line of two [x, z] or more');
                const ps = pts.map((p, i) => this.vec(p, 2, s, `points[${i}]`));
                const width = this.num(node.width, s, 'width'), step = node.step === undefined ? Infinity : this.num(node.step, s, 'step');
                const out: Plot[] = [];
                for (let i = 0; i + 1 < ps.length; i++) {
                    const [a, b] = [ps[i]!, ps[i + 1]!];
                    const dx = b[0]! - a[0]!, dz = b[1]! - a[1]!, len = Math.hypot(dx, dz);
                    const m = Math.max(1, Math.ceil(len / step));
                    const yaw = Math.atan2(-dz, dx) / DEG;
                    for (let j = 0; j < m; j++) {
                        const t = (j + 0.5) / m;
                        const p = this.plotFrom(node, s, [a[0]! + dx * t, a[1]! + dz * t], [len / m, width], yaw, mix(salt, out.length, 4));
                        p.attrs.k = out.length;
                        out.push(p);
                    }
                }
                return out;
            }
        }
        throw new Error(`${node.op} is not a source`);
    }

    /** True when the node works on this plot. */
    private picks(node: ProcNode, p: Plot, scope: ReadonlyMap<string, ExprValue>): boolean {
        if (node.tag !== undefined && !p.tags.includes(node.tag as string)) return false;
        if (node.where !== undefined && this.num(node.where, scope, 'where') === 0) return false;
        return true;
    }

    private apply(node: ProcNode, input: Item[], base: Map<string, ExprValue>, salt: number, name: string): Item[] {
        const out: Item[] = [];
        const plots = input.filter((it): it is Plot => it.kind === 'plot');
        let dropped = 0, picked = 0;
        if (node.op === 'repeat') return this.repeat(node, input, base, name);
        let pi = 0;
        for (const it of input) {
            if (it.kind === 'part') { out.push(it); continue; }
            const i = pi++;
            const scope = this.scopeOf(base, it, i, plots.length);
            const hit = this.picks(node, it, scope);
            if (node.op === 'filter') {
                if (hit !== Boolean(node.not)) out.push(it); else dropped++;
                continue;
            }
            if (!hit) { out.push(it); continue; }
            picked++;
            const made = this.one(node, it, scope, salt, base);
            if (made.length === 0) dropped++;
            for (const m of made) out.push(m);
        }
        if (this.nested === 0 && plots.length > 0 && picked === 0 && node.op !== 'filter' && (node.where !== undefined || node.tag !== undefined)) {
            this.warnings.push(`${name} (${node.op}): its where/tag matched none of ${plots.length} plots`);
        }
        if (this.nested === 0 && dropped > 0 && (node.op === 'inset' || node.op === 'grid' || node.op === 'split')) this.warnings.push(`${name} (${node.op}): ${dropped} plots came to nothing (a size went to 0 or below)`);
        return out;
    }

    private repeat(node: ProcNode, input: Item[], base: Map<string, ExprValue>, name: string): Item[] {
        const n = Math.round(this.num(node.count, this.scopeOf(base, null, 0, 1), 'count'));
        if (!(n >= 0 && n <= 1000)) throw new Error('count must be 0..1000');
        let items = input;
        this.nested++;
        try {
            for (let k = 0; k < n; k++) {
                const b = new Map(base); b.set('k', k);
                items = this.runNodes(node.chain as ProcNode[], b, items, `${name}.${k}`).last;
            }
        } finally { this.nested--; }
        return items;
    }

    private part(name: string, mesh: unknown, c: [number, number, number], size: [number, number, number], q: Quat, color: [number, number, number], shadows: boolean, id: number, tags: string[]): Part {
        const m = (mesh ?? 'cube') as MeshName;
        if (!MESH_NAMES.includes(m)) throw new Error(`mesh "${String(mesh)}" is not one of ${MESH_NAMES.join(', ')}`);
        return { kind: 'part', name, mesh: m, x: c[0], y: c[1], z: c[2], sx: size[0], sy: size[1], sz: size[2], q, color, shadows, id, tags: [...tags] };
    }

    private tumbled(q: Quat, tumble: number, key: number): Quat {
        if (!(tumble > 0)) return q;
        const a = unit01(key, 11) * 360, tilt = tumble * 90 * unit01(key, 12);
        return qMul(qAxis(Math.cos(a * DEG), 0, Math.sin(a * DEG), tilt), qMul(q, qYaw(unit01(key, 13) * 360 * tumble)));
    }

    /** What a node makes of one plot it works on. */
    private one(node: ProcNode, p: Plot, s: Map<string, ExprValue>, salt: number, base: Map<string, ExprValue>): Item[] {
        const child = (lx: number, lz: number, w: number, d: number, k: number, attrs: Record<string, number> = {}): Plot => {
            const [x, z] = toWorld(p, lx, lz);
            return { kind: 'plot', x, z, w, d, yaw: p.yaw, y: p.y, id: mix(p.id, k, salt), attrs: { ...p.attrs, ...attrs }, tags: [...p.tags] };
        };
        switch (node.op) {
            case 'grid': {
                const gx = this.num(node.gapX ?? node.gap ?? 0, s, 'gapX'), gz = this.num(node.gapZ ?? node.gap ?? 0, s, 'gapZ');
                const fit = (len: number, size: number, gap: number): number => Math.max(1, Math.round((len + gap) / (size + gap)));
                const cols = node.cols !== undefined ? Math.round(this.num(node.cols, s, 'cols')) : fit(p.w, this.num(node.colSize, s, 'colSize'), gx);
                const rows = node.rows !== undefined ? Math.round(this.num(node.rows, s, 'rows')) : fit(p.d, this.num(node.rowSize, s, 'rowSize'), gz);
                if (cols < 1 || rows < 1) throw new Error('a grid has one column and one row at least');
                const cw = (p.w - gx * (cols - 1)) / cols, rd = (p.d - gz * (rows - 1)) / rows;
                if (!(cw > 0 && rd > 0)) return [];
                const out: Plot[] = [];
                for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
                    out.push(child(-p.w / 2 + cw / 2 + c * (cw + gx), -p.d / 2 + rd / 2 + r * (rd + gz), cw, rd, r * cols + c, { col: c, row: r, cols, rows }));
                }
                return out;
            }
            case 'split': {
                const named = node.axis ?? 'x';
                if (!['x', 'z', 'long', 'short'].includes(named as string)) throw new Error('axis is "x", "z", "long" or "short"');
                // "long" cuts along the plot's longer side (a wall run of either direction, cut into lengths), "short" across it
                const axis = named === 'long' ? (p.w >= p.d ? 'x' : 'z') : named === 'short' ? (p.w >= p.d ? 'z' : 'x') : named;
                const L = axis === 'x' ? p.w : p.d, gap = this.num(node.gap ?? 0, s, 'gap'), as = (node.as as string | undefined) ?? 'part';
                let lens: number[];
                if (node.sizes !== undefined) {
                    const raw = node.sizes as unknown[];
                    if (!Array.isArray(raw) || raw.length === 0) throw new Error('`sizes` is a list: lengths, and shares written "1r"');
                    const rel = raw.map((v) => (typeof v === 'string' && /^\d*\.?\d+r$/.test(v) ? Number(v.slice(0, -1)) : null));
                    const abs = raw.map((v, k) => (rel[k] === null ? this.num(v, s, `sizes[${k}]`) : 0));
                    const left = L - abs.reduce((a, b) => a + b, 0) - gap * (raw.length - 1);
                    const shares = rel.reduce<number>((a, b) => a + (b ?? 0), 0);
                    lens = raw.map((_, k) => (rel[k] === null ? abs[k]! : shares > 0 ? (left * rel[k]!) / shares : 0));
                } else {
                    const n = node.count !== undefined ? Math.round(this.num(node.count, s, 'count')) : Math.max(1, Math.round((L + gap) / (this.num(node.size, s, 'size') + gap)));
                    if (n < 1) throw new Error('count must be 1 or more');
                    lens = Array.from({ length: n }, () => (L - gap * (n - 1)) / n);
                }
                const out: Plot[] = [];
                let at = -L / 2;
                lens.forEach((len, k) => {
                    if (len > 0) {
                        const mid = at + len / 2;
                        out.push(axis === 'x' ? child(mid, 0, len, p.d, k, { [as]: k, [`${as}s`]: lens.length }) : child(0, mid, p.w, len, k, { [as]: k, [`${as}s`]: lens.length }));
                    }
                    at += len + gap;
                });
                return out;
            }
            case 'inset': {
                const by = node.by ?? 0;
                const bx = this.num(node.byX ?? by, s, 'byX'), bz = this.num(node.byZ ?? by, s, 'byZ');
                const w = p.w - 2 * bx, d = p.d - 2 * bz;
                return w > 0 && d > 0 ? [{ ...p, w, d, attrs: { ...p.attrs }, tags: [...p.tags] }] : [];
            }
            case 'quarter': {
                const st = this.num(node.street ?? 0, s, 'street');
                const qw = (p.w - st) / 2, qd = (p.d - st) / 2;
                if (!(qw > 0 && qd > 0)) return [];
                const out: Plot[] = [];
                [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([qx, qz], k) => out.push(child(qx! * (st + qw) / 2, qz! * (st + qd) / 2, qw, qd, k, { q: k, qx: qx!, qz: qz! })));
                return out;
            }
            case 'subdivide': {
                const max = this.num(node.max, s, 'max'), gap = this.num(node.gap ?? 0, s, 'gap'), seed = this.num(node.seed ?? 0, s, 'seed');
                if (!(max > 0)) throw new Error('max must be positive');
                const out: Plot[] = [];
                const cut = (lx: number, lz: number, w: number, d: number, key: number, depth: number): void => {
                    if ((w <= max && d <= max) || depth > 24) { out.push(child(lx, lz, w, d, key, { lot: out.length })); return; }
                    const t = 0.35 + unit01(p.id, key, seed) * 0.3;
                    if (w >= d) {
                        const a = (w - gap) * t, b = w - gap - a;
                        if (a <= 0 || b <= 0) { out.push(child(lx, lz, w, d, key, { lot: out.length })); return; }
                        cut(lx - w / 2 + a / 2, lz, a, d, key * 2 + 1, depth + 1);
                        cut(lx + w / 2 - b / 2, lz, b, d, key * 2 + 2, depth + 1);
                    } else {
                        const a = (d - gap) * t, b = d - gap - a;
                        if (a <= 0 || b <= 0) { out.push(child(lx, lz, w, d, key, { lot: out.length })); return; }
                        cut(lx, lz - d / 2 + a / 2, w, a, key * 2 + 1, depth + 1);
                        cut(lx, lz + d / 2 - b / 2, w, b, key * 2 + 2, depth + 1);
                    }
                };
                cut(0, 0, p.w, p.d, 1, 0);
                return out;
            }
            case 'edges': {
                const t = this.num(node.thick, s, 'thick');
                const sides = (node.sides as number[] | undefined) ?? [0, 1, 2, 3];
                const gaps = ((node.gaps as Record<string, unknown>[] | undefined) ?? []).map((g, k) => ({
                    side: this.num(g.side, s, `gaps[${k}].side`), at: this.num(g.at ?? 0, s, `gaps[${k}].at`), width: this.num(g.width, s, `gaps[${k}].width`),
                }));
                const out: Plot[] = [];
                for (const side of sides) {
                    const ns = side === 0 || side === 2;
                    const len = ns ? p.w : p.d - 2 * t;
                    // the run along this side, from -len/2 to len/2, with the gaps cut out
                    let runs: [number, number][] = [[-len / 2, len / 2]];
                    for (const g of gaps.filter((g) => g.side === side)) {
                        runs = runs.flatMap(([a, b]): [number, number][] => {
                            const g0 = g.at - g.width / 2, g1 = g.at + g.width / 2;
                            if (g1 <= a || g0 >= b) return [[a, b]];
                            return [[a, g0], [g1, b]].filter(([u, v]) => v - u > 1e-6) as [number, number][];
                        });
                    }
                    for (const [a, b] of runs) {
                        const mid = (a + b) / 2, l = b - a;
                        const k = out.length;
                        if (side === 0) out.push(child(mid, -p.d / 2 + t / 2, l, t, 100 + k, { side }));
                        else if (side === 2) out.push(child(mid, p.d / 2 - t / 2, l, t, 100 + k, { side }));
                        else if (side === 1) out.push(child(p.w / 2 - t / 2, mid, t, l, 100 + k, { side }));
                        else out.push(child(-p.w / 2 + t / 2, mid, t, l, 100 + k, { side }));
                    }
                }
                return out;
            }
            case 'scatter': {
                const n = Math.round(this.num(node.count, s, 'count')), margin = this.num(node.margin ?? 0, s, 'margin');
                const turn = this.num(node.turn ?? 0, s, 'turn'), seed = this.num(node.seed ?? 0, s, 'seed');
                const out: Plot[] = [];
                for (let k = 0; k < n; k++) {
                    const sk = new Map(s); sk.set('k', k);
                    const size = this.vec(node.size ?? [1, 1], 2, sk, 'size');
                    const lx = (unit01(p.id, k, seed, 1) - 0.5) * Math.max(0, p.w - 2 * margin);
                    const lz = (unit01(p.id, k, seed, 2) - 0.5) * Math.max(0, p.d - 2 * margin);
                    const c = child(lx, lz, size[0]!, size[1]!, k, { k });
                    c.yaw += (unit01(p.id, k, seed, 3) * 2 - 1) * turn;
                    out.push(c);
                }
                return out;
            }
            case 'move': {
                const by = this.vec(node.by ?? [0, 0], 2, s, 'by');
                const [x, z] = toWorld(p, by[0]!, by[1]!);
                return [{ ...p, x, z, y: p.y + this.num(node.lift ?? 0, s, 'lift'), yaw: p.yaw + this.num(node.yaw ?? 0, s, 'yaw'), attrs: { ...p.attrs }, tags: [...p.tags] }];
            }
            case 'resize':
                return [{ ...p, w: node.w === undefined ? p.w : this.num(node.w, s, 'w'), d: node.d === undefined ? p.d : this.num(node.d, s, 'd'), attrs: { ...p.attrs }, tags: [...p.tags] }];
            case 'lift':
                return [{ ...p, y: p.y + this.num(node.by, s, 'by'), attrs: { ...p.attrs }, tags: [...p.tags] }];
            case 'ground': {
                if (!this.env.ground) throw new Error('the source names no `land`, so there is no ground to stand on');
                const off = this.num(node.offset ?? 0, s, 'offset');
                const mode = node.mode ?? 'min';
                if (mode !== 'min' && mode !== 'max' && mode !== 'center') throw new Error('mode is "min", "max" or "center"');
                let g = this.env.ground(p.x, p.z);
                if (mode !== 'center') {
                    for (const [a, b] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5], [0, -0.5], [0, 0.5], [-0.5, 0], [0.5, 0]]) {
                        const [x, z] = toWorld(p, a! * p.w, b! * p.d);
                        g = mode === 'min' ? Math.min(g, this.env.ground(x, z)) : Math.max(g, this.env.ground(x, z));
                    }
                }
                return [{ ...p, y: g + off, attrs: { ...p.attrs }, tags: [...p.tags] }];
            }
            case 'attr': {
                const attrs = { ...p.attrs };
                for (const [k, v] of Object.entries((node.set as Record<string, Num>) ?? {})) attrs[k] = this.num(v, s, `set.${k}`);
                return [{ ...p, attrs, tags: [...p.tags] }];
            }
            case 'retag': {
                const tags = new Set(p.tags);
                for (const t of (node.add as string[] | undefined) ?? []) tags.add(t);
                for (const t of (node.remove as string[] | undefined) ?? []) tags.delete(t);
                return [{ ...p, attrs: { ...p.attrs }, tags: [...tags] }];
            }
            case 'use': return this.use(node, p, s, base);
            case 'box': {
                const h = this.num(node.height, s, 'height');
                const fill = this.vec(node.fill ?? [1, 1], 2, s, 'fill'), lift = this.num(node.lift ?? 0, s, 'lift');
                const tumble = this.num(node.tumble ?? 0, s, 'tumble');
                const out: Item[] = [];
                if (h > 0) {
                    out.push(this.part((node.name as string | undefined) ?? node.id ?? 'Box', node.mesh,
                        [p.x, p.y + lift + h / 2, p.z], [p.w * fill[0]!, h, p.d * fill[1]!], this.tumbled(qYaw(p.yaw), tumble, p.id),
                        this.color(node.color, this.num(node.jitter ?? 0, s, 'jitter'), p.id, s), node.shadows !== false, p.id, p.tags));
                }
                if (node.keep === 'top') out.push({ ...p, y: p.y + lift + Math.max(h, 0), attrs: { ...p.attrs }, tags: [...p.tags] });
                else if (node.keep === 'plot') out.push(p);
                return out;
            }
            case 'part': {
                const at = this.vec(node.at ?? [0, 0, 0], 3, s, 'at'), size = this.vec(node.size, 3, s, 'size');
                const [x, z] = toWorld(p, at[0]!, at[2]!);
                let q = qYaw(p.yaw + this.num(node.yaw ?? 0, s, 'yaw'));
                if (node.flip) q = qMul(q, [1, 0, 0, 0]);
                const out: Item[] = [this.part((node.name as string | undefined) ?? node.id ?? 'Part', node.mesh, [x, p.y + at[1]!, z], size as [number, number, number],
                    this.tumbled(q, this.num(node.tumble ?? 0, s, 'tumble'), p.id), this.color(node.color, this.num(node.jitter ?? 0, s, 'jitter'), p.id, s), node.shadows !== false, p.id, p.tags)];
                if (node.keep === 'plot') out.push(p);
                return out;
            }
            case 'roof': {
                const pitch = this.num(node.pitch ?? 28, s, 'pitch'), over = this.num(node.overhang ?? 1, s, 'overhang');
                const thick = this.num(node.thick ?? 0.4, s, 'thick'), lift = this.num(node.lift ?? 0, s, 'lift');
                if (!(pitch > 0 && pitch < 80)) throw new Error('pitch is degrees, between 0 and 80');
                const along = node.along ?? 'long';
                if (!['long', 'x', 'z'].includes(along as string)) throw new Error('along is "long", "x" or "z"');
                const onX = along === 'x' || (along === 'long' && p.w >= p.d);
                // the ridge runs along the plot's own x (turned a quarter when it runs along z); `span` is across it
                const length = (onX ? p.w : p.d) + 2 * over, span = onX ? p.d : p.w;
                const t = Math.tan(pitch * DEG), c = Math.cos(pitch * DEG);
                const half = span / 2 + over, rise = (span / 2) * t;
                const color = this.color(node.color, this.num(node.jitter ?? 0, s, 'jitter'), p.id, s);
                const out: Item[] = [];
                for (const side of [-1, 1]) {
                    const across = side * (half / 2), y = p.y + lift + rise - (half / 2) * t - (thick / 2) / c;
                    const [x, z] = onX ? toWorld(p, 0, across) : toWorld(p, across, 0);
                    const q = qMul(qYaw(p.yaw + (onX ? 0 : 90)), qAxis(1, 0, 0, side * pitch));
                    out.push(this.part((node.name as string | undefined) ?? node.id ?? 'Roof', 'cube', [x, y, z], [length, thick, half / c], q, color, node.shadows !== false, mix(p.id, side, 9), p.tags));
                }
                return out;
            }
            case 'beam': return [this.beam(node, s, p)];
        }
        throw new Error(`${node.op} does not work on plots`);
    }

    private beam(node: ProcNode, s: ReadonlyMap<string, ExprValue>, p: Plot | null): Part {
        let a = this.vec(node.from, 3, s, 'from'), b = this.vec(node.to, 3, s, 'to');
        if (p && node.space !== 'world') {
            const [ax, az] = toWorld(p, a[0]!, a[2]!), [bx, bz] = toWorld(p, b[0]!, b[2]!);
            a = [ax, p.y + a[1]!, az]; b = [bx, p.y + b[1]!, bz];
        }
        const d = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
        const len = Math.hypot(d[0]!, d[1]!, d[2]!), t = this.num(node.thick, s, 'thick');
        const id = p?.id ?? hashText(JSON.stringify(node.from));
        return this.part((node.name as string | undefined) ?? node.id ?? 'Beam', node.mesh ?? 'cylinder', [(a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2, (a[2]! + b[2]!) / 2],
            [t, len, t], qUpTo(d[0]!, d[1]!, d[2]!), this.color(node.color, this.num(node.jitter ?? 0, s, 'jitter'), id, s), node.shadows === true, id, p?.tags ?? []);
    }

    private use(node: ProcNode, p: Plot, s: Map<string, ExprValue>, base: Map<string, ExprValue>): Item[] {
        const name = node.component as string;
        const comp = this.source.components?.[name] ?? this.env.resolve?.(name) ?? null;
        if (!comp) throw new Error(`there is no component "${name}"`);
        const b = new Map(base);
        for (const [k, v] of Object.entries(comp.params ?? {})) b.set(k, v);
        for (const [k, v] of Object.entries((node.params as Record<string, Num> | undefined) ?? {})) {
            if (comp.params && !(k in comp.params)) throw new Error(`component "${name}" takes no param "${k}"; it takes ${Object.keys(comp.params).join(', ') || 'none'}`);
            b.set(k, typeof v === 'string' && v.startsWith('=') ? evaluate(v.slice(1), s) : Array.isArray(v) ? v.map((x, j) => this.num(x, s, `params.${k}[${j}]`)) : this.num(v, s, `params.${k}`));
        }
        const local: Plot = { kind: 'plot', x: 0, z: 0, w: p.w, d: p.d, yaw: 0, y: 0, id: p.id, attrs: { ...p.attrs }, tags: [...p.tags] };
        this.nested++;
        let run: ReturnType<Run['runNodes']>;
        try { run = this.runNodes(comp.nodes, b, [local], `${name}`); } finally { this.nested--; }
        const made = comp.output ? run.byId.get(comp.output) : run.last;
        if (!made) throw new Error(`component "${name}" has no node "${comp.output}" to answer with`);
        const turn = qYaw(p.yaw);
        return made.map((it): Item => {
            const [x, z] = toWorld(p, it.x, it.z);
            if (it.kind === 'plot') return { ...it, x, z, y: it.y + p.y, yaw: it.yaw + p.yaw, attrs: { ...it.attrs }, tags: [...it.tags] };
            return { ...it, x, z, y: it.y + p.y, q: qMul(turn, it.q), tags: [...it.tags] };
        });
    }
}

/** Runs a validated source. Throws a {@link ProcBuildError} naming the node that could not run. */
export function runProc(source: ProcSource, env: ProcEnv = {}, options: { probe?: string | null } = {}): ProcResult {
    const run = new Run(source, env);
    run.probeId = options.probe ?? null;
    const base = new Map<string, ExprValue>();
    base.set('seed', source.seed ?? 0);
    for (const [k, v] of Object.entries(source.params ?? {})) base.set(k, v);
    const groups = run.runNodes(source.nodes, base, null, 'graph').outputs;
    const parts = groups.flatMap((g) => g.parts);
    let bounds: ProcReport['bounds'] = null;
    for (const pt of parts) {
        const hx = Math.max(pt.sx, pt.sz) / 2, hy = pt.sy / 2;
        const lo: [number, number, number] = [pt.x - hx, pt.y - hy, pt.z - hx], hi: [number, number, number] = [pt.x + hx, pt.y + hy, pt.z + hx];
        if (!bounds) bounds = { min: lo, max: hi };
        else for (let k = 0; k < 3; k++) { bounds.min[k] = Math.min(bounds.min[k]!, lo[k]!); bounds.max[k] = Math.max(bounds.max[k]!, hi[k]!); }
    }
    if (parts.length === 0) run.warnings.push('the output has no parts: nothing would stand in the scene');
    return {
        groups,
        report: { nodes: run.reports, groups: groups.map((g) => ({ name: g.name, parts: g.parts.length })), parts: parts.length, bounds, warnings: run.warnings },
        ...(options.probe ? { probe: run.probed } : {}),
    };
}
