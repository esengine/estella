// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The radius provider when it KEEPS its grid.
 *
 * With the canonical Transform reader the index is carried between samples and
 * maintained from two feeds: membership from the server's enter/leave, movement
 * from what the composition says changed. Everything here is about the ways a
 * kept structure can quietly stop matching the world — the per-connection answer
 * only reveals a stale cell when it changes somebody's view, and at a small
 * radius most of the world is nobody's.
 */
import { describe, it, expect, afterEach, beforeAll, beforeEach } from 'vitest';
import { App } from '../src/app/app';
import { clearUserComponents, Name, Transform } from '../src/ecs/component';
import { MemoryTransport } from '../src/net/MemoryTransport';
import { replicationPlugin, Net, Replicated, radiusInterestProvider } from '../src/net/replication';
import type { InterestPoint, InterestProvider, PreparedInterest } from '../src/net/replication/interest';
import type { Entity } from '../src/types';
import type { World } from '../src/ecs/world';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';
import { applyPhysics2DTransforms } from '../src/physics/PhysicsSystem';
import type { PhysicsWasmModule } from '../src/physics/PhysicsModuleLoader';

const STEP = 1 / 60;
const RADIUS = 20;

/** The same fact the default reader reads, spelled out — a provider given this
 *  is snapshot-only, which is what makes it an independent oracle. */
const canonical = (world: World, e: Entity): InterestPoint | null => {
    if (!world.has(e, Transform)) return null;
    const t = world.tryGet(e, Transform) as { worldPosition: { x: number; y: number; z: number } } | null;
    return t ? { x: t.worldPosition.x, y: t.worldPosition.y, z: t.worldPosition.z } : null;
};

describe.skipIf(!HAS_WASM)('a radius provider that keeps its grid', () => {
    let module: ESEngineModule;
    beforeAll(async () => { module = await loadWasmModule(); });
    // Change tracking is the ENGINE's, one flag for the module every world in
    // this file shares — so a provider left installed by one test would report
    // into the next one's.
    const opened: App[] = [];
    beforeEach(() => { clearUserComponents(); });
    afterEach(() => {
        for (const app of opened.splice(0)) {
            app.world.setTransformChangeTracking(false);
            app.world.disconnectCpp();
        }
    });

    async function serverWith(connections: number) {
        const serverApp = App.new();
        serverApp.connectCpp(new module.Registry() as unknown as CppRegistry, module);
        serverApp.addPlugin(replicationPlugin);
        opened.push(serverApp);
        const server = serverApp.getResource(Net).startServer();
        const clients: { app: App; id: number }[] = [];
        for (let i = 0; i < connections; i++) {
            const app = App.new();
            app.connectCpp(new module.Registry() as unknown as CppRegistry, module);
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
        const place = (name: string, x: number, owner = -1, y = 0): Entity => {
            const e = serverApp.world.spawn(name);
            serverApp.world.insert(e, Replicated, { owner });
            serverApp.world.insert(e, Transform, { position: { x, y, z: 0 } });
            return e;
        };
        const move = (e: Entity, x: number, y = 0) => {
            serverApp.world.update(e, Transform, (t) => {
                const p = (t as { position: { x: number; y: number } }).position;
                p.x = x; p.y = y;
            });
        };
        return { serverApp, server, clients, step, place, move };
    }

    const ghosts = (app: App): string[] =>
        app.world.getEntitiesWithComponents([Replicated])
            .map((e) => (app.world.tryGet(e, Name) as { value: string } | null)?.value ?? '')
            .sort();

    /**
     * The provider the server drives, with the snapshot it last handed back kept
     * so the KEPT state can be asked questions. Preparing it again here would
     * reseed it, and the oracle would be comparing two fresh builds.
     */
    function watched(inner: InterestProvider) {
        let last: PreparedInterest | null = null;
        const provider: InterestProvider = {
            prepare: (view) => { last = inner.prepare(view); return last; },
            dispose: () => inner.dispose?.(),
        };
        return { provider, prepared: () => last };
    }

    /**
     * The highest-value oracle: what the KEPT index answers against what a
     * freshly built one would, asked for every entity as the anchor rather than
     * for the connections that happen to exist — a stale cell reaches those only
     * if it changes somebody's view.
     */
    function agreesWithARebuild(serverApp: App, kept: PreparedInterest | null): void {
        expect(kept, 'the server never prepared the provider').not.toBeNull();
        const world = serverApp.world;
        const all = world.getEntitiesWithComponents([Replicated]);
        const fresh = radiusInterestProvider(RADIUS, { position: canonical }).prepare({
            world, entities: all, entityCount: all.length,
        });
        for (const anchor of all) {
            const a = kept!.query({ connectionId: 0, owned: [anchor] });
            const b = fresh.query({ connectionId: 0, owned: [anchor] });
            const seen = a === 'all' ? 'all' : [...a].sort().join(',');
            const want = b === 'all' ? 'all' : [...b].sort().join(',');
            expect(seen, `anchor ${anchor}`).toBe(want);
        }
    }

    /** Every canonical position read, counted where the reader takes it. */
    function countsReads(world: World) {
        const original = world.tryGet.bind(world);
        let reads = 0;
        (world as unknown as { tryGet: typeof world.tryGet }).tryGet = ((e: Entity, c: unknown) => {
            if (c === Transform) reads++;
            return original(e, c as never);
        }) as typeof world.tryGet;
        return { get count() { return reads; }, reset() { reads = 0; } };
    }

    it('a spawn at the origin enters the index, though nothing composed changed', async () => {
        const h = await serverWith(1);
        const kept = watched(radiusInterestProvider(RADIUS));
        h.server.setInterestProvider(kept.provider);
        h.place('anchor', 0, h.clients[0]!.id);
        await h.step(4);

        // Its composed output equals what its fields already held, so the change
        // feed never mentions it. Membership is the other feed for exactly this.
        h.place('origin', 0);
        await h.step(4);
        expect(ghosts(h.clients[0]!.app)).toContain('origin');
        agreesWithARebuild(h.serverApp, kept.prepared());
    });

    it('a despawn leaves the index', async () => {
        const h = await serverWith(1);
        const kept = watched(radiusInterestProvider(RADIUS));
        h.server.setInterestProvider(kept.provider);
        h.place('anchor', 0, h.clients[0]!.id);
        const near = h.place('near', 5);
        await h.step(4);
        expect(ghosts(h.clients[0]!.app)).toContain('near');

        h.serverApp.world.despawn(near);
        await h.step(4);
        expect(ghosts(h.clients[0]!.app)).not.toContain('near');
        agreesWithARebuild(h.serverApp, kept.prepared());
    });

    it('added and removed inside one sample leaves nothing behind', async () => {
        const h = await serverWith(1);
        const kept = watched(radiusInterestProvider(RADIUS));
        h.server.setInterestProvider(kept.provider);
        h.place('anchor', 0, h.clients[0]!.id);
        await h.step(4);

        const brief = h.place('brief', 3);
        h.serverApp.world.despawn(brief);
        await h.step(4);
        expect(ghosts(h.clients[0]!.app)).not.toContain('brief');
        agreesWithARebuild(h.serverApp, kept.prepared());
    });

    it('removed and re-added leaves the entity in the index exactly once', async () => {
        const h = await serverWith(1);
        const kept = watched(radiusInterestProvider(RADIUS));
        h.server.setInterestProvider(kept.provider);
        h.place('anchor', 0, h.clients[0]!.id);
        const e = h.place('flicker', 5);
        await h.step(4);

        h.serverApp.world.remove(e, Replicated);
        h.serverApp.world.insert(e, Replicated, { owner: -1 });
        await h.step(4);

        expect(ghosts(h.clients[0]!.app).filter((n) => n === 'flicker')).toHaveLength(1);
        agreesWithARebuild(h.serverApp, kept.prepared());
    });

    it('a parent moving carries its child to another cell', async () => {
        const h = await serverWith(1);
        const kept = watched(radiusInterestProvider(RADIUS));
        h.server.setInterestProvider(kept.provider);
        h.place('anchor', 0, h.clients[0]!.id);
        const parent = h.place('parent', 200);
        const child = h.place('child', 5);
        h.serverApp.world.setParent(child, parent);
        await h.step(4);
        expect(ghosts(h.clients[0]!.app)).not.toContain('child');

        // The child's own transform never changes; only its parent's does.
        h.move(parent, 0);
        await h.step(4);
        expect(ghosts(h.clients[0]!.app)).toContain('child');
        agreesWithARebuild(h.serverApp, kept.prepared());
    });

    it('a reparent moves the subtree', async () => {
        const h = await serverWith(1);
        const kept = watched(radiusInterestProvider(RADIUS));
        h.server.setInterestProvider(kept.provider);
        h.place('anchor', 0, h.clients[0]!.id);
        const far = h.place('far-parent', 400);
        const near = h.place('near-parent', 2);
        const child = h.place('child', 1);
        h.serverApp.world.setParent(child, far);
        await h.step(4);
        expect(ghosts(h.clients[0]!.app)).not.toContain('child');

        h.serverApp.world.setParent(child, near);
        await h.step(4);
        expect(ghosts(h.clients[0]!.app)).toContain('child');
        agreesWithARebuild(h.serverApp, kept.prepared());
    });

    it('an entity that loses its Transform becomes relevant to everyone again', async () => {
        const h = await serverWith(1);
        const kept = watched(radiusInterestProvider(RADIUS));
        h.server.setInterestProvider(kept.provider);
        h.place('anchor', 0, h.clients[0]!.id);
        const far = h.place('far', 500);
        await h.step(4);
        expect(ghosts(h.clients[0]!.app)).not.toContain('far');

        // Losing the component the cached position came FROM is not something
        // that component's change feed reports, so the server names it instead.
        h.serverApp.world.remove(far, Transform);
        await h.step(4);
        expect(ghosts(h.clients[0]!.app)).toContain('far');
        agreesWithARebuild(h.serverApp, kept.prepared());
    });

    it('a physics-driven move reaches the index like any other', async () => {
        const h = await serverWith(1);
        const kept = watched(radiusInterestProvider(RADIUS));
        h.server.setInterestProvider(kept.provider);
        h.place('anchor', 0, h.clients[0]!.id);
        const body = h.place('body', 500);
        await h.step(4);
        expect(ghosts(h.clients[0]!.app)).not.toContain('body');

        // Physics writes the local input and says the composition is stale; it
        // does not author the world fields, so the change feed is what carries it.
        const ptr = 256;
        const buffer = new ArrayBuffer(ptr + 16);
        new Uint32Array(buffer)[ptr >> 2] = body as number;
        new Float32Array(buffer).set([0.05, 0, 0], (ptr >> 2) + 1);
        applyPhysics2DTransforms(h.serverApp, 100, new Set(), {
            _physics_capturePoses: () => {},
            _physics_getInterpolatedCount: () => 1,
            _physics_getInterpolatedTransforms: () => ptr,
            HEAPF32: new Float32Array(buffer),
            HEAPU32: new Uint32Array(buffer),
            HEAPU8: new Uint8Array(buffer),
            _malloc: () => 0,
            _free: () => {},
        } as unknown as PhysicsWasmModule, 1);
        await h.step(4);

        expect(ghosts(h.clients[0]!.app)).toContain('body');
        agreesWithARebuild(h.serverApp, kept.prepared());
    });

    it('a reused entity slot is the new occupant, not the old one', async () => {
        const h = await serverWith(1);
        const kept = watched(radiusInterestProvider(RADIUS));
        h.server.setInterestProvider(kept.provider);
        h.place('anchor', 0, h.clients[0]!.id);
        const gone = h.place('gone', 5);
        await h.step(4);

        h.serverApp.world.despawn(gone);
        await h.step(2);
        // The index may hand this slot back with a new generation; the entity in
        // it is a different one and stands somewhere else.
        h.place('reused', 500);
        await h.step(4);
        expect(ghosts(h.clients[0]!.app)).not.toContain('gone');
        expect(ghosts(h.clients[0]!.app)).not.toContain('reused');
        agreesWithARebuild(h.serverApp, kept.prepared());
    });

    it('reads nothing while nothing moves', async () => {
        const h = await serverWith(1);
        const kept = watched(radiusInterestProvider(RADIUS));
        h.server.setInterestProvider(kept.provider);
        h.place('anchor', 0, h.clients[0]!.id);
        for (let i = 0; i < 8; i++) h.place(`e${i}`, i * 3);
        await h.step(8);

        // Seeded and caught up. From here nothing writes a transform, so the
        // index has nothing to ask the world.
        const reads = countsReads(h.serverApp.world);
        await h.step(9);
        const counted = reads.count;
        agreesWithARebuild(h.serverApp, kept.prepared());
        expect(counted).toBe(0);
    });

    it('reads what moved, and the same amount however big the population is', async () => {
        // A threshold would be arbitrary; two populations are not. If the reads
        // followed the population these would differ by twenty-five.
        const sample = async (population: number): Promise<number> => {
            const h = await serverWith(1);
            const kept = watched(radiusInterestProvider(RADIUS));
            h.server.setInterestProvider(kept.provider);
            h.place('anchor', 0, h.clients[0]!.id);
            const movers: Entity[] = [];
            for (let i = 0; i < population; i++) movers.push(h.place(`e${i}`, 100 + i * 3));
            await h.step(8);

            const reads = countsReads(h.serverApp.world);
            h.move(movers[0]!, 5);
            h.move(movers[1]!, 6);
            await h.step(3);
            // Before the oracle, which reads the whole population itself.
            const counted = reads.count;
            agreesWithARebuild(h.serverApp, kept.prepared());
            return counted;
        };
        const small = await sample(24);
        const large = await sample(49);
        expect(large).toBe(small);
        expect(small).toBeLessThan(24);
    });

    it('rebuilds rather than replaying a list longer than the population', async () => {
        // Driven directly: the point is COST, and the server takes the pending set
        // every sample, which is exactly what stops it ever growing that far.
        const h = await serverWith(0);
        const world = h.serverApp.world;
        const all: Entity[] = [];
        for (let i = 0; i < 20; i++) all.push(h.place(`e${i}`, i * 2));
        const provider = radiusInterestProvider(RADIUS);
        const view = (entered: Entity[]) => ({
            world, entities: all, entityCount: all.length,
            entered, left: [] as Entity[], rechecked: [] as Entity[],
        });
        provider.prepare(view([...all]));

        // Three full-population compositions with nobody acknowledging: sixty
        // pending changes against twenty entities.
        for (let pass = 1; pass <= 3; pass++) {
            for (const [i, e] of all.entries()) h.move(e, i * 2 + pass);
            world.ensureTransformsComposed();
        }
        expect(world.compositionChanges()!.overflowed).toBe(true);

        const reads = countsReads(world);
        provider.prepare(view([]));
        // Twenty, not sixty: it read the world instead of replaying the list.
        expect(reads.count).toBe(all.length);
        agreesWithARebuild(h.serverApp, provider.prepare(view([])));
        provider.dispose?.();
    });

    it('an arbitrary position reader stays on the per-sample rebuild', async () => {
        const h = await serverWith(1);
        const kept = watched(radiusInterestProvider(RADIUS, { position: canonical }));
        h.server.setInterestProvider(kept.provider);
        h.place('anchor', 0, h.clients[0]!.id);
        for (let i = 0; i < 6; i++) h.place(`e${i}`, i * 3);
        await h.step(8);

        // The server cannot know when an arbitrary function would answer
        // differently, so it reads all of them every sample — and never asks the
        // composition to track anything on this path.
        h.serverApp.world.setTransformChangeTracking(false);
        const reads = countsReads(h.serverApp.world);
        await h.step(3);
        expect(reads.count).toBeGreaterThanOrEqual(7);
        expect(h.serverApp.world.compositionChanges()!.changed.length).toBe(0);
    });

    it('replacing the provider releases what it was holding', async () => {
        const h = await serverWith(0);
        const world = h.serverApp.world;
        const anchor = h.place('anchor', 0);
        const provider = radiusInterestProvider(RADIUS);
        provider.prepare({
            world, entities: [anchor], entityCount: 1,
            entered: [anchor], left: [], rechecked: [],
        });
        expect(world.compositionChanges()!.tracking).toBe(true);

        provider.dispose?.();

        // Tracking went with it: nothing accumulates for a consumer that is gone,
        // and the next provider seeds rather than replaying somebody else's set.
        h.move(anchor, 3);
        world.ensureTransformsComposed();
        const pending = world.compositionChanges()!;
        expect(pending.tracking).toBe(false);
        expect(pending.changed.length).toBe(0);
    });
});
