// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Readying the mesh programs a decoded scene document requires.
 *
 * The document is the only source available at preparation: a cell is prepared
 * precisely when it has no entities, so the requirements have to come from what
 * it says rather than from what it spawned.
 */
import type { SceneData } from '../scene/scene';
import type { ESEngineModule } from '../wasm';
import { withScratch } from '../wasm/wasmScratch';
import type { RenderReadiness } from './renderReadiness';

/** Words per renderable in, and words of readiness result out. */
const ROW_WORDS = 5;
const RESULT_WORDS = 11;

interface DocEntity {
    components?: Array<{ type: string; data: Record<string, unknown> }>;
}

/**
 * The five words per renderable the engine reads: mesh handle, lit, normal-map
 * handle, joint count, material id.
 *
 * Asset references must already be resolved to handles: a path string here
 * reads as handle 0 and describes a requirement nothing has.
 */
export function meshDocumentRows(doc: SceneData): number[] {
    const rows: number[] = [];
    for (const entity of doc.entities as DocEntity[]) {
        const parts = entity.components;
        const renderer = parts?.find((c) => c.type === 'MeshRenderer');
        if (!renderer) continue;
        const skin = parts?.find((c) => c.type === 'MeshSkin');
        rows.push(
            Number(renderer.data.mesh) || 0,
            renderer.data.lit ? 1 : 0,
            Number(renderer.data.normalMap) || 0,
            (skin?.data.joints as unknown[] | undefined)?.length ?? 0,
            Number(renderer.data.material) || 0,
        );
    }
    return rows;
}

/**
 * Make the mesh programs `doc` requires ready, and answer with the claim.
 *
 * Not applicable where the engine does not carry the entry: a headless host owes
 * nothing rather than being handed an invented claim. A null stamp is a debt —
 * something moved underneath the readying, and it can be attempted again.
 */
export function readyMeshPrograms(module: ESEngineModule | null,
                                  doc: SceneData): RenderReadiness {
    if (!module?.engine_prepareMeshPrograms) return { applicable: false };
    const rows = meshDocumentRows(doc);
    // Nothing to draw is still an answer: the claim covers an empty requirement
    // set, so a cell of pure logic is prepared rather than perpetually owing.
    const m = module as unknown as {
        _malloc(n: number): number; _free(p: number): void; HEAPU32: Uint32Array;
        engine_prepareMeshPrograms(rowsPtr: number, count: number, outPtr: number): void;
    };
    return withScratch(module, (alloc) => {
        const rowsPtr = alloc(Math.max(rows.length, 1) * 4);
        const outPtr = alloc(RESULT_WORDS * 4);
        if (rows.length > 0) m.HEAPU32.set(rows, rowsPtr >> 2);
        m.engine_prepareMeshPrograms(rowsPtr, rows.length / ROW_WORDS, outPtr);
        const o = m.HEAPU32.subarray(outPtr >> 2, (outPtr >> 2) + RESULT_WORDS);
        if (o[0] !== 1) return { applicable: true, stamp: null };
        return {
            applicable: true,
            stamp: {
                digestLo: o[5], digestHi: o[6],
                programEpoch: o[7] + o[8] * 0x100000000,
            },
        };
    });
}
