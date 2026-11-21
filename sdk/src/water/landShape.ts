// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    landShape.ts
 * @brief   What a body of water does to the ground under it: a lake's floor cut under its outline, and an island raised inside its own.
 *
 * @details Both are terrain modifiers (terrain/source.ts): laid over the ground the terrain was made or sculpted with, never written into it,
 *          so a body moved or removed gives the ground back as it was. A lake's floor only cuts (ground already lower is left), and an
 *          island only raises (ground already higher, or sculpted up afterwards, is left), so either can sit over hand-made ground.
 */
import type { TerrainModifier } from '../terrain/source';
import { polygonSdf, type Point2 } from './shore';
import { gradientNoise } from '../image/imageNoise';

/** An outline on a body's own plane and how a world (x, z) is put into that plane; `scale` turns a distance there into world units. */
export interface OutlineSpace {
    outline: readonly Point2[];
    toLocal(x: number, z: number): [number, number];
    toWorld(x: number, z: number): [number, number];
    scale: number;
}

const smoothstep = (t: number): number => {
    const c = Math.min(Math.max(t, 0), 1);
    return c * c * (3 - 2 * c);
};

/** The world square the outline covers, grown by `margin` world units. */
function boundsOf(space: OutlineSpace, margin: number): [number, number, number, number] {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of space.outline) {
        const [x, z] = space.toWorld(p.x, p.y);
        x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z);
    }
    return [x0 - margin, z0 - margin, x1 + margin, z1 + margin];
}

/** How far inside the outline a world point is, in world units (negative outside). */
function inside(space: OutlineSpace, x: number, z: number): number {
    const [lx, lz] = space.toLocal(x, z);
    return polygonSdf(space.outline, lx, lz) * space.scale;
}

/**
 * The floor of a lake: under its outline the ground is lowered to `depth` under its surface at `level`, the floor sloping down from the
 * shore to that depth over `ramp` world units in. Only cuts.
 */
export function lakeFloorModifier(id: string, space: OutlineSpace, level: number, depth: number, ramp: number): TerrainModifier {
    const reach = Math.max(ramp, 1e-6);
    return {
        id,
        bounds: boundsOf(space, 0),
        apply(x, z, h) {
            const d = inside(space, x, z);
            if (d <= 0) return h;
            return Math.min(h, level - depth * smoothstep(d / reach));
        },
        heights: [level - depth, level],
    };
}

/**
 * How a body of water cuts the ground under it when its Curve Channel is on (WaterBody's Terrain settings): the bed's profile across its
 * edge from an elevation curve, where that starts against the shore, how wide it ramps, how it is laid over the ground, how its bank
 * meets the ground round it, the effects over the whole (blur, curl noise, smoothing) and its terraces.
 */
export interface ChannelSettings {
    /** The bed's depth as a share of the full depth, against how far across the ramp (both 0 to 1): 0 at the curve's start, the full depth from its end. */
    curve: (u: number) => number;
    /** How far in from the shore the curve starts, in world units; negative starts it out on the bank. */
    edgeOffset: number;
    /** How wide the curve ramps from its start to the full depth, in world units. */
    ramp: number;
    /** {@link ChannelBlend}: whether the ground is only cut, only raised, laid to the profile either way, or has the channel added onto it. */
    blend: number;
    /** Width falloff: how far out past the bank's flat edge the ground comes back to itself. Angle falloff: the farthest the bank reaches. World units. */
    falloff: number;
    /** Raises (or lowers) the whole profile against the water's surface, in world units. */
    zOffset: number;
    /** Terraces laid over the profile: how much of them (0 none), the rise of each, and how round their edges (0 sharp, 1 none at all). */
    terraceAlpha: number;
    terraceSpacing: number;
    terraceSmoothness: number;
    /** {@link ChannelFalloff}: the bank given back to the ground over a fixed width, or run out at an angle until it meets the ground. Width when absent. */
    falloffMode?: number;
    /** Angle falloff: the bank's slope, in degrees from level. */
    falloffAngle?: number;
    /** A flat edge round the water at its level, past the curve's start and before the falloff, in world units. */
    bankEdge?: number;
    /** Averages the cut over this radius, in world units: softens it as a whole. 0 for none. */
    blurRadius?: number;
    /** Curl noise bending the outline: two octaves, each how far it moves the edge (world units, 0 for none) and the size of its swirls (world units). */
    curlAmount1?: number;
    curlTiling1?: number;
    curlAmount2?: number;
    curlTiling2?: number;
    /** Rounds the inner edge, where the curve leaves the bank, over this width in world units. */
    innerSmooth?: number;
    /** Rounds the outer edge, where the bank meets the ground, over this height in world units. */
    outerSmooth?: number;
    /** Terraces only within this span of distance out from the water's edge, starting `terraceMaskStart` out; 0 for terraces everywhere. */
    terraceMaskLength?: number;
    terraceMaskStart?: number;
}

/**
 * How a channel is laid over the ground: only cutting (Min), only raising (Max), to its profile either way (Alpha Blend), or added onto
 * the ground as it is (Additive: the cut a flat ground at the water's level would get, added to the ground's own height, its detail kept).
 */
export const BLEND_MIN = 0, BLEND_MAX = 1, BLEND_ALPHA = 2, BLEND_ADDITIVE = 3;
export const ChannelBlend = { Min: BLEND_MIN, Max: BLEND_MAX, AlphaBlend: BLEND_ALPHA, Additive: BLEND_ADDITIVE } as const;

/** How a channel's bank meets the ground: given back over a fixed width, or run out at an angle until it meets the ground. */
export const FALLOFF_WIDTH = 0, FALLOFF_ANGLE = 1;
export const ChannelFalloff = { Width: FALLOFF_WIDTH, Angle: FALLOFF_ANGLE } as const;

const clamp01 = (t: number): number => Math.min(Math.max(t, 0), 1);

/** A smooth minimum, rounding the corner where `a` and `b` cross over `k`; exact once they are `k` apart. */
function smin(a: number, b: number, k: number): number {
    if (!(k > 0)) return Math.min(a, b);
    const t = clamp01(0.5 + 0.5 * (b - a) / k);
    return b + (a - b) * t - k * t * (1 - t);
}
const smax = (a: number, b: number, k: number): number => -smin(-a, -b, k);

/** The profile's height after its terraces: steps `spacing` apart, their edges rounded by `smoothness`, blended in by `alpha`. */
function terraced(y: number, s: ChannelSettings, alpha: number): number {
    if (!(alpha > 0) || !(s.terraceSpacing > 0)) return y;
    const k = Math.floor(y / s.terraceSpacing), f = y / s.terraceSpacing - k;
    // A smooth step whose edge widens with smoothness: 0 a sheer step, 1 the plain slope.
    const w = clamp01(s.terraceSmoothness);
    const edge = w >= 1 ? f : f < 1 - w ? 0 : smoothstep((f - (1 - w)) / Math.max(w, 1e-6));
    const stepped = (k + edge) * s.terraceSpacing;
    return y + (stepped - y) * Math.min(alpha, 1);
}

/** How much of the terraces lie `out` world units out from the water's edge: all of them, or those inside the mask's span. */
function terraceMask(out: number, s: ChannelSettings): number {
    const len = s.terraceMaskLength ?? 0;
    if (!(len > 0)) return 1;
    const start = s.terraceMaskStart ?? 0, soft = len * 0.1;
    return smoothstep((out - start + soft) / soft) * smoothstep((start + len + soft - out) / soft);
}

/** The cut at `d` in from the shore, before any smoothing along it: the shape laid over the ground `g` by the blend mode. */
function laidAt(d: number, surface: number, depth: number, g: number, s: ChannelSettings): number {
    const top = surface + s.zOffset, x = d - s.edgeOffset, k = Math.max(s.outerSmooth ?? 0, 0);
    const alpha = s.terraceAlpha * terraceMask(Math.max(-d, 0), s);
    const blend = s.blend === ChannelBlend.Additive ? ChannelBlend.AlphaBlend : s.blend;
    const lay = (shape: number): number => blend === ChannelBlend.Max ? smax(g, shape, k) : blend === ChannelBlend.AlphaBlend ? shape : smin(g, shape, k);
    if (x >= 0) return lay(terraced(top - depth * Math.max(s.curve(Math.min(x / Math.max(s.ramp, 1e-6), 1)), 0), s, alpha));
    // The bank: flat at the water's level across its edge, then given back to the ground.
    const e = Math.max(-x - Math.max(s.bankEdge ?? 0, 0), 0);
    if (s.falloffMode === ChannelFalloff.Angle) {
        // A slope out from the edge until it meets the ground: down to ground lower than the water, up to ground higher, as the blend
        // allows; it fades back over the last fifth of its reach where it never met the ground.
        const reach = Math.max(s.falloff, 0);
        if (!(reach > 0) && e > 0) return g;
        const fade = reach > 0 ? 1 - smoothstep((e - reach * 0.8) / (reach * 0.2)) : 1;
        if (!(fade > 0)) return g;
        const rise = Math.tan(Math.min(Math.max(s.falloffAngle ?? 45, 1), 89) * Math.PI / 180) * e;
        const up = terraced(top + rise, s, alpha), down = terraced(top - rise, s, alpha);
        // Rounded only against the ground: up and down meet at the edge, and rounding them against each other would raise a ridge there.
        const met = blend === ChannelBlend.Min ? smin(g, up, k) : blend === ChannelBlend.Max ? smax(g, down, k) : g >= top ? smin(g, up, k) : smax(g, down, k);
        return g + (met - g) * fade;
    }
    if (!(s.falloff > 0) ? e > 0 : e >= s.falloff) return g;
    const w = s.falloff > 0 ? 1 - smoothstep(e / s.falloff) : 1;
    return g + (lay(terraced(top, s, alpha)) - g) * w;
}

/**
 * The height a channel lays at a point `d` world units in from the shore (negative out on the bank), under water whose surface is at
 * `surface`, `depth` deep at its middle, over ground at `h`.
 */
export function channelHeight(d: number, surface: number, depth: number, h: number, s: ChannelSettings): number {
    // Additive lays the channel over a flat ground at the water's level, and adds what that cut to the ground's own height.
    const additive = s.blend === ChannelBlend.Additive, g = additive ? surface : h;
    const inner = Math.max(s.innerSmooth ?? 0, 0);
    let laid: number;
    if (inner > 0) {
        // Averaged across its edge over the inner smoothing's width: the corner where the curve leaves the bank rounds off.
        laid = 0;
        for (let i = 0; i < SMOOTH_TAPS.length; i++) laid += laidAt(d + SMOOTH_TAPS[i]! * inner, surface, depth, g, s) * SMOOTH_WEIGHTS[i]!;
    } else {
        laid = laidAt(d, surface, depth, g, s);
    }
    return additive ? h + (laid - surface) : laid;
}

// A raised-cosine window over the smoothing's width, sampled finely enough that the kinks between its taps do not show as rings.
const SMOOTH_TAPS = Array.from({ length: 17 }, (_, i) => i / 16 - 0.5);
const SMOOTH_WEIGHTS = ((): number[] => {
    const w = SMOOTH_TAPS.map((t) => 1 + Math.cos(t * 2 * Math.PI));
    const sum = w.reduce((a, b) => a + b, 0);
    return w.map((v) => v / sum);
})();

/** Where a point is against a body's edge: how far in (negative out), the water's surface there and its depth. */
export interface ChannelSample { d: number; surface: number; depth: number }

/** A swirl of curl noise at (x, z) in noise cells, at most 1 long: the turn of a gradient noise, so it bends an outline without tearing it. */
function curl(x: number, z: number, seed: number): [number, number] {
    const e = 0.01;
    const dz = (gradientNoise(x, z + e, seed) - gradientNoise(x, z - e, seed)) / (2 * e);
    const dx = (gradientNoise(x + e, z, seed) - gradientNoise(x - e, z, seed)) / (2 * e);
    const vx = dz, vz = -dx, len = Math.hypot(vx, vz);
    return len > 1 ? [vx / len, vz / len] : [vx, vz];
}

/**
 * The height a channel lays at world (x, z) over ground at `h`, its edge found by `sample` (null where the point is nowhere near it): the
 * point bent by the curl noise first, and the result averaged over the blur's radius.
 */
export function channelAt(sample: (x: number, z: number) => ChannelSample | null, x: number, z: number, h: number, s: ChannelSettings): number {
    const one = (px: number, pz: number): number => {
        let qx = px, qz = pz;
        for (const [amount, tiling, seed] of [[s.curlAmount1 ?? 0, s.curlTiling1 ?? 1, 17], [s.curlAmount2 ?? 0, s.curlTiling2 ?? 1, 53]] as const) {
            if (!(amount > 0) || !(tiling > 0)) continue;
            const [cx, cz] = curl(px / tiling, pz / tiling, seed);
            qx += cx * amount; qz += cz * amount;
        }
        const at = sample(qx, qz);
        return at ? channelHeight(at.d, at.surface, at.depth, h, s) : h;
    };
    const r = s.blurRadius ?? 0;
    if (!(r > 0)) return one(x, z);
    let sum = one(x, z) * 2;
    for (let i = 0; i < 8; i++) sum += one(x + Math.cos(i * Math.PI / 4) * r, z + Math.sin(i * Math.PI / 4) * r);
    return sum / 10;
}

/** How far out past the shore a channel can reach: the curve's start out on the bank, its flat edge, its falloff, and what bends or softens it. */
export function channelReach(s: ChannelSettings): number {
    return Math.max(-s.edgeOffset, 0) + Math.max(s.bankEdge ?? 0, 0) + Math.max(s.falloff, 0) + Math.max(s.curlAmount1 ?? 0, 0)
        + Math.max(s.curlAmount2 ?? 0, 0) + Math.max(s.blurRadius ?? 0, 0) + Math.max(s.innerSmooth ?? 0, 0) * 0.5;
}

/**
 * The heights a channel can lay, for the ground's range: from `lowest` (its deepest bed) to `highest` (its highest surface) with the
 * terraces' and the smoothing's overshoot, or, added onto the ground, how far it moves the ground's own heights.
 */
export function channelHeights(lowest: number, highest: number, s: ChannelSettings): Pick<TerrainModifier, 'heights' | 'shifts'> {
    const over = (s.terraceAlpha > 0 ? Math.max(s.terraceSpacing, 0) : 0) + Math.max(s.outerSmooth ?? 0, 0) * 0.25;
    if (s.blend === ChannelBlend.Additive) return { shifts: [Math.min(s.zOffset, 0) - (highest - lowest) - over, Math.max(s.zOffset, 0) + over] };
    return { heights: [lowest + s.zOffset - over, highest + s.zOffset + over] };
}

/** A lake floor laid by its Curve Channel: the profile across its shore, from the outline's signed distance. */
export function lakeChannelModifier(id: string, space: OutlineSpace, level: number, depth: number, s: ChannelSettings): TerrainModifier {
    const sample = (x: number, z: number): ChannelSample => ({ d: inside(space, x, z), surface: level, depth });
    return {
        id,
        bounds: boundsOf(space, channelReach(s)),
        apply(x, z, h) { return channelAt(sample, x, z, h, s); },
        ...channelHeights(level - depth, level, s),
    };
}

/**
 * An island: inside its outline the ground is raised to `top`, and outside it eases back down to the ground over `falloff` world units.
 * Only raises.
 */
export function islandModifier(id: string, space: OutlineSpace, top: number, falloff: number): TerrainModifier {
    return {
        id,
        bounds: boundsOf(space, Math.max(falloff, 0)),
        apply(x, z, h) {
            const d = inside(space, x, z);
            if (d >= 0) return Math.max(h, top);
            if (falloff <= 0 || -d >= falloff) return h;
            const w = smoothstep(1 + d / falloff);
            return Math.max(h, h + (top - h) * w);
        },
        heights: [top, top],
    };
}
