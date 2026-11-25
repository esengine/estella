// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    scene-format-version.test.ts
 * @brief   The format version answers one question — older, current, or newer —
 *          and a dotted version cannot answer it.
 *
 *          `parseFloat` reads "1.10" as 1.1 and sorts it BELOW "1.2", and reads
 *          "1.0.1" as 1, dropping the patch. While only "1.0" is ever written
 *          every test passes either way — these are the cases that separate them,
 *          so the tenth revision of the format cannot count as older than the
 *          second.
 */
import { describe, it, expect, vi } from 'vitest';
import { App } from '../src/app/app';
import { Assets } from '../src/asset/AssetPlugin';
import { EmbeddedBackend } from '../src/asset/Backend';
import { MeshAssetLoader } from '../src/asset/loaders/MeshAssetLoader';
import { MeshRenderer } from '../src/ecs/component';
import { registerPhysics2DSupport } from '../src/physics/physicsSupport';
import { createRuntimeSceneConfig, loadRuntimeScene, sceneUsesPhysics } from '../src/runtime/runtimeLoader';
import { connectFakeCpp } from './helpers/fakeEngine';
import {
    SCENE_FORMAT_VERSION,
    parseSceneFormatVersion,
    migrateSceneData,
    loadSceneWithAssets,
    type SceneData,
} from '../src/scene/scene';

vi.mock('../src/wasm/resourceManager', async importOriginal => ({
    ...await importOriginal<typeof import('../src/wasm/resourceManager')>(), requireResourceManager: () => ({}),
}));

const scene = (version: unknown): SceneData =>
    ({ version, name: 'test', entities: [] } as unknown as SceneData);

describe('packaged scene format', () => {
    const legacy: SceneData = { version: '1.0', name: 'old', entities: [{ id: 17, name: 'body', parent: null,
        children: [], components: [{ type: 'Mesh2D', data: { mesh: 'body.esmesh' } }, { type: 'RigidBody', data: {} }],
    }] };
    const source = { backend: new EmbeddedBackend({}), decodePixels: async () => { throw new Error('unexpected image'); } };

    it('loads legacy geometry and requests its 2D physics before publishing, with the same handles as authoring', async () => {
        registerPhysics2DSupport();
        const app = App.new(), acquire = vi.fn(async () => null);
        connectFakeCpp(app.world);
        app.setSideModules({ acquire });
        const mesh = vi.spyOn(MeshAssetLoader.prototype, 'load').mockResolvedValue({ handle: 37 });
        const original = JSON.stringify(legacy);
        try {
            await loadRuntimeScene({ app, module: null, source, sceneData: legacy });
            const entity = app.world.findEntityByName('body')!;
            expect(app.world.get(entity, MeshRenderer).mesh).toBe(37);
            expect(acquire).toHaveBeenCalledWith('physics');
            expect(sceneUsesPhysics(legacy)).toBe(true);
            const assets = app.getResource(Assets);
            expect(assets.sizes().refRows).toBe(1);
            app.world.despawn(entity);
            const map = await loadSceneWithAssets(app.world, legacy, { assets });
            expect(app.world.get(map.get(17)!, MeshRenderer).mesh).toBe(37);
            app.world.despawn(map.get(17)!);
            expect(assets.sizes().refRows).toBe(0);
            expect(JSON.stringify(legacy)).toBe(original);
        } finally { mesh.mockRestore(); app.quit(); }
    });

    it('refuses an unsupported document during preparation before asking for its assets', async () => {
        const app = App.new();
        const mesh = vi.spyOn(MeshAssetLoader.prototype, 'load').mockResolvedValue({ handle: 37 });
        const fetchPrefab = vi.spyOn(source.backend, 'fetchText');
        const instance = { ...legacy.entities[0]!, id: 18, components: [], prefab: 'future.esprefab', overrides: [] };
        const data = { ...legacy, version: SCENE_FORMAT_VERSION + 1,
            entities: [instance, { ...legacy.entities[0]!, components: [{ type: 'MeshRenderer', data: { mesh: 'body.esmesh' } }] }] };
        const config = createRuntimeSceneConfig('future', data, { app, module: null, source });
        try {
            await expect(config.prepare!()).rejects.toThrow(/newer/);
            await expect(loadSceneWithAssets(app.world, data, { assets: app.getResource(Assets) })).rejects.toThrow(/newer/);
            expect(mesh).not.toHaveBeenCalled();
            expect(fetchPrefab).not.toHaveBeenCalled();
            expect(app.world.getAllEntities()).toEqual([]);
            expect(config.discardPrepared!()).toBe(0);
        } finally { config.discardPrepared!(); fetchPrefab.mockRestore(); mesh.mockRestore(); app.quit(); }
    });
});

describe('scene format version', () => {
    it('is an integer, so ordering is ordering', () => {
        expect(Number.isInteger(SCENE_FORMAT_VERSION)).toBe(true);
        expect(SCENE_FORMAT_VERSION).toBeGreaterThan(0);
    });

    it('orders the way parseFloat could not', () => {
        expect(parseSceneFormatVersion(10)).toBeGreaterThan(parseSceneFormatVersion(2));
        expect(parseSceneFormatVersion(10)).toBeGreaterThan(parseSceneFormatVersion(9));
        // The old reading: "1.10" → 1.1 < "1.2" → 1.2. Both are format 1 now.
        expect(parseSceneFormatVersion('1.10')).toBe(parseSceneFormatVersion('1.2'));
    });

    it('reads every legacy spelling as format 1', () => {
        for (const legacy of ['1.0', '1', '1.0.1', '1.2', '1.10']) {
            expect(parseSceneFormatVersion(legacy)).toBe(1);
        }
    });

    it('treats a missing or unreadable version as the oldest format, not zero', () => {
        for (const bad of [undefined, null, '', 'nonsense', {}, [], NaN, 0, -3, 1.5]) {
            expect(parseSceneFormatVersion(bad)).toBe(1);
        }
    });

    it('migrating stamps the integer and reports integers', () => {
        const result = migrateSceneData(scene('1.0'));
        expect(result.data.version).toBe(SCENE_FORMAT_VERSION);
        expect(result.fromVersion).toBe(1);
        expect(result.toVersion).toBe(SCENE_FORMAT_VERSION);
    });

    it('a legacy file still loads', () => {
        expect(() => migrateSceneData(scene('1.0'))).not.toThrow();
        expect(() => migrateSceneData(scene(1))).not.toThrow();
    });

    it('a file from a newer engine is refused', () => {
        expect(() => migrateSceneData(scene(SCENE_FORMAT_VERSION + 1)))
            .toThrow(/newer than this engine supports/);
    });

    it('a two-digit future version is refused, not mistaken for an old one', () => {
        // The case the old comparison got backwards: parseFloat("1.10") < 1.2 read
        // a tenth-revision file as older and would have "migrated" it.
        expect(() => migrateSceneData(scene(10))).toThrow(/newer than this engine supports/);
    });
});
