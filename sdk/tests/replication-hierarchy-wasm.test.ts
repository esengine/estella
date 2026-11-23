// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { Transform } from '../src/ecs/component';
import { ABI_LAYOUT_HASH } from '../src/ecs/component.generated';
import { MemoryTransport } from '../src/net/MemoryTransport';
import { NetChannel } from '../src/net/NetChannel';
import {
    Net, Replicated, ReplMsg, REPLICATION_PROTOCOL_VERSION, registerReplicationArchetype, replicationPlugin, tableSchemas,
    type ReplicationClientOptions, type ReplicationServer, type ReplSpawnBatch,
} from '../src/net/replication';
import { clearReplicationArchetypes } from '../src/net/replication/archetype';
import type { Entity } from '../src/types';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('replicated hierarchy in independent engine registries', () => {
    let module: ESEngineModule;
    const cleanup: (() => void)[] = [];
    beforeAll(async () => { module = await loadWasmModule(); });
    afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });

    function app() {
        const app = App.new(), registry = new module.Registry();
        app.connectCpp(registry, module, { strict: false });
        app.addPlugin(replicationPlugin);
        cleanup.push(() => { app.world.disconnectCpp(); registry.delete(); });
        return app;
    }
    function host() {
        const authority = app();
        const server = authority.getResource(Net).startServer();
        cleanup.push(() => server.dispose());
        return { authority, server };
    }
    async function join(server: ReplicationServer, options: ReplicationClientOptions = {}) {
        const peer = app(), [a, b] = MemoryTransport.pair();
        const link = server.attachConnection(a);
        const observer = new NetChannel(b);
        cleanup.push(() => observer.dispose());
        const batches: ReplSpawnBatch[] = [];
        observer.on<ReplSpawnBatch>(ReplMsg.spawn, batch => batches.push(batch));
        const client = await peer.getResource(Net).connect(b, options);
        cleanup.push(() => client.disconnect());
        return { peer, client, link, batches };
    }
    async function tick(...apps: App[]) {
        for (const app of apps) await app.tick(1 / 60);
    }
    function spawn(app: App, name: string, x = 0, owner = 0) {
        const e = app.world.spawn(name);
        app.world.insert(e, Transform, { position: { x, y: 0, z: 0 } });
        app.world.insert(e, Replicated, { owner });
        return e;
    }
    function parent(app: App, child: Entity) {
        expect(app.world.valid(child)).toBe(true);
        const core = app.world.getCppRegistry()!;
        return core.hasParent(child) ? core.getParent(child).entity : null;
    }
    function pose(app: App, e: Entity) {
        app.world.ensureTransformsComposed();
        const t = app.world.get(e, Transform);
        return [t.position.x, t.worldPosition.x];
    }

    it('keeps each visible child and its local subtree as ancestors leave and return on one connection', async () => {
        const { authority, server } = host();
        const a = await join(server, { prediction: { apply() {} } }), b = await join(server);
        const root = spawn(authority, 'root', 10), joint = spawn(authority, 'joint', 4);
        const child = spawn(authority, 'pawn', 2, a.link);
        authority.world.setParent(joint, root); authority.world.setParent(child, joint);
        let ancestors = false;
        server.setInterestPolicy(({ connectionId }) => connectionId === b.link || ancestors ? 'all' : new Set());
        await tick(authority, a.peer, b.peer);
        const aw = a.peer.world, bw = b.peer.world;
        const pawn = aw.findEntityByName('pawn')!, otherPawn = bw.findEntityByName('pawn')!;
        expect(a.client.ownsEntity(pawn)).toBe(true);
        expect(parent(a.peer, pawn)).toBeNull();
        expect(pose(a.peer, pawn)).toEqual([2, 2]);
        expect(pose(b.peer, otherPawn)).toEqual([2, 16]);
        const decoration = aw.spawn('held decoration');
        aw.setParent(decoration, pawn);
        ancestors = true;
        await tick(authority, a.peer, b.peer);
        expect(pose(a.peer, pawn)).toEqual([2, 16]);
        const oldJoint = aw.findEntityByName('joint')!;
        expect(parent(a.peer, pawn)).toBe(oldJoint);
        // A local rig can insert joints anywhere. The actual tree determines
        // which ghost a recursive despawn would otherwise take with it.
        const localJoint = aw.spawn(), core = aw.getCppRegistry()!;
        core.setParent(localJoint, oldJoint); core.setParent(pawn, localJoint);
        ancestors = false;
        await tick(authority, a.peer, b.peer);
        expect(aw.findEntityByName('pawn')).toBe(pawn);
        expect(parent(a.peer, pawn)).toBeNull();
        expect(pose(a.peer, pawn)).toEqual([2, 2]);
        expect(parent(a.peer, decoration)).toBe(pawn);
        expect(aw.valid(localJoint)).toBe(false);
        expect(bw.findEntityByName('pawn')).toBe(otherPawn);
        expect(pose(b.peer, otherPawn)).toEqual([2, 16]);
        ancestors = true;
        await tick(authority, a.peer, b.peer);
        expect(parent(a.peer, pawn)).toBe(aw.findEntityByName('joint'));
        expect(parent(a.peer, pawn)).not.toBe(oldJoint);
        expect(pose(a.peer, pawn)).toEqual([2, 16]);
        authority.world.despawn(root);
        await tick(authority, a.peer, b.peer);
        expect(aw.valid(pawn) || aw.valid(decoration) || bw.valid(otherPawn)).toBe(false);
        expect(a.client.netIds.size).toBe(0);
    });

    it.each(['broadcast', 'budget'])('sends structural edits once, including native writes and parent identity changes (%s)', async mode => {
        const { authority, server } = host(), a = await join(server);
        if (mode === 'budget') server.setBandwidthBudget({ bytesPerSecond: 1 });
        const sw = authority.world, cw = a.peer.world;
        const child = spawn(authority, 'child'), first = spawn(authority, 'first'), other = sw.spawn('other');
        sw.setParent(child, first);
        await tick(authority, a.peer);
        const ghost = cw.findEntityByName('child')!, firstGhost = cw.findEntityByName('first')!;
        expect(parent(a.peer, ghost)).toBe(firstGhost);
        a.batches.length = 0;
        const core = sw.getCppRegistry()!;
        core.setParent(child, other);
        await tick(authority, a.peer);
        expect(parent(a.peer, ghost)).toBeNull();
        sw.insert(other, Replicated);
        await tick(authority, a.peer);
        const otherGhost = cw.findEntityByName('other')!;
        expect(parent(a.peer, ghost)).toBe(otherGhost);
        sw.remove(other, Replicated);
        await tick(authority, a.peer);
        expect(parent(a.peer, ghost)).toBeNull();
        sw.insert(other, Replicated);
        await tick(authority, a.peer);
        expect(parent(a.peer, ghost)).toBe(cw.findEntityByName('other'));
        expect(parent(a.peer, ghost)).not.toBe(otherGhost);
        sw.setParent(child, first);
        await tick(authority, a.peer);
        expect(parent(a.peer, ghost)).toBe(firstGhost);
        const rigJoint = cw.spawn();
        cw.setParent(rigJoint, firstGhost); cw.setParent(ghost, rigJoint);
        core.removeParent(child);
        await tick(authority, a.peer);
        expect(parent(a.peer, ghost)).toBeNull();
        expect(a.batches.flatMap(batch => batch.parents ?? [])).toHaveLength(6);
        a.batches.length = 0;
        core.setParent(child, first); core.removeParent(child);
        await tick(authority, a.peer);
        await tick(authority, a.peer);
        expect(a.batches).toEqual([]);
    });

    it('reconciles reversed links, explicit roots and children of retired parents in place on resume', async () => {
        const { authority, server } = host(), a = await join(server);
        const sw = authority.world, cw = a.peer.world;
        const former = spawn(authority, 'former'), first = spawn(authority, 'first'), second = spawn(authority, 'second');
        sw.setParent(first, former); sw.setParent(second, first);
        await tick(authority, a.peer);
        const firstGhost = cw.findEntityByName('first')!, secondGhost = cw.findEntityByName('second')!;
        server.detachConnection(a.link);
        sw.removeParent(second); sw.setParent(first, second); sw.despawn(former);
        await tick(authority);
        const [c, d] = MemoryTransport.pair();
        server.attachConnection(c); await a.client.resume(d);
        await tick(authority, a.peer);
        expect(cw.findEntityByName('first')).toBe(firstGhost);
        expect(cw.findEntityByName('second')).toBe(secondGhost);
        expect(cw.findEntityByName('former')).toBeNull();
        expect(parent(a.peer, secondGhost)).toBeNull();
        expect(parent(a.peer, firstGhost)).toBe(secondGhost);
    });

    it('keeps a root archetype in its local container until the server assigns a parent', async () => {
        const { authority, server } = host(), a = await join(server);
        const container = a.peer.world.spawn('client container');
        registerReplicationArchetype('grouped', (w, entity) => w.setParent(entity, container));
        cleanup.push(clearReplicationArchetypes);
        const child = spawn(authority, 'child'), group = spawn(authority, 'group');
        authority.world.update(child, Replicated, r => { r.archetype = 'grouped'; });
        await tick(authority, a.peer);
        const ghost = a.peer.world.findEntityByName('child')!;
        expect(parent(a.peer, ghost)).toBe(container);
        authority.world.setParent(child, group);
        await tick(authority, a.peer);
        expect(parent(a.peer, ghost)).toBe(a.peer.world.findEntityByName('group'));
        authority.world.removeParent(child);
        await tick(authority, a.peer);
        expect(parent(a.peer, ghost)).toBeNull();
        expect(a.peer.world.valid(container)).toBe(true);
    });

    it('settles a join between samples even when the server restores the previous parent', async () => {
        const { authority, server } = host(), early = await join(server);
        const a = spawn(authority, 'a'), b = spawn(authority, 'b'), child = spawn(authority, 'child');
        authority.world.setParent(child, a);
        await tick(authority, early.peer);
        authority.world.setParent(child, b);
        const late = await join(server);
        await tick(late.peer);
        const ghost = late.peer.world.findEntityByName('child')!;
        expect(parent(late.peer, ghost)).toBe(late.peer.world.findEntityByName('b'));
        authority.world.setParent(child, a);
        await tick(authority, early.peer, late.peer);
        expect(parent(late.peer, ghost)).toBe(late.peer.world.findEntityByName('a'));
        expect(parent(early.peer, early.peer.world.findEntityByName('child')!)).toBe(early.peer.world.findEntityByName('a'));
    });

    it('sends current parent links only for retained children on connections that requested them', async () => {
        const { authority, server } = host(), all = await join(server), partial = await join(server);
        const [c, d] = MemoryTransport.pair();
        server.attachConnection(c);
        const legacy = new NetChannel(d), legacyBatches: ReplSpawnBatch[] = [];
        cleanup.push(() => legacy.dispose());
        legacy.on<ReplSpawnBatch>(ReplMsg.spawn, batch => legacyBatches.push(batch));
        await legacy.request(ReplMsg.hello, { protocolVersion: REPLICATION_PROTOCOL_VERSION, abiHash: ABI_LAYOUT_HASH,
            components: tableSchemas(server.table) });
        let show = false;
        const root = spawn(authority, 'root'), child = spawn(authority, 'child');
        server.setInterestPolicy(({ connectionId }) => connectionId === partial.link && !show ? new Set([root]) : 'all');
        await tick(authority, all.peer, partial.peer);
        all.batches.length = partial.batches.length = legacyBatches.length = 0;
        authority.world.setParent(child, root);
        await tick(authority, all.peer, partial.peer);
        expect(all.batches.flatMap(batch => batch.parents ?? [])).toEqual([{
            netId: server.netIds.netIdOf(child), parentNetId: server.netIds.netIdOf(root),
        }]);
        expect(partial.batches).toEqual([]);
        expect(legacyBatches).toEqual([]);
        show = true; authority.world.removeParent(child);
        await tick(authority, all.peer, partial.peer);
        expect(partial.batches).toHaveLength(1);
        expect(partial.batches[0]!.entities[0]!.parentNetId).toBe(0);
        expect(partial.batches[0]!.parents).toBeUndefined();
    });
});
