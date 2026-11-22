// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, flushPendingRegistrations } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { Transform, defineTag } from '../src/ecs/component';
import { Added, Changed, Mut, Query } from '../src/ecs/query';
import { defineSystem, Schedule } from '../src/ecs/system';
import { UINode, UIDisplay } from '../src/ui/core/ui-node';
import type { Entity } from '../src/types';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

const Excluded = defineTag('QueryBoundaryExcluded');

describe.skipIf(!HAS_WASM)('builtin change query boundaries on real WASM', () => {
    let engine: ESEngineModule;
    let registry: CppRegistry;
    let app: App;
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => {
        setDefaultContext(new AppContext());
        registry = new engine.Registry();
        app = App.new();
        app.connectCpp(registry, engine);
    });
    afterEach(() => {
        for (const entity of app.world.getAllEntities()) app.world.despawn(entity);
        expect(app.world.getStorageSizes().changes.sequenceRows).toBe(0);
        app.world.disconnectCpp();
        registry.delete();
    });
    it.each([Added, Changed])('sees a builtin insertion between frames through %s', async filter => {
        const batches: Entity[][] = [];
        app.addSystemToSchedule(Schedule.Update, defineSystem([Query(filter(UINode))], query => {
            const batch: Entity[] = [];
            query.forEach(entity => batch.push(entity));
            batches.push(batch);
        }));
        flushPendingRegistrations(app);
        await app.tick(1 / 60);
        const entity = app.world.spawn();
        app.world.insert(entity, UINode);
        await app.tick(1 / 60);
        await app.tick(1 / 60);
        expect(batches).toEqual([[], [entity], []]);
    });
    it('tests builtin membership only for entities passing the script exclusions', () => {
        const { world } = app;
        const entities = Array.from({ length: 100 }, () => world.spawn());
        for (const entity of entities) {
            world.insert(entity, Transform);
            if (entity !== entities[0]) world.insert(entity, Excluded);
        }
        const nativeHas = vi.spyOn(world.builtin.getBuiltinMethods(Transform._cppName), 'has');
        try {
            expect(world.getEntitiesWithComponents([Transform], [], [Excluded])).toEqual([entities[0]]);
            expect(nativeHas.mock.calls).toEqual([[entities[0]]]);
        } finally {
            nativeHas.mockRestore();
        }
    });

    it('sees a late UI write on the next frame without retriggering its own Mut writeback', async () => {
        const batches: Entity[][] = [];
        app.addSystemToSchedule(Schedule.Update, defineSystem([Query(Mut(UINode), Changed(UINode))], query => {
            const batch: Entity[] = [];
            query.forEach((entity, node) => { batch.push(entity); node.display = UIDisplay.Flex; });
            batches.push(batch);
        }));
        let victim: Entity | undefined;
        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem([], () => {
            if (victim !== undefined) {
                app.world.update(victim, UINode, node => { node.display = UIDisplay.None; });
                victim = undefined;
            }
        }));
        flushPendingRegistrations(app);
        await app.tick(1 / 60);
        const entity = app.world.spawn();
        app.world.insert(entity, UINode);
        await app.tick(1 / 60);
        victim = entity;
        await app.tick(1 / 60);
        await app.tick(1 / 60);
        await app.tick(1 / 60);
        expect(batches).toEqual([[], [entity], [], [entity], []]);
        expect(app.world.get(entity, UINode).display).toBe(UIDisplay.Flex);
        expect(app.world.getStorageSizes().changes.sequenceRows).toBe(1);
    });
});
