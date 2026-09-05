// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The three contracts a spawn payload confuses for one.
 *
 * A spawn currently carries `serializeEntityComponents` — the SCENE projection,
 * which answers "how is this entity restored in full". Replication answers a
 * different question: "which facts is this client authorized and declared to
 * know". While the two are one function, every non-transient component a server
 * hangs on a replicated entity transits, and the documented contract that an
 * empty `replicatedFields` means never-replicated is not true on this path.
 *
 * One fixture separates the three layers:
 *
 *     Replicated     protocol identity   — netId, owner
 *     Transform      replication baseline — declared fields only
 *     Sprite         ghost construction   — the client needs it, the server's
 *                                           value is not authority for it
 *     ServerSecret   neither              — must never leave the authority
 *
 * `it.fails` marks what is broken TODAY. Each becomes `it` when the spawn
 * contract splits; a fix that lands without flipping them turns them red.
 */
import { describe, it, expect, afterEach, beforeAll, beforeEach } from 'vitest';
import { App } from '../src/app/app';
import { clearUserComponents, defineComponent, Name, Transform, Sprite } from '../src/ecs/component';
import { MemoryTransport } from '../src/net/MemoryTransport';
import {
    replicationPlugin, Net, Replicated,
    registerReplicationArchetype, clearReplicationArchetypes, radiusInterest,
} from '../src/net/replication';
import type { Entity } from '../src/types';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';

const STEP = 1 / 60;
/** What an explicit construction contract would give the ghost — deliberately
 *  NOT what the authority holds, so "the ghost has a Sprite" cannot pass by
 *  the payload having copied the server's one. */
const ARCHETYPE_LAYER = 7;
const AUTHORITY_LAYER = 3;

let ServerSecret: ReturnType<typeof defineComponent<{ plan: string }>>;
/** A replicated entity reference, so the baseline has netIds to remap. */
let Link: ReturnType<typeof defineComponent<{ target: number }>>;
/** Two fields, one declared: the same hole a component at a time. */
let PartlyShared: ReturnType<typeof defineComponent<{ shown: number; hidden: number }>>;

describe.skipIf(!HAS_WASM)('a spawn carries three contracts, not one', () => {
    let module: ESEngineModule;
    beforeAll(async () => { module = await loadWasmModule(); });
    const opened: App[] = [];
    beforeEach(() => {
        clearUserComponents();
        clearReplicationArchetypes();
        ServerSecret = defineComponent('ServerSecret', { plan: '' });
        Link = defineComponent('SpawnLink', { target: 0 },
            { replicatedFields: ['target'], entityFields: ['target'] });
        // The construction contract, and deliberately NOT what the authority
        // holds: "the ghost has a Sprite" must not be satisfiable by a copy.
        registerReplicationArchetype('pawn', (world, entity) => {
            world.insert(entity, Sprite, { layer: ARCHETYPE_LAYER });
        });
        PartlyShared = defineComponent('PartlyShared', { shown: 0, hidden: 0 },
            { replicatedFields: ['shown'] });
    });
    afterEach(() => { for (const app of opened.splice(0)) app.world.disconnectCpp(); });

    async function arena() {
        const serverApp = App.new();
        serverApp.connectCpp(new module.Registry() as unknown as CppRegistry, module, { strict: false });
        serverApp.addPlugin(replicationPlugin);
        opened.push(serverApp);
        const server = serverApp.getResource(Net).startServer();

        const clientApp = App.new();
        clientApp.connectCpp(new module.Registry() as unknown as CppRegistry, module, { strict: false });
        clientApp.addPlugin(replicationPlugin);
        opened.push(clientApp);
        const [ta, tb] = MemoryTransport.pair();
        const connId = server.attachConnection(ta);
        await clientApp.getResource(Net).connect(tb, { interpolationDelayTicks: 0 });

        const pawn = serverApp.world.spawn('pawn');
        serverApp.world.insert(pawn, Transform, { position: { x: 11, y: 0, z: 0 } });
        serverApp.world.insert(pawn, Sprite, { layer: AUTHORITY_LAYER });
        serverApp.world.insert(pawn, PartlyShared, { shown: 5, hidden: 9 });
        serverApp.world.insert(pawn, ServerSecret, { plan: 'flank at 30s' });
        serverApp.world.insert(pawn, Replicated, { owner: connId, archetype: 'pawn' });

        for (let i = 0; i < 6; i++) { await serverApp.tick(STEP); await clientApp.tick(STEP); }
        const ghost = clientApp.world.getEntitiesWithComponents([Replicated])
            .find((e) => (clientApp.world.tryGet(e, Name) as { value: string } | null)?.value === 'pawn');
        expect(ghost, 'the pawn never reached the client at all').toBeDefined();
        return { serverApp, clientApp, server, connId, pawn, ghost: ghost! };
    }

    /** Server + client with no entity yet — for the cases that build their own. */
    async function serverWith() {
        const serverApp = App.new();
        serverApp.connectCpp(new module.Registry() as unknown as CppRegistry, module, { strict: false });
        serverApp.addPlugin(replicationPlugin);
        opened.push(serverApp);
        const server = serverApp.getResource(Net).startServer();
        const clientApp = App.new();
        clientApp.connectCpp(new module.Registry() as unknown as CppRegistry, module, { strict: false });
        clientApp.addPlugin(replicationPlugin);
        opened.push(clientApp);
        const [ta, tb] = MemoryTransport.pair();
        const connId = server.attachConnection(ta);
        await clientApp.getResource(Net).connect(tb, { interpolationDelayTicks: 0 });
        const step = async (n = 1) => {
            for (let i = 0; i < n; i++) { await serverApp.tick(STEP); await clientApp.tick(STEP); }
        };
        return { serverApp, clientApp, server, connId, step };
    }

    it('gives the ghost the replication baseline', async () => {
        const h = await arena();
        const t = h.clientApp.world.tryGet(h.ghost, Transform) as { position: { x: number } } | null;
        expect(t?.position.x).toBe(11);
    });

    it('gives the ghost its protocol identity, so ownership resolves', async () => {
        const h = await arena();
        const repl = h.clientApp.world.tryGet(h.ghost, Replicated) as { owner: number } | null;
        expect(repl?.owner).toBe(h.connId);
        expect(h.clientApp.getResource(Net).client?.ownsEntity(h.ghost)).toBe(true);
    });

    it('does not hand the client a component that declares nothing', async () => {
        // ServerSecret has no `replicatedFields`, and the public contract says
        // that means never replicated. Until protocol v4 the scene projection
        // sent it anyway.
        const h = await arena();
        expect(h.clientApp.world.has(h.ghost, ServerSecret)).toBe(false);
    });

    it('does not hand the client the fields a component did not declare', async () => {
        const h = await arena();
        const p = h.clientApp.world.tryGet(h.ghost, PartlyShared) as
            { shown: number; hidden: number } | null;
        expect(p?.shown).toBe(5);
        expect(p?.hidden, 'undeclared field arrived from the authority').toBe(0);
    });

    it('refuses a spawn whose construction key it cannot resolve', async () => {
        const h = await serverWith();
        const orphan = h.serverApp.world.spawn('orphan');
        h.serverApp.world.insert(orphan, Transform, { position: { x: 4, y: 0, z: 0 } });
        h.serverApp.world.insert(orphan, Replicated, { owner: -1, archetype: 'never-registered' });
        await h.step(4);

        // No ghost at all rather than a stripped one: a registered netId over an
        // entity nobody can build would take this entity's deltas for the rest
        // of the session.
        expect(h.clientApp.world.getEntitiesWithComponents([Replicated])).toHaveLength(0);
    });

    it('remaps an entity reference in the baseline, itself and a later sibling', async () => {
        const h = await serverWith();
        // Both spawn in one batch, and `first` points at a netId that is only
        // registered while the batch is still being read.
        const first = h.serverApp.world.spawn('first');
        const second = h.serverApp.world.spawn('second');
        h.serverApp.world.insert(first, Link, { target: second as unknown as number });
        h.serverApp.world.insert(second, Link, { target: second as unknown as number });
        h.serverApp.world.insert(first, Replicated, { owner: -1 });
        h.serverApp.world.insert(second, Replicated, { owner: -1 });
        await h.step(4);

        const named = (n: string) => h.clientApp.world.getEntitiesWithComponents([Replicated])
            .find((e) => (h.clientApp.world.tryGet(e, Name) as { value: string } | null)?.value === n);
        const gFirst = named('first');
        const gSecond = named('second');
        expect(gFirst).toBeDefined();
        expect(gSecond).toBeDefined();
        expect((h.clientApp.world.tryGet(gFirst!, Link) as { target: number }).target).toBe(gSecond);
        expect((h.clientApp.world.tryGet(gSecond!, Link) as { target: number }).target).toBe(gSecond);
    });

    it('re-enters interest at the authority state, not at the archetype default', async () => {
        const h = await serverWith();
        registerReplicationArchetype('drifter', (world, entity) => {
            world.insert(entity, Transform, { position: { x: -999, y: 0, z: 0 } });
            world.insert(entity, Sprite, { layer: ARCHETYPE_LAYER });
        });
        const anchor = h.serverApp.world.spawn('anchor');
        h.serverApp.world.insert(anchor, Transform, { position: { x: 0, y: 0, z: 0 } });
        h.serverApp.world.insert(anchor, Replicated, { owner: h.connId });
        const drifter = h.serverApp.world.spawn('drifter');
        h.serverApp.world.insert(drifter, Transform, { position: { x: 5, y: 0, z: 0 } });
        h.serverApp.world.insert(drifter, Replicated, { owner: -1, archetype: 'drifter' });
        h.server.setInterestPolicy(radiusInterest(20));
        await h.step(4);

        const seen = () => h.clientApp.world.getEntitiesWithComponents([Replicated])
            .find((e) => (h.clientApp.world.tryGet(e, Name) as { value: string } | null)?.value === 'drifter');
        expect(seen()).toBeDefined();

        const serverApp = h.serverApp;
        // `pose`, not `t`: the silent-writes census tracks bindings by name, and
        // this block also holds a `t` read out of the client world.
        const move = (x: number) => {
            serverApp.world.update(drifter, Transform, (pose) => {
                const p = (pose as { position: { x: number } }).position;
                p.x = x;
            });
        };
        move(900);
        await h.step(4);
        expect(seen(), 'it never left interest, so re-entry proves nothing').toBeUndefined();

        move(7);
        await h.step(4);
        const back = seen();
        expect(back).toBeDefined();
        const t = h.clientApp.world.tryGet(back!, Transform) as { position: { x: number } };
        expect(t.position.x, 'the archetype default outranked the authority').toBe(7);
    });

    it('builds the ghost from a construction contract, not the authority dump', async () => {
        // Sprite is not in the table and a ghost still needs one. Where it comes
        // from is the whole question, and the answer is the declared archetype.
        const h = await arena();
        const s = h.clientApp.world.tryGet(h.ghost, Sprite) as { layer: number } | null;
        expect(s, 'the ghost has no Sprite at all').not.toBeNull();
        expect(s?.layer, 'the ghost took the authority Sprite, not a declared one')
            .toBe(ARCHETYPE_LAYER);
    });
});
