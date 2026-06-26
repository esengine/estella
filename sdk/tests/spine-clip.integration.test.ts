// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-clip.integration.test.ts
 * @brief   S2 gate: proves the spine side module clips a clipping attachment
 *          correctly (the SkeletonClipping port). Drives the spine42 module
 *          directly (no World, no GL) over a real 4.2 asset that uses a
 *          clipping attachment (tank), and asserts the clip actually reduces
 *          geometry to within the unclipped extent.
 *
 *          Why no native comparison: post-S1 a configured provider routes 4.2
 *          to THIS side module (webAppFactory.ts), so the side module IS the
 *          production 4.2 renderer — native 4.2 is GL-coupled and no longer the
 *          shipping path. The port wires spine's own spSkeletonClipping, so the
 *          correctness statement is the clip invariant, not native parity.
 *
 *          RED before the S2 port (side module skips clipping at
 *          SpineModuleEntry.cpp:556, and spine_setClippingEnabled does not
 *          exist) -> GREEN after. Requires the built spine42 module + the
 *          spine-runtimes-4.2 tank asset; skips otherwise.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WASM_DIR } from './helpers/loadWasm';
import { wrapSpineModule, type SpineWasmModule } from '../src/spine/SpineModuleLoader';
import { SpineModuleController } from '../src/spine/SpineController';

const SPINE42_JS = resolve(WASM_DIR, 'spine42.js');
const SPINE42_WASM = resolve(WASM_DIR, 'spine42.wasm');
const ASSET_DIR = resolve(__dirname, '../../third_party/spine-runtimes-4.2/examples/tank/export');
const SKEL = resolve(ASSET_DIR, 'tank-pro.skel');
const ATLAS = resolve(ASSET_DIR, 'tank.atlas');
const HAS_ASSETS = existsSync(SPINE42_WASM) && existsSync(SKEL) && existsSync(ATLAS);

interface Mesh { verts: number[]; tris: number; batches: number; }

function bbox(verts: number[]): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < verts.length; i += 2) {
        const x = verts[i], y = verts[i + 1];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return { minX, minY, maxX, maxY };
}

describe.skipIf(!HAS_ASSETS)('Spine 4.2 side module clips a clipping attachment (S2)', () => {
    let raw: SpineWasmModule;
    let controller: SpineModuleController;

    beforeAll(async () => {
        const wasmBinary = readFileSync(SPINE42_WASM);
        const factory = (await import(SPINE42_JS)).default as (a: { wasmBinary: Uint8Array }) => Promise<SpineWasmModule>;
        raw = await factory({ wasmBinary });
        controller = new SpineModuleController(raw, wrapSpineModule(raw));
    });

    /** Load tank, supply stub page textures (real dims from .atlas, fake glId so
     *  getMeshTextureId != 0 and attachments emit), pose, and extract the mesh. */
    function extractTankMesh(clippingEnabled: boolean): Mesh {
        const skel = new Uint8Array(readFileSync(SKEL));
        const atlasText = readFileSync(ATLAS, 'utf8');
        const handle = controller.loadSkeleton(skel, atlasText, true);
        expect(handle).toBeGreaterThan(0);

        const sizeMatch = atlasText.match(/size:\s*(\d+)\s*,\s*(\d+)/);
        const pw = sizeMatch ? Number(sizeMatch[1]) : 1024;
        const ph = sizeMatch ? Number(sizeMatch[2]) : 1024;
        const pageCount = controller.getAtlasPageCount(handle);
        for (let p = 0; p < pageCount; p++) {
            controller.setAtlasPageTexture(handle, p, /*fake glId*/ 1, pw, ph);
        }

        // Clip toggle via cwrap (the module's calling convention) — absent
        // pre-S2 so cwrap returns a no-op stub then (RED).
        const setClip = raw.cwrap('spine_setClippingEnabled', null, ['number']) as (v: number) => void;
        setClip(clippingEnabled ? 1 : 0);

        const instance = controller.createInstance(handle);
        expect(instance).toBeGreaterThan(0);
        controller.update(instance, 0); // pose at setup
        // tank-glow has no setup attachment and 'drive' never sets one, so attach
        // smoke-glow explicitly: it's the slot the clip region (clipping->tank-glow)
        // is meant to mask, and its raw geometry spills past the tank-body polygon.
        controller.setAttachment(instance, 'tank-glow', 'smoke-glow');

        const verts: number[] = [];
        let tris = 0, batches = 0;
        controller.forEachMeshBatch(instance, (vertBytes, _idxBytes, vertexCount, indexCount) => {
            batches++;
            tris += indexCount / 3;
            const f32 = new Float32Array(vertBytes.buffer, vertBytes.byteOffset, vertexCount * 8);
            for (let v = 0; v < vertexCount; v++) {
                verts.push(f32[v * 8], f32[v * 8 + 1]); // x, y
            }
        });

        controller.destroyInstance(instance);
        controller.unloadSkeleton(handle);
        return { verts, tris, batches };
    }

    it('loads tank-4.2 and emits a non-empty mesh headlessly', () => {
        const m = extractTankMesh(true);
        expect(m.batches).toBeGreaterThan(0);
        expect(m.verts.length).toBeGreaterThan(0);
    });

    it('clips the smoke-glow to within the tank-body clip polygon', () => {
        const clipped = extractTankMesh(true);
        const unclipped = extractTankMesh(false);

        // The clip must actually change the mesh (Sutherland-Hodgman re-triangulates
        // at the polygon boundary), proving the clip region was applied, not skipped.
        const changed = clipped.tris !== unclipped.tris || clipped.verts.length !== unclipped.verts.length;
        expect(changed).toBe(true);

        // Clipping never expands geometry: clipped verts are original-or-edge
        // intersection points, so the clipped bbox stays within the unclipped one.
        const u = bbox(unclipped.verts);
        const c = bbox(clipped.verts);
        const eps = 1e-3;
        expect(c.minX).toBeGreaterThanOrEqual(u.minX - eps);
        expect(c.minY).toBeGreaterThanOrEqual(u.minY - eps);
        expect(c.maxX).toBeLessThanOrEqual(u.maxX + eps);
        expect(c.maxY).toBeLessThanOrEqual(u.maxY + eps);

        // And it must strictly reduce the extent somewhere — the smoke-glow spilled
        // past the polygon and got cut back (else the clip would be a no-op).
        const area = (x: ReturnType<typeof bbox>) => (x.maxX - x.minX) * (x.maxY - x.minY);
        expect(area(c)).toBeLessThan(area(u));
    });
});
