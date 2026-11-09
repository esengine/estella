// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    sculpt.ts
 * @brief   Brush strokes on an area's ground: raise, lower, smooth and flatten its heights, and paint its layers.
 *
 * @details Pure arithmetic over the arrays the ground is made of (a heightfield, and up to two splatmaps), so an editor tool and a
 *          test drive the same code. Positions are in the terrain's own space (its entity at the origin); a brush reaches `radius`
 *          from its centre, at full strength over the inner `1 - falloff` of that and easing to nothing at the edge.
 *          Heights are the field's 0 to 1, so an amount in world units is divided by the span the field is read over.
 */
import type { Heightfield } from './heightfield';
import type { Splat } from './source';

/** What a brush does to heights. @experimental */
export const SculptMode = { Raise: 0, Lower: 1, Smooth: 2, Flatten: 3 } as const;

/** A brush at (x, z) in the terrain's space. */
export interface Brush {
    x: number;
    z: number;
    radius: number;
    /** 0 to 1: how much of the brush's edge eases away. 0 is a hard disc, 1 a cone. */
    falloff: number;
}

/** The texels a stroke changed, both corners included. */
export interface Dirty { i0: number; j0: number; i1: number; j1: number }

/** The brush's weight at `d` from its centre, 1 over its core, easing (smoothstep) to 0 at its edge. */
export function brushWeight(d: number, radius: number, falloff: number): number {
    if (d >= radius) return 0;
    const core = radius * (1 - Math.min(Math.max(falloff, 0), 1));
    if (d <= core) return 1;
    const t = 1 - (d - core) / Math.max(radius - core, 1e-9);
    return t * t * (3 - 2 * t);
}

/** The texel span of a brush over a grid `width` by `height` laid across `sizeX` by `sizeZ`, or null when it reaches none. */
export function reach(width: number, height: number, sizeX: number, sizeZ: number, b: Brush): Dirty | null {
    const u0 = (b.x - b.radius) / sizeX + 0.5, u1 = (b.x + b.radius) / sizeX + 0.5;
    const v0 = (b.z - b.radius) / sizeZ + 0.5, v1 = (b.z + b.radius) / sizeZ + 0.5;
    const i0 = Math.max(Math.ceil(u0 * (width - 1)), 0), i1 = Math.min(Math.floor(u1 * (width - 1)), width - 1);
    const j0 = Math.max(Math.ceil(v0 * (height - 1)), 0), j1 = Math.min(Math.floor(v1 * (height - 1)), height - 1);
    return i0 > i1 || j0 > j1 ? null : { i0, j0, i1, j1 };
}

/** The union of two dirty spans, either of which may be absent. */
export function unionDirty(a: Dirty | null, b: Dirty | null): Dirty | null {
    if (!a) return b;
    if (!b) return a;
    return { i0: Math.min(a.i0, b.i0), j0: Math.min(a.j0, b.j0), i1: Math.max(a.i1, b.i1), j1: Math.max(a.j1, b.j1) };
}

/** What one dab does. */
export interface SculptDab {
    mode: number;
    brush: Brush;
    /**
     * Raise and lower: how far the brush's core moves the ground, in the field's 0 to 1. Smooth and flatten: how much of the way to
     * the average or to `target` it goes, 0 to 1.
     */
    amount: number;
    /** Flatten's height, in the field's 0 to 1. */
    target?: number;
}

/**
 * Applies one dab to `field` and says which texels it touched (null when the brush is off the area). Heights stay between 0 and 1.
 */
export function sculptField(field: Heightfield, sizeX: number, sizeZ: number, dab: SculptDab): Dirty | null {
    const span = reach(field.width, field.height, sizeX, sizeZ, dab.brush);
    if (!span) return null;
    const { width, data } = field, b = dab.brush;
    // Smoothing reads the ground as it was before the dab, or the first texels it softens would feed the ones after.
    const before = dab.mode === SculptMode.Smooth ? sliceOf(field, span) : null;
    const w = span.i1 - span.i0 + 1;
    for (let j = span.j0; j <= span.j1; j++) {
        for (let i = span.i0; i <= span.i1; i++) {
            const x = (i / (field.width - 1) - 0.5) * sizeX, z = (j / (field.height - 1) - 0.5) * sizeZ;
            const k = brushWeight(Math.hypot(x - b.x, z - b.z), b.radius, b.falloff);
            if (k <= 0) continue;
            const at = j * width + i;
            const h = data[at]!;
            let next = h;
            if (dab.mode === SculptMode.Raise) next = h + dab.amount * k;
            else if (dab.mode === SculptMode.Lower) next = h - dab.amount * k;
            else if (dab.mode === SculptMode.Flatten) next = h + ((dab.target ?? h) - h) * Math.min(dab.amount * k, 1);
            else if (before) {
                let sum = 0, n = 0;
                for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
                    const ii = Math.min(Math.max(i + di, 0), field.width - 1), jj = Math.min(Math.max(j + dj, 0), field.height - 1);
                    // Outside the span the ground is untouched by this dab, so the field itself is the "before".
                    const inside = ii >= span.i0 && ii <= span.i1 && jj >= span.j0 && jj <= span.j1;
                    sum += inside ? before[(jj - span.j0) * w + (ii - span.i0)]! : data[jj * width + ii]!;
                    n++;
                }
                next = h + (sum / n - h) * Math.min(dab.amount * k, 1);
            }
            data[at] = Math.min(Math.max(next, 0), 1);
        }
    }
    return span;
}

function sliceOf(field: Heightfield, s: Dirty): Float32Array {
    const w = s.i1 - s.i0 + 1, out = new Float32Array(w * (s.j1 - s.j0 + 1));
    for (let j = s.j0; j <= s.j1; j++) for (let i = s.i0; i <= s.i1; i++) out[(j - s.j0) * w + (i - s.i0)] = field.data[j * field.width + i]!;
    return out;
}

/** What one paint dab does. */
export interface PaintDab {
    /** The layer, 0 to 7: layers 1 to 4 live in the first splatmap, 5 to 8 in the second. */
    layer: number;
    brush: Brush;
    /** 0 to 1: how far toward the layer being all there is a texel at the brush's core goes. */
    strength: number;
    /** Takes the layer away instead of laying it. */
    erase?: boolean;
}

/** One texel's eight weights, from the splatmaps. */
function readWeights(a: Splat, b: Splat | null, at: number, out: Float32Array): void {
    for (let c = 0; c < 4; c++) {
        out[c] = a.pixels[at * 4 + c]! / 255;
        out[4 + c] = b ? b.pixels[at * 4 + c]! / 255 : 0;
    }
}

/**
 * Paints one dab into the splatmaps (`b` null paints layers 1 to 4 only) and says which texels it touched. The two maps must be the
 * same size. The weights of a texel always add to one: laying a layer takes from the others in proportion to what they had, and
 * erasing one gives its share back to them (to layer 1 where there is nothing else).
 */
export function paintSplat(a: Splat, b: Splat | null, sizeX: number, sizeZ: number, dab: PaintDab): Dirty | null {
    if (dab.layer < 0 || dab.layer > 7 || (dab.layer > 3 && !b)) return null;
    const span = reach(a.width, a.height, sizeX, sizeZ, dab.brush);
    if (!span) return null;
    const bb = dab.brush, w = new Float32Array(8);
    for (let j = span.j0; j <= span.j1; j++) {
        for (let i = span.i0; i <= span.i1; i++) {
            const x = (i / (a.width - 1) - 0.5) * sizeX, z = (j / (a.height - 1) - 0.5) * sizeZ;
            const k = brushWeight(Math.hypot(x - bb.x, z - bb.z), bb.radius, bb.falloff) * dab.strength;
            if (k <= 0) continue;
            const at = j * a.width + i;
            readWeights(a, b, at, w);
            let others = 0;
            for (let c = 0; c < 8; c++) if (c !== dab.layer) others += w[c]!;
            const was = w[dab.layer]!;
            const now = Math.min(Math.max(dab.erase ? was * (1 - Math.min(k, 1)) : was + (1 - was) * Math.min(k, 1), 0), 1);
            const rest = 1 - now;
            if (others > 1e-6) for (let c = 0; c < 8; c++) { if (c !== dab.layer) w[c] = w[c]! * rest / others; }
            else if (dab.erase) w[dab.layer === 0 ? 1 : 0] = rest;
            w[dab.layer] = now;
            for (let c = 0; c < 4; c++) {
                a.pixels[at * 4 + c] = Math.round(w[c]! * 255);
                if (b) b.pixels[at * 4 + c] = Math.round(w[4 + c]! * 255);
            }
        }
    }
    return span;
}

/** A height field as the red-and-green 16-bit image a heightmap is saved as (red the high byte): `RGBA` pixels, opaque. */
export function encodeHeightmap(field: Heightfield): Uint8Array {
    const out = new Uint8Array(field.width * field.height * 4);
    for (let i = 0; i < field.width * field.height; i++) {
        const v = Math.round(Math.min(Math.max(field.data[i]!, 0), 1) * 65535);
        out[i * 4] = v >> 8; out[i * 4 + 1] = v & 255; out[i * 4 + 2] = 0; out[i * 4 + 3] = 255;
    }
    return out;
}
