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
 * edge from an elevation curve, where that starts against the shore, how wide it ramps, how it is laid over the ground, and its terraces.
 */
export interface ChannelSettings {
    /** The bed's depth as a share of the full depth, against how far across the ramp (both 0 to 1): 0 at the curve's start, the full depth from its end. */
    curve: (u: number) => number;
    /** How far in from the shore the curve starts, in world units; negative starts it out on the bank. */
    edgeOffset: number;
    /** How wide the curve ramps from its start to the full depth, in world units. */
    ramp: number;
    /** {@link ChannelBlend}: whether the ground is only cut, only raised, or laid to the profile either way. */
    blend: number;
    /** How far out past the curve's start the ground comes back to itself, in world units. */
    falloff: number;
    /** Raises (or lowers) the whole profile against the water's surface, in world units. */
    zOffset: number;
    /** Terraces laid over the profile: how much of them (0 none), the rise of each, and how round their edges (0 sharp, 1 none at all). */
    terraceAlpha: number;
    terraceSpacing: number;
    terraceSmoothness: number;
}

/** How a channel is laid over the ground: only cutting (Min), only raising (Max), or to its profile either way (Alpha Blend). */
export const ChannelBlend = { Min: 0, Max: 1, AlphaBlend: 2 } as const;

/** The profile's height after its terraces: steps `spacing` apart, their edges rounded by `smoothness`, blended in by `alpha`. */
function terraced(y: number, s: ChannelSettings): number {
    if (!(s.terraceAlpha > 0) || !(s.terraceSpacing > 0)) return y;
    const k = Math.floor(y / s.terraceSpacing), f = y / s.terraceSpacing - k;
    // A smooth step whose edge widens with smoothness: 0 a sheer step, 1 the plain slope.
    const w = Math.min(Math.max(s.terraceSmoothness, 0), 1);
    const edge = w >= 1 ? f : f < 1 - w ? 0 : smoothstep((f - (1 - w)) / Math.max(w, 1e-6));
    const stepped = (k + edge) * s.terraceSpacing;
    return y + (stepped - y) * Math.min(s.terraceAlpha, 1);
}

/**
 * The height a channel lays at a point `d` world units in from the shore (negative out on the bank), under water whose surface is at
 * `surface`, `depth` deep at its middle, over ground at `h`.
 */
export function channelHeight(d: number, surface: number, depth: number, h: number, s: ChannelSettings): number {
    const x = d - s.edgeOffset;
    let target: number, weight: number;
    if (x >= 0) {
        target = surface + s.zOffset - depth * Math.max(s.curve(Math.min(x / Math.max(s.ramp, 1e-6), 1)), 0);
        weight = 1;
    } else {
        // Past the curve's start the bank: flat at the water's level, giving the ground back over the falloff.
        if (!(s.falloff > 0) || -x >= s.falloff) return h;
        target = surface + s.zOffset;
        weight = 1 - smoothstep(-x / s.falloff);
    }
    const laid = h + (terraced(target, s) - h) * weight;
    return s.blend === ChannelBlend.Max ? Math.max(h, laid) : s.blend === ChannelBlend.AlphaBlend ? laid : Math.min(h, laid);
}

/** How far out past the shore a channel can reach: the curve's start out on the bank, and its falloff. */
export function channelReach(s: ChannelSettings): number {
    return Math.max(-s.edgeOffset, 0) + Math.max(s.falloff, 0);
}

/** A lake floor laid by its Curve Channel: the profile across its shore, from the outline's signed distance. */
export function lakeChannelModifier(id: string, space: OutlineSpace, level: number, depth: number, s: ChannelSettings): TerrainModifier {
    return {
        id,
        bounds: boundsOf(space, channelReach(s)),
        apply(x, z, h) { return channelHeight(inside(space, x, z), level, depth, h, s); },
        heights: [level + s.zOffset - depth, level + s.zOffset],
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
