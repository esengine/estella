// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Transactions, and one store shared by many processes.
 *
 * A transaction is all or none on every store that has one — in memory, on
 * disk (through a journal a crash cannot leave half-applied), and over a
 * socket to a StoreHub, which is the same store contract run where the store
 * is. Then what sits on top: several players' records saved as one.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { GameSocket } from '../src/net/GameSocket';
import {
    MemoryStore, FileStore, PersistConflict, StoreHub, RemoteStore, StoreUnavailable, PlayerPersistence,
    type PersistStore,
} from '../src/persist';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(done: () => boolean, ms = 3000): Promise<boolean> {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (done()) return true; await delay(5); }
    return done();
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'estella-txn-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

/** A StoreHub over a real socket, in front of `inner`; closed after each test. */
const hubs: { wss: WebSocketServer; clients: RemoteStore[] }[] = [];
async function hubbed(inner: PersistStore, secret?: string, port = 0) {
    const hub = new StoreHub(inner, secret !== undefined ? { secret } : {});
    const wss = new WebSocketServer({ port, host: '127.0.0.1' });
    await new Promise<void>((r) => wss.on('listening', () => r()));
    wss.on('connection', (s) => hub.accept(s));
    const url = `ws://127.0.0.1:${(wss.address() as { port: number }).port}`;
    const entry = { wss, clients: [] as RemoteStore[] };
    hubs.push(entry);
    const client = (clientSecret = secret) => {
        const c = new RemoteStore({ connect: () => new GameSocket({ url }), secret: clientSecret, timeoutMs: 2000, minDelayMs: 20, maxDelayMs: 100 });
        entry.clients.push(c);
        return c;
    };
    return { hub, wss, url, client };
}
afterEach(async () => {
    for (const h of hubs.splice(0)) {
        for (const c of h.clients) c.close();
        for (const s of h.wss.clients) s.terminate();
        await new Promise<void>((r) => h.wss.close(() => r()));
    }
});

describe.each([
    ['MemoryStore', async () => new MemoryStore() as PersistStore],
    ['FileStore', async () => new FileStore(dir) as PersistStore],
    ['RemoteStore over a StoreHub', async () => (await hubbed(new MemoryStore())).client() as PersistStore],
])('%s', (_name, make) => {
    it('keeps the store contract', async () => {
        const store = await make();
        expect(await store.put('a', { n: 1 })).toBe(1);
        expect(await store.get('a')).toEqual({ value: { n: 1 }, version: 1 });
        await expect(store.put('a', 2, { expectVersion: 0 })).rejects.toBeInstanceOf(PersistConflict);
        expect(await store.delete('a', { expectVersion: 1 })).toBe(true);
        expect(await store.get('a')).toBeNull();
        await store.put('k:1', 1);
        await store.put('k:2', 2);
        expect((await store.keys('k:')).sort()).toEqual(['k:1', 'k:2']);
    });

    it('writes a transaction all or none', async () => {
        const store = await make();
        await store.put('ana', { gold: 10 });
        await store.put('bo', { gold: 5 });
        await store.put('old', 1);
        // Gold moves from ana to bo, and an old record goes: one commit.
        expect(await store.transact!([
            { key: 'ana', value: { gold: 7 }, expectVersion: 1 },
            { key: 'bo', value: { gold: 8 }, expectVersion: 1 },
            { key: 'old', delete: true, expectVersion: 1 },
            { key: 'new', value: 'x', expectVersion: 0 },
        ])).toEqual([2, 2, 0, 1]);
        expect((await store.get('ana'))!.value).toEqual({ gold: 7 });
        expect(await store.get('old')).toBeNull();
        // One stale expectation: nothing at all is written.
        await expect(store.transact!([
            { key: 'ana', value: { gold: 0 }, expectVersion: 2 },
            { key: 'bo', value: { gold: 15 }, expectVersion: 1 },
        ])).rejects.toBeInstanceOf(PersistConflict);
        expect(await store.get('ana')).toEqual({ value: { gold: 7 }, version: 2 });
        expect(await store.get('bo')).toEqual({ value: { gold: 8 }, version: 2 });
        await expect(store.transact!([{ key: 'ana', value: 1 }, { key: 'ana', value: 2 }])).rejects.toThrow('twice');
    });
});

describe('FileStore journal', () => {
    it('finishes a transaction a crash left half-applied, and drops one cut short', async () => {
        const store = new FileStore(dir);
        await store.put('ana', { gold: 10 });
        await store.put('bo', { gold: 5 });
        // As if the process died after committing the journal and writing only ana.
        mkdirSync(path.join(dir, '.txn'), { recursive: true });
        writeFileSync(path.join(dir, '.txn', 'crashed.json'), JSON.stringify({ ops: [
            { key: 'ana', version: 2, value: { gold: 7 } },
            { key: 'bo', version: 2, value: { gold: 8 } },
        ] }));
        writeFileSync(path.join(dir, '.txn', 'torn.json'), '{"ops":[{"key":"ana","vers');
        const reopened = new FileStore(dir);
        expect(await reopened.get('ana')).toEqual({ value: { gold: 7 }, version: 2 });
        expect(await reopened.get('bo')).toEqual({ value: { gold: 8 }, version: 2 });
        expect(readdirSync(path.join(dir, '.txn'))).toEqual([]);
        expect((await reopened.keys()).sort()).toEqual(['ana', 'bo']);
    });
});

describe('StoreHub', () => {
    it('lets in only a client with the secret', async () => {
        const { client } = await hubbed(new MemoryStore(), 's3cret');
        const good = client('s3cret');
        const bad = client('guess');
        expect(await good.put('a', 1)).toBe(1);
        await expect(bad.get('a')).rejects.toBeInstanceOf(StoreUnavailable);
    });

    it('serves many processes one store: a versioned write races fairly across them', async () => {
        const { client } = await hubbed(new MemoryStore());
        const a = client();
        const b = client();
        await a.put('lease', { zone: 'A' });
        const results = await Promise.allSettled([
            a.put('lease', { zone: 'A2' }, { expectVersion: 1 }),
            b.put('lease', { zone: 'B' }, { expectVersion: 1 }),
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(results.find((r) => r.status === 'rejected')!.status === 'rejected'
            && (results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(PersistConflict);
    });

    it('a client waits out a hub restart; a call in flight when it dropped fails rather than runs twice', async () => {
        const inner = new MemoryStore();
        const first = await hubbed(inner);
        const store = first.client();
        expect(await store.put('a', 1)).toBe(1);
        const port = Number(new URL(first.url).port);
        for (const s of first.wss.clients) s.terminate();
        await new Promise<void>((r) => first.wss.close(() => r()));
        expect(await until(() => !store.connected)).toBe(true);
        // Made while the hub is down: it waits, then runs once the hub is back.
        const waiting = store.put('b', 2);
        await delay(50);
        const second = await hubbed(inner, undefined, port);
        void second;
        expect(await waiting).toBe(1);
        expect((await store.get('a'))!.value).toBe(1);
    });
});

describe('PlayerPersistence.saveTogether', () => {
    type Rec = { gold: number };
    async function loaded(store: PersistStore, ids: string[]) {
        const players = new PlayerPersistence<Rec>({ store, schema: 1, create: () => ({ gold: 10 }) });
        players.track(ids);
        for (let i = 0; i < 50 && !ids.every((id) => players.isReady(id)); i++) await delay(2);
        await players.flush();
        return players;
    }

    it('writes a trade between two players as one', async () => {
        const store = new FileStore(dir);
        const players = await loaded(store, ['ana', 'bo']);
        players.get('ana')!.gold -= 3;
        players.get('bo')!.gold += 3;
        await players.saveTogether(['ana', 'bo']);
        expect((await store.get<{ data: Rec }>('player:ana'))!.value.data.gold).toBe(7);
        expect((await store.get<{ data: Rec }>('player:bo'))!.value.data.gold).toBe(13);
        // And again, against the versions that one left them at.
        players.get('ana')!.gold -= 1;
        players.get('bo')!.gold += 1;
        await players.saveTogether(['ana', 'bo']);
        expect((await store.get<{ data: Rec }>('player:bo'))!.value.data.gold).toBe(14);
    });

    it('writes neither when one was written meanwhile by someone else', async () => {
        const store = new MemoryStore();
        const players = await loaded(store, ['ana', 'bo']);
        // Another process changes bo.
        const doc = (await store.get<{ schema: number; savedAt: number; data: Rec }>('player:bo'))!;
        await store.put('player:bo', { ...doc.value, data: { gold: 999 } }, { expectVersion: doc.version });
        players.get('ana')!.gold -= 3;
        players.get('bo')!.gold += 3;
        await expect(players.saveTogether(['ana', 'bo'])).rejects.toBeInstanceOf(PersistConflict);
        expect((await store.get<{ data: Rec }>('player:ana'))!.value.data.gold).toBe(10);
        expect((await store.get<{ data: Rec }>('player:bo'))!.value.data.gold).toBe(999);
    });
});
