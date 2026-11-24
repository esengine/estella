// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { ownedAssetLease } from '../src/asset/AssetLease';
import { EntityAssetScopes } from '../src/asset/entityAssetScopes';
import { Name, Parent, SceneOwner, Transform } from '../src/ecs/component';
import { getDefaultContext } from '../src/ecs/context';
import { World } from '../src/ecs/world';
import { resetWorldTo, type SceneData } from '../src/scene/scene';
import { SceneLoadCancelled } from '../src/scene/sceneManager';
import type { Entity } from '../src/types';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';
import { createMockModule } from './mocks/wasm';

describe.skipIf(!HAS_WASM)('subtree teardown owns its registry', () => {
    let core: ESEngineModule;
    beforeAll(async () => { core = await loadWasmModule(); });

    it.each(['borrowed', 'owned'])('finishes the old %s subtree before its listener starts the new hierarchy', ownership => {
        const app = App.new(), world = app.world;
        const old = new core.Registry(), next = new core.Registry(), owned = ownership === 'owned';
        app.connectCpp(old, core, { ownedRegistry: owned });
        const root = world.spawn('old root'), child = world.spawn('old child');
        world.setParent(child, root);
        const bystander = owned ? undefined : old.create();
        const scopes = new EntityAssetScopes(), oldRelease = vi.fn(), nextRelease = vi.fn();
        scopes.ensure(world, child).add(ownedAssetLease('old mesh', 1, 1, oldRelease));
        const fresh: Entity[] = [], events: string[] = [];
        let linked = false;
        const replace = world.onDespawn(entity => {
            if (entity !== child || world.getCppRegistry() !== old) return;
            if (owned) app.quit({ keepRenderer: true });
            app.connectCpp(next, core);
            fresh.push(world.spawn('new root'), world.spawn('new child'));
            world.insert(fresh[1]!, Transform);
            linked = world.trySetParent(fresh[1]!, fresh[0]!);
            scopes.ensure(world, fresh[1]!).add(ownedAssetLease('new mesh', 1, 2, nextRelease));
        });
        const observe = world.onDespawn(entity => { events.push(world.tryGet(entity, Name)?.value ?? 'missing'); });
        try {
            world.despawn(root);
            expect(fresh).toEqual([root, child]);
            expect(world.getAllEntities()).toEqual(fresh);
            expect(events).toEqual(['old child', 'old root']);
            expect(linked).toBe(true);
            expect(next.getParent(child).entity).toBe(root);
            expect(world.findEntityByName('new child')).toBe(child);
            expect(world.getEntitiesWithComponents([Parent, Transform])).toEqual([child]);
            expect(oldRelease).toHaveBeenCalledOnce();
            expect(nextRelease).not.toHaveBeenCalled();
            if (bystander !== undefined) {
                expect(old.entityCount()).toBe(1);
                expect(old.valid(bystander)).toBe(true);
            }
            world.despawn(root);
            expect(nextRelease).toHaveBeenCalledOnce();
            expect(next.entityCount()).toBe(0);
        } finally { replace(); observe(); app.quit({ keepRenderer: true }); if (!owned) old.delete(); next.delete(); }
    });

    it('interrupts restoring an editor snapshot when a despawn listener changes its world', () => {
        const app = App.new(), world = app.world, old = new core.Registry(), next = new core.Registry();
        app.connectCpp(old, core);
        const first = world.spawn('old A'), second = world.spawn('old B');
        world.insert(second, SceneOwner, { scene: 'old', persistent: true });
        const snapshot: SceneData = { version: 4, name: 'snapshot', entities: [
            { id: 1, name: 'snapshot entity', parent: null, children: [], components: [] },
        ] };
        const off = world.onDespawn(entity => {
            if (entity !== first) return;
            off();
            app.connectCpp(next, core);
            world.spawn('new A'); world.spawn('new B');
        });
        try {
            expect(() => resetWorldTo(world, snapshot)).toThrow(SceneLoadCancelled);
            expect(world.getAllEntities()).toEqual([first, second]);
            expect(world.findEntityByName('new B')).toBe(second);
            expect(world.has(second, SceneOwner)).toBe(false);
            expect(next.entityCount()).toBe(2);
            expect(old.valid(second)).toBe(true);
        } finally { off(); app.quit({ keepRenderer: true }); old.delete(); next.delete(); }
    });

    it('finishes a nested despawn before resuming observers of the outer entity', () => {
        const world = new World(), old = new core.Registry(), next = new core.Registry();
        world.connectCpp(old, core);
        const outer = world.spawn('outer'), inner = world.spawn('inner');
        const events: string[] = [];
        const act = world.onDespawn(entity => {
            if (entity === outer) world.despawn(inner);
            if (entity === inner) world.connectCpp(next, core);
        });
        const record = world.onDespawn(entity => {
            events.push(world.getCppRegistry() === old ? world.get(entity, Name).value : 'replacement world');
        });
        try {
            world.despawn(outer);
            expect(events).toEqual(['inner', 'outer']);
            expect(old.entityCount()).toBe(0);
        } finally { act(); record(); world.disconnectCpp(); old.delete(); next.delete(); }
    });

    it('lets the editor switch worlds before SDK observers without repeating its notification', () => {
        const world = new World(), old = new core.Registry(), next = new core.Registry();
        const context = getDefaultContext(), previousBridge = context.editorBridge;
        world.connectCpp(old, core);
        const root = world.spawn('root'), child = world.spawn('child');
        world.setParent(child, root);
        const seen: string[] = [];
        context.editorBridge = {
            registerComponent() {},
            onEntityDespawned(entity) {
                seen.push('editor ' + world.get(entity as Entity, Name).value);
                if (entity === child) {
                    world.connectCpp(next, core);
                    world.spawn('replacement');
                }
            },
        };
        const off = world.onDespawn(entity => { seen.push('SDK ' + world.get(entity, Name).value); });
        try {
            world.despawn(root);
            expect(seen).toEqual(['editor child', 'SDK child', 'editor root', 'SDK root']);
            expect(world.getAllEntities()).toEqual([root]);
            expect(world.findEntityByName('replacement')).toBe(root);
            expect(old.entityCount()).toBe(0);
        } finally { context.editorBridge = previousBridge; off(); world.disconnectCpp(); old.delete(); next.delete(); }
    });

    it('finishes a logic-only world before its first native attachment', () => {
        const world = new World(), next = new core.Registry();
        const entity = world.spawn('logic entity');
        const seen: string[] = [];
        const bind = world.onDespawn(() => {
            bind();
            world.connectCpp(next, core);
            world.spawn('native entity');
        });
        const observe = world.onDespawn(e => { seen.push(world.get(e, Name).value); });
        try {
            world.despawn(entity);
            expect(seen).toEqual(['logic entity']);
            expect(world.entityCount()).toBe(1);
            expect(world.findEntityByName('native entity')).toBe(world.getAllEntities()[0]);
        } finally { bind(); observe(); world.disconnectCpp(); next.delete(); }
    });
});

it.each(['SDK notification', 'native destroy'])('abandons the old population when a bulk clear occurs during %s', during => {
    const core = createMockModule(), registry = core.getRegistry(), world = new World();
    let epoch = 0;
    core.registry_entityChangeResetEpoch = () => epoch;
    world.connectCpp(registry, core);
    const root = world.spawn('old root'), child = world.spawn('old child');
    world.insert(root, SceneOwner, { scene: 'old', persistent: false });
    world.setParent(child, root);
    const delivered = vi.fn();
    let linked = false, claimed = false;
    function reset() {
        // Keep the host's registry object and replace its population, as Registry::clear does.
        Object.assign(registry, createMockModule().getRegistry());
        epoch++;
        const newRoot = world.spawn('new root'), newChild = world.spawn('new child');
        linked = world.trySetParent(newChild, newRoot);
        claimed = registry.reserveDestruction(newRoot);
    }
    const remove = registry.destroy;
    const off = world.onDespawn(entity => {
        if (entity !== child || during !== 'SDK notification' || epoch) return;
        reset();
    });
    if (during === 'native destroy') {
        registry.destroy = entity => {
            remove(entity);
            if (entity === child && !epoch) reset();
        };
    }
    const observe = world.onDespawn(delivered);
    try {
        world.despawn(root);
        expect(delivered.mock.calls).toEqual(during === 'SDK notification' ? [] : [[child]]);
        expect(linked && claimed).toBe(true);
        expect(world.getAllEntities()).toEqual([root, child]);
        expect(world.findEntityByName('new root')).toBe(root);
        expect(world.has(root, SceneOwner)).toBe(false);
        expect(registry.destructionPending(root)).toBe(true);
    } finally { off(); observe(); registry.releaseDestruction(root); world.disconnectCpp(); }
});
