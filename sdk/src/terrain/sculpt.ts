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
export const SculptMode = { Raise: 0, Lower: 1, Smooth: 2, Flatten: 3, Clay: 4 } as const;

export type BrushShape = 'circle' | 'square' | 'diamond';
export type BrushCurve = 'smooth' | 'linear' | 'spherical' | 'tip';

/** Omitted options keep the original round, smooth brush. */
export interface BrushProfile {
    /** Project a single RGBA channel. UV offsets are at the dab centre, so tile edit windows can rebase the brush without changing its mask. */
    mask?: BrushMask;
    /** Half extents of one clipped terrain patch. Shared edge samples belong to both patches. */
    component?: { halfX: number; halfZ: number };
    shape?: BrushShape;
    curve?: BrushCurve;
}

/** A texture projection in cycles per world unit, evaluated relative to the centre of each dab. */
export interface BrushMask {
    image: Splat;
    channel: 0 | 1 | 2 | 3;
    repeat: boolean;
    axisU: { x: number; z: number };
    axisV: { x: number; z: number };
    u: number; v: number;
}

/** A brush at (x, z) in the terrain's space. */
export interface Brush extends BrushProfile {
    x: number;
    z: number;
    radius: number;
    /** Fraction of the radius over which the weight fades. Zero gives a hard edge. */
    falloff: number;
}

/** The texels a stroke changed, both corners included. */
export interface Dirty { i0: number; j0: number; i1: number; j1: number }

/** Distance from the centre in the footprint's own metric. Radius is half its width along X or Z. */
export function brushDistance(dx: number, dz: number, shape: BrushShape = 'circle'): number {
    if (shape === 'square') return Math.max(Math.abs(dx), Math.abs(dz));
    if (shape === 'diamond') return Math.abs(dx) + Math.abs(dz);
    return Math.hypot(dx, dz);
}

/** The brush has full weight in the core; its curve determines how weight fades to the edge. */
export function brushWeight(d: number, radius: number, falloff: number, curve: BrushCurve = 'smooth'): number {
    if (d >= radius) return 0;
    const core = radius * (1 - Math.min(Math.max(falloff, 0), 1));
    if (d <= core) return 1;
    const t = (radius - d) / (radius - core);
    if (curve === 'linear') return t;
    if (curve === 'spherical') return Math.sqrt(t * (2 - t));
    if (curve === 'tip') return 1 - Math.sqrt(1 - t * t);
    return t * t * (3 - 2 * t);
}

function weightAt(b: Brush, x: number, z: number): number {
    const dx = x - b.x, dz = z - b.z;
    if (b.component) return Math.abs(dx) <= b.component.halfX && Math.abs(dz) <= b.component.halfZ ? 1 : 0;
    const m = b.mask;
    const envelope = m && !m.repeat ? 1 : brushWeight(brushDistance(dx, dz, b.shape), b.radius, b.falloff, b.curve);
    if (!m || !envelope) return envelope;
    const u = m.u + dx * m.axisU.x + dz * m.axisU.z, v = m.v + dx * m.axisV.x + dz * m.axisV.z;
    if (!m.repeat && (u < 0 || v < 0 || u > 1 || v > 1)) return 0;
    const { width, height, pixels } = m.image;
    const sx = (m.repeat ? u - Math.floor(u) : u) * width - 0.5;
    const sy = (m.repeat ? v - Math.floor(v) : v) * height - 0.5;
    const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
    const x0 = maskIndex(ix, width, m.repeat), x1 = maskIndex(ix + 1, width, m.repeat);
    const y0 = maskIndex(iy, height, m.repeat) * width, y1 = maskIndex(iy + 1, height, m.repeat) * width;
    const c = m.channel;
    const top = pixels[(y0 + x0) * 4 + c]! * (1 - fx) + pixels[(y0 + x1) * 4 + c]! * fx;
    const bottom = pixels[(y1 + x0) * 4 + c]! * (1 - fx) + pixels[(y1 + x1) * 4 + c]! * fx;
    return envelope * (top * (1 - fy) + bottom * fy) / 255;
}

function maskIndex(i: number, size: number, repeat: boolean): number {
    if (i < 0) return repeat ? size - 1 : 0;
    if (i >= size) return repeat ? 0 : size - 1;
    return i;
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
     * Raise, lower and clay: how far the brush's core moves the ground, in the field's 0 to 1 (negative clay carves). Smooth and flatten: how much of the way to
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
    if (!dab.amount) return null;
    const span = reach(field.width, field.height, sizeX, sizeZ, dab.brush);
    if (!span) return null;
    const { width, data } = field, b = dab.brush;
    // Smoothing reads the ground as it was before the dab, or the first texels it softens would feed the ones after.
    const before = dab.mode === SculptMode.Smooth ? sliceOf(field, span) : null;
    const plane = dab.mode === SculptMode.Clay ? clayPlane(field, sizeX, sizeZ, b, span) : null;
    let changed = false;
    const w = span.i1 - span.i0 + 1;
    for (let j = span.j0; j <= span.j1; j++) {
        for (let i = span.i0; i <= span.i1; i++) {
            const x = (i / (field.width - 1) - 0.5) * sizeX, z = (j / (field.height - 1) - 0.5) * sizeZ;
            const k = weightAt(b, x, z);
            if (k <= 0) continue;
            const at = j * width + i;
            const h = data[at]!;
            let next = h;
            if (dab.mode === SculptMode.Raise) next = h + dab.amount * k;
            else if (dab.mode === SculptMode.Lower) next = h - dab.amount * k;
            else if (plane) {
                // Lay one thin layer against the local slope. Raising fills hollows before
                // touching a ridge; carving does the reverse. A second pass adds another layer.
                const toLayer = plane(x, z) + dab.amount - h;
                const step = Math.max(Math.min(0, dab.amount), Math.min(Math.max(0, dab.amount), toLayer));
                next = h + step * k;
            } else if (dab.mode === SculptMode.Flatten) next = h + ((dab.target ?? h) - h) * Math.min(dab.amount * k, 1);
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
            if (data[at] !== h) changed = true;
        }
    }
    return changed ? span : null;
}

/** Weighted tangent plane of the footprint before this dab. The one-sample halo in a tiled
 * edit supplies the same slopes on either side of a tile seam as on a single heightfield. */
function clayPlane(field: Heightfield, sizeX: number, sizeZ: number, b: Brush, span: Dirty): (x: number, z: number) => number {
    const { width, height, data } = field;
    const dx = sizeX / (width - 1), dz = sizeZ / (height - 1);
    let mass = 0, cx = 0, cz = 0, mean = 0, slopeX = 0, slopeZ = 0;
    for (let j = span.j0; j <= span.j1; j++) for (let i = span.i0; i <= span.i1; i++) {
        const x = (i / (width - 1) - 0.5) * sizeX, z = (j / (height - 1) - 0.5) * sizeZ;
        const k = weightAt(b, x, z);
        if (k <= 0) continue;
        const left = Math.max(0, i - 1), right = Math.min(width - 1, i + 1);
        const back = Math.max(0, j - 1), front = Math.min(height - 1, j + 1);
        mass += k;
        cx += x * k; cz += z * k; mean += data[j * width + i]! * k;
        slopeX += k * (data[j * width + right]! - data[j * width + left]!) / ((right - left) * dx);
        slopeZ += k * (data[front * width + i]! - data[back * width + i]!) / ((front - back) * dz);
    }
    if (mass > 0) {
        cx /= mass; cz /= mass; mean /= mass; slopeX /= mass; slopeZ /= mass;
    }
    return (x, z) => mean + slopeX * (x - cx) + slopeZ * (z - cz);
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
    if (dab.strength <= 0 || dab.layer < 0 || dab.layer > 7 || (dab.layer > 3 && !b)) return null;
    const span = reach(a.width, a.height, sizeX, sizeZ, dab.brush);
    if (!span) return null;
    const bb = dab.brush, w = new Float32Array(8);
    let changed = false;
    for (let j = span.j0; j <= span.j1; j++) {
        for (let i = span.i0; i <= span.i1; i++) {
            const x = (i / (a.width - 1) - 0.5) * sizeX, z = (j / (a.height - 1) - 0.5) * sizeZ;
            const k = weightAt(bb, x, z) * dab.strength;
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
                const offset = at * 4 + c;
                const value = Math.round(w[c]! * 255);
                if (a.pixels[offset] !== value) changed = true;
                a.pixels[offset] = value;
                if (b) {
                    const value2 = Math.round(w[4 + c]! * 255);
                    if (b.pixels[offset] !== value2) changed = true;
                    b.pixels[offset] = value2;
                }
            }
        }
    }
    return changed ? span : null;
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
