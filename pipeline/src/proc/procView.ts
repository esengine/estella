// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  procView.ts — a rules graph's parts seen from above: a plan, coloured as they will be, lighter the higher they
 *        stand, so a layout can be read without a scene. +x is right and +z (south) is down, with grid lines a round
 *        number of the source's units apart and the darker pair through 0.
 */
import { qRotate, type Part, type ProcResult } from './procEval';

export interface ProcPlan { width: number; height: number; rgba: Uint8Array; grid: number; region: { at: [number, number]; size: [number, number] } }

const toSrgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** The corners of a part's footprint from above, as a convex outline. */
function footprint(p: Part): [number, number][] {
    const pts: [number, number][] = [];
    for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) {
        const v = qRotate(p.q, [sx * p.sx, sy * p.sy, sz * p.sz]);
        pts.push([p.x + v[0], p.z + v[2]]);
    }
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o: [number, number], a: [number, number], b: [number, number]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower: [number, number][] = [], upper: [number, number][] = [];
    for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop(); lower.push(p); }
    for (const p of pts.slice().reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop(); upper.push(p); }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * Draws the parts of @p result from above. `region` (centre and size, the source's units) looks at part of it; by default
 * the whole of what stands. `size` is pixels along the longer side.
 */
export function renderProcPlan(result: ProcResult, options: { size?: number; region?: { at: [number, number]; size: [number, number] } | null } = {}): ProcPlan {
    const parts = result.groups.flatMap((g) => g.parts);
    const b = result.report.bounds;
    let region = options.region ?? null;
    if (!region) {
        const lo = b ? [b.min[0], b.min[2]] : [-50, -50], hi = b ? [b.max[0], b.max[2]] : [50, 50];
        const pad = Math.max(hi[0]! - lo[0]!, hi[1]! - lo[1]!, 1) * 0.04;
        region = { at: [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2], size: [hi[0]! - lo[0]! + pad * 2, hi[1]! - lo[1]! + pad * 2] };
    }
    const long = Math.max(128, Math.min(2048, Math.round(options.size ?? 900)));
    const aspect = region.size[0] / region.size[1];
    const width = aspect >= 1 ? long : Math.max(64, Math.round(long * aspect));
    const height = aspect >= 1 ? Math.max(64, Math.round(long / aspect)) : long;
    const scale = width / region.size[0];
    const x0 = region.at[0] - region.size[0] / 2, z0 = region.at[1] - region.size[1] / 2;
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) { rgba[i * 4] = 236; rgba[i * 4 + 1] = 232; rgba[i * 4 + 2] = 222; rgba[i * 4 + 3] = 255; }

    // grid: a round number of units, about eight lines across
    const raw = region.size[0] / 8, mag = 10 ** Math.floor(Math.log10(raw));
    const grid = [1, 2, 5, 10].map((m) => m * mag).find((g) => g >= raw) ?? raw;
    const line = (px: number, horizontal: boolean, dark: boolean): void => {
        const c = dark ? 150 : 205;
        const n = horizontal ? width : height;
        for (let k = 0; k < n; k++) {
            const i = horizontal ? px * width + k : k * width + px;
            if (i < 0 || i >= width * height) continue;
            rgba[i * 4] = c; rgba[i * 4 + 1] = c; rgba[i * 4 + 2] = c;
        }
    };
    for (let g = Math.ceil(x0 / grid) * grid; g <= x0 + region.size[0]; g += grid) line(Math.round((g - x0) * scale), false, Math.abs(g) < grid / 2);
    for (let g = Math.ceil(z0 / grid) * grid; g <= z0 + region.size[1]; g += grid) line(Math.round((g - z0) * scale), true, Math.abs(g) < grid / 2);

    // lower parts first, so what stands higher covers them; the higher a top, the lighter
    const tops = parts.map((p) => p.y + p.sy / 2);
    const lo = Math.min(...tops, 0), hi = Math.max(...tops, 1);
    const order = parts.map((_, i) => i).sort((a, b) => tops[a]! - tops[b]!);
    for (const idx of order) {
        const p = parts[idx]!;
        const poly = footprint(p).map(([x, z]) => [(x - x0) * scale, (z - z0) * scale] as [number, number]);
        const shade = 0.75 + 0.35 * ((tops[idx]! - lo) / Math.max(hi - lo, 1e-6));
        const col = p.color.map((c) => Math.round(Math.min(1, toSrgb(c) * shade) * 255));
        const minY = Math.max(0, Math.floor(Math.min(...poly.map((q) => q[1])))), maxY = Math.min(height - 1, Math.ceil(Math.max(...poly.map((q) => q[1]))));
        for (let y = minY; y <= maxY; y++) {
            const yc = y + 0.5;
            const xs: number[] = [];
            for (let k = 0; k < poly.length; k++) {
                const a = poly[k]!, c = poly[(k + 1) % poly.length]!;
                if ((a[1] <= yc && c[1] > yc) || (c[1] <= yc && a[1] > yc)) xs.push(a[0] + ((yc - a[1]) / (c[1] - a[1])) * (c[0] - a[0]));
            }
            xs.sort((u, v) => u - v);
            for (let k = 0; k + 1 < xs.length; k += 2) {
                const from = Math.max(0, Math.round(xs[k]!)), to = Math.min(width - 1, Math.round(xs[k + 1]!) - 1);
                for (let x = from; x <= to; x++) {
                    const i = (y * width + x) * 4;
                    const edge = x === from || x === to || y === minY || y === maxY;
                    const f = edge && to - from > 3 ? 0.7 : 1;
                    rgba[i] = col[0]! * f; rgba[i + 1] = col[1]! * f; rgba[i + 2] = col[2]! * f;
                }
                // a part too thin to fill a pixel still shows as one
                if (to < from && from < width) { const i = (y * width + from) * 4; rgba[i] = col[0]!; rgba[i + 1] = col[1]!; rgba[i + 2] = col[2]!; }
            }
        }
    }
    return { width, height, rgba, grid, region };
}
