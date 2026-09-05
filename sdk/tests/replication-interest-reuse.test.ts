// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The sample in which nobody's view could have moved.
 *
 * A provider that keeps its index can say what snapshot it IS. When that number,
 * the installed source and a connection's owned set all still hold, the answer
 * the connection is already holding is the answer — so it is not queried, the
 * result is not copied, and neither the enter nor the leave scan runs.
 *
 * Everything here is about the ways that certificate can be wrong. A stale
 * answer is silent by construction: the connection keeps receiving deltas for
 * exactly the ghosts it holds, and only what should have entered or left is
 * missing.
 */
import { describe, it, expect, afterEach, beforeAll, beforeEach } from 'vitest';
import { App } from '../src/app/app';
import { clearUserComponents, defineComponent, Name, Transform } from '../src/ecs/component';
import { MemoryTransport } from '../src/net/MemoryTransport';
import { replicationPlugin, Net, Replicated, radiusInterestProvider } from '../src/net/replication';
import type { InterestProvider, PreparedInterest } from '../src/net/replication/interest';
import type { Entity } from '../src/types';
import type { World } from '../src/ecs/world';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';

const STEP = 1 / 60;
const RADIUS = 20;

let Health: ReturnType<typeof defineComponent<{ hp: number }>>;

beforeEach(() => {
    clearUserComponents();
    Health = defineComponent('ReuseHealth', { hp: 0 }, { replicatedFields: ['hp'] });
});

const ghosts = (app: App): string[] =>
    app.world.getEntitiesWithComponents([Replicated])
        .map((e) => (app.world.tryGet(e, Name) as { value: string } | null)?.value ?? '')
        .sort();

/**
 * The provider the server drives, with every `query` on the snapshot it hands
 * back counted. The generation is FORWARDED, not dropped: a wrapper that ate it
 * would put the server back on the path this file is about.
 */
function counting(inner: InterestProvider) {
    let queries = 0;
    const provider: InterestProvider = {
        prepare(view) {
            const prepared = inner.prepare(view);
            return {
                get generation() { return prepared.generation; },
                query: (q) => { queries++; return prepared.query(q); },
            } as PreparedInterest;
        },
        dispose: () => inner.dispose?.(),
    };
    return { provider, get queries() { return queries; } };
}

describe.skipIf(!HAS_WASM)('a snapshot nothing moved in is not queried again', () => {
    let module: ESEngineModule;
    beforeAll(async () => { module = await loadWasmModule(); });
    // Change tracking is the ENGINE's, one flag per module — a provider left
    // installed by one test would otherwise report into the next one's.
    const opened: App[] = [];
    afterEach(() => {
        for (const app of opened.splice(0)) {
            app.world.setTransformChangeTracking(false);
            app.world.disconnectCpp();
        }
    });

    async function serverWith(connections: number) {
        const serverApp = App.new();
        serverApp.connectCpp(new module.Registry() as unknown as CppRegistry, module, { strict: false });
        serverApp.addPlugin(replicationPlugin);
        opened.push(serverApp);
        const server = serverApp.getResource(Net).startServer();
        const clients: { app: App; id: number }[] = [];
        for (let i = 0; i < connections; i++) {
            const app = App.new();
            app.connectCpp(new module.Registry() as unknown as CppRegistry, module, { strict: false });
            app.addPlugin(replicationPlugin);
            const [ta, tb] = MemoryTransport.pair();
            const id = server.attachConnection(ta);
            await app.getResource(Net).connect(tb, { interpolationDelayTicks: 0 });
            opened.push(app);
            clients.push({ app, id });
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
            serverApp.world.insert(e, Transform, { position: { x, y: 0, z: 0 } });
            return e;
        };
        const move = (e: Entity, x: number) => {
            serverApp.world.update(e, Transform, (t) => {
                (t as { position: { x: number } }).position.x = x;
            });
        };
        const give = (e: Entity, owner: number) => {
            serverApp.world.update(e, Replicated, (d) => { (d as { owner: number }).owner = owner; });
        };
        return { serverApp, server, clients, step, place, move, give };
    }

    /** A settled world: seeded, caught up, and nobody's view still arriving. */
    async function settled(connections = 1) {
        const h = await serverWith(connections);
        const kept = counting(radiusInterestProvider(RADIUS));
        h.server.setInterestProvider(kept.provider);
        return { ...h, kept };
    }

    it('asks nobody while nothing enters, leaves or moves', async () => {
        const h = await settled(3);
        for (const c of h.clients) h.place(`anchor${c.id}`, c.id * 1000, c.id);
        for (let i = 0; i < 6; i++) h.place(`e${i}`, i * 3);
        await h.step(6);

        const before = h.kept.queries;
        const recomputes = h.server.visibilityRecomputes;
        const seen = h.clients.map((c) => ghosts(c.app));
        await h.step(5);

        // Not a cheaper query: no query at all, and so no copy of its result and
        // neither scan over it.
        expect(h.kept.queries - before).toBe(0);
        expect(h.server.visibilityRecomputes - recomputes).toBe(0);
        expect(h.clients.map((c) => ghosts(c.app))).toEqual(seen);
    });

    it('still routes a field that changed to the connections holding the ghost', async () => {
        const h = await settled(1);
        const c = h.clients[0]!;
        h.place('anchor', 0, c.id);
        const near = h.place('near', 5);
        h.serverApp.world.insert(near, Health, { hp: 100 });
        await h.step(6);

        const before = h.kept.queries;
        h.serverApp.world.update(near, Health, (d) => { (d as { hp: number }).hp = 42; });
        await h.step(3);

        // Visibility unchanged is not "this connection has nothing coming".
        expect(h.kept.queries - before).toBe(0);
        const ghost = c.app.world.getEntitiesWithComponents([Replicated])
            .find((e) => (c.app.world.tryGet(e, Name) as { value: string } | null)?.value === 'near');
        expect(ghost).toBeDefined();
        expect((c.app.world.tryGet(ghost!, Health) as { hp: number } | null)?.hp).toBe(42);
    });

    it('asks again when something moved, and the move reaches the wire', async () => {
        const h = await settled(1);
        const c = h.clients[0]!;
        h.place('anchor', 0, c.id);
        const far = h.place('wanderer', 500);
        await h.step(6);
        expect(ghosts(c.app)).not.toContain('wanderer');

        const before = h.kept.queries;
        h.move(far, 4);
        await h.step(3);
        expect(h.kept.queries - before).toBeGreaterThan(0);
        expect(ghosts(c.app)).toContain('wanderer');
    });

    it('asks again when a spawn joins the world a connection fails open to', async () => {
        // Owning no positioned anchor, this one's last answer was 'all' — the
        // population growing is exactly what it cannot be told twice.
        const h = await settled(1);
        const c = h.clients[0]!;
        h.place('somewhere', 5000);
        await h.step(6);
        expect(ghosts(c.app)).toEqual(['somewhere']);

        const before = h.kept.queries;
        h.place('newcomer', 9000);
        await h.step(3);
        expect(h.kept.queries - before).toBeGreaterThan(0);
        expect(ghosts(c.app)).toEqual(['newcomer', 'somewhere']);
    });

    it('asks again when a despawn takes something out of the world', async () => {
        const h = await settled(1);
        const c = h.clients[0]!;
        h.place('anchor', 0, c.id);
        const near = h.place('near', 5);
        await h.step(6);
        expect(ghosts(c.app)).toContain('near');

        const before = h.kept.queries;
        h.serverApp.world.despawn(near);
        await h.step(3);
        expect(h.kept.queries - before).toBeGreaterThan(0);
        expect(ghosts(c.app)).not.toContain('near');
    });

    it('asks again when an entity loses the component its place came from', async () => {
        const h = await settled(1);
        const c = h.clients[0]!;
        h.place('anchor', 0, c.id);
        const far = h.place('far', 500);
        await h.step(6);
        expect(ghosts(c.app)).not.toContain('far');

        // Placeless entities cannot be culled by distance, so this one becomes
        // relevant to everybody — and no position feed reports it.
        const before = h.kept.queries;
        h.serverApp.world.remove(far, Transform);
        await h.step(3);
        expect(h.kept.queries - before).toBeGreaterThan(0);
        expect(ghosts(c.app)).toContain('far');
    });

    it('asks the two connections an anchor changed hands between, and no others', async () => {
        const h = await settled(3);
        const [a, b, idle] = h.clients as [{ app: App; id: number }, { app: App; id: number }, { app: App; id: number }];
        h.place('a-home', 0, a.id);
        h.place('b-home', 2000, b.id);
        h.place('idle-home', 4000, idle.id);
        const outpost = h.place('outpost', 1000, a.id);
        h.place('by-outpost', 1004);
        await h.step(6);
        expect(ghosts(a.app)).toContain('by-outpost');
        expect(ghosts(b.app)).not.toContain('by-outpost');

        // The index does not move a byte: the same entities stand in the same
        // cells. What changed is which of them each connection looks FROM.
        const recomputes = h.server.visibilityRecomputes;
        const idleSaw = ghosts(idle.app);
        h.give(outpost, b.id);
        await h.step(3);

        expect(h.server.visibilityRecomputes - recomputes).toBe(2);
        expect(ghosts(a.app)).not.toContain('by-outpost');
        expect(ghosts(b.app)).toContain('by-outpost');
        expect(ghosts(idle.app)).toEqual(idleSaw);
    });

    it('asks a connection that has never been answered, and no one else', async () => {
        const h = await settled(1);
        const first = h.clients[0]!;
        h.place('anchor', 0, first.id);
        h.place('near', 5);
        await h.step(6);

        const recomputes = h.server.visibilityRecomputes;
        const late = App.new();
        late.connectCpp(new module.Registry() as unknown as CppRegistry, module, { strict: false });
        late.addPlugin(replicationPlugin);
        opened.push(late);
        const [ta, tb] = MemoryTransport.pair();
        h.server.attachConnection(ta);
        await late.getResource(Net).connect(tb, { interpolationDelayTicks: 0 });
        await late.tick(STEP);
        await h.step(3);

        // The joiner holds no certificate, so it is proved; the settled one is
        // not re-proved because somebody else arrived.
        expect(h.server.visibilityRecomputes - recomputes).toBe(1);
        expect(ghosts(late)).toEqual(['anchor', 'near']);
    });
});

describe('what does not certify a repeat', () => {
    let NetPos: ReturnType<typeof defineComponent<{ x: number; y: number; z: number }>>;
    beforeEach(() => { NetPos = defineComponent('ReusePos', { x: 0, y: 0, z: 0 }, { replicatedFields: ['x', 'y', 'z'] }); });
    const posOf = (world: World, e: Entity) =>
        world.tryGet(e, NetPos) as { x: number; y: number; z: number } | null;

    async function serverWith(connections: number) {
        const serverApp = App.new();
        serverApp.addPlugin(replicationPlugin);
        const server = serverApp.getResource(Net).startServer();
        const clients: { app: App; id: number }[] = [];
        for (let i = 0; i < connections; i++) {
            const app = App.new();
            app.addPlugin(replicationPlugin);
            const [ta, tb] = MemoryTransport.pair();
            const id = server.attachConnection(ta);
            await app.getResource(Net).connect(tb, { interpolationDelayTicks: 0 });
            clients.push({ app, id });
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
        return { serverApp, server, clients, step, place };
    }

    /** A provider whose snapshot identity the test states outright: the subject
     *  is what the SERVER does with a number, not how a grid arrives at one. */
    function stating(generation: number, visible: () => ReadonlySet<Entity>) {
        let queries = 0;
        const provider: InterestProvider = {
            prepare: () => ({ generation, query: () => { queries++; return visible(); } }),
        };
        return { provider, get queries() { return queries; } };
    }

    it('publishes a snapshot identity only from the lane that can keep one', () => {
        const world = App.new().world;
        const view = {
            world, entities: [] as Entity[], entityCount: 0,
            entered: [] as Entity[], left: [] as Entity[], rechecked: [] as Entity[],
        };
        // Behaviour cannot tell these apart while the rebuilt lane reseeds — and
        // so bumps — every sample. The contract is what stops a later cheaper
        // reseed from quietly certifying a function nothing can certify.
        expect(radiusInterestProvider(RADIUS).prepare(view).generation).toBeTypeOf('number');
        expect(radiusInterestProvider(RADIUS, { position: posOf }).prepare(view).generation)
            .toBeUndefined();
    });

    it('keeps an arbitrary position reader on the per-sample query', async () => {
        const h = await serverWith(2);
        for (const c of h.clients) h.place(`anchor${c.id}`, c.id * 500, c.id);
        h.place('near', 3);
        const kept = counting(radiusInterestProvider(RADIUS, { position: posOf }));
        h.server.setInterestProvider(kept.provider);
        await h.step(4);

        // Nothing can know when an arbitrary function would answer differently,
        // so a stationary sample buys nothing here — and must not pretend to.
        const before = kept.queries;
        await h.step(2);
        expect(kept.queries - before).toBe(4);
    });

    it('does not read one provider\'s generation as another\'s', async () => {
        const h = await serverWith(1);
        const c = h.clients[0]!;
        const near = h.place('near', 0);
        const far = h.place('far', 900);
        const a = stating(5, () => new Set([near]));
        h.server.setInterestProvider(a.provider);
        await h.step(4);
        expect(ghosts(c.app)).toEqual(['near']);

        // The same number from a different source is a different snapshot.
        const b = stating(5, () => new Set([far]));
        h.server.setInterestProvider(b.provider);
        await h.step(4);
        expect(b.queries).toBeGreaterThan(0);
        expect(ghosts(c.app)).toEqual(['far']);
    });

    it('leaves nothing reusable behind when the initial send is refused', async () => {
        const h = await serverWith(1);
        const survivor = h.clients[0]!;
        const near = h.place('near', 0);
        const source = stating(7, () => new Set([near]));
        h.server.setInterestProvider(source.provider);
        await h.step(4);
        const settled = h.server.visibilityRecomputes;

        const [ta, tb] = MemoryTransport.pair();
        const app = App.new();
        app.addPlugin(replicationPlugin);
        // Refuses the initial state and nothing else, so the handshake still
        // completes: a connection that never heard about the world is not one.
        const send = ta.send.bind(ta);
        (ta as unknown as { send(d: string | ArrayBuffer): void }).send = (d) => {
            if (typeof d === 'string' && d.includes('repl:spawn')) throw new Error('refused');
            send(d);
        };
        h.server.attachConnection(ta);
        await app.getResource(Net).connect(tb, { interpolationDelayTicks: 0 }).catch(() => {});
        await h.step(3);

        // The corpse holds no view and forces no one else to be re-proved: the
        // stamp died with the connection rather than outliving it in a Map.
        expect(h.server.viewerLinks).toBe(1);
        expect(h.server.visibilityRecomputes - settled).toBe(0);
        expect(ghosts(survivor.app)).toEqual(['near']);
    });
});
