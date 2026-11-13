// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    zone.ts
 * @brief   A water zone: every body of water in a region baked into one field, which one surface is drawn from.
 *
 * @details Bodies of water drawn each as a mesh of its own are separate surfaces, and where a river runs into a lake or the sea they meet
 *          along a seam: two heights, two sets of waves, a shore foaming across the river's mouth, a ribbon's edge showing over the lake.
 *          So a body of water is not drawn: it is an INPUT. A zone gathers the bodies over its region and bakes them into a grid, each
 *          texel holding what the water is there:
 *            - the height of its surface (a lake's level, the height of a river's curve at its nearest place, the sea's level);
 *            - the signed distance to the nearest shore (positive on the water): where the surface is cut and where it foams;
 *            - how high its waves stand there (a body's own height, calmed toward its shore and as the water shallows);
 *            - how it flows (a river's current), and how deep it is over the ground.
 *          Where two bodies meet their values are blended by how far inside each the texel is, so a river is at its lake's level where it runs
 *          into it, its current fades into the still water, and its banks run on into the lake's shores with no seam; the sea gives way to
 *          the bodies over it. One mesh following the camera reads the field and is the whole surface, and {@link WaterField.sample} answers
 *          the CPU from the same numbers.
 *
 *          The field is in the world's own frame on the xz plane: bodies may be turned about their up, not tilted.
 */
import { DEEP, WaterQuery, type WaterQueryData, type ZoneGrid } from './waterQuery';
import { defineComponent, type ComponentDef } from '../ecs/component';
import { polygonSdf, shoreDamp, type Point2 } from './shore';

/** The fields of the `WaterZone` component. @experimental */
export interface WaterZoneData {
    /** The region baked, along x and z, centred on the entity. Bodies (or the parts of them) outside it are not drawn; an ocean goes on past it. */
    sizeX: number;
    sizeZ: number;
    /** Texels along the longer side of the region. */
    resolution: number;
    /** A material on the Water shader for the whole surface. Empty uses the stock water. */
    material: number;
    /** The waves every body shares (each sets only how high they stand): the length of the longest, a multiplier on their speed, their heading in degrees. */
    waveLength: number;
    waveSpeed: number;
    waveDirection: number;
    /** The surf: how high a breaker stands against its body's waves (0 draws none), and how long the surf's waves are, in world units. */
    surf: number;
    surfLength: number;
    /** The surface's mesh: the cell size of its finest ring, cells along a ring's side, and how many rings (each twice as coarse) follow the camera. */
    cellSize: number;
    cells: number;
    rings: number;
    /** Cells along a side of the ripple grid; 0 keeps none. The grid is a window of `rippleSize` that follows the camera. */
    ripples: number;
    rippleSize: number;
    /** How fast a ripple spreads (world units a second), how much of its height it loses a second, and how fast the foam it leaves fades a second. */
    rippleSpeed: number;
    rippleDamping: number;
    foamFade: number;
}

/**
 * Where the bodies of water are drawn from, and what they share. A scene without one is given a zone over its lakes and rivers with these
 * defaults; put one in to say where, how fine, and what the water looks like.
 *
 * @experimental
 */
export const WaterZone: ComponentDef<WaterZoneData> = /* @__PURE__ */ defineComponent<WaterZoneData>('WaterZone', {
    // Lengths at the engine's reference of 100 units a metre (ecs/worldUnits.ts): 14 m waves on metre cells in any project.
    sizeX: 20000, sizeZ: 20000, resolution: 256, material: 0,
    waveLength: 1400, waveSpeed: 1, waveDirection: 30, surf: 0.6, surfLength: 800,
    cellSize: 100, cells: 64, rings: 5,
    ripples: 0, rippleSize: 6400, rippleSpeed: 600, rippleDamping: 0.8, foamFade: 0.4,
}, {
    worldUnitFields: ['sizeX', 'sizeZ', 'waveLength', 'surfLength', 'cellSize', 'rippleSize', 'rippleSpeed'],
    assetFields: [{ field: 'material', type: 'material' }],
    fields: {
        sizeX: { min: 1, category: 'Region', tooltip: 'The region baked along x, centred on the entity. Water outside it is not drawn; an ocean goes on past it.' },
        sizeZ: { min: 1, category: 'Region', tooltip: 'The region baked along z, centred on the entity.' },
        resolution: { min: 32, max: 1024, step: 32, category: 'Region', tooltip: 'Texels along the longer side of the region: how finely shores and rivers are traced.' },
        material: { category: 'Look', tooltip: 'A material on the Water shader for the whole surface. Empty uses the stock water.' },
        waveLength: { min: 0.5, max: 3000, category: 'Waves', tooltip: 'The length of the longest wave. Every body shares the waves; each sets how high they stand.' },
        waveSpeed: { min: 0, max: 4, category: 'Waves', tooltip: 'A multiplier on how fast the waves travel.' },
        waveDirection: { min: 0, max: 360, category: 'Waves', tooltip: 'The heading of the waves, in degrees.' },
        surf: { min: 0, max: 4, category: 'Waves', tooltip: 'How high the surf breaking on a shore stands against its body\'s waves. 0 draws none. A current carries none.' },
        surfLength: { min: 0.1, max: 100000, category: 'Waves', tooltip: 'The length of the surf\'s waves, in world units. They run in over four lengths of water, break, and run up the ground past the shore.' },
        cellSize: { min: 0.05, category: 'Detail', tooltip: 'The cell size of the finest ring of the surface. Waves shorter than six cells are not drawn as geometry there (the shading still shows them).' },
        cells: { min: 4, max: 256, step: 4, category: 'Detail', tooltip: 'Cells along a ring\'s side.' },
        rings: { min: 1, max: 10, step: 1, category: 'Detail', tooltip: 'Rings of the surface, each twice as coarse as the one inside it.' },
        ripples: { min: 0, max: 256, step: 8, category: 'Ripples', tooltip: 'Cells along a side of the grid that keeps what disturbs the water: bodies moving in it, rain, and what a script disturbs. 0 keeps none.' },
        rippleSize: { min: 4, category: 'Ripples', tooltip: 'The side of the window the ripples are kept in, in world units. It follows the camera.' },
        rippleSpeed: { min: 0.1, max: 4000, category: 'Ripples', tooltip: 'How fast a ripple spreads, in world units a second.' },
        rippleDamping: { min: 0, max: 10, category: 'Ripples', tooltip: 'How much of its height a ripple loses each second.' },
        foamFade: { min: 0, max: 10, category: 'Ripples', tooltip: 'How fast the foam a disturbance leaves fades, a second.' },
    },
});

/**
 * An ocean, as the zone takes it: at `level` wherever the ground is below it and joined to the open sea, which is past the region's
 * edge. A basin below the sea's level that no low ground joins to the edge is dry land, not sea.
 */
export interface ZoneOcean {
    kind: 'ocean'; key: number; level: number; waveHeight: number; shoreWidth: number;
    /** How open the water is to the wind, 0 to 1 (its fetch): how far the weather raises its waves. Open sea, 1 when absent. */
    exposure?: number;
}

/** A lake: its outline on its own plane at world height `level`, and how a world point is put into the outline's space. */
export interface ZoneLake {
    kind: 'lake'; key: number; level: number; waveHeight: number; shoreWidth: number; exposure?: number;
    outline: readonly Point2[];
    /** A world (x, z) in the outline's own space, and back. */
    toLocal(x: number, z: number): [number, number];
    toWorld(x: number, z: number): [number, number];
}

/** A point along a river, in the world: where its middle is, its surface's height, half its width, its heading and how fast it runs there. */
export interface RiverStation { x: number; z: number; y: number; half: number; dx: number; dz: number; speed: number }

/** A river, as the stations along it (a few to a width), in order downstream. */
export interface ZoneRiver { kind: 'river'; key: number; waveHeight: number; shoreWidth: number; exposure?: number; stations: readonly RiverStation[] }

export type ZoneBody = ZoneOcean | ZoneLake | ZoneRiver;

/** The ground's world height at (x, z), or null where none is known. */
export type ZoneGround = (x: number, z: number) => number | null;

/** The region a field is baked over, in world units, and its grid. */
export type { ZoneGrid } from './waterQuery';

/** What the field encodes its numbers over, which the shader decodes with: see {@link WaterField.encode}. */
export interface ZoneRanges { heightMin: number; heightSpan: number; shore: number; amp: number; flow: number; depth: number }

/** What {@link WaterField.sample} answers about the water at a point. */
export interface FieldSample {
    /** The body that owns the most of it. */
    key: number;
    /** Its surface's height at rest, the height its waves stand to (and the share of its body's that is, calmed toward the shore), and its current. */
    height: number;
    amp: number;
    calm: number;
    /** The height its body's waves stand to away from any shore: what the surf breaking on the shore is measured against. */
    swell: number;
    flowX: number;
    flowZ: number;
    /** The signed distance to the nearest shore (positive on the water) and how deep the water is over the ground. */
    shore: number;
    depth: number;
    /** The distance the surf runs in by: the shore's, a river's water taken for land, smoothed over the surf's length. */
    surf: number;
    /** How much of the surf a current leaves: 0 in a river, rising away from its mouth over half the surf's length. */
    still: number;
    /** How open it is to the wind, 0 to 1: how far the weather raises its waves (see {@link ZoneOcean.exposure}). */
    exposure: number;
}

/** What the current is at a reach this wide against the river's widest, against its nominal speed (half): a narrow reach is quick and a wide one slow. */
export function currentShare(width: number, widest: number): number {
    return Math.min(Math.max(widest / Math.max(width, 1e-3), 0.25), 2) / 2;
}

/** The depth over ground nothing is known of. */

/** The gentlest slope a depth is turned into a distance by: flatter ground than this is deep water or dry land a long way from a shore. */
const MIN_SLOPE = 0.01;
/** The slopes a shore goes from a beach (waves wash up it) to rock (they burst on it) over. */
const STEEP_FROM = 0.25, STEEP_TO = 0.8;

/** The baked water of a zone. */
export class WaterField {
    readonly grid: ZoneGrid;
    readonly height: Float32Array;
    readonly shore: Float32Array;
    readonly amp: Float32Array;
    readonly calm: Float32Array;
    readonly swell: Float32Array;
    readonly flowX: Float32Array;
    readonly flowZ: Float32Array;
    readonly depth: Float32Array;
    /** The distance the surf runs in by (see {@link FieldSample.surf}). */
    readonly surf: Float32Array;
    /** How much of the surf a current leaves (see {@link FieldSample.still}). */
    readonly still: Float32Array;
    /** How steep the shore is, 0 (a gentle beach) to 1 (rock, a cliff): where waves burst white rather than wash up. */
    readonly steep: Float32Array;
    readonly exposure: Float32Array;
    /** The body that owns the most of each texel, as its key; -1 where there is no water. */
    readonly owner: Int32Array;
    /** The ocean, which goes on past the region: what a point outside it is. */
    readonly ocean: ZoneOcean | null;

    private constructor(grid: ZoneGrid, ocean: ZoneOcean | null) {
        const n = grid.nx * grid.nz;
        this.grid = grid;
        this.ocean = ocean;
        this.height = new Float32Array(n);
        this.shore = new Float32Array(n);
        this.amp = new Float32Array(n);
        this.calm = new Float32Array(n);
        this.swell = new Float32Array(n);
        this.flowX = new Float32Array(n);
        this.flowZ = new Float32Array(n);
        this.depth = new Float32Array(n);
        this.surf = new Float32Array(n);
        this.still = new Float32Array(n).fill(1);
        this.steep = new Float32Array(n);
        this.exposure = new Float32Array(n).fill(1);
        this.owner = new Int32Array(n);
    }

    /**
     * Bakes `bodies` over `grid`. Each texel takes every body's say (its height, its distance to its own shore, its waves and current) and
     * weighs them by how far inside each it is, over a texel and a half, so where two bodies meet the values run from one to the other.
     * The lakes come first, then the rivers have what they leave (a river runs into a lake and is the lake there), and the ocean what both leave. A texel no body holds keeps the height of the nearest water, so the
     * surface's vertices there (which the shore cuts away) do not pull the water's edge down to nothing.
     */
    static bake(grid: ZoneGrid, bodies: readonly ZoneBody[], ground?: ZoneGround, surfLength = 0): WaterField {
        const job = WaterField.baking(grid, bodies, ground, surfLength);
        for (;;) {
            const next = job.next();
            if (next.done) return next.value;
        }
    }

    /** {@link WaterField.bake} as a job that yields its progress (0 to 1) every few rows, for spreading over frames. */
    static *baking(grid: ZoneGrid, bodies: readonly ZoneBody[], ground?: ZoneGround, surfLength = 0): Generator<number, WaterField, void> {
        const ocean = (bodies.find((b) => b.kind === 'ocean') as ZoneOcean | undefined) ?? null;
        const field = new WaterField(grid, ocean);
        const texel = Math.max(grid.sizeX / Math.max(grid.nx - 1, 1), grid.sizeZ / Math.max(grid.nz - 1, 1));
        const blend = texel * 1.5;
        // Lakes before rivers: a river that runs into a lake is the lake's there, as both are the ocean's betters.
        const bounded = [...bodies.filter((b) => b.kind === 'lake'), ...bodies.filter((b) => b.kind === 'river')] as (ZoneLake | ZoneRiver)[];
        const boxes = bounded.map((b) => boundsOf(b));
        const grounds = new Float64Array(grid.nx * grid.nz).fill(Number.NaN);
        // How much of each texel's water is a river's: the surf takes it for land.
        const rivers = new Float32Array(grid.nx * grid.nz);
        const rows = rowsAStep(grid.nx, CELLS_A_STEP);
        for (let j = 0; j < grid.nz; j++) {
            if (j % rows === 0) yield 0.3 * (j / grid.nz);
            for (let i = 0; i < grid.nx; i++) {
                const x = grid.minX + (i / Math.max(grid.nx - 1, 1)) * grid.sizeX;
                const z = grid.minZ + (j / Math.max(grid.nz - 1, 1)) * grid.sizeZ;
                grounds[j * grid.nx + i] = ground?.(x, z) ?? Number.NaN;
            }
        }
        const sea = ocean ? yield* openSea(grid, grounds, ocean.level, 0.3) : null;
        // How steep the ground is at each texel: a depth over it is how far the shore is across the ground, to first order, so the
        // distance to the shore is one measure (along the ground) everywhere and runs smoothly through zero between texels.
        const stepX = grid.sizeX / Math.max(grid.nx - 1, 1), stepZ = grid.sizeZ / Math.max(grid.nz - 1, 1);
        const slopeAt = (i: number, j: number): number => {
            const at = (ii: number, jj: number): number => grounds[Math.min(Math.max(jj, 0), grid.nz - 1) * grid.nx + Math.min(Math.max(ii, 0), grid.nx - 1)]!;
            const gx = (at(i + 1, j) - at(i - 1, j)) / (2 * stepX), gz = (at(i, j + 1) - at(i, j - 1)) / (2 * stepZ);
            const m = Math.hypot(gx, gz);
            return Number.isFinite(m) ? Math.max(m, MIN_SLOPE) : MIN_SLOPE;
        };
        for (let j = 0; j < grid.nz; j++) {
            if (j % rows === 0) yield 0.3 + 0.5 * (j / grid.nz);
            for (let i = 0; i < grid.nx; i++) {
                const k = j * grid.nx + i;
                const x = grid.minX + (i / Math.max(grid.nx - 1, 1)) * grid.sizeX;
                const z = grid.minZ + (j / Math.max(grid.nz - 1, 1)) * grid.sizeZ;
                const g = Number.isNaN(grounds[k]!) ? null : grounds[k]!;
                const slope = g === null ? MIN_SLOPE : slopeAt(i, j);
                field.steep[k] = smooth(STEEP_FROM, STEEP_TO, slope);
                let w = 0, h = 0, a = 0, c = 0, sw = 0, ex = 0, fx = 0, fz = 0, best = -Infinity, owner = -1, ownerW = 0, held = 0, lakeShore = -Infinity, riverW = 0;
                // Ground below the sea's level that the open sea does not reach is a dry basin: as far above the sea as a texel.
                const seaDeep = !ocean ? -DEEP : g === null ? DEEP : g < ocean.level && !sea![k] ? -texel : (ocean.level - g) / slope;
                for (let b = 0; b < bounded.length; b++) {
                    const box = boxes[b]!;
                    if (x < box[0] - blend || x > box[2] + blend || z < box[1] - blend || z > box[3] + blend) continue;
                    const say = sayOf(bounded[b]!, x, z, g, slope);
                    if (!say) continue;
                    best = Math.max(best, say.shore);
                    const inside = smooth(-blend, blend, say.shore);
                    // A river gives way to the lake or the sea it runs into over half its width past their shore, its current fading
                    // with it: cut off at their shore, its sides would run on into the open water as lines the surf stops at.
                    const fade = Math.max(say.half, blend);
                    // Its mouth on the sea is where its surface comes down to the sea's (its bed may lie under the sea's level far
                    // upstream): how far past that it is, from how far under it its surface runs and how fast it falls along its course.
                    const pastSea = ocean ? (ocean.level - say.height) / Math.max(say.grade, 1e-3) : -DEEP;
                    const weight = bounded[b]!.kind === 'river'
                        ? inside * (1 - smooth(0, fade, lakeShore)) * (1 - smooth(0, fade, pastSea)) : inside;
                    if (bounded[b]!.kind === 'lake') lakeShore = Math.max(lakeShore, say.shore);
                    if (weight <= 0) continue;
                    held = Math.max(held, weight);
                    if (bounded[b]!.kind === 'river') riverW += weight;
                    w += weight; h += say.height * weight; a += say.amp * weight; c += say.calm * weight; sw += bounded[b]!.waveHeight * weight; fx += say.fx * weight; fz += say.fz * weight;
                    ex += (bounded[b]!.exposure ?? 1) * weight;
                    if (weight > ownerW) { ownerW = weight; owner = bounded[b]!.key; }
                }
                if (ocean) {
                    const deep = seaDeep;
                    best = Math.max(best, deep);
                    const weight = smooth(-blend, blend, deep) * (1 - held);
                    if (weight > 0) {
                        const calm = shoreDamp(g === null ? deep : Math.min(deep, ocean.level - g), ocean.shoreWidth);
                        w += weight; h += ocean.level * weight; a += ocean.waveHeight * calm * weight; c += calm * weight; sw += ocean.waveHeight * weight;
                        ex += (ocean.exposure ?? 1) * weight;
                        if (weight > ownerW) { ownerW = weight; owner = ocean.key; }
                    }
                }
                field.shore[k] = best === -Infinity ? -DEEP : best;
                field.owner[k] = w > 0 ? owner : -1;
                if (w > 0) {
                    field.height[k] = h / w;
                    field.amp[k] = a / w;
                    field.calm[k] = c / w;
                    field.swell[k] = sw / w;
                    field.exposure[k] = ex / w;
                    field.flowX[k] = fx / w;
                    field.flowZ[k] = fz / w;
                    rivers[k] = riverW / w;
                } else {
                    field.height[k] = Number.NaN;
                }
                field.depth[k] = g === null ? DEEP : Math.max(0, (w > 0 ? h / w : 0) - g);
            }
        }
        yield* levelShore(field, texel);
        yield* fillDry(field);
        yield* surfDistance(field, rivers, texel, surfLength, 0.95);
        // The water beside a steep shore takes its steepness: a cliff's foot is a texel or two out in the water.
        yield* blur(field.steep, grid.nx, grid.nz, 2, 0.99);
        for (let k = 0; k < field.steep.length; k++) field.steep[k] = Math.min(field.steep[k]! * 2, 1);
        return field;
    }

    /** The field at a world point inside the region, read as the texels around it blend; null outside the region. */
    at(x: number, z: number): FieldSample | null {
        const { minX, minZ, sizeX, sizeZ, nx, nz } = this.grid;
        if (nx < 2 || nz < 2) return null;
        const u = (x - minX) / sizeX, v = (z - minZ) / sizeZ;
        if (u < 0 || u > 1 || v < 0 || v > 1) return null;
        const fx = u * (nx - 1), fz = v * (nz - 1);
        const i = Math.min(Math.floor(fx), nx - 2), j = Math.min(Math.floor(fz), nz - 2);
        const tx = fx - i, tz = fz - j;
        const lerp2 = (a: Float32Array): number => {
            const k = j * nx + i;
            const lo = a[k]! * (1 - tx) + a[k + 1]! * tx, hi = a[k + nx]! * (1 - tx) + a[k + nx + 1]! * tx;
            return lo * (1 - tz) + hi * tz;
        };
        const near = (j + (tz > 0.5 ? 1 : 0)) * nx + i + (tx > 0.5 ? 1 : 0);
        return {
            key: this.owner[near]!, height: lerp2(this.height), amp: lerp2(this.amp), calm: lerp2(this.calm), swell: lerp2(this.swell), flowX: lerp2(this.flowX), flowZ: lerp2(this.flowZ),
            shore: lerp2(this.shore), depth: lerp2(this.depth), surf: lerp2(this.surf), still: lerp2(this.still), exposure: lerp2(this.exposure),
        };
    }

    /**
     * The water at a world point: the field inside the region, the ocean past it (as deep as it likes, waves whole), null where there is none.
     * `shore` above zero is water.
     */
    sample(x: number, z: number): FieldSample | null {
        const inside = this.at(x, z);
        if (inside) return inside.shore > 0 ? inside : null;
        const o = this.ocean;
        if (!o) return null;
        return { key: o.key, height: o.level, amp: o.waveHeight, calm: 1, swell: o.waveHeight, flowX: 0, flowZ: 0, shore: DEEP, depth: DEEP, surf: DEEP, still: 1, exposure: o.exposure ?? 1 };
    }

    /** The part of the field a world is laid out by (how deep water stands over a height, how far a point is from the shore), as a query over this field's own arrays. */
    query(): WaterQuery {
        return this.query_ ??= new WaterQuery({ grid: this.grid, height: this.height, shore: this.shore, ocean: this.ocean ? { level: this.ocean.level } : null });
    }

    private query_: WaterQuery | null = null;

    /** The ranges the encoding spans, from what the field holds; the shore distance reaches `shoreReach` at least (as far out as the surf is drawn). */
    ranges(shoreReach = 0): ZoneRanges {
        const r = this.ranges_ ??= this.measure();
        return { ...r, shore: Math.max(r.shore, shoreReach * 1.25) };
    }

    private ranges_: ZoneRanges | null = null;

    private measure(): ZoneRanges {
        let lo = Infinity, hi = -Infinity, amp = 0, flow = 0;
        for (let k = 0; k < this.height.length; k++) {
            const h = this.height[k]!;
            if (Number.isFinite(h)) { lo = Math.min(lo, h); hi = Math.max(hi, h); }
            amp = Math.max(amp, this.swell[k]!);
            flow = Math.max(flow, Math.abs(this.flowX[k]!), Math.abs(this.flowZ[k]!));
        }
        if (this.ocean) { lo = Math.min(lo, this.ocean.level); hi = Math.max(hi, this.ocean.level); amp = Math.max(amp, this.ocean.waveHeight); }
        if (!Number.isFinite(lo)) { lo = 0; hi = 0; }
        const texel = Math.max(this.grid.sizeX / Math.max(this.grid.nx - 1, 1), this.grid.sizeZ / Math.max(this.grid.nz - 1, 1));
        return { heightMin: lo, heightSpan: Math.max(hi - lo, 1e-3), shore: texel * 16, amp: Math.max(amp, 1e-3), flow: Math.max(flow, 1e-3), depth: texel * 16 };
    }

    /**
     * The field as two RGBA8 images, rows from minZ. heights (read texel by texel: filtered bytes are no number): rg the height, high byte
     * first; b the depth, as its square root (fine where the water is shallow, where the shore is drawn by it); a the swell (the body's waves' height). field (filtered): r the shore distance (0.5 at it, a signed square root); gb the current (0.5 still); a the calm.
     * exposure (filtered): r how open the water is to the wind; g the distance the surf runs in by; b how much surf a current leaves; a how steep the shore is. Each over its range in `r`.
     */
    encode(r: ZoneRanges): { heights: Uint8Array; field: Uint8Array; exposure: Uint8Array } {
        const n = this.height.length;
        const heights = new Uint8Array(n * 4), field = new Uint8Array(n * 4), exposure = new Uint8Array(n * 4);
        const byte = (v: number): number => Math.round(Math.min(Math.max(v, 0), 1) * 255);
        for (let k = 0; k < n; k++) {
            const h = Math.round(Math.min(Math.max((this.height[k]! - r.heightMin) / r.heightSpan, 0), 1) * 65535);
            heights[k * 4] = h >> 8;
            heights[k * 4 + 1] = h & 255;
            heights[k * 4 + 2] = byte(Math.sqrt(Math.max(this.depth[k]! / r.depth, 0)));
            heights[k * 4 + 3] = byte(this.swell[k]! / r.amp);
            // As a signed square root: a byte across the whole reach of the surf is coarse, and the shore is drawn where it crosses zero.
            const across = Math.max(Math.min(this.shore[k]! / r.shore, 1), -1);
            field[k * 4] = byte(Math.sign(across) * Math.sqrt(Math.abs(across)) / 2 + 0.5);
            field[k * 4 + 1] = byte(this.flowX[k]! / (2 * r.flow) + 0.5);
            field[k * 4 + 2] = byte(this.flowZ[k]! / (2 * r.flow) + 0.5);
            field[k * 4 + 3] = byte(this.calm[k]!);
            exposure[k * 4] = byte(this.exposure[k]!);
            // g: the distance the surf runs in by, as a signed square root like the shore's.
            const surf = Math.max(Math.min(this.surf[k]! / r.shore, 1), -1);
            exposure[k * 4 + 1] = byte(Math.sign(surf) * Math.sqrt(Math.abs(surf)) / 2 + 0.5);
            exposure[k * 4 + 2] = byte(this.still[k]!);
            exposure[k * 4 + 3] = byte(this.steep[k]!);
        }
        return { heights, field, exposure };
    }
}

/** What one body says about a point: its height there, how far inside it the point is, its waves and its current. Null where it says nothing. */
function sayOf(body: ZoneLake | ZoneRiver, x: number, z: number, g: number | null, slope: number):
    { height: number; shore: number; amp: number; calm: number; fx: number; fz: number; half: number; grade: number } | null {
    if (body.kind === 'lake') {
        const [lx, lz] = body.toLocal(x, z);
        // The depth as a distance across the ground to where the water meets it (the ground's slope there sets how far that is).
        const depth = g === null ? DEEP : body.level - g;
        // Water only where its outline is and its surface is over the ground: land inside the outline, above the water, is land.
        const shore = Math.min(polygonSdf(body.outline, lx, lz), depth / slope);
        // The waves calm toward the shore and as the water shallows, which on a flat shelf far from any shore is the depth alone.
        const calm = shoreDamp(Math.min(shore, depth), body.shoreWidth);
        return { height: body.level, shore, amp: body.waveHeight * calm, calm, fx: 0, fz: 0, half: 0, grade: 0 };
    }
    const st = body.stations;
    if (st.length < 2) return null;
    // The nearest place on the river's middle, between two stations, with what is there eased between them.
    let best = Infinity, at = 0, t = 0;
    for (let s = 0; s + 1 < st.length; s++) {
        const a = st[s]!, b = st[s + 1]!;
        const ex = b.x - a.x, ez = b.z - a.z;
        const len2 = ex * ex + ez * ez;
        const u = len2 > 0 ? Math.min(Math.max(((x - a.x) * ex + (z - a.z) * ez) / len2, 0), 1) : 0;
        const d = Math.hypot(x - (a.x + u * ex), z - (a.z + u * ez));
        if (d < best) { best = d; at = s; t = u; }
    }
    const a = st[at]!, b = st[at + 1]!;
    const mix = (p: number, q: number): number => p + (q - p) * t;
    const half = mix(a.half, b.half), y = mix(a.y, b.y), speed = mix(a.speed, b.speed);
    let dx = mix(a.dx, b.dx), dz = mix(a.dz, b.dz);
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    const depth = g === null ? DEEP : y - g;
    // Within its banks and over its bed: a bank inside the river's width that stands above its surface is dry.
    const shore = Math.min(half - best, depth / slope);
    // The current fades in over a width from the spring and out over a width into whatever it runs into.
    const along = (at + t) / (st.length - 1);
    const length = st.reduce((n, p, i) => (i ? n + Math.hypot(p.x - st[i - 1]!.x, p.z - st[i - 1]!.z) : 0), 0);
    const run = smooth(0, 2 * half, along * length) * smooth(0, 2 * half, (1 - along) * length);
    const calm = shoreDamp(Math.min(shore, depth), body.shoreWidth);
    return { height: y, shore, amp: body.waveHeight * calm, calm, fx: dx * speed * run, fz: dz * speed * run, half, grade: Math.abs(b.y - a.y) / Math.max(Math.hypot(b.x - a.x, b.z - a.z), 1e-6) };
}

/**
 * Which texels the open sea reaches: those whose ground is below `level` (or unknown) and joined, through such texels, to the region's
 * edge, past which the sea goes on.
 */
function* openSea(grid: ZoneGrid, grounds: Float64Array, level: number, at: number): Generator<number, Uint8Array, void> {
    const { nx, nz } = grid;
    const sea = new Uint8Array(nx * nz);
    const low = (k: number): boolean => { const g = grounds[k]!; return Number.isNaN(g) || g < level; };
    const queue: number[] = [];
    const reach = (k: number): void => { if (!sea[k] && low(k)) { sea[k] = 1; queue.push(k); } };
    for (let i = 0; i < nx; i++) { reach(i); reach((nz - 1) * nx + i); }
    for (let j = 0; j < nz; j++) { reach(j * nx); reach(j * nx + nx - 1); }
    for (let q = 0; q < queue.length; q++) {
        if (q % SWEPT_A_STEP === SWEPT_A_STEP - 1) yield at;
        const k = queue[q]!, i = k % nx;
        if (i > 0) reach(k - 1);
        if (i < nx - 1) reach(k + 1);
        if (k >= nx) reach(k - nx);
        if (k < (nz - 1) * nx) reach(k + nx);
    }
    return sea;
}

/** A body's box on the world's xz plane, [minX, minZ, maxX, maxZ]. */
function boundsOf(body: ZoneLake | ZoneRiver): [number, number, number, number] {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    if (body.kind === 'river') {
        for (const s of body.stations) {
            minX = Math.min(minX, s.x - s.half); maxX = Math.max(maxX, s.x + s.half);
            minZ = Math.min(minZ, s.z - s.half); maxZ = Math.max(maxZ, s.z + s.half);
        }
        return [minX, minZ, maxX, maxZ];
    }
    for (const p of body.outline) {
        const [x, z] = body.toWorld(p.x, p.y);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    return [minX, minZ, maxX, maxZ];
}

/**
 * The shore distance made one measure everywhere: how far across the ground the nearest edge of ANY water is, the sign the bodies gave. A body's
 * own say is exact only near its edge (an ocean's is its depth, a lake's ends at its outline even where a river carries the water on), so the
 * texels on either side of an edge keep it, held to a texel, and every other texel is that plus how far it is from the nearest of them
 * (each texel carries its nearest edge texel, two sweeps).
 */
/**
 * How much of a bake is one step. A job stepped in a frame is given the frame's spare milliseconds, and takes them a step at a time: a
 * step is as small as the smallest thing worth waiting for, by cells and not by rows, so a region of 4096 texels a side steps as often
 * as one of 256. Reading the ground and asking every body is about a microsecond a cell; a sweep is a twentieth of that.
 */
const CELLS_A_STEP = 2048;
const SWEPT_A_STEP = 32768;
const rowsAStep = (nx: number, cells: number): number => Math.max(1, Math.floor(cells / Math.max(nx, 1)));

function* levelShore(field: WaterField, texel: number): Generator<number, void, void> {
    const { nx, nz, sizeX, sizeZ } = field.grid;
    const n = nx * nz;
    if (nx < 2 || nz < 2) return;
    const dx = sizeX / (nx - 1), dz = sizeZ / (nz - 1);
    const wet = (k: number): boolean => field.shore[k]! > 0;
    const seed = new Int32Array(n).fill(-1);
    const offset = new Float32Array(n);
    const dist = new Float32Array(n).fill(Infinity);
    const rows = rowsAStep(nx, SWEPT_A_STEP);
    yield 0.85;
    for (let j = 0; j < nz; j++) {
        if (j % rows === 0) yield 0.85;
        for (let i = 0; i < nx; i++) {
            const k = j * nx + i, w = wet(k);
            const edge = (i > 0 && wet(k - 1) !== w) || (i < nx - 1 && wet(k + 1) !== w) || (j > 0 && wet(k - nx) !== w) || (j < nz - 1 && wet(k + nx) !== w);
            if (!edge) continue;
            seed[k] = k;
            offset[k] = Math.min(Math.abs(field.shore[k]!), texel);
            dist[k] = offset[k]!;
        }
    }
    const relax = (k: number, from: number): void => {
        const s = seed[from]!;
        if (s < 0) return;
        const ex = ((k % nx) - (s % nx)) * dx, ez = (Math.floor(k / nx) - Math.floor(s / nx)) * dz;
        const d = Math.hypot(ex, ez) + offset[s]!;
        if (d < dist[k]!) { dist[k] = d; seed[k] = s; }
    };
    yield 0.85;
    for (let j = 0; j < nz; j++) {
        if (j % rows === 0) yield 0.85 + 0.035 * (j / nz);
        for (let i = 0; i < nx; i++) {
            const k = j * nx + i;
            if (i > 0) relax(k, k - 1);
            if (j > 0) { relax(k, k - nx); if (i > 0) relax(k, k - nx - 1); if (i < nx - 1) relax(k, k - nx + 1); }
        }
    }
    for (let j = nz - 1; j >= 0; j--) {
        if (j % rows === 0) yield 0.92 - 0.035 * (j / nz);
        for (let i = nx - 1; i >= 0; i--) {
            const k = j * nx + i;
            if (i < nx - 1) relax(k, k + 1);
            if (j < nz - 1) { relax(k, k + nx); if (i < nx - 1) relax(k, k + nx + 1); if (i > 0) relax(k, k + nx - 1); }
        }
    }
    yield 0.92;
    for (let k = 0; k < n; k++) {
        if (!Number.isFinite(dist[k]!)) continue;
        field.shore[k] = wet(k) ? dist[k]! : -dist[k]!;
    }
}

/**
 * A texel no body holds takes the height (and how open it is to the wind) of the nearest that one does: two passes of a chamfer sweep over
 * which texel is nearest. The shore's filtered reads then see the water's own, not the dry land's.
 */
function* fillDry(field: WaterField): Generator<number, void, void> {
    const { nx, nz } = field.grid;
    const n = nx * nz;
    const src = new Int32Array(n).fill(-1);
    const dist = new Float32Array(n).fill(Infinity);
    for (let k = 0; k < n; k++) if (Number.isFinite(field.height[k]!)) { src[k] = k; dist[k] = 0; }
    const relax = (k: number, from: number, step: number): void => {
        if (src[from]! < 0 || dist[from]! + step >= dist[k]!) return;
        dist[k] = dist[from]! + step;
        src[k] = src[from]!;
    };
    const rows = rowsAStep(nx, SWEPT_A_STEP);
    yield 0.92;
    for (let j = 0; j < nz; j++) {
        if (j % rows === 0) yield 0.92 + 0.015 * (j / nz);
        for (let i = 0; i < nx; i++) {
            const k = j * nx + i;
            if (i > 0) relax(k, k - 1, 1);
            if (j > 0) relax(k, k - nx, 1);
            if (i > 0 && j > 0) relax(k, k - nx - 1, Math.SQRT2);
            if (i < nx - 1 && j > 0) relax(k, k - nx + 1, Math.SQRT2);
        }
    }
    for (let j = nz - 1; j >= 0; j--) {
        if (j % rows === 0) yield 0.95 - 0.015 * (j / nz);
        for (let i = nx - 1; i >= 0; i--) {
            const k = j * nx + i;
            if (i < nx - 1) relax(k, k + 1, 1);
            if (j < nz - 1) relax(k, k + nx, 1);
            if (i < nx - 1 && j < nz - 1) relax(k, k + nx + 1, Math.SQRT2);
            if (i > 0 && j < nz - 1) relax(k, k + nx - 1, Math.SQRT2);
        }
    }
    yield 0.95;
    const fallback = field.ocean ? field.ocean.level : 0;
    for (let k = 0; k < n; k++) {
        if (Number.isFinite(field.height[k]!)) continue;
        field.height[k] = src[k]! >= 0 ? field.height[src[k]!]! : fallback;
        if (src[k]! >= 0) field.exposure[k] = field.exposure[src[k]!]!;
    }
}

/**
 * The distance the surf runs in by: the shore distance with a river's water taken for land (a current carries no surf, and its mouth is
 * no bay the crests bend into), smoothed over the surf's length. A crest is a line of it: smoothed, the crests come in from the open
 * water as lines and turn to follow the shore only as they near it, instead of tracing every turn of it from far out.
 */
function* surfDistance(field: WaterField, rivers: Float32Array, texel: number, surfLength: number, at: number): Generator<number, void, void> {
    const { nx, nz } = field.grid;
    const n = nx * nz;
    // Distances across the texels (8-neighbour chamfer) from the open water's edge: into the water above zero, onto the land (a river's
    // water with it) below. The surf needs where the crests line up, which this keeps, not the shore to a texel, which the real one has.
    const wet = new Uint8Array(n);
    for (let k = 0; k < n; k++) wet[k] = field.shore[k]! > 0 && rivers[k]! < 0.5 ? 1 : 0;
    const cap = Math.max(surfLength * 8, texel * 16);
    yield at;
    const toWater = yield* chamfer(nx, nz, wet, 0, at);
    const toLand = yield* chamfer(nx, nz, wet, 1, at);
    for (let k = 0; k < n; k++) field.surf[k] = Math.min(Math.max((toLand[k]! - toWater[k]!) * texel, -cap), cap);
    yield* blur(field.surf, nx, nz, Math.round(surfLength / Math.max(texel, 1e-6)), at);
    // A river's current carries no surf, and spreads as it runs out into open water: the surf comes back over half its length.
    for (let k = 0; k < n; k++) field.still[k] = 1 - rivers[k]!;
    yield* blur(field.still, nx, nz, Math.round((surfLength * 0.5) / Math.max(texel, 1e-6)), at);
    // Spread out past the mouth, never in: the river itself, banks and all, keeps none (the land beside it would lend it some).
    for (let k = 0; k < n; k++) field.still[k] = Math.min(field.still[k]!, 1 - rivers[k]!);
}

/** `values` (a grid nx by nz) blurred in place over `radius` texels: three box passes each way, near enough a Gaussian, at a cost that
 * does not grow with the radius. */
function* blur(values: Float32Array, nx: number, nz: number, radius: number, progress: number): Generator<number, void, void> {
    if (radius < 1 || nx < 2 || nz < 2) return;
    const line = new Float32Array(Math.max(nx, nz));
    function* pass(count: number, length: number, at: (c: number, i: number) => number): Generator<number, void, void> {
        const lines = rowsAStep(length, SWEPT_A_STEP);
        for (let c = 0; c < count; c++) {
            if (c % lines === 0) yield progress;
            for (let i = 0; i < length; i++) line[i] = values[at(c, i)]!;
            let sum = 0;
            for (let i = -radius; i <= radius; i++) sum += line[Math.min(Math.max(i, 0), length - 1)]!;
            for (let i = 0; i < length; i++) {
                values[at(c, i)] = sum / (2 * radius + 1);
                sum += line[Math.min(i + radius + 1, length - 1)]! - line[Math.max(i - radius, 0)]!;
            }
        }
    }
    for (let p = 0; p < 3; p++) {
        yield* pass(nz, nx, (j, i) => j * nx + i);
        yield* pass(nx, nz, (i, j) => j * nx + i);
    }
}

/** How many texels each texel is from the nearest one whose `wet` is not `from` (half a texel at the edge, 0 on the other side). */
function* chamfer(nx: number, nz: number, wet: Uint8Array, from: number, at: number): Generator<number, Float32Array, void> {
    const n = nx * nz;
    const d = new Float32Array(n);
    for (let k = 0; k < n; k++) d[k] = wet[k] === from ? 1e9 : 0;
    const relax = (k: number, o: number, w: number): void => { if (d[o]! + w < d[k]!) d[k] = d[o]! + w; };
    const rows = rowsAStep(nx, SWEPT_A_STEP);
    for (let j = 0; j < nz; j++) {
        if (j % rows === 0) yield at;
        for (let i = 0; i < nx; i++) {
            const k = j * nx + i;
            if (i > 0) relax(k, k - 1, 1);
            if (j > 0) relax(k, k - nx, 1);
            if (i > 0 && j > 0) relax(k, k - nx - 1, Math.SQRT2);
            if (i < nx - 1 && j > 0) relax(k, k - nx + 1, Math.SQRT2);
        }
    }
    for (let j = nz - 1; j >= 0; j--) {
        if (j % rows === 0) yield at;
        for (let i = nx - 1; i >= 0; i--) {
            const k = j * nx + i;
            if (i < nx - 1) relax(k, k + 1, 1);
            if (j < nz - 1) relax(k, k + nx, 1);
            if (i < nx - 1 && j < nz - 1) relax(k, k + nx + 1, Math.SQRT2);
            if (i > 0 && j < nz - 1) relax(k, k + nx - 1, Math.SQRT2);
        }
    }
    // The edge lies between two texels: half a texel from each.
    for (let k = 0; k < n; k++) if (d[k]! > 0 && d[k]! < 1e9) d[k] = d[k]! - 0.5;
    return d;
}

function smooth(a: number, b: number, x: number): number {
    const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
    return t * t * (3 - 2 * t);
}
