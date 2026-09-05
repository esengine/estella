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
import { replicationPlugin, Net, Replicated } from '../src/net/replication';
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
/** Two fields, one declared: the same hole a component at a time. */
let PartlyShared: ReturnType<typeof defineComponent<{ shown: number; hidden: number }>>;

describe.skipIf(!HAS_WASM)('a spawn carries three contracts, not one', () => {
    let module: ESEngineModule;
    beforeAll(async () => { module = await loadWasmModule(); });
    const opened: App[] = [];
    beforeEach(() => {
        clearUserComponents();
        ServerSecret = defineComponent('ServerSecret', { plan: '' });
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
        serverApp.world.insert(pawn, Replicated, { owner: connId });

        for (let i = 0; i < 6; i++) { await serverApp.tick(STEP); await clientApp.tick(STEP); }
        const ghost = clientApp.world.getEntitiesWithComponents([Replicated])
            .find((e) => (clientApp.world.tryGet(e, Name) as { value: string } | null)?.value === 'pawn');
        expect(ghost, 'the pawn never reached the client at all').toBeDefined();
        return { serverApp, clientApp, server, connId, pawn, ghost: ghost! };
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

    it.fails('does not hand the client a component that declares nothing', async () => {
        // ServerSecret has no `replicatedFields`, and the public contract says
        // that means never replicated. The scene projection sends it anyway.
        const h = await arena();
        expect(h.clientApp.world.has(h.ghost, ServerSecret)).toBe(false);
    });

    it.fails('does not hand the client the fields a component did not declare', async () => {
        const h = await arena();
        const p = h.clientApp.world.tryGet(h.ghost, PartlyShared) as
            { shown: number; hidden: number } | null;
        expect(p?.shown).toBe(5);
        expect(p?.hidden, 'undeclared field arrived from the authority').toBe(0);
    });

    it.fails('builds the ghost from a construction contract, not the authority dump', async () => {
        // Sprite is not in the table, and a ghost still needs one. Where it comes
        // from is the whole question: an explicit archetype, or whatever the
        // server happened to be holding.
        const h = await arena();
        const s = h.clientApp.world.tryGet(h.ghost, Sprite) as { layer: number } | null;
        expect(s, 'the ghost has no Sprite at all').not.toBeNull();
        expect(s?.layer, 'the ghost took the authority Sprite, not a declared one')
            .toBe(ARCHETYPE_LAYER);
    });
});
