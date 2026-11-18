// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    probes.ts
 * @brief   What light arrives at a point in the air, as nine coefficients.
 *
 * @details The bounce's gather, aimed from a point rather than from a surface:
 *          the whole sphere instead of a hemisphere, and no normal to weight by.
 *          It is the same light field the atlas holds, sampled where a thing that
 *          moves can be — which is the one place a lightmap cannot answer.
 */

import type { Bvh } from './bvh';
import { rayRadiance, type HitLookup } from './solve';
import type { SkyRadiance } from './reflection';
import { shBasis, convolveCosine, convolveCosineScalar } from './sh';

/** Where one grid of probes sits, and how many. */
export interface ProbeGrid {
    /** The world box the probes fill, corner to corner. */
    min: readonly [number, number, number];
    max: readonly [number, number, number];
    /** Probes along each axis: the FINEST spacing, the one near geometry. */
    resolution: readonly [number, number, number];
    /**
     * How many sizes of brick the grid may use (1 = every probe, the dense grid). Above one, a brick of
     * BRICK_CELLS cells with nothing near it is solved at twice its children's spacing, up to 2^(levels-1) times
     * the finest: probes go where light changes against something, not into the air between.
     */
    levels?: number;
}

/** Cells a brick spans along each axis at its own spacing; its probes are BRICK_CELLS + 1 a side, the far faces
 *  included, which is how the runtime's atlas stores it (ProbeStore::kBrickCells). */
export const BRICK_CELLS = 4;
/** Probes a brick carries: (BRICK_CELLS + 1) cubed. */
export const BRICK_PROBES = (BRICK_CELLS + 1) ** 3;

/**
 * Where a grid's probes are solved, and how the solved list becomes the grid.
 *
 * Dense (`bricks` absent): `positions` is the grid in its order, x fastest — what a version 2 `.esprobes` holds.
 * Sparse: `bricks` is four ints a brick — its first finest-brick cell x, y, z and its span in those cells (1, 2, 4,
 * ...) — and `brickProbes` names, for each of a brick's BRICK_PROBES probes in x-fastest order, the entry of
 * `positions` it reads. Probes two bricks share are solved once.
 */
export interface ProbeLayout {
    resolution: [number, number, number];
    positions: Float64Array;
    bricks?: Int32Array;
    brickProbes?: Int32Array;
}

/**
 * Directions over the whole sphere, as a fixed low-discrepancy set (Fibonacci).
 * Fixed and not random, for the reason the hemisphere's set is: a bake that
 * answers differently twice cannot be told from one that answers wrongly once.
 */
function sphere(samples: number): Float32Array {
    const out = new Float32Array(samples * 3);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < samples; i++) {
        const y = 1 - (2 * i + 1) / samples;
        const r = Math.sqrt(Math.max(0, 1 - y * y));
        const phi = i * golden;
        out[i * 3] = Math.cos(phi) * r;
        out[i * 3 + 1] = y;
        out[i * 3 + 2] = Math.sin(phi) * r;
    }
    return out;
}

/**
 * Where probe `i` of `n` sits along one axis.
 *
 * On the CORNERS — the rule ProbeStore's trilinear read assumes, so a volume's
 * own bounds are covered by its own probes. One probe sits at the middle, which
 * is the value that read takes for the whole axis.
 */
export function probeAt(min: number, max: number, i: number, n: number): number {
    if (n <= 1) return (min + max) * 0.5;
    return min + (max - min) * (i / (n - 1));
}

/** Finest-brick cells along each axis: enough for every probe interval, one on a flat axis. */
function cellsFor(resolution: readonly [number, number, number]): [number, number, number] {
    return resolution.map((n) => Math.max(1, Math.ceil((n - 1) / BRICK_CELLS))) as [number, number, number];
}

/**
 * Where a grid's probes go. One level is every probe of the grid. More, and the grid is cut into the bricks the
 * runtime reads: starting from bricks 2^(levels-1) finest-brick cells a side, each one that `nearGeometry` says
 * has something in it (its box widened by one finest cell, so a surface just past a face counts) is split into
 * eight of half the span, down to the finest; the rest keep their span and are solved at its spacing.
 *
 * A brick's probe t along an axis sits at finest index `first * BRICK_CELLS + t * span`, clamped to the grid's last
 * probe: past the far edge a brick repeats the edge's probe, as the runtime does for a dense grid.
 */
export function planProbes(grid: ProbeGrid,
                           nearGeometry: (min: [number, number, number], max: [number, number, number]) => boolean): ProbeLayout {
    const res: [number, number, number] = [grid.resolution[0], grid.resolution[1], grid.resolution[2]];
    const at = (axis: number, i: number) => probeAt(grid.min[axis]!, grid.max[axis]!, i, res[axis]!);
    const levels = Math.max(1, Math.min(8, Math.floor(grid.levels ?? 1)));
    const leaves: number[] = [];
    if (levels > 1) planLeaves(grid, res, levels, nearGeometry, leaves);
    // Every brick at the finest span is the dense grid in pieces, and as bricks it carries its shared faces twice:
    // it is solved and written dense.
    let coarse = false;
    for (let i = 3; i < leaves.length; i += 4) if (leaves[i]! > 1) { coarse = true; break; }
    if (!coarse) {
        const positions = new Float64Array(res[0] * res[1] * res[2] * 3);
        let k = 0;
        for (let z = 0; z < res[2]; z++) {
            for (let y = 0; y < res[1]; y++) {
                for (let x = 0; x < res[0]; x++) {
                    positions[k++] = at(0, x); positions[k++] = at(1, y); positions[k++] = at(2, z);
                }
            }
        }
        return { resolution: res, positions };
    }

    const bricks = Int32Array.from(leaves);
    const count = bricks.length / 4;
    const brickProbes = new Int32Array(count * BRICK_PROBES);
    const index = new Map<number, number>();
    const coords: number[] = [];
    const side = BRICK_CELLS + 1;
    for (let b = 0; b < count; b++) {
        const span = bricks[b * 4 + 3]!;
        for (let t = 0; t < BRICK_PROBES; t++) {
            const tx = t % side, ty = Math.floor(t / side) % side, tz = Math.floor(t / (side * side));
            const fx = Math.min(bricks[b * 4]! * BRICK_CELLS + tx * span, res[0] - 1);
            const fy = Math.min(bricks[b * 4 + 1]! * BRICK_CELLS + ty * span, res[1] - 1);
            const fz = Math.min(bricks[b * 4 + 2]! * BRICK_CELLS + tz * span, res[2] - 1);
            const key = fx + res[0] * (fy + res[1] * fz);
            let slot = index.get(key);
            if (slot === undefined) {
                slot = coords.length / 3;
                index.set(key, slot);
                coords.push(fx, fy, fz);
            }
            brickProbes[b * BRICK_PROBES + t] = slot;
        }
    }
    const positions = new Float64Array(coords.length);
    for (let i = 0; i < coords.length; i += 3) {
        positions[i] = at(0, coords[i]!); positions[i + 1] = at(1, coords[i + 1]!); positions[i + 2] = at(2, coords[i + 2]!);
    }
    return { resolution: res, positions, bricks, brickProbes };
}

/** The bricks planProbes keeps, four numbers each (first finest-brick cell xyz, span), into `leaves`. */
function planLeaves(grid: ProbeGrid, res: [number, number, number], levels: number,
                    nearGeometry: (min: [number, number, number], max: [number, number, number]) => boolean,
                    leaves: number[]): void {
    const at = (axis: number, i: number) => probeAt(grid.min[axis]!, grid.max[axis]!, i, res[axis]!);
    const cells = cellsFor(res);
    const step = res.map((n, a) => (n > 1 ? (grid.max[a]! - grid.min[a]!) / (n - 1) : 0));
    // World bounds of a brick, widened by one finest cell.
    const near = (first: number[], span: number): boolean => {
        const lo = [0, 0, 0] as [number, number, number];
        const hi = [0, 0, 0] as [number, number, number];
        for (let a = 0; a < 3; a++) {
            const from = Math.min(first[a]! * BRICK_CELLS, res[a]! - 1);
            const to = Math.min((first[a]! + span) * BRICK_CELLS, res[a]! - 1);
            lo[a] = at(a, from) - step[a]!;
            hi[a] = at(a, to) + step[a]!;
            if (res[a] === 1) { lo[a] = grid.min[a]!; hi[a] = grid.max[a]!; }
        }
        return nearGeometry(lo, hi);
    };
    const split = (first: number[], span: number): void => {
        if (first[0]! >= cells[0] || first[1]! >= cells[1] || first[2]! >= cells[2]) return;
        if (span === 1 || !near(first, span)) { leaves.push(first[0]!, first[1]!, first[2]!, span); return; }
        const half = span / 2;
        for (let dz = 0; dz < 2; dz++) {
            for (let dy = 0; dy < 2; dy++) {
                for (let dx = 0; dx < 2; dx++) split([first[0]! + dx * half, first[1]! + dy * half, first[2]! + dz * half], half);
            }
        }
    };
    const top = 2 ** (levels - 1);
    for (let z = 0; z < cells[2]; z += top) {
        for (let y = 0; y < cells[1]; y += top) {
            for (let x = 0; x < cells[0]; x += top) split([x, y, z], top);
        }
    }

}

/**
 * A solved layout as the grid it describes: dense, the solved list as it is; sparse, each brick's BRICK_PROBES
 * probes laid out in turn (`stride` numbers a probe: 27 for the irradiance, 9 for the sky's visibility).
 */
export function gatherBricks(layout: ProbeLayout, solved: Float32Array, stride: number): Float32Array {
    if (!layout.bricks || !layout.brickProbes) return solved;
    const out = new Float32Array(layout.brickProbes.length * stride);
    for (let i = 0; i < layout.brickProbes.length; i++) {
        out.set(solved.subarray(layout.brickProbes[i]! * stride, layout.brickProbes[i]! * stride + stride), i * stride);
    }
    return out;
}

/**
 * What brick `b` of a sparse grid holds at finest-grid point `f` (each axis inside or on its box): its probes at its
 * own spacing, blended trilinearly — the runtime's read (ProbeStore::sampleBricks, the shaders' probeGridIrradiance).
 */
function readBrick(bricks: Int32Array, data: Float32Array, stride: number, b: number, f: readonly number[],
                   out: Float64Array): void {
    const side = BRICK_CELLS + 1;
    const low = [0, 0, 0], frac = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
        const local = (f[a]! - bricks[b * 4 + a]! * BRICK_CELLS) / bricks[b * 4 + 3]!;
        low[a] = Math.min(Math.max(Math.floor(local), 0), BRICK_CELLS - 1);
        frac[a] = Math.min(Math.max(local - low[a]!, 0), 1);
    }
    out.fill(0);
    for (let corner = 0; corner < 8; corner++) {
        const dx = corner & 1, dy = (corner >> 1) & 1, dz = (corner >> 2) & 1;
        const w = (dx ? frac[0]! : 1 - frac[0]!) * (dy ? frac[1]! : 1 - frac[1]!) * (dz ? frac[2]! : 1 - frac[2]!);
        if (w === 0) continue;
        const t = (low[0]! + dx) + side * ((low[1]! + dy) + side * (low[2]! + dz));
        const at = (b * BRICK_PROBES + t) * stride;
        for (let k = 0; k < stride; k++) out[k]! += data[at + k]! * w;
    }
}

/**
 * Makes a sparse grid's light continuous where bricks of different sizes meet, in place.
 *
 * A coarse brick's face is a blend of probes two or more finest cells apart; the fine brick across it holds a probe at
 * every one, so the two disagree at the points between and a read crossing the face jumps. Each probe on a brick's
 * boundary is set to what the coarsest brick touching that point holds there — as Unreal's volumetric lightmap
 * stitches its bricks. Bricks are settled coarsest first, so a span-2 face matching a span-4 brick is final before a
 * span-1 face reads it. A blend of a bilinear face sampled at finer points and blended again is the same face, so
 * after this a read is continuous across every face, edge and corner.
 *
 * `data` holds BRICK_PROBES probes a brick, `stride` numbers each (27 for the irradiance, 9 for sky visibility).
 */
export function stitchBricks(resolution: readonly [number, number, number], bricks: Int32Array, data: Float32Array,
                             stride: number): void {
    const count = bricks.length / 4;
    const cells = cellsFor(resolution);
    const owner = new Int32Array(cells[0] * cells[1] * cells[2]).fill(-1);
    for (let b = 0; b < count; b++) {
        const span = bricks[b * 4 + 3]!;
        for (let z = bricks[b * 4 + 2]!; z < Math.min(bricks[b * 4 + 2]! + span, cells[2]); z++) {
            for (let y = bricks[b * 4 + 1]!; y < Math.min(bricks[b * 4 + 1]! + span, cells[1]); y++) {
                for (let x = bricks[b * 4]!; x < Math.min(bricks[b * 4]! + span, cells[0]); x++) {
                    owner[x + cells[0] * (y + cells[1] * z)] = b;
                }
            }
        }
    }
    const order = Array.from({ length: count }, (_, b) => b).sort((p, q) => bricks[q * 4 + 3]! - bricks[p * 4 + 3]!);
    const side = BRICK_CELLS + 1;
    const value = new Float64Array(stride);
    const f = [0, 0, 0];
    for (const b of order) {
        const span = bricks[b * 4 + 3]!;
        for (let t = 0; t < BRICK_PROBES; t++) {
            const tx = t % side, ty = Math.floor(t / side) % side, tz = Math.floor(t / (side * side));
            if (tx !== 0 && tx !== BRICK_CELLS && ty !== 0 && ty !== BRICK_CELLS && tz !== 0 && tz !== BRICK_CELLS) continue;
            f[0] = bricks[b * 4]! * BRICK_CELLS + tx * span;
            f[1] = bricks[b * 4 + 1]! * BRICK_CELLS + ty * span;
            f[2] = bricks[b * 4 + 2]! * BRICK_CELLS + tz * span;
            // The coarsest brick among the cells this point touches (two along an axis it sits on a cell boundary of).
            let coarsest = b;
            for (let corner = 0; corner < 8; corner++) {
                const c = [0, 0, 0];
                let inside = true;
                for (let a = 0; a < 3; a++) {
                    const back = (corner >> a) & 1;
                    if (back && f[a]! % BRICK_CELLS !== 0) { inside = false; break; }
                    c[a] = Math.floor(f[a]! / BRICK_CELLS) - back;
                    if (c[a]! < 0 || c[a]! >= cells[a]!) { inside = false; break; }
                }
                if (!inside) continue;
                const o = owner[c[0]! + cells[0] * (c[1]! + cells[1] * c[2]!)]!;
                if (o >= 0 && bricks[o * 4 + 3]! > bricks[coarsest * 4 + 3]!) coarsest = o;
            }
            if (coarsest === b) continue;
            readBrick(bricks, data, stride, coarsest, f, value);
            const at = (b * BRICK_PROBES + t) * stride;
            for (let k = 0; k < stride; k++) data[at + k] = value[k]!;
        }
    }
}

/**
 * Nine RGB coefficients per probe, in grid order with x varying fastest.
 *
 * `atlas` is the solved light field indexed by texel — what a surface gives off,
 * before its own albedo. A ray that hits geometry with no place in the atlas
 * returns black rather than the sky: something is there, and it is unlit.
 *
 * With `skyVisibility` (nine floats per probe, zeroed), the sky is NOT gathered: a
 * ray that escapes adds to how much of the sky the probe sees instead, convolved
 * the same way, so the frame can light the probe with whatever sky it has then
 * (sky occlusion). What the sky gave the surfaces the probe sees, their bounce, is
 * still in the atlas and so still in the irradiance.
 */
export function solveProbes(grid: ProbeGrid, bvh: Bvh, lookup: HitLookup,
                            atlas: Float32Array, atlasSize: number, samples: number,
                            sky: SkyRadiance, skyVisibility?: Float32Array): Float32Array {
    const { positions } = planProbes({ ...grid, levels: 1 }, () => false);
    const out = new Float32Array((positions.length / 3) * 27);
    solveProbesAt(positions, 0, positions.length / 3, bvh, lookup, atlas, atlasSize, samples, sky, out, skyVisibility);
    return out;
}

/**
 * {@link solveProbes} for probes `from` to `to` of a position list (three floats each): nine RGB coefficients per
 * probe into `out` at its index. Each probe writes only its own entries, so any split of the list gives the same
 * answer; a probe's rays are numbered by its index, as the dense grid's always were.
 */
export function solveProbesAt(positions: Float64Array, from: number, to: number, bvh: Bvh, lookup: HitLookup,
                              atlas: Float32Array, atlasSize: number, samples: number,
                              sky: SkyRadiance, out: Float32Array, skyVisibility?: Float32Array | null): void {
    if (to <= from) return;
    const dirs = sphere(samples);
    const basis = new Float32Array(9);
    const seen = new Float32Array(3);
    // The Monte-Carlo weight of one direction over the sphere, folded in once.
    const weight = (4 * Math.PI) / samples;

    for (let p = from; p < to; p++) {
        const px = positions[p * 3]!, py = positions[p * 3 + 1]!, pz = positions[p * 3 + 2]!;
        const at = p * 27;
        const vAt = p * 9;
        for (let i = 0; i < 27; i++) out[at + i] = 0;
        if (skyVisibility) for (let i = 0; i < 9; i++) skyVisibility[vAt + i] = 0;
        for (let s = 0; s < samples; s++) {
            const dx = dirs[s * 3]!, dy = dirs[s * 3 + 1]!, dz = dirs[s * 3 + 2]!;
            shBasis(dx, dy, dz, basis);
            if (!rayRadiance(bvh, lookup, atlas, atlasSize, px, py, pz, dx, dy, dz,
                             seen, 0, at * samples + s)) {
                if (skyVisibility) {
                    for (let i = 0; i < 9; i++) skyVisibility[vAt + i]! += basis[i]! * weight;
                    continue;
                }
                sky(dx, dy, dz, seen, 0);
            }
            const r = seen[0]!, g = seen[1]!, b = seen[2]!;
            for (let i = 0; i < 9; i++) {
                const w = basis[i]! * weight;
                out[at + i * 3]! += r * w;
                out[at + i * 3 + 1]! += g * w;
                out[at + i * 3 + 2]! += b * w;
            }
        }
        convolveCosine(out, at);
        if (skyVisibility) convolveCosineScalar(skyVisibility, vAt);
    }
}
