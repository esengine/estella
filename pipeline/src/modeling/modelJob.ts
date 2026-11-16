// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  modelJob.ts — one bake of a model source for a host that must not wait on it: asked for as plain data,
 *        answered as plain data, so it can run on a thread of its own.
 *
 *        Node only: the texels of a normalBake are spread over the cores, as `bake-model` spreads them.
 */
import { ModelBuildError, validateModelSource } from './modelSource';
import { needsPreparing, prepareModeling } from './booleans';
import { bakeModel, type BakedModel, type ModelReport } from './modelBake';
import { renderRigSheet, type ModelSheet, type RigViewOptions } from './modelViews';
import { modelProductsOf, type ModelProducts } from './modelProducts';
import { startNormalBake, type NormalMap } from './normalBake';
import { openProbeCache } from './probeCache';
import { runBakeAcross, shadeAcross } from './probeWorkers';

export type ModelJob =
    /** Everything a writer puts on disk. `cacheDir` keeps what a normalBake probed, under `stem`, for the next bake of the same surface. */
    | { kind: 'bake'; source: unknown; jobs?: number; cacheDir?: string; stem?: string }
    | { kind: 'report'; source: unknown }
    | { kind: 'views'; source: unknown; options?: RigViewOptions };

export type ModelJobReply =
    | { ok: true; products?: ModelProducts; report?: ModelReport; sheet?: ModelSheet }
    /**
     * `step` is the index of the step that failed, when one did. `unavailable` says the bake never ran: what it runs on
     * could not be loaded where this was asked, which is the host's trouble and not the model's.
     */
    | { ok: false; error: string; step?: number | null; stepId?: string | null; op?: string | null; unavailable?: true };

async function normalOf(baked: BakedModel, job: Extract<ModelJob, { kind: 'bake' }>): Promise<NormalMap | null> {
    if (!baked.detail) return null;
    const jobs = Math.max(1, job.jobs ?? 1);
    const start = startNormalBake(baked);
    await shadeAcross(start, jobs);
    const plan = start.plan();
    const cache = job.cacheDir && job.stem ? openProbeCache(job.cacheDir, job.stem, baked.detail.size, plan.probes) : null;
    await runBakeAcross(plan, jobs);
    cache?.save();
    return plan.finish();
}

export async function runModelJob(job: ModelJob): Promise<ModelJobReply> {
    try {
        const source = validateModelSource(job.source);
        if (needsPreparing(source.steps)) {
            try {
                await prepareModeling();
            } catch (e) {
                return { ok: false, error: e instanceof Error ? e.message : String(e), unavailable: true };
            }
        }
        const baked = bakeModel(source);
        if (job.kind === 'report') return { ok: true, report: baked.report };
        if (job.kind === 'views') {
            // A fractured model is looked at as its pieces.
            const shown = baked.cut ? { ...baked, poly: baked.cut.poly, triangles: baked.cut.triangles } : baked;
            return { ok: true, sheet: renderRigSheet(shown, source.animations ?? [], job.options ?? {}) };
        }
        return { ok: true, products: modelProductsOf(baked, await normalOf(baked, job)) };
    } catch (e) {
        if (e instanceof ModelBuildError) return { ok: false, error: e.message, step: e.stepIndex, stepId: e.stepId, op: e.op };
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}
