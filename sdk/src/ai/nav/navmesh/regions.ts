// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    regions.ts
 * @brief   Cut the walkable spans into regions — connected patches that a single
 *          simple outline can describe.
 *
 * Monotone partitioning: sweep the field row by row, and let a run of spans keep
 * the region of the run behind it whenever the two line up one to one. What comes
 * out is a set of patches with NO HOLES, which is what lets the contour tracer
 * that follows be one walk around one boundary. Recast's other partitioners give
 * rounder patches and can produce a region with an island inside it, which then
 * needs a whole second stage to stitch back up; this pipeline buys robustness
 * with the shape of its polygons, and `cellSize` is the knob that matters more.
 */

import { NAV_AREA_NULL } from './heightfield';
import type { NavCompactField } from './compact';

/** A sweep that touched more than one region behind it, so it can inherit none. */
const AMBIGUOUS = -1;

interface Sweep {
    /** Region behind this run, or {@link AMBIGUOUS} when there was more than one. */
    nei: number;
    /** How many of this run's spans touch `nei`. */
    ns: number;
    /** Final region id, decided at the end of the row. */
    id: number;
}

/**
 * Fill `chf.regs` and return how many region ids were handed out; 0 means "no
 * region", which is what an unwalkable span keeps. `minRegionArea` is in spans: a
 * patch smaller than that and reachable from nowhere else is an artefact of the
 * voxel grid, and a polygon for it is a destination nobody can walk to.
 */
export function buildRegionsMonotone(chf: NavCompactField, minRegionArea: number): number {
    const { width: w, depth: d } = chf;
    const regs = chf.regs;
    regs.fill(0);

    let nextId = 1;
    const sweeps: Sweep[] = [];
    const prev = new Map<number, number>();

    for (let z = 0; z < d; z++) {
        prev.clear();
        let rid = 1;
        for (let x = 0; x < w; x++) {
            const c = x + z * w;
            const start = chf.cellIndex[c]!;
            const end = start + chf.cellCount[c]!;
            for (let i = start; i < end; i++) {
                if (chf.areas[i] === NAV_AREA_NULL) continue;

                // Behind on this row: the run continues if it can.
                let sweepId = 0;
                const back = chf.neighbourSpan(x, z, i, 0);
                if (back >= 0 && chf.areas[back] === chf.areas[i] && regs[back]! > 0) {
                    sweepId = regs[back]!;
                }
                if (sweepId === 0) {
                    sweepId = rid++;
                    sweeps[sweepId] = { nei: 0, ns: 0, id: 0 };
                }

                // Behind on the previous row: which region this run may inherit.
                const under = chf.neighbourSpan(x, z, i, 3);
                if (under >= 0 && regs[under]! > 0 && chf.areas[under] === chf.areas[i]) {
                    const nr = regs[under]!;
                    const sweep = sweeps[sweepId]!;
                    if (sweep.nei === 0 || sweep.nei === nr) {
                        sweep.nei = nr;
                        sweep.ns++;
                        prev.set(nr, (prev.get(nr) ?? 0) + 1);
                    } else {
                        sweep.nei = AMBIGUOUS;
                    }
                }

                regs[i] = sweepId;
            }
        }

        // A run inherits only when it covers the whole of the run behind it —
        // otherwise the two would become one region shaped like a Y, which is
        // exactly the hole-prone shape this partitioner exists to avoid.
        for (let i = 1; i < rid; i++) {
            const sweep = sweeps[i]!;
            sweep.id = sweep.nei > 0 && prev.get(sweep.nei) === sweep.ns ? sweep.nei : nextId++;
        }

        for (let x = 0; x < w; x++) {
            const c = x + z * w;
            const start = chf.cellIndex[c]!;
            const end = start + chf.cellCount[c]!;
            for (let i = start; i < end; i++) {
                const r = regs[i]!;
                if (r > 0 && r < rid) regs[i] = sweeps[r]!.id;
            }
        }
    }

    removeSmallRegions(chf, nextId, minRegionArea);
    return nextId;
}

/**
 * Drop patches of walkable ground that are too small to be worth a polygon AND
 * reachable from nowhere else. Size is judged over the whole connected group of
 * regions, not one at a time: a big room cut into six regions by the sweep is
 * not six small islands.
 */
function removeSmallRegions(chf: NavCompactField, regionCount: number, minRegionArea: number): void {
    if (minRegionArea <= 0) return;
    const { width: w, depth: d } = chf;
    const spanCount = new Int32Array(regionCount);
    const linked: Set<number>[] = Array.from({ length: regionCount }, () => new Set<number>());

    for (let z = 0; z < d; z++) {
        for (let x = 0; x < w; x++) {
            const c = x + z * w;
            const start = chf.cellIndex[c]!;
            const end = start + chf.cellCount[c]!;
            for (let i = start; i < end; i++) {
                const r = chf.regs[i]!;
                if (r === 0) continue;
                spanCount[r]!++;
                for (let dir = 0; dir < 4; dir++) {
                    const ni = chf.neighbourSpan(x, z, i, dir);
                    if (ni < 0) continue;
                    const nr = chf.regs[ni]!;
                    if (nr !== 0 && nr !== r) linked[r]!.add(nr);
                }
            }
        }
    }

    const visited = new Uint8Array(regionCount);
    const doomed = new Set<number>();
    for (let r = 1; r < regionCount; r++) {
        if (visited[r] || spanCount[r] === 0) continue;
        const group: number[] = [];
        const stack = [r];
        visited[r] = 1;
        let total = 0;
        while (stack.length) {
            const cur = stack.pop()!;
            group.push(cur);
            total += spanCount[cur]!;
            for (const nr of linked[cur]!) {
                if (visited[nr]) continue;
                visited[nr] = 1;
                stack.push(nr);
            }
        }
        if (total < minRegionArea) for (const g of group) doomed.add(g);
    }

    if (doomed.size === 0) return;
    for (let i = 0; i < chf.spanCount; i++) {
        if (doomed.has(chf.regs[i]!)) chf.regs[i] = 0;
    }
}
