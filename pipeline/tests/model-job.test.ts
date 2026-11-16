// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { decodeMesh } from 'esengine';
import { bakeModel, bakeNormalMap, prepareModeling, type ModelStep } from '../src/modeling';
import { runModelJob } from '../src/modeling/modelJob';
import { modelProductsOf } from '../src/modeling/modelProducts';

const scratch = mkdtempSync(path.join(tmpdir(), 'estella-model-job-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

const slab: ModelStep = { id: 'slab', op: 'box', size: [4, 0.4, 4], color: [0, 0, 1], tag: 'slab' };
const plates: ModelStep = { id: 'dense', op: 'panels', faces: '+y', size: 1.3, gap: 0.16, height: 0.12, seed: 3, tag: 'plate' };
const thin: ModelStep = { op: 'decimate', from: 'slab', ratio: 1 };
const baked = { version: 1, normalBake: { from: 'dense', size: 128, color: true, occlusion: { size: 64, samples: 9 } }, steps: [slab, plates, thin] };

describe('a model job', () => {
    it('answers a bake with the files a writer writes, the same as a bake in the caller\'s own thread', async () => {
        const reply = await runModelJob({ kind: 'bake', source: baked, jobs: 4, cacheDir: scratch, stem: 'slab' });
        if (!reply.ok) throw new Error(reply.error);
        // Prepared by the job itself: its source has a decimate, and nothing here loaded what that runs on.
        await prepareModeling();
        const here = bakeModel(baked as never);
        const want = modelProductsOf(here, bakeNormalMap(here));
        const got = reply.products!;
        expect(got.mesh).toEqual(want.mesh);
        expect(decodeMesh(got.mesh).vertexCount).toBe(got.report.vertices);
        expect(got.normal!.rgba).toEqual(want.normal!.rgba);
        expect(got.normal!.colorRgba).toEqual(want.normal!.colorRgba);
        expect(got.normal!.occlusion!.rgba).toEqual(want.normal!.occlusion!.rgba);
        expect(got.report).toEqual(want.report);
        expect(got.report.normalBake).toBeDefined();
        expect(readdirSync(scratch).some((file) => file.startsWith('slab.128.'))).toBe(true);
    });

    it('crosses a thread: what it answers is numbers and bytes, with nothing a copy would drop', async () => {
        const reply = await runModelJob({ kind: 'bake', source: { version: 1, rig: { joints: [{ name: 'root', at: [0, 0, 0] }, { name: 'tip', parent: 'root', at: [0, 1, 0] }] }, steps: [{ op: 'box', size: [0.4, 1, 0.4], at: [0, 0.5, 0] }] } });
        if (!reply.ok) throw new Error(reply.error);
        expect(structuredClone(reply)).toEqual(reply);
        expect(reply.products!.rig!.joints.map((j) => j.name)).toEqual(['root', 'tip']);
    });

    it('names the step that failed, as the bake does', async () => {
        const reply = await runModelJob({ kind: 'report', source: { version: 1, steps: [slab, { id: 'cut', op: 'extrude', faces: 'nothing-has-this-tag', distance: 1 }] } });
        expect(reply).toMatchObject({ ok: false, step: 1, stepId: 'cut', op: 'extrude' });
    });

    it('answers a report without baking a map, and views with a picture', async () => {
        const report = await runModelJob({ kind: 'report', source: baked });
        expect(report).toMatchObject({ ok: true });
        expect(report.ok && report.report!.normalBake).toBeUndefined();
        expect(report.ok && report.products).toBeUndefined();
        const views = await runModelJob({ kind: 'views', source: baked, options: { panel: 64, views: ['front'] } });
        if (!views.ok) throw new Error(views.error);
        expect(views.sheet!.rgba.length).toBe(views.sheet!.width * views.sheet!.height * 4);
    });
});
