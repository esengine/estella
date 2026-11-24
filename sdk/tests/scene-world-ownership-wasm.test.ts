// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { ownedAssetLease } from '../src/asset/AssetLease';
import { EmbeddedBackend } from '../src/asset/Backend';
import { worldEngineApi } from '../src/ecs/bridge/engineApi';
import { Name } from '../src/ecs/component';
import { loadRuntimeScene, prepareRuntimeScene, publishRuntimeScene } from '../src/runtime/runtimeLoader';
import { loadSceneWithAssets, type SceneData } from '../src/scene/scene';
import { SceneLoadCancelled, SceneManager, SceneManagerState } from '../src/scene/sceneManager';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

const scene: SceneData = { version: 4, name: 'previous', entities: [
    { id: 1, name: 'former', parent: null, children: [], components: [] },
] };

describe.skipIf(!HAS_WASM)('scene publication owns its registry', () => {
    let core: ESEngineModule;
    beforeAll(async () => { core = await loadWasmModule(); });

    function setup() {
        const app = App.new(), first = new core.Registry(), second = new core.Registry();
        app.connectCpp(first, core);
        const options = { app, module: core, sceneData: scene, source: {
            backend: new EmbeddedBackend({}), decodePixels: async () => { throw new Error('unexpected texture'); },
        } };
        function replace(quit: boolean) {
            const old = app.world.getAllEntities()[0];
            if (quit) app.quit({ keepRenderer: true });
            app.connectCpp(second, core);
            const entity = app.world.spawn('replacement');
            if (old !== undefined) expect(entity).toBe(old);
            return entity;
        }
        function checkReplacement() {
            const entities = app.world.getAllEntities();
            expect(entities).toHaveLength(1);
            expect(second.valid(entities[0]!)).toBe(true);
            expect(app.world.get(entities[0]!, Name).value).toBe('replacement');
        }
        function dispose() {
            app.quit({ keepRenderer: true });
            first.delete();
            second.delete();
        }
        return { app, first, second, options, replace, checkReplacement, dispose };
    }

    it.each(['authoring', 'runtime'])('preserves the new entity and original error on failed %s rollback', async entry => {
        const { app, options, replace, checkReplacement, dispose } = setup();
        const fault = new Error('old scene failed after spawn');
        const onPhase = (phase: string) => {
            if (phase === 'spawn') { replace(true); throw fault; }
        };
        try {
            const load = entry === 'authoring' ? loadSceneWithAssets(app.world, scene, { onPhase })
                : loadRuntimeScene({ ...options, onPhase });
            await expect(load).rejects.toBe(fault);
            checkReplacement();
        } finally { dispose(); }
    });

    it.each(['spawn.entities', 'spawn', 'origins'])('stops publication when the registry changes during %s', async when => {
        const { first, options, replace, checkReplacement, dispose } = setup();
        try {
            await expect(loadRuntimeScene({ ...options, onPhase(phase) {
                if (phase === when) replace(false);
            } })).rejects.toBeInstanceOf(SceneLoadCancelled);
            expect(first.entityCount()).toBe(0);
            checkReplacement();
        } finally { dispose(); }
    });

    it('returns a partially spawned entity to its borrowed registry when a spawn listener switches worlds', async () => {
        const { app, first, options, replace, checkReplacement, dispose } = setup();
        const off = app.world.onSpawn(() => { off(); replace(false); });
        try {
            await expect(loadRuntimeScene(options)).rejects.toBeInstanceOf(SceneLoadCancelled);
            expect(first.entityCount()).toBe(0);
            checkReplacement();
        } finally { off(); dispose(); }
    });

    it('invalidates a preparation across a disconnect and reconnect to the same registry', async () => {
        const { app, first, options, dispose } = setup();
        try {
            const prepared = await prepareRuntimeScene(options);
            app.connectCpp(first, core);
            expect(app.world.entityLifetime).toBe(prepared.lifetime);
            app.world.disconnectCpp();
            app.connectCpp(first, core);
            await expect(publishRuntimeScene(prepared)).rejects.toBeInstanceOf(SceneLoadCancelled);
            expect(first.entityCount()).toBe(0);
        } finally { dispose(); }
    });

    it('honors a native population reset even when both the registry object and entity number match', async () => {
        const { app, first, options, dispose } = setup();
        const api = worldEngineApi(app.world)!;
        const original = api.registry_entityChangeResetEpoch!;
        let epoch = original(first);
        api.registry_entityChangeResetEpoch = () => epoch;
        try {
            await expect(loadRuntimeScene({ ...options, onPhase(phase) {
                if (phase !== 'spawn') return;
                // Native hosts signal a bulk clear through this epoch. The web Registry has no public clear method.
                epoch++;
                const [reused] = app.world.getAllEntities();
                app.world.insert(reused!, Name, { value: 'after clear' });
            } })).rejects.toBeInstanceOf(SceneLoadCancelled);
            expect(first.entityCount()).toBe(1);
            expect(app.world.get(app.world.getAllEntities()[0]!, Name).value).toBe('after clear');
        } finally { api.registry_entityChangeResetEpoch = original; dispose(); }
    });

    it.each(['loading', 'running'])('reuses a registration after disconnecting its %s instance', async status => {
        const { app, first, replace, checkReplacement, dispose } = setup();
        const manager = new SceneManagerState(app);
        app.insertResource(SceneManager, manager);
        manager.register({ name: 'room', setup(ctx) { ctx.spawn(); } });
        try {
            if (status === 'loading') {
                const off = app.world.onSpawn(() => { off(); replace(false); });
                try { await expect(manager.load('room')).rejects.toBeInstanceOf(SceneLoadCancelled); }
                finally { off(); }
            } else {
                await manager.load('room');
                replace(false);
            }
            expect(first.entityCount()).toBe(0);
            checkReplacement();
            const fresh = await manager.load('room');
            expect(fresh.entities.size).toBe(1);
            expect(app.world.getAllEntities()).toHaveLength(2);
        } finally { manager.reset(); dispose(); }
    });

    it.each(['return', 'resume'])('a staged job can %s after disconnect without touching the new world', async finish => {
        const { options, first, replace, checkReplacement, dispose } = setup();
        const release = vi.fn();
        try {
            const prepared = await prepareRuntimeScene(options);
            prepared.assetResult.scope.add(ownedAssetLease('previous mesh', 1, 1, release));
            await expect(publishRuntimeScene(prepared, undefined, async job => {
                const step = job.next();
                expect(step.done).toBe(false);
                replace(false);
                if (finish === 'resume') while (!job.next().done) { /* run the rest of this slice */ }
                const stopped = { entities: new Map(), hidden: [] };
                job.return(stopped);
                return stopped;
            })).rejects.toBeInstanceOf(SceneLoadCancelled);
            expect(release).toHaveBeenCalledOnce();
            expect(first.entityCount()).toBe(0);
            checkReplacement();
        } finally { dispose(); }
    });

    it('discards a prepared game session after quit, including its remaining asset receipt', async () => {
        const { options, replace, checkReplacement, dispose } = setup();
        const release = vi.fn();
        try {
            const ready = await prepareRuntimeScene(options);
            ready.assetResult.scope.add(ownedAssetLease('old texture', 1, 1, release));
            replace(true);
            await expect(publishRuntimeScene(ready)).rejects.toBeInstanceOf(SceneLoadCancelled);
            expect(release).toHaveBeenCalledOnce();
            checkReplacement();
        } finally { dispose(); }
    });
});
