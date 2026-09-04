// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  RC11 N2 keystone gate: two Apps in one process — an authoritative
 *        server and a replica client wired through MemoryTransport — step
 *        fixed ticks and must agree field-by-field. Covers the handshake
 *        (version/ABI/schema fail-loud), spawn/despawn ghosts, delta frames
 *        (only dirty fields move), late-joiner current-state spawn, and the
 *        reflection-driven codec round trip.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { App } from '../src/app/app';
import { defineComponent, clearUserComponents } from '../src/ecs/component';
import { ABI_LAYOUT_HASH } from '../src/ecs/component.generated';
import { MemoryTransport } from '../src/net/MemoryTransport';
import { NetChannel } from '../src/net/NetChannel';
import {
    replicationPlugin, Net, Replicated, NetGhost,
    ReplMsg, REPLICATION_PROTOCOL_VERSION,
    buildReplicationTable, tableSchemas, diffSchemas, ReplicationServer,
    ByteWriter, ByteReader, encodeValue, decodeValue, FrameWriter, decodeStateFrame,
    type ReplHelloResponse, type FieldShape,
} from '../src/net/replication';

const STEP = 1 / 60;

function makeApp(): App {
    const app = App.new();
    app.addPlugin(replicationPlugin);
    return app;
}

/** One server + one client, already handshaken over a MemoryTransport pair. */
async function makePair() {
    const serverApp = makeApp();
    const clientApp = makeApp();
    const server = serverApp.getResource(Net).startServer();
    const [ta, tb] = MemoryTransport.pair();
    server.attachConnection(ta);
    const client = await clientApp.getResource(Net).connect(tb, { interpolationDelayTicks: 0 });
    return { serverApp, clientApp, server, client };
}

let NetPos: ReturnType<typeof defineComponent<{ x: number; y: number; secret: number }>>;
let NetTag: ReturnType<typeof defineComponent<{ label: string; active: boolean }>>;
let NetLink: ReturnType<typeof defineComponent<{ target: number }>>;

beforeEach(() => {
    clearUserComponents();
    NetPos = defineComponent('NetPos', { x: 0, y: 0, secret: 0 }, {
        replicatedFields: ['x', 'y'],
    });
    NetTag = defineComponent('NetTag', { label: '', active: false }, {
        replicatedFields: ['label', 'active'],
    });
    // An entity reference: `0` on the wire is a netId, not a coordinate.
    NetLink = defineComponent('NetLink', { target: 0 }, {
        replicatedFields: ['target'],
        entityFields: ['target'],
    });
});

describe('replication handshake', () => {
    it('accepts a matching client and assigns a connection id', async () => {
        const { client } = await makePair();
        expect(client.connected).toBe(true);
        expect(client.connectionId).toBeGreaterThan(0);
    });

    it('commits the client role synchronously — authority never runs during the handshake', async () => {
        const clientApp = makeApp();
        const session = clientApp.getResource(Net);
        // Manual flush keeps the handshake in flight indefinitely.
        const [, tb] = MemoryTransport.pair({ manualFlush: true });
        const pending = session.connect(tb, { interpolationDelayTicks: 0 });
        // The moment connect() is called the session is a client — ticks that
        // run while the server is still booting must gate authority systems.
        expect(session.role).toBe('client');
        await clientApp.tick(STEP);
        await clientApp.tick(STEP);
        expect(session.role).toBe('client');
        session.stop();
        await expect(pending).rejects.toThrow();
    });

    it('a refused handshake reverts the session to offline', async () => {
        const clientApp = makeApp();
        const session = clientApp.getResource(Net);
        const [ta, tb] = MemoryTransport.pair();
        // A hostile peer that refuses every hello.
        const raw = new NetChannel(ta);
        raw.handle(ReplMsg.hello, () => ({ ok: false, error: 'go away' }));
        await expect(session.connect(tb)).rejects.toThrow(/go away/);
        expect(session.role).toBe('offline');
        expect(session.client).toBeNull();
    });

    it('refuses a protocol version mismatch', async () => {
        const serverApp = makeApp();
        serverApp.getResource(Net).startServer().attachConnection(MemoryTransport.pair()[0]);
        const [ta, tb] = MemoryTransport.pair();
        serverApp.getResource(Net).server!.attachConnection(ta);
        const raw = new NetChannel(tb);
        const res = await raw.request<ReplHelloResponse>(ReplMsg.hello, {
            protocolVersion: REPLICATION_PROTOCOL_VERSION + 1,
            abiHash: ABI_LAYOUT_HASH,
            components: [],
        });
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.error).toMatch(/protocol/);
    });

    it('refuses an ABI hash mismatch', async () => {
        const serverApp = makeApp();
        const server = serverApp.getResource(Net).startServer();
        const [ta, tb] = MemoryTransport.pair();
        server.attachConnection(ta);
        const raw = new NetChannel(tb);
        const res = await raw.request<ReplHelloResponse>(ReplMsg.hello, {
            protocolVersion: REPLICATION_PROTOCOL_VERSION,
            abiHash: 'deadbeef',
            components: tableSchemas(buildReplicationTable()),
        });
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.error).toMatch(/ABI/);
    });

    it('refuses a field whose wire SHAPE differs, with the names identical', async () => {
        // The mismatch names alone cannot see. Both ends call the component
        // NetPos and the field x; one writes 4 bytes and the other 1, so every
        // entry after it in the frame decodes from the wrong offset.
        const serverApp = makeApp();
        const server = serverApp.getResource(Net).startServer();
        const [ta, tb] = MemoryTransport.pair();
        server.attachConnection(ta);
        const raw = new NetChannel(tb);
        const schemas = tableSchemas(buildReplicationTable());
        const i = schemas.findIndex((c) => c.name === 'NetPos');
        schemas[i] = { ...schemas[i], shapes: schemas[i].shapes.map((sh, f) => (f === 0 ? 'bool' : sh)) };
        const res = await raw.request<ReplHelloResponse>(ReplMsg.hello, {
            protocolVersion: REPLICATION_PROTOCOL_VERSION,
            abiHash: ABI_LAYOUT_HASH,
            components: schemas,
        });
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.error).toMatch(/wire shape/);
    });

    it('refuses an entity-ref field the other end thinks is a plain number', async () => {
        // Same width, so nothing desynchronizes — one end just reads a netId as
        // a coordinate forever. `entity` is its own signature for this reason.
        const serverApp = makeApp();
        const server = serverApp.getResource(Net).startServer();
        const [ta, tb] = MemoryTransport.pair();
        server.attachConnection(ta);
        const raw = new NetChannel(tb);
        const schemas = tableSchemas(buildReplicationTable());
        const i = schemas.findIndex((c) => c.name === 'NetPos');
        schemas[i] = { ...schemas[i], shapes: schemas[i].shapes.map((sh, f) => (f === 0 ? 'entity' : sh)) };
        const res = await raw.request<ReplHelloResponse>(ReplMsg.hello, {
            protocolVersion: REPLICATION_PROTOCOL_VERSION,
            abiHash: ABI_LAYOUT_HASH,
            components: schemas,
        });
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.error).toMatch(/wire shape/);
    });

    it('refuses a replication schema mismatch', async () => {
        const serverApp = makeApp();
        const server = serverApp.getResource(Net).startServer();
        const [ta, tb] = MemoryTransport.pair();
        server.attachConnection(ta);
        const raw = new NetChannel(tb);
        const schemas = tableSchemas(buildReplicationTable());
        schemas[0] = { ...schemas[0], fields: [...schemas[0].fields, 'phantom'] };
        const res = await raw.request<ReplHelloResponse>(ReplMsg.hello, {
            protocolVersion: REPLICATION_PROTOCOL_VERSION,
            abiHash: ABI_LAYOUT_HASH,
            components: schemas,
        });
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.error).toMatch(/schema/);
    });
});

describe('spawn / state / despawn replication', () => {
    it('replicates a spawned entity to the client as a NetGhost', async () => {
        const { serverApp, clientApp, client } = await makePair();

        const e = serverApp.world.spawn('player');
        serverApp.world.insert(e, Replicated, {});
        serverApp.world.insert(e, NetPos, { x: 10, y: 20, secret: 42 });

        await serverApp.tick(STEP);
        await clientApp.tick(STEP);

        const netId = clientApp.world.getEntitiesWithComponents([Replicated]);
        expect(netId).toHaveLength(1);
        const ghost = netId[0];
        expect(clientApp.world.has(ghost, NetGhost)).toBe(true);
        const pos = clientApp.world.tryGet(ghost, NetPos)!;
        expect(pos.x).toBe(10);
        expect(pos.y).toBe(20);
        // Spawn carries the full component payload — including non-replicated
        // fields (spawn is scene-shaped); only per-tick deltas are filtered.
        expect(pos.secret).toBe(42);
        const repl = clientApp.world.tryGet(ghost, Replicated)!;
        expect(repl.netId).toBeGreaterThan(0);
        expect(client.netIds.entityOf(repl.netId)).toBe(ghost);
    });

    it('streams only dirty replicated fields, and goes quiet when nothing changes', async () => {
        const serverApp = makeApp();
        const clientApp = makeApp();
        const server = serverApp.getResource(Net).startServer();
        // Manual flush so the test can observe exactly what each tick emits.
        const [ta, tb] = MemoryTransport.pair();
        server.attachConnection(ta);
        const connectP = clientApp.getResource(Net).connect(tb, { interpolationDelayTicks: 0 });
        await connectP;

        const e = serverApp.world.spawn('mover');
        serverApp.world.insert(e, Replicated, {});
        serverApp.world.insert(e, NetPos, { x: 1, y: 2, secret: 3 });
        await serverApp.tick(STEP);
        await clientApp.tick(STEP);
        const ghost = clientApp.world.getEntitiesWithComponents([Replicated])[0];

        //

        // Move on the server; secret (not replicated) also changes.
        const pos = serverApp.world.tryGet(e, NetPos)!;
        pos.x = 100;
        pos.secret = 999;
        serverApp.world.set(e, NetPos, pos);
        await serverApp.tick(STEP);
        await clientApp.tick(STEP);

        const gpos = clientApp.world.tryGet(ghost, NetPos)!;
        expect(gpos.x).toBe(100);
        expect(gpos.y).toBe(2);
        // secret keeps its spawn-time value: never re-sent per tick.
        expect(gpos.secret).toBe(3);
    });

    it('a quiet server sends no state frames', async () => {
        const serverApp = makeApp();
        const server = serverApp.getResource(Net).startServer();
        const [ta, tb] = MemoryTransport.pair({ manualFlush: true });
        server.attachConnection(ta);

        const clientApp = makeApp();
        const connectP = clientApp.getResource(Net).connect(tb, { interpolationDelayTicks: 0 });
        // Manual flush: pump the handshake both ways.
        for (let i = 0; i < 8; i++) { ta.flush(); tb.flush(); await Promise.resolve(); }
        await connectP;

        const e = serverApp.world.spawn('idle');
        serverApp.world.insert(e, Replicated, {});
        serverApp.world.insert(e, NetPos, {});
        await serverApp.tick(STEP);
        ta.flush();

        // Nothing changed since the spawn tick → subsequent ticks emit nothing.
        await serverApp.tick(STEP);
        await serverApp.tick(STEP);
        expect(ta.pendingCount).toBe(0);
    });

    it('replicates despawn', async () => {
        const { serverApp, clientApp } = await makePair();
        const e = serverApp.world.spawn('temp');
        serverApp.world.insert(e, Replicated, {});
        serverApp.world.insert(e, NetPos, {});
        await serverApp.tick(STEP);
        await clientApp.tick(STEP);
        expect(clientApp.world.getEntitiesWithComponents([Replicated])).toHaveLength(1);

        serverApp.world.despawn(e);
        await serverApp.tick(STEP);
        await clientApp.tick(STEP);
        expect(clientApp.world.getEntitiesWithComponents([Replicated])).toHaveLength(0);
    });

    it('a late joiner receives current state, not spawn-time state', async () => {
        const serverApp = makeApp();
        const server = serverApp.getResource(Net).startServer();

        // First client so the server starts replicating at all.
        const clientA = makeApp();
        const [a1, a2] = MemoryTransport.pair();
        server.attachConnection(a1);
        await clientA.getResource(Net).connect(a2, { interpolationDelayTicks: 0 });

        const e = serverApp.world.spawn('veteran');
        serverApp.world.insert(e, Replicated, {});
        serverApp.world.insert(e, NetPos, { x: 1, y: 1, secret: 0 });
        await serverApp.tick(STEP);

        // Mutate long after spawn.
        const pos = serverApp.world.tryGet(e, NetPos)!;
        pos.x = 777;
        serverApp.world.set(e, NetPos, pos);
        await serverApp.tick(STEP);

        // Now a second client joins.
        const clientB = makeApp();
        const [b1, b2] = MemoryTransport.pair();
        server.attachConnection(b1);
        await clientB.getResource(Net).connect(b2, { interpolationDelayTicks: 0 });
        await clientB.tick(STEP);

        const ghosts = clientB.world.getEntitiesWithComponents([Replicated]);
        expect(ghosts).toHaveLength(1);
        expect(clientB.world.tryGet(ghosts[0], NetPos)!.x).toBe(777);
    });

    it('replicates multiple components and string/bool fields', async () => {
        const { serverApp, clientApp } = await makePair();
        const e = serverApp.world.spawn('tagged');
        serverApp.world.insert(e, Replicated, {});
        serverApp.world.insert(e, NetPos, { x: 5, y: 6, secret: 0 });
        serverApp.world.insert(e, NetTag, { label: 'boss', active: true });
        await serverApp.tick(STEP);
        await clientApp.tick(STEP);

        const ghost = clientApp.world.getEntitiesWithComponents([Replicated])[0];
        expect(clientApp.world.tryGet(ghost, NetTag)).toEqual({ label: 'boss', active: true });

        const tag = serverApp.world.tryGet(e, NetTag)!;
        tag.label = 'minion';
        tag.active = false;
        serverApp.world.set(e, NetTag, tag);
        await serverApp.tick(STEP);
        await clientApp.tick(STEP);
        expect(clientApp.world.tryGet(ghost, NetTag)).toEqual({ label: 'minion', active: false });
    });
});

describe('codec round trip', () => {
    it('encodes and decodes every shape kind exactly', () => {
        const shapes: [FieldShape, unknown][] = [
            [{ kind: 'f32' }, 1.5],
            [{ kind: 'bool' }, true],
            [{ kind: 'string' }, '你好 world'],
            [{ kind: 'object', keys: ['x', 'y'], shapes: [{ kind: 'f32' }, { kind: 'f32' }] }, { x: -2.25, y: 8 }],
            [{ kind: 'json' }, [1, 'two', { three: 3 }]],
        ];
        const w = new ByteWriter();
        for (const [shape, value] of shapes) encodeValue(w, shape, value);
        const r = new ByteReader(w.finish());
        for (const [shape, value] of shapes) expect(decodeValue(r, shape)).toEqual(value);
        expect(r.remaining).toBe(0);
    });

    it('entity shapes remap through the ref map at both ends', () => {
        const w = new ByteWriter();
        encodeValue(w, { kind: 'entity' }, 12345, { toWire: () => 7, fromWire: (n) => n });
        const r = new ByteReader(w.finish());
        expect(decodeValue(r, { kind: 'entity' }, { toWire: (e) => e, fromWire: (n) => n + 1 })).toBe(8);
    });

    it('state frames round-trip mask-selected fields through the table', () => {
        const table = buildReplicationTable();
        const te = table.byName.get('NetPos')!;
        const fw = new FrameWriter(42);
        fw.entry(9, te, 0b01, { x: 3.5, y: 0, secret: 1 }); // only x
        const frame = decodeStateFrame(fw.finish(), table);
        expect(frame.tick).toBe(42);
        expect(frame.entries).toHaveLength(1);
        expect(frame.entries[0].netId).toBe(9);
        expect(frame.entries[0].fieldMask).toBe(0b01);
        expect(frame.entries[0].values).toEqual([3.5]);
    });

    it('diffSchemas pinpoints drift', () => {
        const a = [{ name: 'A', fields: ['x'], shapes: ['f32'] }];
        expect(diffSchemas(a, [{ name: 'A', fields: ['x'], shapes: ['f32'] }])).toBeNull();
        expect(diffSchemas(a, [])).toMatch(/size/);
        expect(diffSchemas(a, [{ name: 'B', fields: ['x'], shapes: ['f32'] }])).toMatch(/differs/);
        expect(diffSchemas(a, [{ name: 'A', fields: ['x', 'y'], shapes: ['f32', 'f32'] }])).toMatch(/field list/);
        expect(diffSchemas(a, [{ name: 'A', fields: ['x'], shapes: ['bool'] }])).toMatch(/wire shape/);
    });
});

describe('component topology', () => {
    it('a replicated component leaving the authority leaves the ghost too', async () => {
        // The delta plane cannot say this: a removed component stops being
        // sampled, so without its own op the ghost keeps the last values it saw
        // for the rest of the session.
        const { serverApp, clientApp, client } = await makePair();
        const e = serverApp.world.spawn('unit');
        serverApp.world.insert(e, NetPos, { x: 5, y: 6, secret: 0 });
        serverApp.world.insert(e, NetTag, { label: 'shielded', active: true });
        serverApp.world.insert(e, Replicated, {});
        await serverApp.tick(STEP);
        await clientApp.tick(STEP);

        const ghost = clientApp.world.getEntitiesWithComponents([NetGhost])[0];
        expect(clientApp.world.has(ghost, NetTag)).toBe(true);

        serverApp.world.remove(e, NetTag);
        await serverApp.tick(STEP);
        await clientApp.tick(STEP);

        expect(clientApp.world.has(ghost, NetTag)).toBe(false);
        // The entity and its other components are untouched — this is a
        // component leaving, not a despawn.
        expect(clientApp.world.valid(ghost)).toBe(true);
        expect((clientApp.world.tryGet(ghost, NetPos) as { x: number }).x).toBe(5);
        expect(client.connected).toBe(true);
    });

    it('re-adding the component after a removal replicates it again', async () => {
        const { serverApp, clientApp } = await makePair();
        const e = serverApp.world.spawn('unit');
        serverApp.world.insert(e, NetPos, { x: 0, y: 0, secret: 0 });
        serverApp.world.insert(e, NetTag, { label: 'first', active: true });
        serverApp.world.insert(e, Replicated, {});
        await serverApp.tick(STEP);
        await clientApp.tick(STEP);
        const ghost = clientApp.world.getEntitiesWithComponents([NetGhost])[0];

        serverApp.world.remove(e, NetTag);
        await serverApp.tick(STEP);
        await clientApp.tick(STEP);
        expect(clientApp.world.has(ghost, NetTag)).toBe(false);

        // The shadow snapshot goes with the removal, so a re-add replicates
        // every field rather than diffing against a component that is gone.
        serverApp.world.insert(e, NetTag, { label: 'second', active: false });
        await serverApp.tick(STEP);
        await clientApp.tick(STEP);
        expect(clientApp.world.has(ghost, NetTag)).toBe(true);
        expect((clientApp.world.tryGet(ghost, NetTag) as { label: string }).label).toBe('second');
    });
});

describe('inbound timeline', () => {
    it('a despawn and a re-spawn arriving together apply in the order they were sent', async () => {
        // The AOI edge: leave interest at tick N, come back at N+1. Sorting the
        // inbox by KIND replays that as re-enter-then-leave — and permanently,
        // since the server sends only deltas for it from then on.
        const serverApp = makeApp();
        const clientApp = makeApp();
        const server = serverApp.getResource(Net).startServer();
        const [ta, tb] = MemoryTransport.pair();
        server.attachConnection(ta);
        const client = await clientApp.getResource(Net).connect(tb, { interpolationDelayTicks: 0 });
        expect(client.connected).toBe(true);

        const e = serverApp.world.spawn('blinker');
        serverApp.world.insert(e, NetPos, { x: 1, y: 2, secret: 0 });
        serverApp.world.insert(e, Replicated, {});
        await serverApp.tick(STEP);
        await clientApp.tick(STEP);
        expect(clientApp.world.getEntitiesWithComponents([NetGhost])).toHaveLength(1);

        // Leave, then re-enter, with the client not stepping in between — both
        // batches land in one flush.
        let visible = false;
        server.setInterestPolicy(({ candidates }) => (visible ? new Set(candidates) : new Set<never>()));
        await serverApp.tick(STEP);          // leaves  → despawn
        visible = true;
        await serverApp.tick(STEP);          // re-enters → spawn
        await clientApp.tick(STEP);

        const ghosts = clientApp.world.getEntitiesWithComponents([NetGhost]);
        expect(ghosts).toHaveLength(1);
        expect((clientApp.world.tryGet(ghosts[0], NetPos) as { x: number }).x).toBe(1);
    });
});

describe('spawn batch references', () => {
    it('an entity reference to something later in the same batch resolves', async () => {
        // Hydrating entity-by-entity looked up a netId that had not been
        // registered yet and wrote 0 — a reference to nothing, never revisited.
        const { serverApp, clientApp, client } = await makePair();
        // Replicated on the holder FIRST, so it is the earlier of the two in
        // the batch and its reference genuinely points forward.
        const holder = serverApp.world.spawn('holder');
        serverApp.world.insert(holder, Replicated, {});
        const target = serverApp.world.spawn('target');
        serverApp.world.insert(target, NetPos, { x: 9, y: 9, secret: 0 });
        serverApp.world.insert(target, Replicated, {});
        serverApp.world.insert(holder, NetLink, { target });
        // Both are new this tick, so they ride ONE spawn batch.
        await serverApp.tick(STEP);
        await clientApp.tick(STEP);

        const ghosts = clientApp.world.getEntitiesWithComponents([NetGhost]);
        expect(ghosts).toHaveLength(2);
        const ghostHolder = ghosts.find((g) => clientApp.world.has(g, NetLink))!;
        const ghostTarget = ghosts.find((g) => clientApp.world.has(g, NetPos))!;
        // netIds are allocated in batch order, so this pins the precondition:
        // without it the test would still pass on a BACKWARD reference and
        // quietly stop covering the bug it exists for.
        expect(client.netIds.netIdOf(ghostHolder)!).toBeLessThan(client.netIds.netIdOf(ghostTarget)!);
        const link = clientApp.world.tryGet(ghostHolder, NetLink) as { target: number };
        expect(link.target).not.toBe(0);
        expect(link.target).toBe(ghostTarget);
    });

    it('an entity that references itself resolves to itself', async () => {
        // Self-reference failed for the same reason: the netId was registered
        // only after its own components had been read.
        const { serverApp, clientApp } = await makePair();
        const e = serverApp.world.spawn('ouroboros');
        serverApp.world.insert(e, NetLink, { target: e });
        serverApp.world.insert(e, Replicated, {});
        await serverApp.tick(STEP);
        await clientApp.tick(STEP);

        const ghost = clientApp.world.getEntitiesWithComponents([NetGhost])[0];
        expect((clientApp.world.tryGet(ghost, NetLink) as { target: number }).target).toBe(ghost);
    });
});

describe('input sequence', () => {
    /** A raw client channel, so the test can send any seq it likes. */
    async function rawInputPair() {
        const serverApp = makeApp();
        const server = serverApp.getResource(Net).startServer();
        const [ta, tb] = MemoryTransport.pair();
        const id = server.attachConnection(ta);
        const raw = new NetChannel(tb);
        const res = await raw.request<ReplHelloResponse>(ReplMsg.hello, {
            protocolVersion: REPLICATION_PROTOCOL_VERSION,
            abiHash: ABI_LAYOUT_HASH,
            components: tableSchemas(buildReplicationTable()),
        });
        expect(res.ok).toBe(true);
        return { serverApp, server, raw, id };
    }

    /** The seq the authority runs on each of `n` consecutive ticks. */
    function ticked(server: ReplicationServer, id: number, n: number): (number | null)[] {
        const out: (number | null)[] = [];
        for (let i = 0; i < n; i++) {
            server.beginTick(STEP);
            out.push(server.tickInputOf(id)?.seq ?? null);
        }
        return out;
    }

    it('a repeated seq does not delay the command behind it', async () => {
        // Queued as [1,1,2] the authority runs 1, 1, 2 — seq 2 lands a tick
        // late, and the client that predicted [1,2] over two ticks is now
        // somewhere the server is not. Deduped it is [1,2].
        const { server, raw, id } = await rawInputPair();
        raw.send(ReplMsg.input, { seq: 1, actions: { n: 1 } });
        raw.send(ReplMsg.input, { seq: 1, actions: { n: 1 } });
        raw.send(ReplMsg.input, { seq: 2, actions: { n: 2 } });

        expect(ticked(server, id, 2)).toEqual([1, 2]);
    });

    it('never runs a seq that goes backwards', async () => {
        // A rewind queued like any other command walks the authority back to an
        // older input a tick after it passed it.
        const { server, raw, id } = await rawInputPair();
        raw.send(ReplMsg.input, { seq: 7, actions: { a: 1 } });
        raw.send(ReplMsg.input, { seq: 3, actions: { a: 2 } });

        // Second tick starves and repeats 7 (documented) rather than running 3.
        expect(ticked(server, id, 2)).toEqual([7, 7]);
        expect(server.inputOf(id)?.seq).toBe(7);
    });

    it('a flooding client loses its NEWEST commands, never the queued ones', async () => {
        // Shifting the front would skip a command the client already predicted
        // and never revisit it. The front is the contract; the tail is credit.
        const { server, raw, id } = await rawInputPair();
        for (let seq = 1; seq <= 200; seq++) {
            raw.send(ReplMsg.input, { seq, actions: { n: seq } });
        }
        const run = ticked(server, id, 129);
        expect(run.slice(0, 128)).toEqual(Array.from({ length: 128 }, (_, i) => i + 1));
        // Starved after the cap — it repeats the last command it actually ran,
        // rather than jumping to a seq the client sent long after.
        expect(run[128]).toBe(128);
    });
});
