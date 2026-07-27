// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine43-load.integration.test.ts
 * @brief   The 4.3 side module, driven end to end against a real 4.3 export.
 *
 * @details 4.3 is the first release Estella binds through spine-cpp rather than
 *          spine-c: its C runtime became a generated wrapper, and the module's
 *          geometry now comes from spine's own SkeletonRenderer. That is a new path
 *          for every step below — parse, pose, batch — so this drives all of them
 *          against the runtime's own spineboy, in both export formats.
 *
 *          Requires the built spine43 module (node build-tools/cli.js build -t
 *          spine43) and the spine-runtimes-4.3 submodule; skips otherwise.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WASM_DIR } from './helpers/loadWasm';
import { wrapSpineModule, type SpineWasmModule } from '../src/spine/SpineModuleLoader';
import { SpineModuleController } from '../src/spine/SpineController';

const SPINE43_JS = resolve(WASM_DIR, 'spine43.js');
const SPINE43_WASM = resolve(WASM_DIR, 'spine43.wasm');
const ASSET_DIR = resolve(__dirname, '../../third_party/spine-runtimes-4.3/examples/spineboy/export');
const SKEL = resolve(ASSET_DIR, 'spineboy-pro.skel');
const JSON_SKEL = resolve(ASSET_DIR, 'spineboy-pro.json');
const ATLAS = resolve(ASSET_DIR, 'spineboy.atlas');
const PMA_ATLAS = resolve(ASSET_DIR, 'spineboy-pma.atlas');
const HAS_ASSETS = existsSync(SPINE43_WASM) && existsSync(SKEL);

interface Batch {
    vertexCount: number;
    indexCount: number;
    /** The first vertex's colour, unpacked from the interleaved x,y,u,v,r,g,b,a. */
    rgba: [number, number, number, number];
}

describe.skipIf(!HAS_ASSETS)('Spine 4.3 side module (spine-cpp backend)', () => {
    let raw: SpineWasmModule;
    let controller: SpineModuleController;

    beforeAll(async () => {
        const wasmBinary = readFileSync(SPINE43_WASM);
        const factory = (await import(SPINE43_JS)).default as (a: { wasmBinary: Uint8Array }) => Promise<SpineWasmModule>;
        raw = await factory({ wasmBinary });
        controller = new SpineModuleController(raw, wrapSpineModule(raw));
    });

    /** Loads spineboy and registers stub page textures, so attachments have an id to draw with. */
    function load(skeleton: Uint8Array | string, atlasPath: string): number {
        const atlasText = readFileSync(atlasPath, 'utf8');
        const handle = controller.loadSkeleton(skeleton, atlasText, skeleton instanceof Uint8Array);
        expect(controller.getLastError()).toBe('');
        expect(handle).toBeGreaterThan(0);

        const size = atlasText.match(/size:\s*(\d+)\s*,\s*(\d+)/);
        const pages = controller.getAtlasPageCount(handle);
        for (let page = 0; page < pages; page++) {
            controller.setAtlasPageTexture(handle, page, /*fake glId*/ 1,
                size ? Number(size[1]) : 1024, size ? Number(size[2]) : 1024);
        }
        return handle;
    }

    function batchesOf(instance: number): Batch[] {
        const batches: Batch[] = [];
        controller.forEachMeshBatch(instance, (vertBytes, _idxBytes, vertexCount, indexCount) => {
            const f32 = new Float32Array(vertBytes.buffer, vertBytes.byteOffset, vertexCount * 8);
            batches.push({
                vertexCount,
                indexCount,
                rgba: [f32[4], f32[5], f32[6], f32[7]],
            });
        });
        return batches;
    }

    it('is the 4.3 runtime, not a 4.2 module under a 4.3 name', () => {
        const runtimeVersion = raw.cwrap('spine_runtimeVersion', 'number', []) as () => number;
        expect(runtimeVersion()).toBe(43);
    });

    it('parses the 4.3 binary export and exposes its animations', () => {
        // A 4.2 runtime rejects this file outright — the format changed with the release.
        const handle = load(new Uint8Array(readFileSync(SKEL)), ATLAS);
        const instance = controller.createInstance(handle);
        expect(instance).toBeGreaterThan(0);
        expect(controller.getAnimations(instance)).toEqual(
            expect.arrayContaining(['walk', 'run', 'idle', 'jump']),
        );
        controller.destroyInstance(instance);
        controller.unloadSkeleton(handle);
    });

    it('parses the 4.3 JSON export too', () => {
        const handle = load(readFileSync(JSON_SKEL, 'utf8'), ATLAS);
        const instance = controller.createInstance(handle);
        expect(controller.getSkins(instance)).toContain('default');
        controller.destroyInstance(instance);
        controller.unloadSkeleton(handle);
    });

    it('emits geometry through SkeletonRenderer, in the engine vertex layout', () => {
        const handle = load(new Uint8Array(readFileSync(SKEL)), ATLAS);
        const instance = controller.createInstance(handle);
        controller.play(instance, 'idle', true);
        controller.update(instance, 0);

        const batches = batchesOf(instance);
        expect(batches.length).toBeGreaterThan(0);
        expect(batches.reduce((n, b) => n + b.indexCount, 0)).toBeGreaterThan(0);

        // spineboy tints nothing, so every vertex is opaque white. This is also the
        // assertion that catches a mis-decoded colour: the renderer packs ARGB, and
        // reading it as RGBA would swap red and blue — invisible on white, so the
        // alpha channel is checked separately below with a tinted slot.
        for (const batch of batches) {
            expect(batch.rgba).toEqual([1, 1, 1, 1]);
        }
        controller.destroyInstance(instance);
        controller.unloadSkeleton(handle);
    });

    it('unpacks a tinted slot colour channel by channel', () => {
        const handle = load(new Uint8Array(readFileSync(SKEL)), ATLAS);
        const instance = controller.createInstance(handle);
        controller.update(instance, 0);
        // Distinct per channel: a swapped decode shows up as the wrong component.
        controller.setSkeletonColor(instance, 1.0, 0.4, 0.0, 0.8);

        const [first] = batchesOf(instance);
        expect(first).toBeDefined();
        expect(first.rgba[0]).toBeCloseTo(1.0, 1);
        expect(first.rgba[1]).toBeCloseTo(0.4, 1);
        expect(first.rgba[2]).toBeCloseTo(0.0, 1);
        expect(first.rgba[3]).toBeCloseTo(0.8, 1);

        controller.destroyInstance(instance);
        controller.unloadSkeleton(handle);
    });

    it('advances the walk animation — a limb bone moves over time', () => {
        const handle = load(new Uint8Array(readFileSync(SKEL)), ATLAS);
        const instance = controller.createInstance(handle);
        expect(controller.play(instance, 'walk', true)).toBe(true);

        controller.update(instance, 0.0);
        const before = controller.getBonePosition(instance, 'front-foot');
        controller.update(instance, 0.4);
        const after = controller.getBonePosition(instance, 'front-foot');

        expect(before).not.toBeNull();
        expect(after).not.toBeNull();
        const moved = Math.abs(after!.x - before!.x) + Math.abs(after!.y - before!.y);
        expect(moved).toBeGreaterThan(0.5);

        controller.destroyInstance(instance);
        controller.unloadSkeleton(handle);
    });

    it('reports a premultiplied atlas page with the premultiplied blend mode', () => {
        // SkeletonRenderer hands back a texture, not a page, so the backend tracks
        // which texture ids came from a `pma: true` page. Same skeleton, two atlases.
        const straight = load(new Uint8Array(readFileSync(SKEL)), ATLAS);
        const premultiplied = load(new Uint8Array(readFileSync(SKEL)), PMA_ATLAS);

        const blendModes = (handle: number): number[] => {
            const instance = controller.createInstance(handle);
            controller.update(instance, 0);
            const modes: number[] = [];
            controller.forEachMeshBatch(instance, (_v, _i, _vc, _ic, _tex, blendMode) => {
                modes.push(blendMode);
            });
            controller.destroyInstance(instance);
            return modes;
        };

        expect(blendModes(straight)).toContain(0);      // normal
        expect(blendModes(premultiplied)).toContain(4); // normal, premultiplied

        controller.unloadSkeleton(straight);
        controller.unloadSkeleton(premultiplied);
    });
});
