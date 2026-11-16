// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { hash3 } from './hash';
import { compact, cross, dot, faceNormal, normalize, selectFaces, sub, type Face, type FaceSelector, type PolyMesh, type Vec3 } from './polyMesh';

export interface PanelsParams {
    faces: FaceSelector;
    size: number;
    uneven?: number;
    gap?: number;
    height?: number | readonly number[];
    bevel?: number;
    tones?: number;
    along?: Vec3;
    seed?: number;
    tag?: string;
}

type P2 = readonly [number, number];

const MAX_PANELS = 200_000;
const MIN_SHARE = 0.25;

function clip(poly: readonly P2[], axis: 0 | 1, at: number, keepLess: boolean): P2[] {
    const out: P2[] = [];
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
        const da = a[axis] - at, db = b[axis] - at;
        const ina = keepLess ? da <= 0 : da >= 0, inb = keepLess ? db <= 0 : db >= 0;
        if (ina) out.push(a);
        if (ina !== inb) {
            const t = da / (da - db);
            out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
    }
    return out;
}

function area2(poly: readonly P2[]): number {
    let sum = 0;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
        sum += a[0] * b[1] - b[0] * a[1];
    }
    return sum / 2;
}

function inset(poly: readonly P2[], by: number): P2[] | null {
    const n = poly.length;
    const lines = poly.map((a, i) => {
        const b = poly[(i + 1) % n]!;
        const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
        const l = Math.hypot(dx, dy);
        if (l < 1e-9) return null;
        const [nx, ny] = [-dy / l, dx / l];
        return { px: a[0] + nx * by, py: a[1] + ny * by, dx: dx / l, dy: dy / l, l };
    });
    if (lines.some((line) => line === null)) return null;
    const out: P2[] = [];
    for (let i = 0; i < n; i++) {
        const a = lines[(i + n - 1) % n]!, b = lines[i]!;
        const det = a.dx * b.dy - a.dy * b.dx;
        if (Math.abs(det) < 1e-9) { out.push([b.px, b.py]); continue; }
        const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / det;
        out.push([a.px + a.dx * t, a.py + a.dy * t]);
    }
    if (area2(out) <= 0) return null;
    for (let i = 0; i < n; i++) {
        const a = out[i]!, b = out[(i + 1) % n]!, line = lines[i]!;
        if ((b[0] - a[0]) * line.dx + (b[1] - a[1]) * line.dy <= line.l * 0.05) return null;
    }
    return out;
}

export function panels(mesh: PolyMesh, p: PanelsParams): PolyMesh {
    if (!(p.size > 0)) throw new Error('`size` must be positive: about how wide a panel is, in model units');
    const uneven = p.uneven ?? 0.5;
    if (!(uneven >= 0 && uneven <= 1)) throw new Error(`uneven ${uneven} must be 0..1`);
    const gap = p.gap ?? p.size * 0.03;
    if (!(gap >= 0)) throw new Error(`gap ${gap} must not be negative`);
    const heights = typeof p.height === 'number' ? [p.height, p.height] : p.height ?? [gap, gap];
    if (heights.length !== 2 || !heights.every((h) => Number.isFinite(h))) throw new Error('`height` is one number or [lowest, highest]');
    const bevel = p.bevel ?? 0;
    if (!(bevel >= 0)) throw new Error(`bevel ${bevel} must not be negative`);
    const tones = p.tones ?? 0;
    if (!(tones >= 0 && tones <= 1)) throw new Error(`tones ${tones} must be 0..1`);
    const seed = p.seed ?? 1;
    const tag = p.tag ?? 'panel';
    const hit = selectFaces(mesh, p.faces);
    if (hit.length === 0) throw new Error(`\`faces\` ${JSON.stringify(p.faces)} matched no face`);
    const chosen = new Set(hit);

    const positions = mesh.positions.slice();
    const faces: Face[] = [];
    let made = 0, counter = 0;
    const rand = (): number => hash3(counter++, 17, 31, seed) * 0.5 + 0.5;

    mesh.faces.forEach((face, f) => {
        if (!chosen.has(f) || face.v.length < 3) { faces.push(face); return; }
        const n = faceNormal(mesh, face);
        const first = mesh.positions[face.v[0]!]!;
        let u: Vec3 = [0, 0, 0];
        if (p.along) {
            const lean = dot(p.along, n);
            u = [p.along[0] - n[0] * lean, p.along[1] - n[1] * lean, p.along[2] - n[2] * lean];
        }
        if (Math.hypot(u[0], u[1], u[2]) < 1e-6) {
            let best = 0;
            u = [1, 0, 0];
            for (let i = 0; i < face.v.length; i++) {
                const e = sub(mesh.positions[face.v[(i + 1) % face.v.length]!]!, mesh.positions[face.v[i]!]!);
                const l = Math.hypot(e[0], e[1], e[2]);
                if (l > best) { best = l; u = e; }
            }
        }
        if (Math.hypot(u[0], u[1], u[2]) < 1e-9) { faces.push(face); return; }
        u = normalize(u);
        const v = cross(n, u);
        const outline: P2[] = face.v.map((i) => {
            const d = sub(mesh.positions[i]!, first);
            return [dot(d, u), dot(d, v)];
        });
        if (area2(outline) <= 0) { faces.push(face); return; }

        const leaves: P2[][] = [];
        const split = (poly: P2[], depth: number): void => {
            const xs = poly.map((q) => q[0]), ys = poly.map((q) => q[1]);
            const [w, h] = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
            const want = p.size * (1 + (rand() * 2 - 1) * uneven * 0.6);
            if (Math.max(w, h) <= want || depth > 24 || made + leaves.length >= MAX_PANELS) { leaves.push(poly); return; }
            const axis: 0 | 1 = w >= h ? 0 : 1;
            const lo = axis === 0 ? Math.min(...xs) : Math.min(...ys), span = axis === 0 ? w : h;
            const at = lo + span * (0.5 + (rand() * 2 - 1) * uneven * (0.5 - MIN_SHARE));
            const a = clip(poly, axis, at, true), b = clip(poly, axis, at, false);
            if (a.length < 3 || b.length < 3 || area2(a) < 1e-12 || area2(b) < 1e-12) { leaves.push(poly); return; }
            split(a, depth + 1);
            split(b, depth + 1);
        };
        split(outline, 0);

        const place = (q: P2, lift: number): number => {
            positions.push([first[0] + u[0] * q[0] + v[0] * q[1] + n[0] * lift, first[1] + u[1] * q[0] + v[1] * q[1] + n[1] * lift, first[2] + u[2] * q[0] + v[2] * q[1] + n[2] * lift]);
            return positions.length - 1;
        };
        const { v: _v, cornerUvs: _uvs, ...rest } = face;
        for (const leaf of leaves) {
            made++;
            const plate = gap > 0 ? inset(leaf, gap / 2) : leaf;
            const lift = heights[0]! + (heights[1]! - heights[0]!) * rand();
            const tone = 1 + (rand() * 2 - 1) * tones;
            if (!plate || lift === 0) {
                faces.push({ ...rest, v: leaf.map((q) => place(q, 0)) });
                continue;
            }
            const was = face.color ?? [1, 1, 1, 1];
            const painted = tones > 0 ? { color: [was[0] * tone, was[1] * tone, was[2] * tone, was[3]] as const } : {};
            const outer = leaf.map((q) => place(q, 0));
            const foot = plate.map((q) => place(q, 0));
            const count = leaf.length;
            if (gap > 0) for (let i = 0; i < count; i++) faces.push({ ...rest, v: [outer[i]!, outer[(i + 1) % count]!, foot[(i + 1) % count]!, foot[i]!] });
            const top = bevel > 0 && Math.abs(lift) > bevel ? inset(plate, bevel) : null;
            const rise = top ? lift - Math.sign(lift) * bevel : lift;
            const brow = plate.map((q) => place(q, rise));
            const up = lift > 0;
            for (let i = 0; i < count; i++) {
                const j = (i + 1) % count;
                faces.push({ ...rest, ...painted, tag: `${tag}Side`, v: up ? [foot[i]!, foot[j]!, brow[j]!, brow[i]!] : [foot[j]!, foot[i]!, brow[i]!, brow[j]!] });
            }
            if (top) {
                const crown = top.map((q) => place(q, lift));
                for (let i = 0; i < count; i++) {
                    const j = (i + 1) % count;
                    faces.push({ ...rest, ...painted, tag: `${tag}Side`, v: [brow[i]!, brow[j]!, crown[j]!, crown[i]!] });
                }
                faces.push({ ...rest, ...painted, tag, v: crown });
            } else {
                faces.push({ ...rest, ...painted, tag, v: brow });
            }
        }
    });
    const out = compact({ positions, faces });
    return made >= MAX_PANELS ? { ...out, notes: [`stopped at ${MAX_PANELS} panels: give a larger \`size\`, or fewer \`faces\``] } : out;
}
