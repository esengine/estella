// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  imageRaster.ts — a picture from a list of layers, on the CPU.
 *
 *        A model describes structure well and cannot write a hundred thousand colours. So it states shapes, fills and
 *        effects, and this owns everything that has to be exact: antialiased edges, gradients, soft shadows.
 *        On the CPU rather than through a canvas, so the same source makes the same bytes on any machine and a test can read them.
 */
import type { ImageFill, ImageLayer, ImageSource, ImageEffect, ImageStroke, ImageTransform } from './imageSource';

export interface RgbaBitmap { width: number; height: number; rgba: Uint8Array }

type Rgba = readonly [number, number, number, number];
type Pt = readonly [number, number];
type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const SUBSCANS = 8;
const CURVE_STEPS = 20;

export function parseColor(text: string): Rgba {
    const h = /^#([0-9a-fA-F]+)$/.exec(text)?.[1];
    if (!h || ![3, 4, 6, 8].includes(h.length)) throw new Error(`color ${JSON.stringify(text)} must be #rgb, #rgba, #rrggbb or #rrggbbaa`);
    const full = h.length <= 4 ? [...h].map((c) => c + c).join('') : h;
    const at = (i: number): number => parseInt(full.slice(i, i + 2), 16) / 255;
    return [at(0), at(2), at(4), full.length === 8 ? at(6) : 1];
}

const times = (a: Matrix, b: Matrix): Matrix => [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];
const apply = (m: Matrix, [x, y]: Pt): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
function invert(m: Matrix): Matrix {
    const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
    return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

function transformOf(t: ImageTransform | undefined, origin: Pt): Matrix {
    if (!t) return IDENTITY;
    const [ox, oy] = t.origin ?? origin;
    const r = ((t.rotate ?? 0) * Math.PI) / 180;
    const [sx, sy] = typeof t.scale === 'number' ? [t.scale, t.scale] : t.scale ?? [1, 1];
    const [tx, ty] = t.translate ?? [0, 0];
    let m: Matrix = [1, 0, 0, 1, tx + ox, ty + oy];
    m = times(m, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]);
    m = times(m, [sx, 0, 0, sy, 0, 0]);
    return times(m, [1, 0, 0, 1, -ox, -oy]);
}

// ---- Outlines -------------------------------------------------------------------

function ellipsePoints(cx: number, cy: number, rx: number, ry: number): Pt[] {
    const n = Math.max(48, Math.ceil(Math.max(rx, ry) * 2));
    return Array.from({ length: n }, (_, i): Pt => [cx + rx * Math.cos((i / n) * Math.PI * 2), cy + ry * Math.sin((i / n) * Math.PI * 2)]);
}

function roundedRect(x: number, y: number, w: number, h: number, radius: number | readonly number[]): Pt[] {
    const rs = typeof radius === 'number' ? [radius, radius, radius, radius] : radius;
    const limit = Math.min(w, h) / 2;
    const [tl, tr, br, bl] = [0, 1, 2, 3].map((i) => Math.max(0, Math.min(limit, rs[i] ?? 0))) as [number, number, number, number];
    const out: Pt[] = [];
    const corner = (cx: number, cy: number, r: number, from: number): void => {
        if (r <= 0) { out.push([cx, cy]); return; }
        const n = Math.max(4, Math.ceil(r));
        for (let i = 0; i <= n; i++) {
            const a = from + (i / n) * (Math.PI / 2);
            out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        }
    };
    corner(x + tl, y + tl, tl, Math.PI);
    corner(x + w - tr, y + tr, tr, -Math.PI / 2);
    corner(x + w - br, y + h - br, br, 0);
    corner(x + bl, y + h - bl, bl, Math.PI / 2);
    return out;
}

/** An SVG path's closed and open runs: M L H V C S Q T Z, either case. */
export function parsePath(d: string): { points: Pt[]; closed: boolean }[] {
    const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
    const runs: { points: Pt[]; closed: boolean }[] = [];
    let run: Pt[] | null = null;
    let [x, y, sx, sy, lastCx, lastCy] = [0, 0, 0, 0, 0, 0];
    let cmd = '', prev = '', i = 0;
    const num = (): number => {
        const t = tokens[i++];
        if (t === undefined || /[a-zA-Z]/.test(t)) throw new Error(`path ${JSON.stringify(d.slice(0, 60))}: command ${cmd} is short of numbers`);
        return Number(t);
    };
    const start = (): void => {
        if (!run) { run = [[x, y]]; runs.push({ points: run, closed: false }); }
    };
    const curve = (f: (t: number) => Pt): void => {
        start();
        for (let s = 1; s <= CURVE_STEPS; s++) run!.push(f(s / CURVE_STEPS));
    };
    while (i < tokens.length) {
        if (/[a-zA-Z]/.test(tokens[i]!)) cmd = tokens[i++]!;
        else if (!cmd) throw new Error(`path ${JSON.stringify(d.slice(0, 60))} must start with a command`);
        const rel = cmd === cmd.toLowerCase();
        const [ox, oy] = rel ? [x, y] : [0, 0];
        switch (cmd.toUpperCase()) {
            case 'M':
                x = ox + num(); y = oy + num(); sx = x; sy = y;
                run = [[x, y]];
                runs.push({ points: run, closed: false });
                cmd = rel ? 'l' : 'L';
                break;
            case 'L': x = ox + num(); y = oy + num(); start(); run!.push([x, y]); break;
            case 'H': x = ox + num(); start(); run!.push([x, y]); break;
            case 'V': y = oy + num(); start(); run!.push([x, y]); break;
            case 'C': case 'S': {
                const smooth = cmd.toUpperCase() === 'S';
                const [c1x, c1y] = smooth ? (prev === 'C' || prev === 'S' ? [2 * x - lastCx, 2 * y - lastCy] : [x, y]) : [ox + num(), oy + num()];
                const [c2x, c2y, ex, ey] = [ox + num(), oy + num(), ox + num(), oy + num()];
                const [x0, y0] = [x, y];
                curve((t) => {
                    const u = 1 - t;
                    return [u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex, u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey];
                });
                [x, y, lastCx, lastCy] = [ex, ey, c2x, c2y];
                break;
            }
            case 'Q': case 'T': {
                const smooth = cmd.toUpperCase() === 'T';
                const [cx, cy] = smooth ? (prev === 'Q' || prev === 'T' ? [2 * x - lastCx, 2 * y - lastCy] : [x, y]) : [ox + num(), oy + num()];
                const [ex, ey] = [ox + num(), oy + num()];
                const [x0, y0] = [x, y];
                curve((t) => {
                    const u = 1 - t;
                    return [u * u * x0 + 2 * u * t * cx + t * t * ex, u * u * y0 + 2 * u * t * cy + t * t * ey];
                });
                [x, y, lastCx, lastCy] = [ex, ey, cx, cy];
                break;
            }
            case 'Z':
                if (runs.length) runs[runs.length - 1]!.closed = true;
                x = sx; y = sy; run = null;
                cmd = '';
                break;
            default:
                throw new Error(`path command ${cmd} is not one this draws; there are M L H V C S Q T Z`);
        }
        prev = cmd.toUpperCase() === 'L' && prev === 'M' ? 'L' : cmd.toUpperCase();
    }
    return runs;
}

/** A layer's outlines in its own coordinates. */
function outlinesOf(layer: ImageLayer): { runs: { points: Pt[]; closed: boolean }[]; middle: Pt } {
    const closed = (points: Pt[]): { points: Pt[]; closed: boolean }[] => [{ points, closed: true }];
    switch (layer.shape) {
        case 'rect': {
            const [x, y] = layer.at!, [w, h] = layer.size!;
            return { runs: closed(roundedRect(x, y, w, h, layer.radius ?? 0)), middle: [x + w / 2, y + h / 2] };
        }
        case 'circle': {
            const [cx, cy] = layer.at!;
            return { runs: closed(ellipsePoints(cx, cy, layer.radius as number, layer.radius as number)), middle: [cx, cy] };
        }
        case 'ellipse': {
            const [cx, cy] = layer.at!, [rx, ry] = layer.radii!;
            return { runs: closed(ellipsePoints(cx, cy, rx, ry)), middle: [cx, cy] };
        }
        case 'ring': {
            const [cx, cy] = layer.at!;
            const inner = ellipsePoints(cx, cy, layer.inner!, layer.inner!).reverse();
            return { runs: [...closed(ellipsePoints(cx, cy, layer.radius as number, layer.radius as number)), ...closed(inner)], middle: [cx, cy] };
        }
        case 'polygon': case 'line': {
            const pts = layer.points as Pt[];
            const c = pts.reduce<[number, number]>((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]);
            return { runs: [{ points: pts, closed: layer.shape === 'polygon' }], middle: c };
        }
        case 'star': case 'gear': {
            const [cx, cy] = layer.at!;
            const n = layer.count!, outer = layer.radius as number, inner = layer.inner!;
            const out: Pt[] = [];
            const start = ((layer.turn ?? -90) * Math.PI) / 180;
            if (layer.shape === 'star') {
                for (let i = 0; i < n * 2; i++) {
                    const r = i % 2 === 0 ? outer : inner;
                    const a = start + (i / (n * 2)) * Math.PI * 2;
                    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
                }
            } else {
                // A tooth is flat on top, narrower than its root, with the same gap between.
                const step = (Math.PI * 2) / n, tip = (layer.tooth ?? 0.3) * step, root = tip * 1.5;
                for (let i = 0; i < n; i++) {
                    const a = start + i * step;
                    for (const [r, d] of [[inner, -root], [outer, -tip], [outer, tip], [inner, root]] as const) out.push([cx + r * Math.cos(a + d), cy + r * Math.sin(a + d)]);
                }
            }
            return { runs: closed(out), middle: [cx, cy] };
        }
        case 'path': {
            const runs = parsePath(layer.d!);
            const all = runs.flatMap((r) => r.points);
            if (all.length === 0) throw new Error('path draws nothing');
            const c = all.reduce<[number, number]>((s, p) => [s[0] + p[0] / all.length, s[1] + p[1] / all.length], [0, 0]);
            return { runs, middle: c };
        }
        default:
            return { runs: [], middle: [0, 0] };
    }
}

// ---- Masks ----------------------------------------------------------------------

/** What each pixel has of a filled outline, non-zero: a span's ends count for what they cover, so an edge has no stairs. */
function fillMask(runs: readonly (readonly Pt[])[], w: number, h: number): Float32Array {
    const mask = new Float32Array(w * h);
    const edges: { x0: number; y0: number; x1: number; y1: number; dir: number }[] = [];
    let top = Infinity, bottom = -Infinity;
    for (const run of runs) {
        for (let i = 0; i < run.length; i++) {
            const [a, b] = [run[i]!, run[(i + 1) % run.length]!];
            if (a[1] === b[1]) continue;
            const down = a[1] < b[1];
            edges.push(down ? { x0: a[0], y0: a[1], x1: b[0], y1: b[1], dir: 1 } : { x0: b[0], y0: b[1], x1: a[0], y1: a[1], dir: -1 });
            top = Math.min(top, a[1], b[1]); bottom = Math.max(bottom, a[1], b[1]);
        }
    }
    if (edges.length === 0) return mask;
    const share = 1 / SUBSCANS;
    const from = Math.max(0, Math.floor(top)), to = Math.min(h - 1, Math.ceil(bottom));
    const hits: { x: number; dir: number }[] = [];
    for (let y = from; y <= to; y++) {
        for (let s = 0; s < SUBSCANS; s++) {
            const sy = y + (s + 0.5) * share;
            hits.length = 0;
            for (const e of edges) {
                if (sy < e.y0 || sy >= e.y1) continue;
                hits.push({ x: e.x0 + ((sy - e.y0) / (e.y1 - e.y0)) * (e.x1 - e.x0), dir: e.dir });
            }
            if (hits.length < 2) continue;
            hits.sort((a, b) => a.x - b.x);
            let winding = 0;
            for (let i = 0; i + 1 < hits.length; i++) {
                winding += hits[i]!.dir;
                if (winding === 0) continue;
                const [l, r] = [Math.max(0, hits[i]!.x), Math.min(w, hits[i + 1]!.x)];
                if (r <= l) continue;
                const [il, ir] = [Math.floor(l), Math.min(w - 1, Math.floor(r))];
                const row = y * w;
                if (il === ir) { mask[row + il]! += (r - l) * share; continue; }
                mask[row + il]! += (il + 1 - l) * share;
                for (let x = il + 1; x < ir; x++) mask[row + x]! += share;
                mask[row + ir]! += (r - ir) * share;
            }
        }
    }
    for (let i = 0; i < mask.length; i++) if (mask[i]! > 1) mask[i] = 1;
    return mask;
}

/** Past this a mitre is bevelled: a point of about 11 degrees still comes out sharp, and a thinner one does not throw a long spike. */
const MITER_LIMIT = 10;
const STROKE_SAMPLES = 6;

/** What each pixel has of a stroke. Round joins and ends come from the distance to the line; the others are built of convex pieces, sampled where a pixel crosses an edge: a distance from the edges would trail a faint tail off a sharp point. */
function strokeMask(runs: readonly { points: readonly Pt[]; closed: boolean }[], width: number, w: number, h: number, join: 'round' | 'miter' | 'bevel' = 'round', cap: 'round' | 'butt' | 'square' = 'round'): Float32Array {
    const mask = new Float32Array(w * h);
    const half = width / 2;
    const capsule = (a: Pt, b: Pt): void => {
        const [x0, x1] = [Math.max(0, Math.floor(Math.min(a[0], b[0]) - half - 1)), Math.min(w - 1, Math.ceil(Math.max(a[0], b[0]) + half + 1))];
        const [y0, y1] = [Math.max(0, Math.floor(Math.min(a[1], b[1]) - half - 1)), Math.min(h - 1, Math.ceil(Math.max(a[1], b[1]) + half + 1))];
        const [ex, ey] = [b[0] - a[0], b[1] - a[1]];
        const len = ex * ex + ey * ey;
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const [px, py] = [x + 0.5 - a[0], y + 0.5 - a[1]];
                const t = len > 0 ? Math.max(0, Math.min(1, (px * ex + py * ey) / len)) : 0;
                const v = Math.max(0, Math.min(1, half - Math.hypot(px - ex * t, py - ey * t) + 0.5));
                if (v > mask[y * w + x]!) mask[y * w + x] = v;
            }
        }
    };
    const convex = (poly: readonly Pt[]): void => {
        let area = 0;
        for (let i = 0; i < poly.length; i++) {
            const [a, b] = [poly[i]!, poly[(i + 1) % poly.length]!];
            area += a[0] * b[1] - b[0] * a[1];
        }
        if (area === 0) return;
        const edges = poly.map((a, i) => {
            const b = poly[(i + 1) % poly.length]!;
            const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
            return { x: a[0], y: a[1], nx: (-(b[1] - a[1]) / len) * Math.sign(area), ny: ((b[0] - a[0]) / len) * Math.sign(area) };
        });
        const [xs, ys] = [poly.map((p) => p[0]), poly.map((p) => p[1])];
        const [x0, x1] = [Math.max(0, Math.floor(Math.min(...xs) - 1)), Math.min(w - 1, Math.ceil(Math.max(...xs) + 1))];
        const [y0, y1] = [Math.max(0, Math.floor(Math.min(...ys) - 1)), Math.min(h - 1, Math.ceil(Math.max(...ys) + 1))];
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                let inside = Infinity;
                for (const e of edges) inside = Math.min(inside, (x + 0.5 - e.x) * e.nx + (y + 0.5 - e.y) * e.ny);
                if (inside <= -0.75) continue;
                let v = 1;
                if (inside < 0.75) {
                    let hits = 0;
                    for (let sy = 0; sy < STROKE_SAMPLES; sy++) {
                        for (let sx = 0; sx < STROKE_SAMPLES; sx++) {
                            const [px, py] = [x + (sx + 0.5) / STROKE_SAMPLES, y + (sy + 0.5) / STROKE_SAMPLES];
                            if (edges.every((e) => (px - e.x) * e.nx + (py - e.y) * e.ny >= 0)) hits++;
                        }
                    }
                    v = hits / (STROKE_SAMPLES * STROKE_SAMPLES);
                }
                if (v > mask[y * w + x]!) mask[y * w + x] = v;
            }
        }
    };
    for (const run of runs) {
        if (join === 'round' && cap === 'round') {
            const count = run.closed ? run.points.length : run.points.length - 1;
            for (let i = 0; i < count; i++) capsule(run.points[i]!, run.points[(i + 1) % run.points.length]!);
            continue;
        }
        // A point repeated has no direction to join from.
        const pts = run.points.filter((p, i, all) => i === 0 || Math.hypot(p[0] - all[i - 1]![0], p[1] - all[i - 1]![1]) > 1e-6);
        if (run.closed && pts.length > 1 && Math.hypot(pts[0]![0] - pts[pts.length - 1]![0], pts[0]![1] - pts[pts.length - 1]![1]) <= 1e-6) pts.pop();
        if (pts.length < 2) {
            if (pts[0] && cap !== 'butt') capsule(pts[0], pts[0]);
            continue;
        }
        const count = run.closed ? pts.length : pts.length - 1;
        const direction = (i: number): Pt => {
            const [a, b] = [pts[i]!, pts[(i + 1) % pts.length]!];
            const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
            return [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
        };
        for (let i = 0; i < count; i++) {
            const [a, b] = [pts[i]!, pts[(i + 1) % pts.length]!];
            const u = direction(i);
            const [nx, ny] = [-u[1] * half, u[0] * half];
            // A joined end runs on by a pixel's half diagonal, or two pieces half covering a pixel leave a notch across the line.
            const end = (open: boolean): number => (open ? (cap === 'square' ? half : 0) : 0.75);
            const [s, e] = [end(!run.closed && i === 0), end(!run.closed && i === count - 1)];
            const [ax, ay, bx, by] = [a[0] - u[0] * s, a[1] - u[1] * s, b[0] + u[0] * e, b[1] + u[1] * e];
            convex([[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]]);
        }
        if (!run.closed && cap === 'round') {
            capsule(pts[0]!, pts[0]!);
            capsule(pts[pts.length - 1]!, pts[pts.length - 1]!);
        }
        for (let i = run.closed ? 0 : 1; i < (run.closed ? pts.length : pts.length - 1); i++) {
            const p = pts[i]!;
            const [u0, u1] = [direction((i - 1 + pts.length) % pts.length), direction(i)];
            const cross = u0[0] * u1[1] - u0[1] * u1[0];
            if (join === 'round') {
                capsule(p, p);
                continue;
            }
            if (Math.abs(cross) < 1e-6) continue;
            // Turning toward +normal, the outside of the corner is the other side.
            const side = cross > 0 ? -1 : 1;
            const [n0, n1]: [Pt, Pt] = [[-u0[1] * side, u0[0] * side], [-u1[1] * side, u1[0] * side]];
            const [A, B]: [Pt, Pt] = [[p[0] + n0[0] * half, p[1] + n0[1] * half], [p[0] + n1[0] * half, p[1] + n1[1] * half]];
            const [mx, my] = [n0[0] + n1[0], n0[1] + n1[1]];
            const length = Math.hypot(mx, my);
            const ratio = length > 0 ? 2 / length : Infinity;
            if (join === 'miter' && ratio <= MITER_LIMIT) convex([p, A, [p[0] + (mx / length) * half * ratio, p[1] + (my / length) * half * ratio], B]);
            else convex([p, A, B]);
        }
    }
    return mask;
}

/** Three box blurs, which is a gaussian to the eye at a cost that does not grow with the radius. */
function blurMask(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
    if (sigma <= 0) return src;
    const r = Math.max(1, Math.round(sigma * 1.2));
    let cur = src;
    for (let pass = 0; pass < 3; pass++) {
        const a = new Float32Array(w * h);
        for (let y = 0; y < h; y++) {
            let sum = 0;
            for (let x = -r; x <= r; x++) sum += cur[y * w + Math.max(0, Math.min(w - 1, x))]!;
            for (let x = 0; x < w; x++) {
                a[y * w + x] = sum / (2 * r + 1);
                sum += cur[y * w + Math.min(w - 1, x + r + 1)]! - cur[y * w + Math.max(0, x - r)]!;
            }
        }
        const b = new Float32Array(w * h);
        for (let x = 0; x < w; x++) {
            let sum = 0;
            for (let y = -r; y <= r; y++) sum += a[Math.max(0, Math.min(h - 1, y)) * w + x]!;
            for (let y = 0; y < h; y++) {
                b[y * w + x] = sum / (2 * r + 1);
                sum += a[Math.min(h - 1, y + r + 1) * w + x]! - a[Math.max(0, y - r) * w + x]!;
            }
        }
        cur = b;
    }
    return cur;
}

function shifted(src: Float32Array, w: number, h: number, dx: number, dy: number): Float32Array {
    const [ix, iy] = [Math.round(dx), Math.round(dy)];
    if (ix === 0 && iy === 0) return src;
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
        const fy = y - iy;
        if (fy < 0 || fy >= h) continue;
        for (let x = 0; x < w; x++) {
            const fx = x - ix;
            if (fx >= 0 && fx < w) out[y * w + x] = src[fy * w + fx]!;
        }
    }
    return out;
}

// ---- Paint ----------------------------------------------------------------------

/** A fill as a function of a pixel. Its coordinates go with its layer's, turned and all. */
/** Written out, not computed by cos and sin, whose last bits are the engine's to choose. */
const NOISE_DIRECTIONS: readonly (readonly [number, number])[] = [
    [1, 0], [0.9239, 0.3827], [0.7071, 0.7071], [0.3827, 0.9239], [0, 1], [-0.3827, 0.9239], [-0.7071, 0.7071], [-0.9239, 0.3827],
    [-1, 0], [-0.9239, -0.3827], [-0.7071, -0.7071], [-0.3827, -0.9239], [0, -1], [0.3827, -0.9239], [0.7071, -0.7071], [0.9239, -0.3827],
];

/** How much a corner of the lattice lifts the point @p dx, @p dy away. Integer hashing, so it is the same on every machine. */
function cornerLift(ix: number, iy: number, seed: number, dx: number, dy: number): number {
    let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442968193);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = Math.imul(h ^ (h >>> 16), 2246822519);
    const d = NOISE_DIRECTIONS[((h ^ (h >>> 16)) >>> 0) % NOISE_DIRECTIONS.length]!;
    return d[0] * dx + d[1] * dy;
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** Gradient noise, about -0.7..0.7: a value on a lattice alone shows the lattice, as boxes in a large soft cloud. */
function gradientNoise(x: number, y: number, seed: number): number {
    const [ix, iy] = [Math.floor(x), Math.floor(y)];
    const [fx, fy] = [x - ix, y - iy];
    const [sx, sy] = [fade(fx), fade(fy)];
    const top = cornerLift(ix, iy, seed, fx, fy) * (1 - sx) + cornerLift(ix + 1, iy, seed, fx - 1, fy) * sx;
    const bottom = cornerLift(ix, iy + 1, seed, fx, fy - 1) * (1 - sx) + cornerLift(ix + 1, iy + 1, seed, fx - 1, fy - 1) * sx;
    return top * (1 - sy) + bottom * sy;
}

/** Spread out to 0..1, so that the stops at the ends are reached. */
const NOISE_CONTRAST = [1.15, 1.3, 1.4, 1.45, 1.45, 1.45, 1.45, 1.45];

function fractalNoise(x: number, y: number, octaves: number, seed: number): number {
    let [sum, weight, amplitude, frequency] = [0, 0, 1, 1];
    for (let i = 0; i < octaves; i++) {
        // Off the lattice, where this noise is always nothing.
        sum += gradientNoise(x * frequency + 0.37, y * frequency + 0.61, seed + i * 101) * amplitude;
        weight += amplitude;
        amplitude *= 0.5;
        frequency *= 2;
    }
    return Math.max(0, Math.min(1, 0.5 + (sum / weight) * NOISE_CONTRAST[octaves - 1]!));
}

function paintOf(fill: ImageFill, m: Matrix): (x: number, y: number) => Rgba {
    if (typeof fill === 'string') {
        const c = parseColor(fill);
        return () => c;
    }
    const stops = [...fill.stops].map(([t, c]) => [t, parseColor(c)] as const).sort((a, b) => a[0] - b[0]);
    const inverse = invert(m);
    const at = (t: number): Rgba => {
        if (t <= stops[0]![0]) return stops[0]![1];
        for (let i = 1; i < stops.length; i++) {
            if (t <= stops[i]![0]) {
                const [t0, a] = stops[i - 1]!, [t1, b] = stops[i]!;
                const s = (t - t0) / Math.max(1e-6, t1 - t0);
                return [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s, a[3] + (b[3] - a[3]) * s];
            }
        }
        return stops[stops.length - 1]![1];
    };
    if (fill.type === 'noise') {
        const [scale, octaves, seed] = [fill.scale ?? 32, fill.octaves ?? 4, fill.seed ?? 0];
        return (x, y) => {
            const p = apply(inverse, [x - 0.5, y - 0.5]);
            return at(fractalNoise(p[0] / scale, p[1] / scale, octaves, seed));
        };
    }
    if (fill.type === 'linear') {
        const [a, b] = [fill.from, fill.to];
        const [ex, ey] = [b[0] - a[0], b[1] - a[1]];
        const len = ex * ex + ey * ey || 1;
        return (x, y) => {
            const p = apply(inverse, [x, y]);
            return at(((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / len);
        };
    }
    const [cx, cy] = fill.at;
    const r = fill.radius;
    return (x, y) => {
        const p = apply(inverse, [x, y]);
        return at(Math.hypot(p[0] - cx, p[1] - cy) / r);
    };
}

/** Premultiplied: what blending wants, and what a blur of an edge wants. */
class Canvas {
    readonly px: Float32Array;
    constructor(readonly w: number, readonly h: number) { this.px = new Float32Array(w * h * 4); }
}

type Blend = NonNullable<ImageLayer['blend']>;
const blendChannel = (mode: Blend, b: number, s: number): number => {
    switch (mode) {
        case 'multiply': return b * s;
        case 'screen': return b + s - b * s;
        case 'overlay': return b < 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s);
        case 'add': return Math.min(1, b + s);
        default: return s;
    }
};

/** @p color straight, at coverage @p m, over what is there. */
function put(c: Canvas, i: number, r: number, g: number, b: number, a: number, mode: Blend): void {
    if (a <= 0) return;
    const p = c.px, at = i * 4;
    const da = p[at + 3]!;
    if (mode === 'normal' || da <= 0) {
        p[at] = p[at]! * (1 - a) + r * a; p[at + 1] = p[at + 1]! * (1 - a) + g * a; p[at + 2] = p[at + 2]! * (1 - a) + b * a;
    } else {
        const [dr, dg, db] = [p[at]! / da, p[at + 1]! / da, p[at + 2]! / da];
        const mix = (d: number, s: number): number => (1 - da) * s + da * blendChannel(mode, d, s);
        p[at] = p[at]! * (1 - a) + mix(dr, r) * a; p[at + 1] = p[at + 1]! * (1 - a) + mix(dg, g) * a; p[at + 2] = p[at + 2]! * (1 - a) + mix(db, b) * a;
    }
    p[at + 3] = da + a - da * a;
}

function effectLayers(effects: readonly ImageEffect[] | undefined, under: boolean, c: Canvas, mask: Float32Array): void {
    const { w, h } = c;
    for (const e of effects ?? []) {
        const isUnder = e.type === 'shadow' || e.type === 'glow';
        if (isUnder !== under) continue;
        const [r, g, b, ca] = parseColor(e.color ?? (e.type === 'glow' || e.type === 'innerGlow' ? '#ffffff' : '#000000'));
        const op = (e.opacity ?? 1) * ca;
        const sigma = e.blur ?? (e.type === 'glow' ? 8 : 4);
        if (isUnder) {
            let src = shifted(mask, w, h, e.x ?? 0, e.y ?? 0);
            // Spread first, so a glow is bright at the edge and not merely soft.
            if (e.type === 'glow') src = src.map((v) => Math.min(1, v * 1.6));
            const soft = blurMask(src, w, h, sigma);
            for (let i = 0; i < soft.length; i++) put(c, i, r, g, b, Math.min(1, soft[i]! * op), e.type === 'glow' ? 'screen' : 'normal');
        } else {
            // Inside: what the shape leaves out, softened and moved, and kept within the shape.
            const inv = mask.map((v) => 1 - v);
            const soft = blurMask(shifted(inv, w, h, e.x ?? 0, e.y ?? 0), w, h, sigma);
            const mode: Blend = e.type === 'innerGlow' ? 'screen' : 'normal';
            for (let i = 0; i < soft.length; i++) put(c, i, r, g, b, Math.min(1, soft[i]! * mask[i]! * op), mode);
        }
    }
}

interface Drawn { masks: Map<string, Float32Array>; notes: string[]; bounds: Map<string, ImageBox> }

/** x, y, width and height in the picture's pixels. */
export type ImageBox = readonly [number, number, number, number];

/** The box of whatever covers at least half a pixel: where a shape's edge is, and not the last faint pixel of a glow. */
function boxOf(w: number, h: number, covers: (i: number) => boolean): ImageBox | null {
    let [x0, y0, x1, y1] = [w, h, -1, -1];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (!covers(y * w + x)) continue;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            y1 = y;
        }
    }
    return x1 < 0 ? null : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

function noteBox(drawn: Drawn, id: string | undefined, mask: Float32Array, w: number, h: number): void {
    if (!id) return;
    const box = boxOf(w, h, (i) => mask[i]! >= 0.5);
    if (box) drawn.bounds.set(id, box);
}

function drawLayer(c: Canvas, layer: ImageLayer, parent: Matrix, drawn: Drawn): void {
    if (layer.visible === false) return;
    const { w, h } = c;
    if (layer.mirror) {
        const { mirror, ...rest } = layer;
        const axis = mirror === 'x' ? { x: -1, y: 1 } : { x: 1, y: -1 };
        // Across the middle of the picture.
        const flip: Matrix = axis.x < 0 ? [-1, 0, 0, 1, w / drawnScale(parent), 0] : [1, 0, 0, -1, 0, h / drawnScale(parent)];
        drawLayer(c, rest, parent, drawn);
        drawLayer(c, { ...rest, ...(layer.id ? { id: `${layer.id}.mirrored` } : {}) }, times(parent, flip), drawn);
        return;
    }
    const opacity = layer.opacity ?? 1;
    const blend: Blend = layer.blend ?? 'normal';
    const clip = layer.clip ? drawn.masks.get(layer.clip) : undefined;
    if (layer.clip && !clip) drawn.notes.push(`layer ${layer.id ?? layer.shape}: clip "${layer.clip}" names no layer drawn before it`);

    if (layer.blur) {
        const { blur, opacity: _o, blend: _b, clip: _c, ...sharp } = layer;
        const inner = new Canvas(w, h);
        drawLayer(inner, sharp, parent, drawn);
        // Blurred as stored, colour already times alpha: blurring straight colour would bring the black of empty pixels in round the edge.
        const [r, g, b, a] = [0, 1, 2, 3].map((k) => {
            const channel = new Float32Array(w * h);
            for (let i = 0; i < channel.length; i++) channel[i] = inner.px[i * 4 + k]!;
            return blurMask(channel, w, h, blur * drawnScale(parent));
        }) as [Float32Array, Float32Array, Float32Array, Float32Array];
        if (layer.id) drawn.masks.set(layer.id, a);
        for (let i = 0; i < a.length; i++) {
            const alpha = a[i]!;
            if (alpha <= 0) continue;
            put(c, i, r[i]! / alpha, g[i]! / alpha, b[i]! / alpha, alpha * opacity * (clip ? clip[i]! : 1), blend);
        }
        return;
    }

    if (layer.shape === 'group') {
        const inner = new Canvas(w, h);
        const m = times(parent, transformOf(layer.transform, [w / 2, h / 2]));
        for (const child of layer.layers ?? []) drawLayer(inner, child, m, drawn);
        const alpha = new Float32Array(w * h);
        for (let i = 0; i < alpha.length; i++) alpha[i] = inner.px[i * 4 + 3]!;
        if (layer.id) drawn.masks.set(layer.id, alpha);
        noteBox(drawn, layer.id, alpha, w, h);
        effectLayers(layer.effects, true, c, alpha);
        for (let i = 0; i < alpha.length; i++) {
            const a = alpha[i]! * opacity * (clip ? clip[i]! : 1);
            if (a <= 0) continue;
            const s = inner.px[i * 4 + 3]! || 1;
            put(c, i, inner.px[i * 4]! / s, inner.px[i * 4 + 1]! / s, inner.px[i * 4 + 2]! / s, a, blend);
        }
        effectLayers(layer.effects, false, c, alpha);
        return;
    }

    if (layer.shape === 'pixels') {
        drawPixels(c, layer, parent, drawn, opacity, blend, clip);
        return;
    }

    if (layer.shape === 'paint') {
        drawPaint(c, layer, parent, drawn, opacity, blend, clip);
        return;
    }

    const { runs, middle } = outlinesOf(layer);
    const m = times(parent, transformOf(layer.transform, middle));
    const placed = runs.map((run) => ({ closed: run.closed, points: run.points.map((p) => apply(m, p)) }));
    const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
    const hasFill = layer.fill !== undefined && layer.shape !== 'line';
    const body = layer.shape === 'line' ? new Float32Array(w * h) : fillMask(placed.map((r) => r.points), w, h);
    const align = layer.stroke?.align ?? 'center';
    // An outside stroke is as wide again and goes under the fill. Cut to meet the fill's edge, each would cover part of the same edge pixel and the ground would show between them.
    const line = layer.stroke ? strokeMask(placed, layer.stroke.width * scale * (align === 'outside' ? 2 : 1), w, h, layer.stroke.join, layer.stroke.cap) : null;
    if (line && align === 'inside') for (let i = 0; i < line.length; i++) line[i]! *= body[i]!;
    // Under a see-through fill it must not show, so only the edge pixels keep it.
    if (line && align === 'outside') for (let i = 0; i < line.length; i++) if (body[i]! >= 0.999) line[i] = 0;
    const whole = new Float32Array(w * h);
    let any = 0;
    for (let i = 0; i < whole.length; i++) {
        const v = Math.max(hasFill ? body[i]! : 0, line ? line[i]! : 0) * (clip ? clip[i]! : 1);
        whole[i] = v;
        any += v;
    }
    noteBox(drawn, layer.id, whole, w, h);
    // What clips to this stays inside its stroke: liquid in a flask must not paint over the flask's outline.
    if (layer.id) {
        // A line has no inside but itself.
        const covering = align === 'outside' ? null : line;
        drawn.masks.set(layer.id, layer.shape === 'line' ? whole : body.map((v, i) => v * (covering ? 1 - covering[i]! : 1) * (clip ? clip[i]! : 1)));
    }
    if (any === 0) drawn.notes.push(`layer ${layer.id ?? layer.shape} draws nothing inside the picture${clip ? ', or nothing inside its clip' : ''}`);
    if (layer.erase) {
        for (let i = 0; i < whole.length; i++) {
            const keep = 1 - whole[i]! * opacity;
            for (let k = 0; k < 4; k++) c.px[i * 4 + k]! *= keep;
        }
        return;
    }
    effectLayers(layer.effects, true, c, whole);
    const paintLine = (): void => {
        const paint = paintOf(layer.stroke!.color, m);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = y * w + x;
                const v = line![i]! * (clip ? clip[i]! : 1);
                if (v <= 0) continue;
                const col = paint(x + 0.5, y + 0.5);
                put(c, i, col[0], col[1], col[2], v * col[3] * opacity, blend);
            }
        }
    };
    if (line && align === 'outside') paintLine();
    if (hasFill) {
        const paint = paintOf(layer.fill!, m);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = y * w + x;
                const v = body[i]! * (clip ? clip[i]! : 1);
                if (v <= 0) continue;
                const col = paint(x + 0.5, y + 0.5);
                put(c, i, col[0], col[1], col[2], v * col[3] * opacity, blend);
            }
        }
    }
    effectLayers(layer.effects, false, c, whole);
    if (line && align !== 'outside') paintLine();
}

const drawnScale = (m: Matrix): number => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

/** Rows of characters, each a palette's colour, drawn as hard squares. */
// ---- Brushes ---------------------------------------------------------------------

const hash01 = (a: number, b: number): number => {
    let h = Math.imul(a, 374761393) + Math.imul(b, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = Math.imul(h ^ (h >>> 16), 2246822519);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

const smoothed = (t: number): number => t * t * (3 - 2 * t);

interface PathPoint { x: number; y: number; pressure: number; along: number }

/** A stroke's points as a smooth line about a pixel apart, Catmull-Rom so it passes through each. */
function brushPath(points: readonly (readonly number[])[], m: Matrix): PathPoint[] {
    const placed = points.map((p) => {
        const q = apply(m, [p[0]!, p[1]!]);
        return [q[0], q[1], p[2] ?? 1] as const;
    });
    const out: PathPoint[] = [{ x: placed[0]![0], y: placed[0]![1], pressure: placed[0]![2], along: 0 }];
    for (let i = 0; i + 1 < placed.length; i++) {
        const [p0, p1, p2, p3] = [placed[Math.max(0, i - 1)]!, placed[i]!, placed[i + 1]!, placed[Math.min(placed.length - 1, i + 2)]!];
        const steps = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1])));
        for (let s = 1; s <= steps; s++) {
            const t = s / steps, t2 = t * t, t3 = t2 * t;
            const curve = (k: 0 | 1): number => 0.5 * (2 * p1[k] + (p2[k] - p0[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t3);
            const [x, y] = [curve(0), curve(1)];
            const last = out[out.length - 1]!;
            out.push({ x, y, pressure: p1[2] + (p2[2] - p1[2]) * t, along: last.along + Math.hypot(x - last.x, y - last.y) });
        }
    }
    return out;
}

/** One stroke's coverage before it meets the canvas, so a stroke overlapping itself does not build up into beads. */
interface StrokeBuffer { mask: Float32Array; rgb: Float32Array; touched: number[] }

function paintStrand(c: Canvas, s: ImageStroke, path: readonly PathPoint[], strand: { offset: number; radius: number | null; from: number; to: number; shade: number; strength: number; seed: number }, scale: number, buffer: StrokeBuffer): void {
    const { w, h } = c;
    const total = path[path.length - 1]!.along;
    const [startColor, endColor] = [parseColor(s.color ?? '#000000'), parseColor(s.to ?? s.color ?? '#000000')];
    const [taperIn, taperOut] = s.taper ?? [0, 0];
    const hardness = s.hardness ?? 0.5;
    const size = s.size * scale;
    const smudge = s.smudge ?? 0;
    const wobble = (s.wobble ?? 0) * scale;

    const sample = (x: number, y: number): [number, number, number, number] => {
        const [px, py] = [Math.max(0, Math.min(w - 1, Math.floor(x))), Math.max(0, Math.min(h - 1, Math.floor(y)))];
        const at = (py * w + px) * 4;
        return [c.px[at]!, c.px[at + 1]!, c.px[at + 2]!, c.px[at + 3]!];
    };
    let carried: [number, number, number, number] | null = null;

    let index = 0;
    let distance = total * strand.from;
    const end = total * strand.to;
    for (;;) {
        while (index + 1 < path.length - 1 && path[index + 1]!.along < distance) index++;
        const [a, b] = [path[index]!, path[Math.min(path.length - 1, index + 1)]!];
        const span = b.along - a.along;
        const t = span > 0 ? Math.max(0, Math.min(1, (distance - a.along) / span)) : 0;
        const position = total > 0 ? distance / total : 0;
        let narrowing = 1;
        if (taperIn > 0 && position < taperIn) narrowing *= smoothed(position / taperIn);
        if (taperOut > 0 && position > 1 - taperOut) narrowing *= smoothed((1 - position) / taperOut);
        const width = size * (a.pressure + (b.pressure - a.pressure) * t) * narrowing;
        const radius = strand.radius === null ? width / 2 : Math.min(strand.radius, Math.max(width, strand.radius * 0.4));
        const [nx, ny] = span > 0 ? [-(b.y - a.y) / span, (b.x - a.x) / span] : [0, 0];
        const drift = wobble > 0 ? gradientNoise(distance / (size * 3 + 8), strand.seed * 0.37 + 0.5, strand.seed) * 2 * wobble : 0;
        const away = strand.offset * width + drift;
        const [cx, cy] = [a.x + (b.x - a.x) * t + nx * away, a.y + (b.y - a.y) * t + ny * away];

        if (radius >= 0.12) {
            const soft = Math.max(1, radius * (1 - hardness));
            const thin = Math.min(1, radius * 2);
            // Flat at the top: stamps of a pointed falloff, overlapped, ripple along the stroke.
            const cover = (d: number): number => {
                const v = Math.max(0, Math.min(1, (radius + 0.5 - d) / soft));
                return soft > 1 ? smoothed(v) : v;
            };
            const [x0, x1] = [Math.max(0, Math.floor(cx - radius - 1)), Math.min(w - 1, Math.ceil(cx + radius + 1))];
            const [y0, y1] = [Math.max(0, Math.floor(cy - radius - 1)), Math.min(h - 1, Math.ceil(cy + radius + 1))];
            if (smudge > 0) {
                carried ??= sample(cx, cy);
                for (let y = y0; y <= y1; y++) {
                    for (let x = x0; x <= x1; x++) {
                        const v = cover(Math.hypot(x + 0.5 - cx, y + 0.5 - cy)) * thin * smudge * (s.opacity ?? 1);
                        if (v <= 0) continue;
                        const at = (y * w + x) * 4;
                        for (let k = 0; k < 4; k++) c.px[at + k] = c.px[at + k]! + (carried[k]! - c.px[at + k]!) * v * 0.5;
                    }
                }
                const here = sample(cx, cy);
                for (let k = 0; k < 4; k++) carried[k] = carried[k]! + (here[k]! - carried[k]!) * (1 - smudge) * 0.5;
            } else {
                const along = total > 0 ? distance / total : 0;
                const mix = (k: number): number => Math.max(0, Math.min(1, (startColor[k]! + (endColor[k]! - startColor[k]!) * along) * strand.shade));
                const [r, g, bl] = [mix(0), mix(1), mix(2)];
                const alpha = (startColor[3] + (endColor[3] - startColor[3]) * along) * (s.opacity ?? 1) * strand.strength;
                for (let y = y0; y <= y1; y++) {
                    for (let x = x0; x <= x1; x++) {
                        const v = cover(Math.hypot(x + 0.5 - cx, y + 0.5 - cy)) * thin * alpha;
                        const i = y * w + x;
                        if (v <= buffer.mask[i]!) continue;
                        if (buffer.mask[i] === 0) buffer.touched.push(i);
                        buffer.mask[i] = v;
                        buffer.rgb[i * 3] = r; buffer.rgb[i * 3 + 1] = g; buffer.rgb[i * 3 + 2] = bl;
                    }
                }
            }
        }
        if (distance >= end || total === 0) break;
        distance = Math.min(end, distance + Math.max(0.4, radius * 0.1));
    }
    // Laid down all at once, so opacity is the stroke's and not the sum of its stamps.
    const mode: Blend = s.blend ?? 'normal';
    for (const i of buffer.touched) {
        const v = buffer.mask[i]!;
        if (s.erase) for (let k = 0; k < 4; k++) c.px[i * 4 + k]! *= 1 - v;
        else put(c, i, buffer.rgb[i * 3]!, buffer.rgb[i * 3 + 1]!, buffer.rgb[i * 3 + 2]!, v, mode);
        buffer.mask[i] = 0;
    }
    buffer.touched.length = 0;
}

function paintStroke(c: Canvas, s: ImageStroke, m: Matrix, scale: number, n: number, buffer: StrokeBuffer): void {
    const path = brushPath(s.points, m);
    const seed = s.seed ?? n + 1;
    const count = s.bristles ?? 1;
    if (count === 1) {
        paintStrand(c, s, path, { offset: 0, radius: null, from: 0, to: 1, shade: 1, strength: 1, seed }, scale, buffer);
        return;
    }
    const spread = s.spread ?? 1;
    const vary = s.vary ?? 0.15;
    const radius = ((s.strand ?? Math.max(0.8, (s.size / count) * 2.2)) * scale) / 2;
    for (let j = 0; j < count; j++) {
        const pick = (k: number): number => hash01(seed * 131 + j, k);
        paintStrand(c, s, path, {
            // Even across the width and then shaken, so bristles neither clump nor stand in rows.
            offset: (((j + pick(1)) / count) - 0.5) * spread,
            radius,
            from: pick(2) * 0.06,
            to: 1 - pick(3) * 0.1,
            shade: 1 + (pick(4) - 0.5) * 2 * vary,
            strength: 1 - pick(5) * vary * 1.5,
            seed: seed * 31 + j,
        }, scale, buffer);
    }
}

function drawPaint(c: Canvas, layer: ImageLayer, parent: Matrix, drawn: Drawn, opacity: number, blend: Blend, clip: Float32Array | undefined): void {
    const { w, h } = c;
    const m = times(parent, transformOf(layer.transform, [w / 2, h / 2]));
    const inner = new Canvas(w, h);
    if (layer.fill !== undefined) {
        const paint = paintOf(layer.fill, m);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const col = paint(x + 0.5, y + 0.5);
                put(inner, y * w + x, col[0], col[1], col[2], col[3], 'normal');
            }
        }
    }
    const buffer: StrokeBuffer = { mask: new Float32Array(w * h), rgb: new Float32Array(w * h * 3), touched: [] };
    (layer.strokes ?? []).forEach((s, n) => paintStroke(inner, s, m, drawnScale(m), n, buffer));
    const alpha = new Float32Array(w * h);
    for (let i = 0; i < alpha.length; i++) alpha[i] = inner.px[i * 4 + 3]!;
    if (layer.id) drawn.masks.set(layer.id, alpha);
    noteBox(drawn, layer.id, alpha, w, h);
    effectLayers(layer.effects, true, c, alpha);
    for (let i = 0; i < alpha.length; i++) {
        const a = alpha[i]!;
        if (a <= 0) continue;
        put(c, i, inner.px[i * 4]! / a, inner.px[i * 4 + 1]! / a, inner.px[i * 4 + 2]! / a, a * opacity * (clip ? clip[i]! : 1), blend);
    }
    effectLayers(layer.effects, false, c, alpha);
}

function drawPixels(c: Canvas, layer: ImageLayer, parent: Matrix, drawn: Drawn, opacity: number, blend: Blend, clip: Float32Array | undefined): void {
    const { w, h } = c;
    const rows = layer.rows!;
    const columns = Math.max(...rows.map((r) => r.length));
    const scale = (layer.scale ?? Math.max(1, Math.floor(Math.min(w / columns, h / rows.length)))) * drawnScale(parent);
    const [ax, ay] = layer.at ? apply(parent, layer.at) : [(w - columns * scale) / 2, (h - rows.length * scale) / 2];
    const palette = new Map(Object.entries(layer.palette ?? {}).map(([k, v]) => [k, parseColor(v)]));
    const whole = new Float32Array(w * h);
    const colors = new Float32Array(w * h * 3);
    rows.forEach((row, ry) => {
        [...row].forEach((ch, rx) => {
            const col = palette.get(ch);
            if (!col) return;
            for (let y = Math.max(0, Math.round(ay + ry * scale)); y < Math.min(h, Math.round(ay + (ry + 1) * scale)); y++) {
                for (let x = Math.max(0, Math.round(ax + rx * scale)); x < Math.min(w, Math.round(ax + (rx + 1) * scale)); x++) {
                    whole[y * w + x] = col[3] * (clip ? clip[y * w + x]! : 1);
                    colors[(y * w + x) * 3] = col[0]; colors[(y * w + x) * 3 + 1] = col[1]; colors[(y * w + x) * 3 + 2] = col[2];
                }
            }
        });
    });
    if (layer.id) drawn.masks.set(layer.id, whole);
    noteBox(drawn, layer.id, whole, w, h);
    effectLayers(layer.effects, true, c, whole);
    for (let i = 0; i < whole.length; i++) put(c, i, colors[i * 3]!, colors[i * 3 + 1]!, colors[i * 3 + 2]!, whole[i]! * opacity, blend);
    effectLayers(layer.effects, false, c, whole);
}

export interface RenderedImage extends RgbaBitmap {
    notes: string[];
    /** Where the picture is solid, null if nowhere, and how much of its area that is, 0..1: how large it looks beside others. */
    bounds: ImageBox | null;
    covers: number;
    /** The same box for each layer with an id, after every transform, without its effects. */
    layerBounds: Record<string, ImageBox>;
}

/** Draws a source that has been validated. */
export function renderImage(source: ImageSource): RenderedImage {
    const [w, h] = typeof source.size === 'number' ? [source.size, source.size] : source.size;
    const canvas = new Canvas(w, h);
    if (source.background) {
        const [r, g, b, a] = parseColor(source.background);
        for (let i = 0; i < w * h; i++) put(canvas, i, r, g, b, a, 'normal');
    }
    const drawn: Drawn = { masks: new Map(), notes: [], bounds: new Map() };
    for (const layer of source.layers) drawLayer(canvas, layer, IDENTITY, drawn);
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
        const a = canvas.px[i * 4 + 3]!;
        const d = a > 1e-5 ? 1 / a : 0;
        rgba[i * 4] = Math.round(Math.min(1, canvas.px[i * 4]! * d) * 255);
        rgba[i * 4 + 1] = Math.round(Math.min(1, canvas.px[i * 4 + 1]! * d) * 255);
        rgba[i * 4 + 2] = Math.round(Math.min(1, canvas.px[i * 4 + 2]! * d) * 255);
        rgba[i * 4 + 3] = Math.round(Math.min(1, a) * 255);
    }
    let solid = 0;
    for (let i = 0; i < w * h; i++) if (rgba[i * 4 + 3]! >= 128) solid++;
    return {
        width: w, height: h, rgba, notes: drawn.notes,
        bounds: boxOf(w, h, (i) => rgba[i * 4 + 3]! >= 128),
        covers: Math.round((solid / (w * h)) * 1000) / 1000,
        layerBounds: Object.fromEntries(drawn.bounds),
    };
}

function shrink(src: RgbaBitmap, width: number, height: number): RgbaBitmap {
    // Averaged by alpha: a transparent pixel's colour must not bleed into the edge beside it.
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        const [y0, y1] = [Math.floor((y * src.height) / height), Math.max(Math.floor((y * src.height) / height) + 1, Math.floor(((y + 1) * src.height) / height))];
        for (let x = 0; x < width; x++) {
            const [x0, x1] = [Math.floor((x * src.width) / width), Math.max(Math.floor((x * src.width) / width) + 1, Math.floor(((x + 1) * src.width) / width))];
            let [r, g, b, a, n] = [0, 0, 0, 0, 0];
            for (let sy = y0; sy < y1; sy++) {
                for (let sx = x0; sx < x1; sx++) {
                    const at = (sy * src.width + sx) * 4;
                    const al = src.rgba[at + 3]!;
                    r += src.rgba[at]! * al; g += src.rgba[at + 1]! * al; b += src.rgba[at + 2]! * al; a += al; n++;
                }
            }
            const to = (y * width + x) * 4;
            if (a > 0) { rgba[to] = r / a; rgba[to + 1] = g / a; rgba[to + 2] = b / a; }
            rgba[to + 3] = a / n;
        }
    }
    return { width, height, rgba };
}

type Ground = (x: number, y: number) => readonly [number, number, number];
/** Between dark and light, so a dark outline and a pale highlight both show. On a near-black ground the outline a small icon wants disappears. */
const midGround: Ground = () => [104, 112, 128];
const checkGround: Ground = (x, y) => ((Math.floor(x / 12) + Math.floor(y / 12)) % 2 ? [226, 226, 230] : [250, 250, 252]);

function layOn(rgba: Uint8Array, W: number, pic: RgbaBitmap, ox: number, oy: number, ground: Ground): void {
    for (let y = 0; y < pic.height; y++) {
        for (let x = 0; x < pic.width; x++) {
            const from = (y * pic.width + x) * 4;
            const a = pic.rgba[from + 3]! / 255;
            const g = ground(x, y);
            const to = ((oy + y) * W + ox + x) * 4;
            rgba[to] = pic.rgba[from]! * a + g[0] * (1 - a);
            rgba[to + 1] = pic.rgba[from + 1]! * a + g[1] * (1 - a);
            rgba[to + 2] = pic.rgba[from + 2]! * a + g[2] * (1 - a);
            rgba[to + 3] = 255;
        }
    }
}

const SHEET_GROUND = [64, 64, 68, 255] as const;

function solidSheet(W: number, H: number): Uint8Array {
    const rgba = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) rgba.set(SHEET_GROUND, i * 4);
    return rgba;
}

const fitted = (image: RgbaBitmap, size: number): RgbaBitmap => {
    const k = size / Math.max(image.width, image.height);
    const [w, h] = [Math.max(1, Math.round(image.width * k)), Math.max(1, Math.round(image.height * k))];
    return k >= 1 ? nearestScale(image, w, h) : shrink(image, w, h);
};

/** Several pictures on one sheet, to be judged as a set: each on the mid ground and the check, then at 64 and 32, column by column. */
export function setSheet(images: readonly RgbaBitmap[], cell = 128): RgbaBitmap {
    if (images.length === 0) throw new Error('a set needs at least one picture');
    const gap = 8;
    const columns = Math.min(8, images.length);
    const rows = Math.ceil(images.length / columns);
    const tall = cell * 2 + 64 + 32 + gap * 5;
    const W = columns * (cell + gap) + gap, H = rows * tall;
    const rgba = solidSheet(W, H);
    images.forEach((image, n) => {
        const [ox, oy] = [gap + (n % columns) * (cell + gap), Math.floor(n / columns) * tall + gap];
        const big = fitted(image, cell);
        layOn(rgba, W, big, ox, oy, midGround);
        layOn(rgba, W, big, ox, oy + cell + gap, checkGround);
        layOn(rgba, W, fitted(image, 64), ox, oy + cell * 2 + gap * 2, midGround);
        layOn(rgba, W, fitted(image, 32), ox, oy + cell * 2 + 64 + gap * 3, midGround);
    });
    return { width: W, height: H, rgba };
}

/** A part of a picture enlarged with hard pixels on the check, to see what the whole hides: a seam one pixel wide. */
export function zoomImage(image: RgbaBitmap, region: { x: number; y: number; w: number; h: number }, longest = 640): RgbaBitmap {
    const [x0, y0] = [Math.max(0, Math.floor(region.x)), Math.max(0, Math.floor(region.y))];
    const [w, h] = [Math.min(image.width - x0, Math.round(region.w)), Math.min(image.height - y0, Math.round(region.h))];
    if (!(w > 0 && h > 0)) throw new Error(`region ${JSON.stringify(region)} is outside the picture, ${image.width} by ${image.height}`);
    const cut = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) cut.set(image.rgba.subarray(((y0 + y) * image.width + x0) * 4, ((y0 + y) * image.width + x0 + w) * 4), y * w * 4);
    const k = Math.max(1, Math.floor(longest / Math.max(w, h)));
    const big = nearestScale({ width: w, height: h, rgba: cut }, w * k, h * k);
    const rgba = solidSheet(big.width, big.height);
    layOn(rgba, big.width, big, 0, 0, checkGround);
    return { width: big.width, height: big.height, rgba };
}

/** Something to look at: the picture on a mid ground and on a light check, as a transparent image needs both, and at the sizes an icon is really seen. */
export function imageSheet(image: RgbaBitmap, sizes: readonly number[] = [96, 64, 48, 32]): RgbaBitmap {
    const big = Math.max(image.width, image.height);
    const k = big < 384 ? Math.max(1, Math.floor(384 / big)) : Math.min(1, 512 / big);
    const [pw, ph] = [Math.round(image.width * k), Math.round(image.height * k)];
    const gap = 8;
    const smallest = sizes.length ? Math.max(...sizes) : 0;
    const W = pw * 2 + gap * 3 + (smallest ? smallest + gap : 0);
    const H = Math.max(ph + gap * 2, sizes.reduce((s, v) => s + v + gap, gap) * 1);
    const rgba = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) rgba.set([64, 64, 68, 255], i * 4);
    const scaled = k >= 1 ? nearestScale(image, pw, ph) : shrink(image, pw, ph);
    const lay = (pic: RgbaBitmap, ox: number, oy: number, ground: Ground): void => layOn(rgba, W, pic, ox, oy, ground);
    lay(scaled, gap, gap, midGround);
    lay(scaled, gap * 2 + pw, gap, checkGround);
    let oy = gap;
    for (const s of sizes) {
        const small = shrink(image, s, Math.max(1, Math.round((s * image.height) / image.width)));
        lay(small, gap * 3 + pw * 2, oy, midGround);
        oy += small.height + gap;
    }
    return { width: W, height: H, rgba };
}

function nearestScale(src: RgbaBitmap, width: number, height: number): RgbaBitmap {
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        const sy = Math.floor((y * src.height) / height);
        for (let x = 0; x < width; x++) {
            const from = (sy * src.width + Math.floor((x * src.width) / width)) * 4;
            rgba.set(src.rgba.subarray(from, from + 4), (y * width + x) * 4);
        }
    }
    return { width, height, rgba };
}
