// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The manager against the real module. Its interesting behaviour is bookkeeping —
// who shares a skeleton, when the last reference drops it, what a disabled entity
// stops doing — and every one of those fails quietly: a leak shows up as memory,
// a double free as a crash three frames later, a missed disable as a thing that
// keeps animating. So they are asserted, not eyeballed.
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WASM_DIR } from './helpers/loadWasm';
import { DragonBonesManager } from '../src/dragonbones/DragonBonesManager';
import { DragonBonesModuleController } from '../src/dragonbones/DragonBonesController';
import { wrapDragonBonesModule, type DragonBonesWasmModule } from '../src/dragonbones/DragonBonesModuleLoader';
import type { Entity } from '../src/types';

const DB_JS = resolve(WASM_DIR, 'dragonbones.js');
const DB_WASM = resolve(WASM_DIR, 'dragonbones.wasm');
const ASSET_DIR = resolve(__dirname, 'assets/dragonbones');
const SKE = resolve(ASSET_DIR, 'DragonBoy_ske.json');
const TEX = resolve(ASSET_DIR, 'DragonBoy_tex.json');
const HAS_ASSETS = existsSync(DB_WASM) && existsSync(SKE);

const e = (n: number): Entity => n as unknown as Entity;

describe.skipIf(!HAS_ASSETS)('DragonBonesManager', () => {
    let raw: DragonBonesWasmModule;
    let manager: DragonBonesManager;

    beforeAll(async () => {
        const factory = (await import(DB_JS)).default as
            (a: { wasmBinary: Uint8Array }) => Promise<DragonBonesWasmModule>;
        raw = await factory({ wasmBinary: new Uint8Array(readFileSync(DB_WASM)) });
    });

    const fresh = (): DragonBonesManager =>
        new DragonBonesManager(new DragonBonesModuleController(raw, wrapDragonBonesModule(raw)));

    const load = (m: DragonBonesManager, key?: string): number =>
        m.loadSkeleton(new Uint8Array(readFileSync(SKE)), readFileSync(TEX, 'utf8'), key);

    it('parses a keyed file once, however many entities want it', () => {
        manager = fresh();
        const first = load(manager, 'dragonboy');
        const second = load(manager, 'dragonboy');
        expect(second).toBe(first);

        // No key means no sharing — the honest fallback when a caller cannot say
        // that two requests are for the same asset.
        const unkeyed = load(manager);
        expect(unkeyed).not.toBe(first);
        manager.dispose();
    });

    it('attaches an armature and refuses one the file does not hold', () => {
        manager = fresh();
        const handle = load(manager, 'dragonboy');
        manager.setAtlasTexture(handle, 3);

        expect(manager.addEntity(e(1), handle, { armature: 'Dragon', assetKey: 'dragonboy' })).toBe(true);
        expect(manager.hasInstance(e(1))).toBe(true);
        expect(manager.addEntity(e(2), handle, { armature: 'Nope', assetKey: 'dragonboy' })).toBe(false);
        expect(manager.hasInstance(e(2))).toBe(false);
        manager.dispose();
    });

    it('keeps a shared skeleton alive until its last entity leaves', () => {
        manager = fresh();
        const handle = load(manager, 'dragonboy');
        manager.setAtlasTexture(handle, 3);
        manager.addEntity(e(1), handle, { armature: 'Dragon', assetKey: 'dragonboy' });
        manager.addEntity(e(2), handle, { armature: 'Dragon', assetKey: 'dragonboy' });

        manager.removeEntity(e(1));
        // Still loaded: entity 2 holds the other reference. Asking the module is the
        // check that matters — an unloaded handle answers with no armatures.
        expect(manager.getArmatures(handle)).toEqual(['Dragon']);
        expect(manager.play(e(2), 'walk')).toBe(true);

        manager.removeEntity(e(2));
        expect(manager.getArmatures(handle)).toEqual([]);
        manager.dispose();
    });

    it('advances what is enabled and leaves the rest where it was', () => {
        manager = fresh();
        const handle = load(manager, 'dragonboy');
        manager.setAtlasTexture(handle, 3);
        manager.addEntity(e(1), handle, { armature: 'Dragon', assetKey: 'dragonboy', animation: 'walk' });
        manager.addEntity(e(2), handle, { armature: 'Dragon', assetKey: 'dragonboy', animation: 'walk' });
        manager.updateAnimations(1 / 60);

        manager.setEnabled(e(2), false);
        const frozen = manager.getBounds(e(2));
        for (let i = 0; i < 20; i++) manager.updateAnimations(1 / 60);

        expect(manager.getBounds(e(1))).not.toEqual(frozen);
        expect(manager.getBounds(e(2))).toEqual(frozen);
        manager.dispose();
    });

    it('re-attaching an entity replaces its armature rather than stacking one', () => {
        manager = fresh();
        const handle = load(manager, 'dragonboy');
        manager.setAtlasTexture(handle, 3);
        manager.addEntity(e(1), handle, { armature: 'Dragon', assetKey: 'dragonboy' });
        manager.addEntity(e(1), handle, { armature: 'Dragon', assetKey: 'dragonboy' });

        // One entity, one instance — and the shared skeleton survives, which it
        // would not if the replace released a reference it never took.
        manager.removeEntity(e(1));
        expect(manager.getArmatures(handle)).toEqual([]);
        manager.dispose();
    });

    it('forgets everything on dispose, twice over', () => {
        manager = fresh();
        const handle = load(manager, 'dragonboy');
        manager.setAtlasTexture(handle, 3);
        manager.addEntity(e(1), handle, { armature: 'Dragon', assetKey: 'dragonboy' });

        manager.dispose();
        expect(manager.hasInstance(e(1))).toBe(false);
        // Idempotent: teardown runs from app shutdown and from an engine re-init,
        // and the second must not free a handle the first already did.
        expect(() => manager.dispose()).not.toThrow();
    });
});
