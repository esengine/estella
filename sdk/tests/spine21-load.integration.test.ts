// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine21-load.integration.test.ts
 * @brief   The 2.1 side module, driven against exports of that era.
 *
 * @details 2.1 is the far end of the runtime seam: colour is four loose floats, a
 *          weighted mesh is its own attachment type, and triangle indices are `int`
 *          where the engine's buffers are 16-bit. Those are the three places a
 *          plausible-looking backend goes wrong silently, so they are what this
 *          drives — with the runtime's own spineboy (regions) and goblins (meshes,
 *          including a weighted one).
 *
 *          Requires the built spine21 module (node build-tools/cli.js build -t
 *          spine21) and the spine-runtimes-2.1 submodule; skips otherwise.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WASM_DIR } from './helpers/loadWasm';
import { wrapSpineModule, type SpineWasmModule } from '../src/spine/SpineModuleLoader';
import { SpineModuleController } from '../src/spine/SpineController';

const SPINE21_JS = resolve(WASM_DIR, 'spine21.js');
const SPINE21_WASM = resolve(WASM_DIR, 'spine21.wasm');
const ROOT = resolve(__dirname, '../../third_party/spine-runtimes-2.1');
const BOY_JSON = resolve(ROOT, 'spine-c/data/spineboy.json');
const BOY_ATLAS = resolve(ROOT, 'spine-c/data/spineboy.atlas');
const GOBLINS_JSON = resolve(ROOT, 'spine-as3/spine-as3-example/src/goblins-mesh.json');
const GOBLINS_ATLAS = resolve(ROOT, 'spine-as3/spine-as3-example/src/goblins-mesh.atlas');
const HAS_ASSETS = existsSync(SPINE21_WASM) && existsSync(BOY_JSON);

interface Batch {
    vertexCount: number;
    indices: number[];
    rgba: [number, number, number, number];
}

describe.skipIf(!HAS_ASSETS)('Spine 2.1 side module', () => {
    let raw: SpineWasmModule;
    let controller: SpineModuleController;

    beforeAll(async () => {
        const wasmBinary = readFileSync(SPINE21_WASM);
        const factory = (await import(SPINE21_JS)).default as (a: { wasmBinary: Uint8Array }) => Promise<SpineWasmModule>;
        raw = await factory({ wasmBinary });
        controller = new SpineModuleController(raw, wrapSpineModule(raw));
    });

    function load(jsonPath: string, atlasPath: string): number {
        const atlasText = readFileSync(atlasPath, 'utf8');
        const handle = controller.loadSkeleton(readFileSync(jsonPath, 'utf8'), atlasText, false);
        expect(controller.getLastError()).toBe('');
        expect(handle).toBeGreaterThan(0);

        const size = atlasText.match(/size:\s*(\d+)\s*,\s*(\d+)/);
        for (let page = 0; page < controller.getAtlasPageCount(handle); page++) {
            controller.setAtlasPageTexture(handle, page, /*fake glId*/ 1,
                size ? Number(size[1]) : 1024, size ? Number(size[2]) : 1024);
        }
        return handle;
    }

    function batchesOf(instance: number): Batch[] {
        const batches: Batch[] = [];
        controller.forEachMeshBatch(instance, (vertBytes, idxBytes, vertexCount, indexCount) => {
            const f32 = new Float32Array(vertBytes.buffer, vertBytes.byteOffset, vertexCount * 8);
            const u16 = new Uint16Array(idxBytes.buffer, idxBytes.byteOffset, indexCount);
            batches.push({
                vertexCount,
                indices: Array.from(u16),
                rgba: [f32[4], f32[5], f32[6], f32[7]],
            });
        });
        return batches;
    }

    it('is the 2.1 runtime', () => {
        const runtimeVersion = raw.cwrap('spine_runtimeVersion', 'number', []) as () => number;
        expect(runtimeVersion()).toBe(21);
    });

    it('parses a 2.1 JSON export and exposes its animations', () => {
        // Every later runtime rejects this file: the format changed with 3.0.
        const handle = load(BOY_JSON, BOY_ATLAS);
        const instance = controller.createInstance(handle);
        expect(instance).toBeGreaterThan(0);
        expect(controller.getAnimations(instance)).toEqual(
            expect.arrayContaining(['walk', 'run', 'idle', 'jump']),
        );
        controller.destroyInstance(instance);
        controller.unloadSkeleton(handle);
    });

    it('says which export setting to change when handed a binary skeleton', () => {
        // 2.1's editor could write .skel, but its C runtime shipped no reader — so the
        // module has to name the fix rather than fail as a corrupt file.
        const handle = controller.loadSkeleton(
            new Uint8Array([1, 2, 3, 4]), readFileSync(BOY_ATLAS, 'utf8'), true);
        expect(handle).toBeLessThan(0);
        expect(controller.getLastError()).toContain('JSON');
    });

    it('advances the walk animation — a limb bone moves over time', () => {
        const handle = load(BOY_JSON, BOY_ATLAS);
        const instance = controller.createInstance(handle);
        expect(controller.play(instance, 'walk', true)).toBe(true);

        controller.update(instance, 0.0);
        const before = controller.getBonePosition(instance, 'front_foot');
        controller.update(instance, 0.4);
        const after = controller.getBonePosition(instance, 'front_foot');

        expect(before).not.toBeNull();
        expect(after).not.toBeNull();
        const moved = Math.abs(after!.x - before!.x) + Math.abs(after!.y - before!.y);
        expect(moved).toBeGreaterThan(0.5);

        controller.destroyInstance(instance);
        controller.unloadSkeleton(handle);
    });

    it('unpacks a tinted colour channel by channel', () => {
        // 2.1 keeps colour as four loose floats rather than a struct, which is its own
        // chance to write one channel into another.
        const handle = load(BOY_JSON, BOY_ATLAS);
        const instance = controller.createInstance(handle);
        controller.update(instance, 0);
        controller.setSkeletonColor(instance, 1.0, 0.4, 0.0, 0.8);

        const [first] = batchesOf(instance);
        expect(first).toBeDefined();
        expect(first.rgba[0]).toBeCloseTo(1.0, 2);
        expect(first.rgba[1]).toBeCloseTo(0.4, 2);
        expect(first.rgba[2]).toBeCloseTo(0.0, 2);
        expect(first.rgba[3]).toBeCloseTo(0.8, 2);

        controller.destroyInstance(instance);
        controller.unloadSkeleton(handle);
    });

    it('poses meshes and the weighted mesh 2.1 keeps as its own attachment type', () => {
        const handle = load(GOBLINS_JSON, GOBLINS_ATLAS);
        const instance = controller.createInstance(handle);
        expect(controller.getSkins(instance)).toEqual(
            expect.arrayContaining(['goblin', 'goblingirl']),
        );

        controller.setSkin(instance, 'goblin');
        controller.play(instance, 'walk', true);
        controller.update(instance, 0.1);

        const batches = batchesOf(instance);
        expect(batches.length).toBeGreaterThan(0);

        // A mesh is more than a quad, so posing them at all shows up as geometry no
        // region-only skeleton could produce.
        const vertices = batches.reduce((n, b) => n + b.vertexCount, 0);
        expect(vertices).toBeGreaterThan(4 * batches.length);

        // 2.1 indexes triangles with `int`; these buffers are 16-bit. A narrowing that
        // lost the value, or a rebase that forgot the batch offset, lands out of range.
        for (const batch of batches) {
            expect(batch.indices.length % 3).toBe(0);
            for (const index of batch.indices) {
                expect(index).toBeLessThan(batch.vertexCount);
            }
        }

        controller.destroyInstance(instance);
        controller.unloadSkeleton(handle);
    });

    it('reports a bounding box around the posed skeleton', () => {
        const handle = load(BOY_JSON, BOY_ATLAS);
        const instance = controller.createInstance(handle);
        controller.play(instance, 'idle', true);
        controller.update(instance, 0.2);

        const bounds = controller.getBounds(instance);
        expect(bounds.width).toBeGreaterThan(0);
        expect(bounds.height).toBeGreaterThan(0);

        controller.destroyInstance(instance);
        controller.unloadSkeleton(handle);
    });
});
