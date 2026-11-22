// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { gradientNoise } from '../image/imageNoise';
import type { Dirty, PaintDab } from './sculpt';
import type { Splat } from './source';

export type PaintTool = 'paint' | 'smooth' | 'flatten' | 'noise';
export type PaintDirection = 'both' | 'raise' | 'lower';
export interface TerrainPaintSettings {
    tool?: PaintTool;
    direction?: PaintDirection;
    /** Target weight from 0 to 1. Flatten always uses a target. */
    target?: number;
    /** Smoothing radius, in weightmap samples. */
    kernel?: number;
    /** Bilateral range. Omit for ordinary smoothing. */
    detail?: number;
    /** Size of a Perlin cell in world units. */
    noiseScale?: number;
    /** Bitset of active weight-blended storage channels. Other channels are independent. */
    weighted?: number;
    /** World-space selection rectangle; mask coordinates follow the world, including tiled edit windows. */
    region?: readonly [number, number, number, number];
    inverse?: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const paintKernel = (s?: TerrainPaintSettings): number => s?.tool === 'smooth' ? clamp(Math.round(s.kernel ?? 1), 1, 8) : 1;

/** Snapshot just the selected channel plus the filter halo so every output sees the same input. */
function smoothing(map: Splat, channel: number, span: Dirty, s: TerrainPaintSettings) {
    const r = paintKernel(s), left = Math.max(0, span.i0 - r), top = Math.max(0, span.j0 - r);
    const width = Math.min(map.width - 1, span.i1 + r) - left + 1, height = Math.min(map.height - 1, span.j1 + r) - top + 1;
    const before = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) before[y * width + x] = map.pixels[((top + y) * map.width + left + x) * 4 + channel]!;
    const taps: { dx: number; dy: number; w: number }[] = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) taps.push({ dx, dy, w: Math.exp(-(dx * dx + dy * dy) / (r * r)) });
    const sigma = s.detail === undefined ? Infinity : 1 + 254 * clamp(s.detail, 0, 1);
    return (x: number, y: number, was: number) => {
        let total = 0, sum = 0;
        for (const { dx, dy, w } of taps) {
            const v = before[clamp(y - top + dy, 0, height - 1) * width + clamp(x - left + dx, 0, width - 1)]!;
            const k = w * Math.exp(-0.5 * ((v - was) / sigma) ** 2);
            total += k; sum += v * k;
        }
        return sum / total;
    };
}

/** Distribute a byte delta evenly among peers, capped at zero, carrying quantization across channels. */
function redistribute(values: number[], peers: number[], rest: number): void {
    let total = 0;
    for (const c of peers) total += values[c]!;
    let shift = (rest - total) / peers.length;
    if (shift < 0) {
        const ascending = peers.map(c => values[c]!).sort((a, b) => a - b);
        for (let i = 0; i < ascending.length - 1 && ascending[i]! + shift < 0; i++) {
            total -= ascending[i]!;
            shift = (rest - total) / (ascending.length - i - 1);
        }
    }
    let sum = 0;
    for (const c of peers) {
        const prev = Math.round(sum);
        sum += Math.max(0, values[c]! + shift);
        values[c] = Math.round(sum) - prev;
    }
}

export function applyWeightBrush(a: Splat, b: Splat | null, sizeX: number, sizeZ: number, dab: PaintDab, s: TerrainPaintSettings,
    span: Dirty, influence: (x: number, z: number) => number): Dirty | null {
    const { layer, brush } = dab, map = layer < 4 ? a : b!, channel = layer % 4;
    const mask = s.weighted ?? (b ? 255 : 15), weighted = !!(mask & (1 << layer));
    const peers = Array.from({ length: b ? 8 : 4 }, (_, i) => i).filter(i => i !== layer && (mask & (1 << i)));
    const average = s.tool === 'smooth' ? smoothing(map, channel, span, s) : null;
    const center = dab.worldCenter ?? brush, scale = Math.max(0.001, s.noiseScale ?? 32), values = Array<number>(8).fill(0);
    const target = clamp(s.target ?? (dab.erase ? 0 : 1), 0, 1) * 255;
    let changed = false;
    for (let j = span.j0; j <= span.j1; j++) for (let i = span.i0; i <= span.i1; i++) {
        const x = (i / (a.width - 1) - 0.5) * sizeX, z = (j / (a.height - 1) - 0.5) * sizeZ;
        const k = clamp(influence(x, z) * dab.strength, 0, 1);
        if (!k) continue;
        const wx = center.x + (x - brush.x), wz = center.z + (z - brush.z);
        if (s.region) {
            const [x0, z0, x1, z1] = s.region;
            const eps = 8 * Number.EPSILON * Math.max(1, Math.abs(wx), Math.abs(wz), sizeX, sizeZ);
            if ((wx >= x0 - eps && wx <= x1 + eps && wz >= z0 - eps && wz <= z1 + eps) === !!s.inverse) continue;
        }
        const at = (j * a.width + i) * 4, was = map.pixels[at + channel]!;
        let delta = target - was;
        if (average) delta = average(i, j, was) - was;
        if (s.tool === 'noise') {
            const n = clamp(gradientNoise(wx / scale + 0.37, wz / scale + 0.61, 731) * 2, -1, 1);
            delta = s.target === undefined ? n * 255 : clamp(target + n * 127.5, 0, 255) - was;
        }
        if (s.direction === 'raise') delta = Math.max(0, delta);
        if (s.direction === 'lower') delta = Math.min(0, delta);
        const now = clamp(Math.round(was + delta * k), 0, 255);
        if (now === was) continue;
        if (weighted && !peers.length && was === 255) continue;
        map.pixels[at + channel] = weighted && !peers.length ? 255 : now;
        if (weighted && peers.length) {
            for (const c of peers) values[c] = (c < 4 ? a : b!).pixels[at + c % 4]!;
            redistribute(values, peers, 255 - now);
            for (const c of peers) (c < 4 ? a : b!).pixels[at + c % 4] = values[c]!;
        }
        changed = true;
    }
    return changed ? span : null;
}
