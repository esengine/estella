// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    riverBed.ts
 * @brief   A river's bed cut into the terrain: the ground along it lowered under its surface, so the water lies in a channel instead
 *          of over grass.
 *
 * @details The bed is a trough across the river, `depth` under the surface at its middle and at the surface at its edge, its banks
 *          rising on at the slope the trough meets them with until they are back on the ground. Ground already lower (a valley the
 *          river runs down) is left as it is: the bed only cuts. The river is laid over the terrain as modifiers of a stretch each, so
 *          a point of ground is weighed against the few stations near it, and editing one river remakes only the ground along it.
 */
import type { TerrainModifier } from '../terrain/source';
import type { RiverStation } from './zone';

/** Stations to a modifier: a stretch a few widths long. */
const STRETCH = 24;
/** How far out from the edge the banks reach, in half-widths, before they give the ground back. */
const BANK = 2;

const smoothstep = (a: number, b: number, x: number): number => {
    const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
    return t * t * (3 - 2 * t);
};

/** The height the bed would have at (x, z) by the stations of one stretch, and how much of it holds there (0 past its banks). */
function bedAt(stations: readonly RiverStation[], from: number, to: number, depth: number, x: number, z: number): { height: number; weight: number } {
    let height = Infinity, weight = 0;
    for (let i = from; i < to; i++) {
        const a = stations[i]!, b = stations[i + 1]!;
        const ex = b.x - a.x, ez = b.z - a.z;
        const len2 = ex * ex + ez * ez;
        const t = len2 > 0 ? Math.min(Math.max(((x - a.x) * ex + (z - a.z) * ez) / len2, 0), 1) : 0;
        const d = Math.hypot(x - (a.x + ex * t), z - (a.z + ez * t));
        const half = Math.max(a.half + (b.half - a.half) * t, 1e-3);
        const reach = half * (1 + BANK);
        if (d >= reach) continue;
        const surface = a.y + (b.y - a.y) * t;
        const u = d / half;
        // Inside, a trough; outside, the bank goes on at the slope the trough meets it with, so there is no crease at the edge.
        const target = u < 1 ? surface - depth * (1 - u * u) : surface + (2 * depth / half) * (d - half);
        height = Math.min(height, target);
        weight = Math.max(weight, 1 - smoothstep(half * BANK, reach, d));
    }
    return { height, weight };
}

/**
 * The modifiers that cut a river's bed `depth` under its surface, a stretch of it each, their ids starting with `prefix`.
 * @experimental
 */
export function riverBedModifiers(prefix: string, stations: readonly RiverStation[], depth: number): TerrainModifier[] {
    if (stations.length < 2 || !(depth > 0)) return [];
    const out: TerrainModifier[] = [];
    for (let from = 0; from < stations.length - 1; from += STRETCH) {
        const to = Math.min(from + STRETCH, stations.length - 1);
        let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity, lowest = Infinity;
        for (let i = from; i <= to; i++) {
            const s = stations[i]!, r = s.half * (1 + BANK);
            lowest = Math.min(lowest, s.y - depth);
            minX = Math.min(minX, s.x - r); maxX = Math.max(maxX, s.x + r);
            minZ = Math.min(minZ, s.z - r); maxZ = Math.max(maxZ, s.z + r);
        }
        out.push({
            id: `${prefix}${from / STRETCH}`,
            bounds: [minX, minZ, maxX, maxZ],
            apply(x, z, h) {
                const bed = bedAt(stations, from, to, depth, x, z);
                if (bed.weight <= 0 || bed.height >= h) return h;
                return h + (bed.height - h) * bed.weight;
            },
            // Only cuts: its lowest is the bed under the lowest station of its stretch.
            heights: [lowest, lowest],
        });
    }
    return out;
}
