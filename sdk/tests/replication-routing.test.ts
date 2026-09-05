// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Getting one sample's rows to the connections that want them.
 *
 * The server routes a sample's dirty rows and removals by whichever projection
 * of the same truth is smaller: hand each affected entity to the connections
 * that see it, or ask each connection's view what happened to it. Which one runs
 * is decided per sample and must not be visible on the wire — so the shape of
 * these is "the same world, routed both ways, ends up saying the same thing".
 *
 * A stale reverse index is the way this goes wrong quietly: a connection that is
 * still listed as a viewer receives rows for a ghost it no longer holds, and one
 * that is missing from the list simply stops hearing.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { App } from '../src/app/app';
import { clearUserComponents, defineComponent, Name } from '../src/ecs/component';
import { MemoryTransport } from '../src/net/MemoryTransport';
import {
    replicationPlugin, Net, Replicated, radiusInterestProvider,
} from '../src/net/replication';
import type { Entity } from '../src/types';
import type { World } from '../src/ecs/world';

const STEP = 1 / 60;
/** Wide enough that everything below is in view unless it is moved far away. */
const RADIUS = 50;
let NetPos: ReturnType<typeof defineComponent<{ x: number; y: number; z: number }>>;

beforeEach(() => {
    clearUserComponents();
    NetPos = defineComponent('NetPos', { x: 0, y: 0, z: 0 }, { replicatedFields: ['x', 'y', 'z'] });
});

const posOf = (world: World, e: Entity) =>
    world.tryGet(e, NetPos) as { x: number; y: number; z: number } | null;
/** Every ghost a client holds, by name and x — the wire's visible result. */
const held = (app: App): string =>
    app.world.getEntitiesWithComponents([Replicated])
        .map((e) => `${(app.world.tryGet(e, Name) as { value: string } | null)?.value}@${posOf(app.world, e)?.x}`)
        .sort().join(' ');

/** The server end, with a tally of what actually went down the wire. */
function counted(transport: MemoryTransport) {
    let frames = 0;
    const send = transport.send.bind(transport);
    (transport as unknown as { send(d: string | ArrayBuffer): void }).send = (d) => { frames++; send(d); };
    return { get frames() { return frames; } };
}

async function serverWith(connections: number) {
    const serverApp = App.new();
    serverApp.addPlugin(replicationPlugin);
    const server = serverApp.getResource(Net).startServer();
    const clients: { app: App; id: number; sent: { frames: number } }[] = [];
    for (let i = 0; i < connections; i++) {
        const app = App.new();
        app.addPlugin(replicationPlugin);
        const [ta, tb] = MemoryTransport.pair();
        const id = server.attachConnection(ta);
        await app.getResource(Net).connect(tb, { interpolationDelayTicks: 0 });
        clients.push({ app, id, sent: counted(ta as MemoryTransport) });
    }
    const step = async (n = 1) => {
        for (let i = 0; i < n; i++) {
            await serverApp.tick(STEP);
            for (const c of clients) await c.app.tick(STEP);
        }
    };
    const place = (name: string, x: number, owner = -1): Entity => {
        const e = serverApp.world.spawn(name);
        serverApp.world.insert(e, Replicated, { owner });
        serverApp.world.insert(e, NetPos, { x, y: 0, z: 0 });
        return e;
    };
    const move = (e: Entity, x: number) => {
        serverApp.world.update(e, NetPos, (d) => { (d as { x: number }).x = x; });
    };
    return { serverApp, server, clients, step, place, move };
}

const provider = () => radiusInterestProvider(RADIUS, {
    position: (world: World, e: Entity) => posOf(world, e),
});

describe('a sample routed either way says the same thing', () => {
    /**
     * The same script, run so that the router takes each branch. Few affected
     * entities and the push side wins; every entity affected and the pull side
     * does — the decision is `U + F` against total interest membership.
     */
    async function play(dirtyAll: boolean): Promise<string[]> {
        const h = await serverWith(3);
        h.server.setInterestProvider(provider());
        for (const c of h.clients) h.place(`anchor${c.id}`, 0, c.id);
        const crowd = Array.from({ length: 12 }, (_, i) => h.place(`e${i}`, i));
        await h.step(4);

        for (let round = 0; round < 3; round++) {
            if (dirtyAll) for (const [i, e] of crowd.entries()) h.move(e, 100 + round * 10 + i);
            else h.move(crowd[0]!, 100 + round * 10);
            // One leaves the radius, one comes back.
            h.move(crowd[1]!, round % 2 === 0 ? 900 : 3);
            await h.step(3);
        }
        return h.clients.map((c) => held(c.app));
    }

    it('agrees ghost for ghost whichever side did the routing', async () => {
        const pushed = await play(false);
        const pulled = await play(true);
        // Different scripts move different entities, so what is compared is that
        // each ROUTE produced a consistent world for all three connections.
        expect(new Set(pushed).size).toBe(1);
        expect(new Set(pulled).size).toBe(1);
    });

    it('sends an entity that just entered its spawn and no delta on top', async () => {
        const h = await serverWith(1);
        h.server.setInterestProvider(provider());
        h.place('anchor', 0, h.clients[0]!.id);
        for (let i = 0; i < 20; i++) h.place(`e${i}`, i % 10);
        // Known to the server for a while, and out of this connection's view.
        const arriving = h.place('arriving', 900);
        await h.step(4);
        expect(held(h.clients[0]!.app)).not.toContain('arriving');

        // The move that brings it into view is also what makes it dirty, and its
        // spawn carries the new position — so a delta beside it is a second copy
        // of the same value, which only the frame count can see.
        const before = h.clients[0]!.sent.frames;
        h.move(arriving, 4);
        await h.step(3);
        expect(held(h.clients[0]!.app)).toContain('arriving@4');
        expect(h.clients[0]!.sent.frames - before).toBe(1);
    });

    it('skips an entity that just entered on the pull side too', async () => {
        const h = await serverWith(1);
        h.server.setInterestProvider(provider());
        h.place('anchor', 0, h.clients[0]!.id);
        // Three away, so more entities are affected than are visible anywhere and
        // the PULL side runs — the other branch has its own fixture above.
        const away = [h.place('a', 900), h.place('b', 901), h.place('c', 902)];
        await h.step(4);

        const before = h.clients[0]!.sent.frames;
        h.move(away[0]!, 4);
        h.move(away[1]!, 903);
        h.move(away[2]!, 904);
        await h.step(3);
        expect(held(h.clients[0]!.app)).toContain('a@4');
        // The spawn batch alone: the two that stayed away are nobody's, and the
        // one that arrived carries its value in the spawn.
        expect(h.clients[0]!.sent.frames - before).toBe(1);
    });

    it('stops sending to a connection an entity has left', async () => {
        const h = await serverWith(1);
        h.server.setInterestProvider(provider());
        h.place('anchor', 0, h.clients[0]!.id);
        // A crowd, so total interest membership is well above the one affected
        // entity and the push side is the one that runs — the side a viewer left
        // behind in the index would show up on.
        for (let i = 0; i < 20; i++) h.place(`e${i}`, i % 10);
        const wanderer = h.place('wanderer', 5);
        await h.step(4);
        expect(held(h.clients[0]!.app)).toContain('wanderer@5');

        h.move(wanderer, 900);
        await h.step(4);
        expect(held(h.clients[0]!.app)).not.toContain('wanderer');

        // Still being moved, and no longer anybody's business. Counted rather
        // than read off the client: a row sent for a ghost it no longer holds is
        // ignored on arrival, so only the wire shows it.
        const before = h.clients[0]!.sent.frames;
        h.move(wanderer, 901);
        h.move(wanderer, 902);
        await h.step(6);
        expect(held(h.clients[0]!.app)).not.toContain('wanderer');
        expect(h.clients[0]!.sent.frames).toBe(before);
    });

    it('leaves nothing in the index behind a detached connection', async () => {
        const h = await serverWith(2);
        h.server.setInterestProvider(provider());
        for (const c of h.clients) h.place(`anchor${c.id}`, 0, c.id);
        h.place('shared', 2);
        await h.step(4);
        const both = h.server.viewerLinks;
        expect(both).toBeGreaterThan(0);

        h.server.detachConnection(h.clients[1]!.id);
        // Halved, not merely still working: a link nothing guards against is a
        // leak that grows with every connection a session ever had.
        expect(h.server.viewerLinks).toBe(both / 2);
        await h.step(3);
        expect(h.server.viewerLinks).toBe(both / 2);
    });

    it('makes a viewer of nobody the initial send never reached', async () => {
        const h = await serverWith(0);
        h.server.setInterestProvider(provider());
        h.place('anchor', 0, 0);
        h.place('near', 3);
        await h.step(2);

        const [ta, tb] = MemoryTransport.pair();
        const app = App.new();
        app.addPlugin(replicationPlugin);
        // Refuses the initial state and nothing else, so the handshake still
        // completes: a connection that never heard about the world is not a
        // viewer of any of it.
        const send = ta.send.bind(ta);
        (ta as unknown as { send(d: string | ArrayBuffer): void }).send = (d) => {
            if (typeof d === 'string' && d.includes('repl:spawn')) throw new Error('refused');
            send(d);
        };
        h.server.attachConnection(ta);
        await app.getResource(Net).connect(tb, { interpolationDelayTicks: 0 }).catch(() => {});
        await h.step(2);
        expect(h.server.viewerLinks).toBe(0);
    });

    it('reaches every connection that can see one entity', async () => {
        const h = await serverWith(4);
        h.server.setInterestProvider(provider());
        for (const c of h.clients) h.place(`anchor${c.id}`, 0, c.id);
        const shared = h.place('shared', 2);
        await h.step(4);

        h.move(shared, 9);
        await h.step(3);
        for (const c of h.clients) expect(held(c.app)).toContain('shared@9');
    });

    it('keeps the survivors current when a connection detaches', async () => {
        const h = await serverWith(3);
        h.server.setInterestProvider(provider());
        for (const c of h.clients) h.place(`anchor${c.id}`, 0, c.id);
        const shared = h.place('shared', 2);
        await h.step(4);

        h.server.detachConnection(h.clients[1]!.id);
        h.move(shared, 42);
        await h.step(3);
        expect(held(h.clients[0]!.app)).toContain('shared@42');
        expect(held(h.clients[2]!.app)).toContain('shared@42');
    });

    it('picks up a world it was not watching when interest is installed later', async () => {
        const h = await serverWith(1);
        // Broadcast first: every connection already holds everything, so nothing
        // ENTERS when a provider arrives — the reverse index has to be seeded
        // from what the connection already has or it stays empty for good.
        h.place('anchor', 0, h.clients[0]!.id);
        const near = h.place('near', 3);
        await h.step(4);
        expect(held(h.clients[0]!.app)).toContain('near@3');

        h.server.setInterestProvider(provider());
        await h.step(2);
        h.move(near, 8);
        await h.step(3);
        expect(held(h.clients[0]!.app)).toContain('near@8');
    });

    it('goes back to broadcasting without carrying the index into it', async () => {
        const h = await serverWith(1);
        h.server.setInterestProvider(provider());
        h.place('anchor', 0, h.clients[0]!.id);
        const far = h.place('far', 900);
        await h.step(4);
        expect(held(h.clients[0]!.app)).not.toContain('far');

        h.server.setInterestProvider(null);
        await h.step(3);
        h.move(far, 901);
        await h.step(3);
        expect(held(h.clients[0]!.app)).toContain('far@901');
    });
});
