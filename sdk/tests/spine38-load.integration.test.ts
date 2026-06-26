// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine38-load.integration.test.ts
 * @brief   Proves the 3.8 side module actually loads and animates a real 3.8
 *          asset (the spine-runtimes spineboy export) headlessly. This is the
 *          core of "users who only have 3.8 exports can run them" — a 4.2 runtime
 *          cannot parse a 3.8 binary skeleton, so this only passes through the
 *          version-matched side module.
 *
 *          Requires the built spine38 module (node build-tools/cli.js build -t
 *          spine38) and the spine-runtimes-3.8 submodule assets; skips otherwise.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WASM_DIR } from './helpers/loadWasm';
import { wrapSpineModule, type SpineWasmModule } from '../src/spine/SpineModuleLoader';
import { SpineModuleController } from '../src/spine/SpineController';

const SPINE38_JS = resolve(WASM_DIR, 'spine38.js');
const SPINE38_WASM = resolve(WASM_DIR, 'spine38.wasm');
const ASSET_DIR = resolve(__dirname, '../../third_party/spine-runtimes-3.8/examples/spineboy/export');
const SKEL = resolve(ASSET_DIR, 'spineboy-pro.skel');
const ATLAS = resolve(ASSET_DIR, 'spineboy.atlas');
const HAS_SPINE38 = existsSync(SPINE38_WASM) && existsSync(SKEL);

describe.skipIf(!HAS_SPINE38)('Spine 3.8 side module loads + animates a real 3.8 asset', () => {
    let controller: SpineModuleController;
    let skelHandle: number;

    beforeAll(async () => {
        const wasmBinary = readFileSync(SPINE38_WASM);
        const factory = (await import(SPINE38_JS)).default as (arg: { wasmBinary: Uint8Array }) => Promise<SpineWasmModule>;
        const raw = await factory({ wasmBinary });
        controller = new SpineModuleController(raw, wrapSpineModule(raw));

        // Texture pages are supplied separately (setAtlasPageTexture); parsing the
        // skeleton + atlas geometry needs no GL, so this runs fully headless.
        const skel = new Uint8Array(readFileSync(SKEL));
        const atlas = readFileSync(ATLAS, 'utf8');
        skelHandle = controller.loadSkeleton(skel, atlas, /*isBinary*/ true);
    });

    it('parses the 3.8 binary skeleton + exposes its animation set', () => {
        expect(skelHandle).toBeGreaterThan(0); // a 4.2 runtime would fail to parse 3.8 binary
        const instance = controller.createInstance(skelHandle);
        expect(instance).toBeGreaterThan(0);
        expect(controller.getAnimations(instance)).toEqual(
            expect.arrayContaining(['walk', 'run', 'idle', 'jump']),
        );
    });

    it('advances the walk animation — a limb bone moves over time', () => {
        const instance = controller.createInstance(skelHandle);
        expect(controller.play(instance, 'walk', true)).toBe(true);

        controller.update(instance, 0.0);
        const p0 = controller.getBonePosition(instance, 'front-foot');
        controller.update(instance, 0.4);
        const p1 = controller.getBonePosition(instance, 'front-foot');

        expect(p0).not.toBeNull();
        expect(p1).not.toBeNull();
        const moved = Math.abs(p1!.x - p0!.x) + Math.abs(p1!.y - p0!.y);
        expect(moved).toBeGreaterThan(0.5); // the foot visibly swings during a walk cycle
    });
});
