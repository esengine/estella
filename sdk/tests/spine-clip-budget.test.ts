// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-clip-budget.test.ts
 * @brief   The budget charges what the engine actually does, not what the
 *          algorithm would have done.
 *
 * @details A diagnostic that says "339 triangles against 13 edges" about a
 *          skeleton whose every triangle is rejected on bounds is worse than no
 *          diagnostic: it sends whoever authored the mask after a cost that no
 *          longer exists. So the charge is taken AFTER the fast paths, and the
 *          triangles they answered are reported separately.
 *
 *          Everything here is dimensionless. The nanoseconds behind the model
 *          were measured on one machine with one compiler; the quantities are
 *          the asset's and they outlive both.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WASM_DIR, hasSideModule } from './helpers/loadWasm';
import { wrapSpineModule } from '../src/spine/SpineModuleLoader';
import { SpineModuleController } from '../src/spine/SpineController';
import type { SpineWasmModule } from '../src/spine/SpineModuleLoader';
import type { SpineClipBudget } from '../src/spine/spineMetrics';
import { syntheticSkeleton } from './helpers/syntheticSpine';
import type { SyntheticOptions } from './helpers/syntheticSpine';

const SPINE38_JS = resolve(WASM_DIR, 'spine38.js');
const SPINE38_WASM = resolve(WASM_DIR, 'spine38.wasm');
const FIXTURES = resolve(__dirname, '../benchmarks/fixtures/spine');
const HAS_WASM = hasSideModule('spine38');
const QUADS = 16;

let raw: SpineWasmModule;
let controller: SpineModuleController;

beforeAll(async () => {
    if (!HAS_WASM) return;
    const factory = (await import(SPINE38_JS)).default as (opts: unknown) => Promise<SpineWasmModule>;
    const bytes = readFileSync(SPINE38_WASM);
    raw = await factory({
        instantiateWasm(imports: WebAssembly.Imports, cb: (i: WebAssembly.Instance, m: WebAssembly.Module) => void) {
            void WebAssembly.instantiate(bytes, imports).then((r) => cb(r.instance, r.module));
            return {};
        },
    });
    controller = new SpineModuleController(raw, wrapSpineModule(raw));
});

function budgetOf(options: SyntheticOptions): SpineClipBudget {
    const { json, atlas } = syntheticSkeleton(options);
    const handle = controller.loadSkeleton(new TextEncoder().encode(json), atlas, false);
    if (handle < 0) throw new Error(controller.getLastError());
    controller.setAtlasPageTexture(handle, 0, 1, 64, 64);
    const instanceId = controller.createInstance(handle);
    controller.update(instanceId, 0);
    const budget = controller.clipBudget(instanceId);
    if (!budget) throw new Error('the runtime reported no budget');
    return budget;
}

function budgetOfAsset(skel: string, atlas: string, animation: string, dt: number): SpineClipBudget {
    const handle = controller.loadSkeleton(
        new Uint8Array(readFileSync(resolve(FIXTURES, skel))),
        readFileSync(resolve(FIXTURES, atlas), 'utf-8'), true);
    if (handle < 0) throw new Error(controller.getLastError());
    for (let i = 0, pages = controller.getAtlasPageCount(handle); i < pages; i++) {
        controller.setAtlasPageTexture(handle, i, 1, 2048, 2048);
    }
    const instanceId = controller.createInstance(handle);
    expect(controller.play(instanceId, animation, true)).toBe(true);
    controller.update(instanceId, dt);
    const budget = controller.clipBudget(instanceId);
    if (!budget) throw new Error('the runtime reported no budget');
    return budget;
}

describe.skipIf(!HAS_WASM)('the clip budget charges what is still being paid', () => {
    it('a skeleton the fast paths answered is charged nothing', () => {
        // spineboy's portal region has the whole body outside it, so every
        // candidate is rejected on bounds. A budget quoting 339 triangles here
        // would send an artist after a cost the engine stopped paying.
        const budget = budgetOfAsset('spineboy-38/spineboy-pro.skel', 'spineboy-38/spineboy.atlas', 'portal', 0.3);
        expect(budget.candidateTriangles).toBeGreaterThan(100);
        expect(budget.rejectedTriangles).toBe(budget.candidateTriangles);
        expect(budget.chargedTriangles).toBe(0);
        expect(budget.edgeWork, 'work was charged for triangles nothing ran on').toBe(0);
    });

    it('asking costs the instance nothing — it is a diagnosis, not a step', () => {
        // The inspector reads this off the LIVE entity somebody is looking at.
        // A counted walk that advanced the clock, or left the clipper's state
        // behind, would make the panel change the thing it is describing.
        const handle = controller.loadSkeleton(
            new Uint8Array(readFileSync(resolve(FIXTURES, 'coin-38/coin-pro.skel'))),
            readFileSync(resolve(FIXTURES, 'coin-38/coin.atlas'), 'utf-8'), true);
        for (let i = 0, pages = controller.getAtlasPageCount(handle); i < pages; i++) {
            controller.setAtlasPageTexture(handle, i, 1, 2048, 2048);
        }
        const instanceId = controller.createInstance(handle);
        controller.play(instanceId, 'animation', true);
        controller.update(instanceId, 0.35);

        const before = controller.getBounds(instanceId);
        const first = controller.clipBudget(instanceId)!;
        const second = controller.clipBudget(instanceId)!;
        const after = controller.getBounds(instanceId);

        expect(second, 'a second scan of an unmoved pose disagreed with the first')
            .toEqual(first);
        expect(after, 'the scan moved the pose it was measuring').toEqual(before);
        controller.destroyInstance(instanceId);
        controller.unloadSkeleton(handle);
    });

    it('a skeleton that really crosses is charged for all of it', () => {
        const budget = budgetOfAsset('coin-38/coin-pro.skel', 'coin-38/coin.atlas', 'animation', 0.35);
        expect(budget.rejectedTriangles + budget.bypassedTriangles + budget.chargedTriangles)
            .toBe(budget.candidateTriangles);
        expect(budget.chargedTriangles).toBeGreaterThan(0);
        expect(budget.edgeWork).toBe(budget.chargedTriangles * budget.effectiveEdges);
    });

    it('the same authored vertex count can cost two different edge counts', () => {
        // What the diagnostic has to explain: sixteen points drawn, forty-one
        // edges paid. Concavity is not a tax of its own — it is this expansion.
        const convex = budgetOf({ quads: QUADS, relation: 'all-crossing', polygonVertices: 16 });
        const concave = budgetOf({ quads: QUADS, relation: 'all-crossing', polygonVertices: 16, concave: true });

        expect(convex.rawVertices).toBe(concave.rawVertices);
        expect(convex.pieces).toBe(1);
        expect(concave.pieces).toBeGreaterThan(1);
        expect(concave.effectiveEdges / concave.rawVertices)
            .toBeGreaterThan(convex.effectiveEdges / convex.rawVertices);
        expect(concave.edgeWork).toBeGreaterThan(convex.edgeWork);
    });

    it('what the cut hands on is reported as its own fact', () => {
        const budget = budgetOf({ quads: QUADS, relation: 'all-crossing' });
        expect(budget.inputVertices).toBe((QUADS + 1) * 2);
        expect(budget.outputVertices).toBeGreaterThan(budget.inputVertices);
        expect(budget.vertexAmplification).toBeCloseTo(budget.outputVertices / budget.inputVertices, 6);
        expect(budget.triangleAmplification).toBeCloseTo(budget.outputTriangles / budget.chargedTriangles, 6);
    });

    it('simplifying the polygon always reads as cheaper', () => {
        // The trap a budget built on output would fall into: cutting against a
        // simpler shape can hand back MORE geometry, and the artist who did the
        // right thing would be told they made it worse.
        const work = [4, 8, 16].map((polygonVertices) =>
            budgetOf({ quads: QUADS, relation: 'all-crossing', polygonVertices }));
        for (let i = 1; i < work.length; i++) {
            expect(work[i].rawVertices).toBeGreaterThan(work[i - 1].rawVertices);
            expect(work[i].effectiveEdges).toBeGreaterThan(work[i - 1].effectiveEdges);
            expect(work[i].edgeWork, 'a simpler polygon was charged more')
                .toBeGreaterThan(work[i - 1].edgeWork);
        }
    });
});
