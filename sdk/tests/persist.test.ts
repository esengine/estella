// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  esengine/persist: what a server keeps across restarts.
 *
 * The store contract is run against both stores the SDK ships, since a game's
 * database adapter is held to the same one. Above it: records migrate, player
 * records follow the players present and never let a stale copy overwrite a
 * newer one, and world entities marked Persistent come back after a restart
 * (a second App over the same store standing in for the restarted process).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { App } from '../src/app/app';
import { clearUserComponents, defineComponent, getUserComponents, unregisterComponent, Name } from '../src/ecs/component';
import {
    MemoryStore, FileStore, PersistConflict, RecordBook, PlayerPersistence, WorldPersistence, Persistent,
    snapshotEntity, restoreEntity, type PersistStore,
} from '../src/persist';
import { replicationPlugin, Replicated } from '../src/net/replication';
import type { Entity } from '../src/types';
import { reservePromise } from '../src/util/reservePromise';
import { registerWorldSceneComponentCodec } from '../src/scene/scene';
import { connectFakeCpp } from './helpers/fakeEngine';

let dir: string;
let Bag: ReturnType<typeof defineComponent<{ gold: number; items: string[] }>>;
let Spot: ReturnType<typeof defineComponent<{ x: number; y: number }>>;

beforeEach(() => {
    clearUserComponents();
    Bag = defineComponent('Bag', { gold: 0, items: [] as string[] });
    Spot = defineComponent('Spot', { x: 0, y: 0 });
    dir = mkdtempSync(path.join(tmpdir(), 'estella-persist-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

const flushTasks = () => new Promise((r) => setTimeout(r, 0));
async function settle(p: PlayerPersistence<unknown>) {
    for (let i = 0; i < 20 && p.pendingOperations > 0; i++) await flushTasks();
}

describe.each([
    ['MemoryStore', () => new MemoryStore() as PersistStore],
    ['FileStore', () => new FileStore(dir) as PersistStore],
])('%s', (_name, make) => {
    it('stores JSON under a key and moves the version on each write', async () => {
        const store = make();
        expect(await store.get('a')).toBeNull();
        expect(await store.put('a', { n: 1 })).toBe(1);
        expect(await store.put('a', { n: 2 })).toBe(2);
        expect(await store.get('a')).toEqual({ value: { n: 2 }, version: 2 });
    });

    it('refuses a write that expected another version', async () => {
        const store = make();
        await store.put('a', 1, { expectVersion: 0 });
        await expect(store.put('a', 2, { expectVersion: 0 })).rejects.toBeInstanceOf(PersistConflict);
        await expect(store.put('a', 2, { expectVersion: 5 })).rejects.toThrow('version 1');
        expect(await store.put('a', 2, { expectVersion: 1 })).toBe(2);
        await expect(store.delete('a', { expectVersion: 1 })).rejects.toBeInstanceOf(PersistConflict);
        expect(await store.delete('a', { expectVersion: 2 })).toBe(true);
        expect(await store.delete('a')).toBe(false);
    });

    it('lists keys by prefix, any characters and case kept apart', async () => {
        const store = make();
        await store.put('player:Ana', 1);
        await store.put('player:ana', 2);
        await store.put('player:路 /*?', 3);
        await store.put('entity:x', 4);
        expect((await store.keys('player:')).sort()).toEqual(['player:Ana', 'player:ana', 'player:路 /*?'].sort());
        expect((await store.get('player:Ana'))!.value).toBe(1);
        expect((await store.get('player:路 /*?'))!.value).toBe(3);
        expect((await store.keys()).length).toBe(4);
    });

    it('keeps no reference to what was written or read', async () => {
        const store = make();
        const v = { list: [1] };
        await store.put('a', v);
        v.list.push(2);
        const read = await store.get<{ list: number[] }>('a');
        read!.value.list.push(3);
        expect((await store.get('a'))!.value).toEqual({ list: [1] });
    });
});

describe('FileStore on disk', () => {
    it('survives a new instance over the same directory, and leaves no temporary files', async () => {
        await Promise.all([1, 2, 3, 4, 5].map((n) => new FileStore(dir).put('k', n)));
        const again = new FileStore(dir);
        expect((await again.get('k'))!.version).toBeGreaterThanOrEqual(1);
        const one = new FileStore(dir);
        await Promise.all([1, 2, 3].map((n) => one.put('serial', n)));
        expect((await one.get('serial'))!.version).toBe(3);
        expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    });
});

describe('RecordBook', () => {
    it('migrates an old record forward and refuses one from the future', async () => {
        const store = new MemoryStore();
        const v1 = new RecordBook<{ hp: number }>({ store, schema: 1 });
        await v1.save('ana', { hp: 7 });
        const v2 = new RecordBook<{ hp: number; mp: number }>({
            store, schema: 2, migrations: { 1: (d) => ({ ...(d as object), mp: 3 }) },
        });
        expect((await v2.load('ana'))!.data).toEqual({ hp: 7, mp: 3 });
        await v2.save('bo', { hp: 1, mp: 1 });
        await expect(v1.load('bo')).rejects.toThrow('newer');
    });
});

describe('PlayerPersistence', () => {
    type Rec = { gold: number };
    const make = (store: PersistStore, extra: Partial<ConstructorParameters<typeof PlayerPersistence<Rec>>[0]> = {}) =>
        new PlayerPersistence<Rec>({ store, schema: 1, create: () => ({ gold: 10 }), ...extra });

    it('loads a newcomer, creates one with no record, and saves on leaving', async () => {
        const store = new MemoryStore();
        const players = make(store);
        players.track(['ana']);
        expect(players.isReady('ana')).toBe(false);
        await settle(players as PlayerPersistence<unknown>);
        expect(players.get('ana')).toEqual({ gold: 10 });
        players.get('ana')!.gold = 25;
        players.markDirty('ana');
        players.track([]);
        await settle(players as PlayerPersistence<unknown>);
        expect(players.isReady('ana')).toBe(false);
        expect((await store.get('player:ana'))!.value).toMatchObject({ schema: 1, data: { gold: 25 } });
    });

    it('a player who leaves and comes straight back reads what they left with', async () => {
        const store = new MemoryStore();
        const players = make(store);
        players.track(['ana']);
        await settle(players as PlayerPersistence<unknown>);
        players.set('ana', { gold: 99 });
        players.track([]);          // leave: the write is queued, not done
        players.track(['ana']);     // back at once: the load waits behind it
        await settle(players as PlayerPersistence<unknown>);
        expect(players.get('ana')).toEqual({ gold: 99 });
    });

    it('autosaves changed records on its timer, and only changed ones', async () => {
        let clock = 0;
        const store = new MemoryStore();
        const players = make(store, { autosaveMs: 1000, now: () => clock });
        players.track(['ana', 'bo']);
        await settle(players as PlayerPersistence<unknown>);
        clock = 1000;
        players.track(['ana', 'bo']); // first save of two new players
        await settle(players as PlayerPersistence<unknown>);
        const before = (await store.get('player:bo'))!.version;
        players.set('ana', { gold: 1 });
        clock = 2000;
        players.track(['ana', 'bo']);
        await settle(players as PlayerPersistence<unknown>);
        expect((await store.get('player:ana'))!.version).toBe(2);
        expect((await store.get('player:bo'))!.version).toBe(before);
    });

    it('never overwrites a newer record someone else wrote', async () => {
        const store = new MemoryStore();
        const errors: string[] = [];
        const players = make(store, { onError: (id, err, during) => errors.push(`${id}:${during}:${(err as Error).name}`) });
        players.track(['ana']);
        await settle(players as PlayerPersistence<unknown>);
        // Another server process writes her record meanwhile.
        await new RecordBook<Rec>({ store, schema: 1, prefix: 'player:' }).save('ana', { gold: 500 });
        players.set('ana', { gold: 1 });
        await players.save('ana');
        expect(errors).toEqual(['ana:save:PersistConflict']);
        expect((await store.get<{ data: Rec }>('player:ana'))!.value.data.gold).toBe(500);
    });

    it('retries a failed load after retryMs, and flush writes everything for shutdown', async () => {
        let clock = 0;
        let fail = true;
        const inner = new MemoryStore();
        const flaky: PersistStore = {
            get: (k) => (fail ? Promise.reject(new Error('db down')) : inner.get(k)),
            put: (k, v, o) => inner.put(k, v, o),
            delete: (k, o) => inner.delete(k, o),
            keys: (p) => inner.keys(p),
        };
        const errors: string[] = [];
        const players = make(flaky, { retryMs: 500, now: () => clock, onError: (_id, e) => errors.push((e as Error).message) });
        players.track(['ana']);
        await settle(players as PlayerPersistence<unknown>);
        expect(errors).toEqual(['db down']);
        fail = false;
        players.track(['ana']);
        await settle(players as PlayerPersistence<unknown>);
        expect(players.isReady('ana')).toBe(false); // not yet: retry is not due
        clock = 500;
        players.track(['ana']);
        await settle(players as PlayerPersistence<unknown>);
        expect(players.isReady('ana')).toBe(true);
        players.set('ana', { gold: 3 });
        await players.flush();
        expect((await inner.get<{ data: Rec }>('player:ana'))!.value.data.gold).toBe(3);
    });
});

describe('entity snapshots', () => {
    it('runs component export only for types included in the snapshot', () => {
        const app = App.new(), world = app.world;
        const entity = world.spawn('level');
        world.insert(entity, Bag, { gold: 5, items: [] });
        world.insert(entity, Spot, { x: 1, y: 2 });
        const exportBag = vi.fn(), exportSpot = vi.fn();
        registerWorldSceneComponentCodec(world, 'Bag', { exportData: exportBag });
        registerWorldSceneComponentCodec(world, 'Spot', { exportData: exportSpot });
        try {
            expect(snapshotEntity(world, entity, { include: ['Spot'], exclude: ['Bag'] }).components).toEqual([
                { type: 'Spot', data: { x: 1, y: 2 } },
            ]);
            expect(exportSpot).toHaveBeenCalledOnce();
            expect(exportBag).not.toHaveBeenCalled();
        } finally { app.quit(); }
    });

    it('keeps process-local identity out of saves and restores through component aliases', () => {
        const world = App.new().world, entity = world.spawn();
        for (const def of [Replicated, Persistent]) unregisterComponent(def._name);
        getUserComponents().set('NetworkIdentity', Replicated);
        getUserComponents().set('SaveMarker', Persistent);
        world.insert(entity, Replicated, { netId: 91, owner: 17, archetype: 'hero' });
        world.insert(entity, Persistent, { key: 'local' });
        const saved = snapshotEntity(world, entity);
        expect(saved.components).toEqual([{ type: 'NetworkIdentity', data: { netId: 0, owner: 0, archetype: 'hero' } }]);
        restoreEntity(world, saved, entity);
        expect(world.get(entity, Replicated)).toEqual({ netId: 91, owner: 17, archetype: 'hero' });
        const legacy = { components: [
            { type: 'NetworkIdentity', data: { netId: 23, owner: 5, archetype: 'saved' } },
            { type: 'SaveMarker', data: { key: 'old-process' } },
        ] };
        const fresh = restoreEntity(world, legacy);
        expect(world.get(fresh, Replicated)).toEqual({ netId: 0, owner: 0, archetype: 'saved' });
        expect(world.has(fresh, Persistent)).toBe(false);
    });

    it('restores independent copies of the nested data in a reusable snapshot', () => {
        const w = App.new().world;
        const template = { components: [{ type: 'Bag', data: { gold: 9, items: ['key'] } }] };
        const first = restoreEntity(w, template), second = restoreEntity(w, template);
        w.update(first, Bag, bag => { bag.items.push('coin'); });
        expect(w.get(first, Bag).items).toEqual(['key', 'coin']);
        expect(template.components[0].data.items).toEqual(['key']);
        expect(w.get(second, Bag).items).toEqual(['key']);
    });

    it('clears scalar and list references using the declaration that supplied each row', () => {
        const world = App.new().world, actor = world.spawn('Actor'), other = world.spawn('Other');
        const type = 'PersistentTargetList', defaults = { targets: [] as number[], values: [] as number[] };
        const original = defineComponent(type, defaults, { entityFields: ['targets'] });
        const ids = [actor, other, 0, other];
        world.insert(actor, original, { targets: ids, values: ids });
        unregisterComponent(type);
        const current = defineComponent(type, defaults, { entityFields: ['values'] });
        world.insert(other, current, { targets: ids, values: ids });
        const capture = (entity: Entity) => snapshotEntity(world, entity, { include: [type] }).components[0].data;
        expect(capture(actor)).toEqual({ targets: [0, 0, 0, 0], values: ids });
        expect(capture(other)).toEqual({ targets: ids, values: [0, 0, 0, 0] });
        expect(world.get(actor, original).targets).toEqual(ids);
        const fresh = App.new().world;
        const restored = restoreEntity(fresh, JSON.parse(JSON.stringify(snapshotEntity(world, actor))));
        expect(fresh.get(restored, current)).toEqual({ targets: [0, 0, 0, 0], values: ids });
    });

    it('round-trip components, leave out process state, and zero entity references', () => {
        const app = App.new();
        app.addPlugin(replicationPlugin);
        const Follows = defineComponent('Follows', { target: 0 }, { entityFields: ['target'] });
        const w = app.world;
        const other = w.spawn('other');
        const e = w.spawn('chest');
        w.insert(e, Bag, { gold: 5, items: ['key'] });
        w.insert(e, Follows, { target: other as unknown as number });
        w.insert(e, Replicated, { owner: 3, archetype: 'chest' });
        const snap = snapshotEntity(w, e);
        expect(snap.name).toBe('chest');
        const types = snap.components.map((c) => c.type).sort();
        expect(types).toContain('Bag');
        expect(snap.components.find((c) => c.type === 'Follows')!.data.target).toBe(0);
        expect(snap.components.find((c) => c.type === 'Replicated')!.data).toEqual({ netId: 0, owner: 0, archetype: 'chest' });
        expect(snapshotEntity(w, e, { include: ['Bag'] }).components.map((c) => c.type)).toEqual(['Bag']);

        const fresh = App.new().world;
        const back = restoreEntity(fresh, JSON.parse(JSON.stringify(snap)));
        expect((fresh.tryGet(back, Name) as { value: string }).value).toBe('chest');
        expect(fresh.tryGet(back, Bag)).toEqual({ gold: 5, items: ['key'] });
    });
});

describe('WorldPersistence', () => {
    const named = (app: App, name: string): Entity | undefined =>
        app.world.getEntitiesWithComponents([Persistent])
            .find((e) => (app.world.tryGet(e, Name) as { value: string } | null)?.value === name);

    it('restores into the current entity and queues a flush behind a pending read', async () => {
        const store = new MemoryStore(), app = App.new();
        const book = new RecordBook({ store, schema: 1, prefix: 'entity:' });
        await book.save('hero', { name: 'Hero', components: [{ type: 'Bag', data: { gold: 25, items: [] } }] });
        const place = () => {
            const entity = app.world.spawn('Hero');
            app.world.insert(entity, Bag, { gold: 1, items: [] });
            app.world.insert(entity, Persistent, { key: 'hero' });
            return entity;
        };
        const original = place();
        const reading = reservePromise<void>(), release = reservePromise<void>();
        const get = store.get.bind(store);
        vi.spyOn(store, 'get').mockImplementationOnce(async key => {
            reading.resolve();
            await release.promise;
            return get(key);
        });
        const put = vi.spyOn(store, 'put');
        const keeper = new WorldPersistence({ store, schema: 1 });
        const restore = keeper.restore(app.world);
        let flush: ReturnType<WorldPersistence['flush']> | undefined;
        try {
            await reading.promise;
            app.world.despawn(original);
            const replacement = place();
            flush = keeper.flush(app.world);
            void flush.catch(() => undefined);
            await flushTasks();
            expect(put).not.toHaveBeenCalled();

            release.resolve();
            expect(await restore).toBe(1);
            expect(await flush).toEqual({ written: 0, deleted: 0 });
            expect(app.world.getEntitiesWithComponents([Persistent])).toEqual([replacement]);
            expect(app.world.get(replacement, Bag).gold).toBe(25);
        } finally { release.resolve(); await Promise.allSettled([restore, flush]); app.quit(); }
    });

    it('leaves the world untouched on a later read failure and restores all records on retry', async () => {
        const store = new MemoryStore(), app = App.new();
        const book = new RecordBook({ store, schema: 1, prefix: 'entity:' });
        for (const key of ['first', 'second']) {
            await book.save(key, { name: key, components: [{ type: 'Bag', data: { gold: 5, items: [] } }] });
        }
        const placed = app.world.spawn('first');
        app.world.insert(placed, Persistent, { key: 'first' });
        app.world.insert(placed, Bag, { gold: 1, items: [] });
        const get = store.get.bind(store);
        const failure = new Error('second record unavailable');
        vi.spyOn(store, 'get').mockImplementationOnce(key => get(key)).mockRejectedValueOnce(failure);
        const keeper = new WorldPersistence({ store, schema: 1 });
        try {
            await expect(keeper.restore(app.world)).rejects.toBe(failure);
            expect(app.world.get(placed, Bag).gold).toBe(1);
            expect(app.world.getEntitiesWithComponents([Persistent])).toEqual([placed]);
            expect(await keeper.restore(app.world)).toBe(2);
            expect(app.world.get(placed, Bag).gold).toBe(5);
            expect(await keeper.flush(app.world)).toEqual({ written: 0, deleted: 0 });
        } finally { app.quit(); }
    });

    it('does not apply a pending restore to a replacement registry', async () => {
        const store = new MemoryStore(), app = App.new();
        const book = new RecordBook({ store, schema: 1, prefix: 'entity:' });
        await book.save('hero', { name: 'Hero', components: [] });
        const reading = reservePromise<void>(), release = reservePromise<void>();
        const get = store.get.bind(store);
        vi.spyOn(store, 'get').mockImplementationOnce(async key => {
            reading.resolve();
            await release.promise;
            return get(key);
        });
        const keeper = new WorldPersistence({ store, schema: 1 });
        const restore = keeper.restore(app.world);
        try {
            await reading.promise;
            connectFakeCpp(app.world);
            release.resolve();
            await expect(restore).rejects.toThrow('the world changed during entity restore');
            expect(app.world.getAllEntities()).toEqual([]);
            expect(await keeper.restore(app.world)).toBe(1);
        } finally { release.resolve(); await Promise.allSettled([restore]); app.quit(); }
    });

    it('reports a partial write once and lets a queued flush retry the unwritten entity', async () => {
        const store = new MemoryStore(), app = App.new();
        const keeper = new WorldPersistence({ store, schema: 1 });
        for (const key of ['first', 'retry']) {
            const entity = app.world.spawn(key);
            app.world.insert(entity, Bag, { gold: 1, items: [] });
            app.world.insert(entity, Persistent, { key });
        }
        const entered = reservePromise<void>(), release = reservePromise<void>();
        const original = store.put.bind(store);
        const failure = new Error('store unavailable');
        let inject = true;
        const put = vi.spyOn(store, 'put').mockImplementation(async (key, value, options) => {
            if (key === 'entity:retry' && inject) {
                inject = false;
                entered.resolve();
                await release.promise;
                throw failure;
            }
            return original(key, value, options);
        });
        const failed = expect(keeper.flush(app.world)).rejects.toBe(failure);
        try {
            await entered.promise;
            app.world.update(named(app, 'retry')!, Bag, bag => { bag.gold = 2; });
            const queued = keeper.flush(app.world);
            release.resolve();
            await failed;
            expect(await queued).toEqual({ written: 1, deleted: 0 });
            expect(put.mock.calls.map(([key]) => key)).toEqual(['entity:first', 'entity:retry', 'entity:retry']);
            expect(await keeper.flush(app.world)).toEqual({ written: 0, deleted: 0 });
            const fresh = App.new();
            try {
                const restorer = new WorldPersistence({ store, schema: 1 });
                expect(await restorer.restore(fresh.world)).toBe(2);
                expect(fresh.world.get(named(fresh, 'retry')!, Bag).gold).toBe(2);
            } finally { fresh.quit(); }
        } finally { release.resolve(); app.quit(); }
    });

    it('brings persistent entities back after a restart, and writes only what changed', async () => {
        const store = new FileStore(dir);
        const first = App.new();
        const keeper = new WorldPersistence({ store, schema: 1 });
        const chest = first.world.spawn('chest');
        first.world.insert(chest, Bag, { gold: 5, items: [] });
        first.world.insert(chest, Persistent, { key: 'chest-1' });
        const rock = first.world.spawn('rock');
        first.world.insert(rock, Spot, { x: 1, y: 2 });
        first.world.insert(rock, Persistent, {});
        first.world.spawn('not kept');

        expect(await keeper.flush(first.world)).toEqual({ written: 2, deleted: 0 });
        expect((first.world.tryGet(rock, Persistent) as { key: string }).key).not.toBe('');
        expect(await keeper.flush(first.world)).toEqual({ written: 0, deleted: 0 });
        first.world.update(chest, Bag, (d) => { (d as { gold: number }).gold = 6; });
        expect(await keeper.flush(first.world)).toEqual({ written: 1, deleted: 0 });

        // The restarted process: its scene places the chest again, not the rock.
        clearUserComponents();
        Bag = defineComponent('Bag', { gold: 0, items: [] as string[] });
        Spot = defineComponent('Spot', { x: 0, y: 0 });
        const second = App.new();
        const placed = second.world.spawn('chest');
        second.world.insert(placed, Bag, { gold: 0, items: [] });
        second.world.insert(placed, Persistent, { key: 'chest-1' });
        const restorer = new WorldPersistence({ store: new FileStore(dir), schema: 1 });
        expect(await restorer.restore(second.world)).toBe(2);
        expect(named(second, 'chest')).toBe(placed);
        expect(second.world.tryGet(placed, Bag)).toEqual({ gold: 6, items: [] });
        expect(second.world.tryGet(named(second, 'rock')!, Spot)).toEqual({ x: 1, y: 2 });
        expect(named(second, 'not kept')).toBeUndefined();
        expect(await restorer.flush(second.world)).toEqual({ written: 0, deleted: 0 });

        second.world.despawn(named(second, 'rock')!);
        expect(await restorer.flush(second.world)).toEqual({ written: 0, deleted: 1 });
        expect(await store.keys('entity:')).toEqual(['entity:chest-1']);
    });
});
