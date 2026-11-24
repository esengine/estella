// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { Commands, CommandsInstance, type EntityCommands } from '../src/ecs/commands';
import { Children, Name, Parent, Sprite, Transform } from '../src/ecs/component';
import { getDefaultContext } from '../src/ecs/context';
import { Query } from '../src/ecs/query';
import { defineResource, ResourceStorage } from '../src/ecs/resource';
import { defineSystem, SystemRunner } from '../src/ecs/system';
import { World } from '../src/ecs/world';
import { INVALID_ENTITY, type Entity } from '../src/types';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';
import { createMockModule } from './mocks/wasm';

function gate() {
    let open!: () => void;
    const wait = new Promise<void>(resolve => { open = resolve; });
    return { open, wait };
}

describe.skipIf(!HAS_WASM)('structural commands belong to their system run and world', () => {
    let core: ESEngineModule;
    beforeAll(async () => { core = await loadWasmModule(); });

    it.each(['borrowed', 'owned'])('retires an awaiting system and its reserved spawn on %s restart', async ownership => {
        const app = App.new(), world = app.world, old = new core.Registry(), next = new core.Registry();
        const owned = ownership === 'owned', parked = gate(), resume = gate();
        const marker = defineResource('initial');
        app.connectCpp(old, core, { ownedRegistry: owned });
        const root = world.spawn('old root'), child = world.spawn('old child');
        world.insert(root, Transform);
        let reservation!: EntityCommands, oldRoot!: EntityCommands, reserved!: Entity, late!: Entity;
        let service: string | null = 'pending';
        app.addSystem(defineSystem([Query(Transform), Commands()], async (query, commands) => {
            for (const [id] of query) {
                oldRoot = commands.entity(id);
                reservation = commands.spawn('outgoing reservation');
                reserved = reservation.id();
                break;
            }
            commands.entity(child).remove(Transform).childOf(reserved);
            commands.despawn(child).insertResource(marker, 'outgoing');
            parked.open(); await resume.wait;
            oldRoot.insert(Name, { value: 'outgoing root' });
            late = commands.spawn('late spawn').id();
            service = commands.resource(marker);
        }, { name: 'ParkedCommandOwner' }));
        const tick = app.tick(1 / 60);
        try {
            await parked.wait;
            if (owned) app.quit({ keepRenderer: true });
            app.connectCpp(next, core);
            const fresh = [world.spawn('new root'), world.spawn('new child'), world.spawn('new third')];
            world.setParent(child, root); world.insert(child, Transform);
            app.insertResource(marker, 'replacement');
            resume.open(); await tick;
            expect(fresh).toEqual([root, child, reserved]);
            expect(world.getAllEntities()).toEqual(fresh);
            expect(next.entityCount()).toBe(3);
            expect(world.get(child, Parent).entity).toBe(root);
            expect(world.getEntitiesWithComponents([Transform])).toEqual([child]);
            expect(fresh.map(e => world.get(e, Name).value)).toEqual(['new root', 'new child', 'new third']);
            expect(app.getResource(marker)).toBe('replacement');
            expect(service).toBeNull();
            expect([oldRoot.id(), reservation.id(), late]).toEqual([INVALID_ENTITY, INVALID_ENTITY, INVALID_ENTITY]);
            if (!owned) {
                expect(old.entityCount()).toBe(2);
                expect(old.valid(reserved)).toBe(false);
            }
        } finally {
            resume.open(); await tick;
            app.quit({ keepRenderer: true });
            if (!owned) old.delete();
            next.delete();
        }
    });

    it('stops a partially applied spawn if a component observer replaces the registry', () => {
        const world = new World(), old = new core.Registry(), next = new core.Registry();
        world.connectCpp(old, core);
        const storage = new ResourceStorage(), queue = new CommandsInstance(world, storage);
        const root = world.spawn('root');
        const staged = queue.spawn().insert(Transform).insert(Name, { value: 'late name' }).childOf(root);
        const names: string[] = [];
        const context = getDefaultContext(), previous = context.editorBridge;
        context.editorBridge = { registerComponent() {}, onComponentAdded(_id, component) {
            if (component !== Transform._name || world.getCppRegistry() !== old) return;
            world.connectCpp(next, core);
            world.spawn('new root'); world.spawn('new child');
            const fresh = new CommandsInstance(world, storage);
            fresh.spawn('current work'); fresh.flush();
        } };
        try {
            queue.spawn('another old spawn');
            const id = staged.id();
            queue.flush();
            for (const e of world.getAllEntities()) names.push(world.get(e, Name).value);
            expect(id).toBe(INVALID_ENTITY);
            expect(names).toEqual(['new root', 'new child', 'current work']);
            expect(next.hasParent(world.getAllEntities()[1]!)).toBe(false);
        } finally { context.editorBridge = previous; world.disconnectCpp(); old.delete(); next.delete(); }
    });

    it('flushes each suspended invocation only when its own system returns', async () => {
        const world = new World(), old = new core.Registry(), next = new core.Registry();
        const runner = new SystemRunner(world, new ResourceStorage()), runs = [gate(), gate()];
        let run = 0;
        world.connectCpp(old, core);
        const system = defineSystem([Commands()], async commands => {
            const i = run++;
            commands.spawn(i ? 'current' : 'outgoing');
            await runs[i]!.wait;
        });
        try {
            const first = runner.run(system);
            world.connectCpp(next, core);
            const second = runner.run(system);
            runs[0]!.open(); await first;
            expect(world.getAllEntities()).toEqual([]);
            runs[1]!.open(); await second;
            expect(world.getAllEntities().map(e => world.get(e, Name).value)).toEqual(['current']);
        } finally { for (const r of runs) r.open(); world.disconnectCpp(); old.delete(); next.delete(); }
    });

    it('keeps a queued spawn name and its notifications with the old registry', () => {
        const world = new World(), old = new core.Registry(), next = new core.Registry();
        world.connectCpp(old, core);
        const context = getDefaultContext(), previous = context.editorBridge;
        const seen: string[] = [];
        context.editorBridge = {
            registerComponent() {},
            onComponentAdded(_entity, name) {
                if (name === Name._name && world.getCppRegistry() === old) {
                    world.connectCpp(next, core);
                    world.spawn('replacement');
                }
            },
            onComponentChanged(entity, name) {
                if (name === Name._name) seen.push('change ' + world.get(entity as Entity, Name).value);
            },
            onEntitySpawned(_entity, name) { seen.push('spawn ' + name); },
        };
        try {
            const queue = new CommandsInstance(world, new ResourceStorage()), staged = queue.spawn('outgoing');
            queue.flush();
            expect(staged.id()).toBe(INVALID_ENTITY);
            expect(world.findEntityByName('replacement')).toBe(world.getAllEntities()[0]);
            expect(world.findEntityByName('outgoing')).toBeNull();
            expect(seen).toEqual(['change replacement', 'spawn replacement']);
        } finally { context.editorBridge = previous; world.disconnectCpp(); old.delete(); next.delete(); }
    });

    it.each(['insert', 'remove'])('stops a queued Children %s after a hierarchy observer switches world', action => {
        const world = new World(), old = new core.Registry(), next = new core.Registry();
        world.connectCpp(old, core);
        const root = world.spawn(), a = world.spawn(), b = world.spawn();
        if (action === 'remove') { world.setParent(a, root); world.setParent(b, root); }
        const context = getDefaultContext(), previous = context.editorBridge;
        context.editorBridge = { registerComponent() {}, onParentChanged() {
            if (world.getCppRegistry() !== old) return;
            world.connectCpp(next, core);
            world.spawn(); world.spawn(); world.spawn();
            if (action === 'remove') world.setParent(b, a);
        } };
        try {
            const commands = new CommandsInstance(world, new ResourceStorage());
            if (action === 'insert') commands.entity(root).insert(Children, { entities: [a, b] });
            else commands.entity(root).remove(Children);
            commands.flush();
            expect(next.hasParent(b)).toBe(action === 'remove');
            if (action === 'remove') expect(next.getParent(b).entity).toBe(a);
        } finally { context.editorBridge = previous; world.disconnectCpp(); old.delete(); next.delete(); }
    });

    it('ends asset notifications and pending loads if an observer restarts the world', () => {
        const world = new World(), old = new core.Registry(), next = new core.Registry();
        world.connectCpp(old, core);
        const entity = world.spawn(), delivered: string[] = [];
        world.setAssetFieldResolver(() => { delivered.push('resolve'); });
        const replace = world.onAssetFieldsChanged(() => {
            world.connectCpp(next, core);
            world.spawn('replacement');
        });
        const watch = world.onAssetFieldsChanged(() => { delivered.push('observe'); });
        try {
            const commands = new CommandsInstance(world, new ResourceStorage());
            commands.entity(entity).insert(Sprite, { texture: 'outgoing.png' });
            commands.flush();
            expect(delivered).toEqual([]);
            expect(world.findEntityByName('replacement')).toBe(entity);
            expect(world.has(entity, Sprite)).toBe(false);
        } finally { replace(); watch(); world.disconnectCpp(); old.delete(); next.delete(); }
    });

    it('retires a logic-only reservation before attaching the first native registry', () => {
        const world = new World(), next = new core.Registry();
        const commands = new CommandsInstance(world, new ResourceStorage());
        const held = commands.spawn('logic reservation');
        world.beginIteration();
        const original = held.id();
        world.endIteration();
        try {
            world.connectCpp(next, core);
            const fresh = world.spawn('native');
            commands.flush();
            expect(held.id()).toBe(INVALID_ENTITY);
            expect(world.valid(original)).toBe(false);
            expect(world.getAllEntities()).toEqual([fresh]);
        } finally { world.disconnectCpp(); next.delete(); }
    });

    it('keeps same-registry refreshes live and publishes once during a recursive flush', () => {
        const world = new World(), registry = new core.Registry();
        world.connectCpp(registry, core);
        const queue = new CommandsInstance(world, new ResourceStorage());
        const builder = queue.spawn('only spawn').insert(Transform);
        const notified: Entity[] = [], during: Entity[] = [];
        const off = world.onSpawn(e => {
            notified.push(e);
            if (notified.length === 1) { during.push(builder.id()); queue.flush(); }
        });
        try {
            world.connectCpp(registry, core);
            queue.flush(); queue.flush();
            expect(notified).toEqual([builder.id()]);
            expect(during).toEqual(notified);
            expect(registry.entityCount()).toBe(1);
            expect(world.has(builder.id(), Transform)).toBe(true);
            queue.spawn('same queue'); queue.flush();
            expect(registry.entityCount()).toBe(2);
        } finally { off(); world.disconnectCpp(); registry.delete(); }
    });

    it('drains work requested by a running command in order, including a recursive flush', () => {
        const world = new World(), registry = new core.Registry();
        world.connectCpp(registry, core);
        const queue = new CommandsInstance(world, new ResourceStorage());
        const first = world.spawn('first'), second = world.spawn('second');
        const events: string[] = [];
        const off = world.onDespawn(entity => {
            events.push(world.get(entity, Name).value);
            if (entity !== first) return;
            queue.spawn('nested spawn');
            queue.flush();
            events.push(world.findEntityByName('nested spawn') === null ? 'missing' : 'nested spawn');
        });
        try {
            queue.despawn(first).despawn(second);
            queue.flush();
            expect(events).toEqual(['first', 'second', 'nested spawn']);
            expect(registry.entityCount()).toBe(1);
            expect(world.getAllEntities()).toEqual([world.findEntityByName('nested spawn')]);
        } finally { off(); world.disconnectCpp(); registry.delete(); }
    });
});

it('retries a failed spawn on its allocated handle after a nested flush drained the queue', () => {
    const world = new World(), queue = new CommandsInstance(world, new ResourceStorage());
    const first = queue.spawn().insert(Name, { value: 'first' });
    queue.spawn();
    const failure = new Error('component failed');
    const off = world.onSpawn(() => { off(); queue.flush(); });
    const insert = vi.spyOn(world, 'insert').mockImplementationOnce(() => { throw failure; });
    try {
        expect(() => queue.flush()).toThrow(failure);
        expect(world.entityCount()).toBe(2);
        queue.flush();
        expect(world.findEntityByName('first')).toBe(first.id());
        expect(world.entityCount()).toBe(2);
    } finally { off(); insert.mockRestore(); }
});

it('drops unpublished reservations on a native clear without destroying a reused raw handle', () => {
    const world = new World(), core = createMockModule(), registry = core.getRegistry();
    let epoch = 0;
    core.registry_entityChangeResetEpoch = () => epoch;
    world.connectCpp(registry, core);
    const storage = new ResourceStorage(), commands = new CommandsInstance(world, storage);
    world.beginIteration();
    const a = commands.spawn('old A'), b = commands.spawn('old B');
    const first = a.id(), second = b.id();
    world.endIteration();
    const raw = createMockModule().getRegistry();
    Object.assign(registry, raw); epoch++;
    const external = registry.create();
    const current = new CommandsInstance(world, storage);
    world.beginIteration();
    const fresh = current.spawn('new reservation');
    const reserved = fresh.id();
    world.endIteration();
    try {
        commands.flush();
        expect([external, reserved]).toEqual([first, second]);
        expect(a.id()).toBe(INVALID_ENTITY);
        expect(b.id()).toBe(INVALID_ENTITY);
        expect(registry.valid(external)).toBe(true);
        expect(world.getAllEntities()).toEqual([reserved]);
        expect(world.getEntitiesWithComponents([])).toEqual([]);
        current.flush();
        expect(world.findEntityByName('new reservation')).toBe(reserved);
        expect(registry.entityCount()).toBe(2);
    } finally { world.disconnectCpp(); }
});

it('stops returning reservations if native destruction resets the registry mid-cleanup', () => {
    const world = new World(), core = createMockModule(), registry = core.getRegistry();
    let epoch = 0;
    core.registry_entityChangeResetEpoch = () => epoch;
    world.connectCpp(registry, core);
    const first = world.reserveEntity(), second = world.reserveEntity(), removed: Entity[] = [];
    const destroy = registry.destroy;
    registry.destroy = e => {
        removed.push(e);
        destroy(e);
        Object.assign(registry, createMockModule().getRegistry()); epoch++;
        registry.create(); registry.create();
    };
    world.disconnectCpp();
    expect(removed).toEqual([first]);
    expect(registry.valid(first) && registry.valid(second)).toBe(true);
    expect(world.getAllEntities()).toEqual([]);
});
