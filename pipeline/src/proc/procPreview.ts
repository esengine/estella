// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  procPreview.ts — what a rules graph editor shows of a graph as it stands: one node's output (or the whole
 *        graph's) drawn from above, with what each node made. Pure and DOM-free, so the editor runs it in a worker and a
 *        test runs it in place; the land comes in as its baked heights (a {@link ProcLandField}), not as a file to read.
 */
import { ProcCache, runProc, type ProcProbe } from './procEval';
import { renderProcItems } from './procView';
import { ProcBuildError, validateProcSource } from './procSource';

/** A land's baked heights, as a worker is handed them once: `n` by `n` world heights, row by row from the least z. */
export interface ProcLandField {
    /** Names this bake (the land's path and its source), so a cache knows when the ground changed. */
    key: string;
    n: number;
    size: [number, number];
    center: [number, number];
    heights: Float32Array;
}

/** The ground's height in world units at a place in world units, read from @p field (bilinear, held at the edge). */
export function sampleLandField(field: ProcLandField): (x: number, z: number) => number {
    const { n, heights } = field;
    const [sx, sz] = field.size, [cx, cz] = field.center;
    return (x, z) => {
        const fx = Math.min(Math.max(((x - cx) / sx + 0.5) * (n - 1), 0), n - 1);
        const fz = Math.min(Math.max(((z - cz) / sz + 0.5) * (n - 1), 0), n - 1);
        const x0 = Math.min(Math.floor(fx), n - 2), z0 = Math.min(Math.floor(fz), n - 2);
        const tx = fx - x0, tz = fz - z0;
        const at = (i: number, j: number): number => heights[j * n + i]!;
        const top = at(x0, z0) * (1 - tx) + at(x0 + 1, z0) * tx, bottom = at(x0, z0 + 1) * (1 - tx) + at(x0 + 1, z0 + 1) * tx;
        return top * (1 - tz) + bottom * tz;
    };
}

export interface ProcPreviewRequest {
    /** The graph as the editor holds it, saved or not. */
    source: unknown;
    /** The node to draw (a top-level id, or a node inside a component); null draws the whole output. */
    probe: ProcProbe | null;
    /** Pixels along the longer side of the picture. */
    size: number;
}

export type ProcPreviewAnswer =
    | {
        ok: true; width: number; height: number; rgba: Uint8Array; plots: number; parts: number; ms: number;
        warnings: string[]; counts: Record<string, { plots: number; parts: number }>;
        /** A probe inside a component: how many plots ran it (the picture is the first). */
        probeUses?: number;
        /** How many top-level nodes ran, and how many were kept from the last run. */
        cache?: { ran: number; reused: number };
    }
    | { ok: false; error: string; node: string | null; fault?: string };

/**
 * Runs @p request against @p land (when the graph names one) through @p cache, and draws what it asked for. A graph that
 * does not run answers why, and which node; a fault under the graph is thrown, so it reaches a log whole.
 */
export function previewProcSource(request: ProcPreviewRequest, land: ProcLandField | null, cache: ProcCache): ProcPreviewAnswer {
    let source;
    try {
        source = validateProcSource(JSON.parse(JSON.stringify(request.source)));
    } catch (e) {
        if (e instanceof ProcBuildError) return { ok: false, error: e.message, node: e.node };
        throw e;
    }
    const unit = source.unit ?? 1;
    let ground: ((x: number, z: number) => number) | undefined;
    if (source.land) {
        if (!land) return { ok: false, error: `the land ${source.land} is not read yet`, node: null };
        const world = sampleLandField(land);
        ground = (x, z) => world(x * unit, z * unit) / unit;
    }
    const t0 = performance.now();
    let result;
    try {
        result = runProc(source, { ground, groundKey: land ? `${land.key}|${unit}` : '' }, { probe: request.probe, cache });
    } catch (e) {
        if (!(e instanceof ProcBuildError)) throw e;
        // A mistake in the graph (a sum, a size, a missing component) is the author's to read. A fault under the graph (a
        // TypeError and its kin) comes along with its stack, for a log.
        let root: unknown = e;
        while (root instanceof Error && root.cause) root = root.cause;
        const fault = root instanceof Error && !(root instanceof ProcBuildError) && root.name !== 'Error' ? root.stack ?? String(root) : undefined;
        return { ok: false, error: e.message, node: e.node, ...(fault ? { fault } : {}) };
    }
    const ms = Math.round(performance.now() - t0);
    const items = request.probe ? result.probe ?? [] : result.groups.flatMap((g) => g.parts);
    const plan = renderProcItems(items, { size: request.size });
    const counts: Record<string, { plots: number; parts: number }> = {};
    for (const n of result.report.nodes) counts[n.id] = { plots: n.plots, parts: n.parts };
    const plots = items.filter((it) => it.kind === 'plot').length;
    return {
        ok: true, width: plan.width, height: plan.height, rgba: plan.rgba, plots, parts: items.length - plots, ms,
        warnings: result.report.warnings, counts,
        ...(result.probeUses !== undefined ? { probeUses: result.probeUses } : {}),
        ...(result.cache ? { cache: result.cache } : {}),
    };
}
