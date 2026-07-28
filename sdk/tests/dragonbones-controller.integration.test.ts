// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The SDK layer, driven the way a caller would. The raw-ABI test beside this one
// checks the module; this one checks that the TypeScript in front of it marshals
// correctly — two heaps, a string list crossing as JSON, and geometry read back
// through the walk that Spine now shares.
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WASM_DIR } from './helpers/loadWasm';
import { DragonBonesModuleController } from '../src/dragonbones/DragonBonesController';
import { wrapDragonBonesModule, type DragonBonesWasmModule } from '../src/dragonbones/DragonBonesModuleLoader';

const DB_JS = resolve(WASM_DIR, 'dragonbones.js');
const DB_WASM = resolve(WASM_DIR, 'dragonbones.wasm');
const ASSET_DIR = resolve(__dirname, 'assets/dragonbones');
const SKE = resolve(ASSET_DIR, 'DragonBoy_ske.json');
const TEX = resolve(ASSET_DIR, 'DragonBoy_tex.json');
const HAS_ASSETS = existsSync(DB_WASM) && existsSync(SKE);

describe.skipIf(!HAS_ASSETS)('DragonBonesModuleController', () => {
    let controller: DragonBonesModuleController;

    beforeAll(async () => {
        const factory = (await import(DB_JS)).default as
            (a: { wasmBinary: Uint8Array }) => Promise<DragonBonesWasmModule>;
        const raw = await factory({ wasmBinary: new Uint8Array(readFileSync(DB_WASM)) });
        controller = new DragonBonesModuleController(raw, wrapDragonBonesModule(raw));
    });

    const load = (): number =>
        controller.loadSkeleton(new Uint8Array(readFileSync(SKE)), readFileSync(TEX, 'utf8'));

    it('loads from bytes and from a string alike', () => {
        const fromBytes = load();
        expect(fromBytes, controller.getLastError()).toBeGreaterThanOrEqual(0);
        const fromText = controller.loadSkeleton(readFileSync(SKE, 'utf8'), readFileSync(TEX, 'utf8'));
        expect(fromText).toBeGreaterThanOrEqual(0);
        expect(controller.getArmatures(fromText)).toEqual(controller.getArmatures(fromBytes));
        controller.unloadSkeleton(fromBytes);
        controller.unloadSkeleton(fromText);
    });

    it('reports a failure instead of a handle', () => {
        const handle = controller.loadSkeleton(new Uint8Array([1, 2, 3]), 'not json');
        expect(handle).toBeLessThan(0);
        expect(controller.getLastError()).not.toBe('');
    });

    it('names the armatures and the image the atlas wants', () => {
        const handle = load();
        expect(controller.getArmatures(handle)).toEqual(['Dragon']);
        expect(controller.getAtlasImageName(handle)).toBe('DragonBoy_tex.png');
        controller.unloadSkeleton(handle);
    });

    it('plays, poses, and hands geometry back through the shared walk', () => {
        const handle = load();
        controller.setAtlasTexture(handle, 42);
        const instance = controller.createInstance(handle, 'Dragon');
        expect(instance).toBeGreaterThanOrEqual(0);
        expect(controller.getAnimations(instance).sort()).toEqual(['fall', 'jump', 'stand', 'walk']);

        expect(controller.play(instance, 'walk')).toBe(true);
        for (let i = 0; i < 10; i++) controller.update(instance, 1 / 60);

        let batches = 0;
        let vertices = 0;
        controller.forEachMeshBatch(instance, (vertBytes, indexBytes, vertexCount, indexCount, textureId) => {
            batches++;
            vertices += vertexCount;
            expect(textureId).toBe(42);
            // The views are windows into wasm scratch, so their length is the
            // contract: eight floats a vertex, two bytes an index.
            expect(vertBytes.byteLength).toBe(vertexCount * 8 * 4);
            expect(indexBytes.byteLength).toBe(indexCount * 2);
        });
        expect(batches).toBeGreaterThan(0);
        expect(vertices).toBeGreaterThan(0);

        controller.destroyInstance(instance);
        controller.unloadSkeleton(handle);
    });

    it('crossfades where Spine would consult a mix table', () => {
        const handle = load();
        controller.setAtlasTexture(handle, 1);
        const instance = controller.createInstance(handle, 'Dragon');
        controller.play(instance, 'stand');
        controller.update(instance, 1 / 60);

        expect(controller.fadeIn(instance, 'walk', 0.2)).toBe(true);
        for (let i = 0; i < 6; i++) controller.update(instance, 1 / 60);
        const bounds = controller.getBounds(instance);
        // Mid-fade the pose is neither animation, but it is still a posed skeleton.
        expect(bounds.width).toBeGreaterThan(0);
        expect(Number.isFinite(bounds.x)).toBe(true);

        controller.destroyInstance(instance);
        controller.unloadSkeleton(handle);
    });

    it('refuses an armature the file does not hold', () => {
        const handle = load();
        expect(controller.createInstance(handle, 'NotAnArmature')).toBeLessThan(0);
        expect(controller.getLastError()).not.toBe('');
        controller.unloadSkeleton(handle);
    });
});
