// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    world-streaming-policy.test.ts
 * @brief   How much a world streams at once and what it does when it falls behind (Unreal's level-streaming budget,
 *          MaxLoadingStreamingCells and BlockOnSlowStreaming), and a cell that arrives over frames without being seen
 *          half arrived.
 */
import { describe, it, expect } from 'vitest';
import { WorldStreamer, DEFAULT_STREAMING_POLICY, type WorldStreamHost } from '../src/residency/WorldStreamer';
import type { WorldCell, WorldManifest, ResidencySource } from '../src/residency/cells';
import { Bakes } from '../src/runtime/bakes';
import { World } from '../src/ecs/world';
import { defineComponent, Disabled } from '../src/ecs/component';
import { createMockModule } from './mocks/wasm';
import { spawnAndLoadEntitiesJob, revealStagedEntities, type SceneData } from '../src/scene/scene';

const flush = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

function cell(x: number, z: number, size = 100): WorldCell {
    return {
        name: `c_${x}_${z}`, path: `world/c_${x}_${z}.json`, x, z,
        minX: x * size, minZ: z * size, maxX: (x + 1) * size, maxZ: (z + 1) * size,
        entityCount: 1, rootCount: 1,
    };
}

const manifest = (...cells: WorldCell[]): WorldManifest =>
    ({ version: 1, scene: 'main', cellSize: 100, persistentRefs: [], cells });

const source = (x: number, z: number, load: number, unload = load * 2, prefetch = load): ResidencySource =>
    ({ x, z, loadRadius: load, unloadRadius: unload, prefetchRadius: prefetch });

/** A host whose every preparation and publication waits for the test to settle it, and that records what it was told. */
function heldHost() {
    const calls: string[] = [];
    const prepares = new Map<string, () => void>();
    const loads = new Map<string, () => void>();
    const loaded = new Set<string>();
    const host: WorldStreamHost = {
        register() {},
        prepare(name) {
            calls.push(`prepare:${name}`);
            return new Promise<void>((resolve) => prepares.set(name, resolve));
        },
        discardPrepared(name) { calls.push(`discard:${name}`); return 0; },
        loadAdditive(name) {
            calls.push(`load:${name}`);
            return new Promise((resolve) => loads.set(name, () => { loaded.add(name); resolve({}); }));
        },
        unload(name, options) {
            calls.push(`unload:${name}:${options?.staggered ? 'staggered' : 'whole'}`);
            loaded.delete(name);
            return Promise.resolve();
        },
        isLoaded: (name) => loaded.has(name),
        rush(name) { calls.push(`rush:${name}`); },
        urge(name, urgent) { calls.push(`urge:${name}:${urgent}`); },
    };
    const settle = (map: Map<string, () => void>, name: string): void => {
        const run = map.get(name);
        if (!run) throw new Error(`nothing pending for ${name}`);
        map.delete(name);
        run();
    };
    return {
        host, calls, prepares, loads, loaded,
        prepared: (name: string) => settle(prepares, name),
        published: (name: string) => settle(loads, name),
    };
}

describe('streaming policy', () => {
    it('defaults to Unreal\'s numbers', () => {
        expect(DEFAULT_STREAMING_POLICY).toEqual({
            maxLoadingCells: 4, maxPublishingCells: 1, slowStreaming: 'wait', slowStreamingRatio: 0.25,
        });
        expect(new WorldStreamer(heldHost().host).policy).toEqual(DEFAULT_STREAMING_POLICY);
    });

    it('prepares at most maxLoadingCells at once, and gives a freed slot to the nearest waiting cell', async () => {
        const h = heldHost();
        const s = new WorldStreamer(h.host);
        // Nothing urgent: an urgent cell does not wait for a slot (below).
        s.setPolicy({ maxLoadingCells: 2, slowStreamingRatio: 0 });
        s.loadManifest(manifest(cell(3, 0), cell(1, 0), cell(2, 0), cell(0, 0)));
        // Left of all four, every one within reach: nearest first.
        s.update([source(-10, 50, 1000)]);
        await flush();
        expect(h.calls.filter((c) => c.startsWith('prepare:'))).toEqual(['prepare:c_0_0', 'prepare:c_1_0']);
        expect(s.status().queuedCells.sort()).toEqual(['c_2_0', 'c_3_0']);

        h.prepared('c_1_0');
        await flush();
        expect(h.calls.filter((c) => c.startsWith('prepare:'))).toEqual(['prepare:c_0_0', 'prepare:c_1_0', 'prepare:c_2_0']);
    });

    it('prepares an urgent cell past the cap', async () => {
        const h = heldHost();
        const s = new WorldStreamer(h.host);
        s.setPolicy({ maxLoadingCells: 1 });
        // c_1_0 is readied first (prefetch, nearer), then the source lands on c_5_0, which becomes urgent.
        s.loadManifest(manifest(cell(1, 0), cell(5, 0)));
        s.update([source(-10, 50, 30, 60, 1000)]);
        await flush();
        expect(h.calls.filter((c) => c.startsWith('prepare:'))).toEqual(['prepare:c_1_0']);
        s.update([source(550, 50, 30, 60, 1000)]);
        await flush();
        expect(h.calls).toContain('prepare:c_5_0');
    });

    it('publishes one cell at a time, and the next when the first is in', async () => {
        const h = heldHost();
        const s = new WorldStreamer(h.host);
        // Far enough that nothing is urgent: 0.25 of 1000 is 250, and both cells start further away.
        s.loadManifest(manifest(cell(4, 0), cell(5, 0)));
        s.update([source(-10, 50, 1000)]);
        await flush();
        h.prepared('c_4_0');
        h.prepared('c_5_0');
        await flush();
        expect(h.calls.filter((c) => c.startsWith('load:'))).toEqual(['load:c_4_0']);
        h.published('c_4_0');
        await flush();
        expect(h.calls.filter((c) => c.startsWith('load:'))).toEqual(['load:c_4_0', 'load:c_5_0']);
    });

    it('calls a cell urgent within slowStreamingRatio of the load radius, and says so to the host', async () => {
        const h = heldHost();
        const s = new WorldStreamer(h.host);
        s.loadManifest(manifest(cell(0, 0), cell(3, 0)));
        // 400 load radius: urgent within 100. c_0_0 holds the source; c_3_0 is 250 away.
        s.update([source(50, 50, 400)]);
        await flush();
        expect(s.status().urgentCells).toEqual(['c_0_0']);
        expect(h.calls).toContain('urge:c_0_0:true');
        expect(h.calls).not.toContain('urge:c_3_0:true');
    });

    it('an urgent cell does not wait behind one that is publishing, and is finished at once', async () => {
        const h = heldHost();
        const s = new WorldStreamer(h.host);
        s.loadManifest(manifest(cell(0, 0), cell(4, 0)));
        s.update([source(-1000, 50, 2000)]);
        await flush();
        h.prepared('c_4_0');
        await flush();
        expect(h.calls).toContain('load:c_4_0');
        // The source jumps onto c_0_0, which is now prepared while c_4_0 still publishes.
        s.update([source(50, 50, 2000)]);
        h.prepared('c_0_0');
        await flush();
        expect(h.calls).toContain('load:c_0_0');
        expect(h.calls).toContain('rush:c_0_0');
    });

    it('under `budget` nothing is finished outside the frame\'s budget', async () => {
        const h = heldHost();
        const s = new WorldStreamer(h.host);
        s.setPolicy({ slowStreaming: 'budget' });
        s.loadManifest(manifest(cell(0, 0)));
        s.update([source(50, 50, 100)]);
        h.prepared('c_0_0');
        await flush();
        expect(h.calls).toContain('load:c_0_0');
        expect(h.calls).toContain('urge:c_0_0:true');
        expect(h.calls.some((c) => c.startsWith('rush:'))).toBe(false);
    });

    it('under `wait` the game is held until every urgent cell is in, and let go after', async () => {
        const h = heldHost();
        const s = new WorldStreamer(h.host);
        const holds: boolean[] = [];
        s.setHoldHandler((held) => holds.push(held));
        s.loadManifest(manifest(cell(0, 0)));
        s.update([source(50, 50, 100)]);
        await flush();
        expect(s.holding).toBe(true);
        expect(holds).toEqual([true]);
        h.prepared('c_0_0');
        await flush();
        h.published('c_0_0');
        await flush();
        expect(s.holding).toBe(false);
        expect(holds).toEqual([true, false]);
        expect(s.status().holdCount).toBe(1);
        expect(h.calls).toContain('urge:c_0_0:false');
    });

    it('under `publish` the game is never held', async () => {
        const h = heldHost();
        const s = new WorldStreamer(h.host);
        const holds: boolean[] = [];
        s.setHoldHandler((held) => holds.push(held));
        s.setPolicy({ slowStreaming: 'publish' });
        s.loadManifest(manifest(cell(0, 0)));
        s.update([source(50, 50, 100)]);
        await flush();
        expect(holds).toEqual([]);
        expect(s.status().urgentCells).toEqual(['c_0_0']);
    });

    it('does not hold for a cell that failed, or it would hold for ever', async () => {
        const h = heldHost();
        h.host.prepare = () => Promise.reject(new Error('gone'));
        const s = new WorldStreamer(h.host);
        s.setHoldHandler(() => {});
        s.loadManifest(manifest(cell(0, 0)));
        s.update([source(50, 50, 100)]);
        await flush();
        s.update([source(50, 50, 100)]);
        await flush();
        expect(s.holding).toBe(false);
    });

    it('takes a cell out over frames, but whole while the world is cleared', async () => {
        const h = heldHost();
        const s = new WorldStreamer(h.host);
        s.setPolicy({ slowStreaming: 'budget' });
        s.loadManifest(manifest(cell(0, 0), cell(5, 0)));
        s.update([source(50, 50, 100)]);
        h.prepared('c_0_0');
        await flush();
        h.published('c_0_0');
        await flush();
        s.update([source(9999, 50, 100)]);
        await flush();
        expect(h.calls).toContain('unload:c_0_0:staggered');

        s.update([source(550, 50, 100)]);
        h.prepared('c_5_0');
        await flush();
        h.published('c_5_0');
        await flush();
        await s.clear();
        expect(h.calls).toContain('unload:c_5_0:whole');
    });

    it('lets a preparation through when the world is cleared', async () => {
        const h = heldHost();
        const s = new WorldStreamer(h.host);
        s.setPolicy({ slowStreaming: 'budget' });
        s.loadManifest(manifest(cell(5, 0)));
        s.update([source(-10, 50, 1000)]);
        await flush();
        expect(s.residencyOf('c_5_0')).toBe('preparing');
        const cleared = s.clear();
        expect(h.calls).toContain('rush:c_5_0');
        h.prepared('c_5_0');
        await cleared;
    });

    it('finishes publication spread over frames when the world is cleared', async () => {
        const h = heldHost();
        const s = new WorldStreamer(h.host);
        s.loadManifest(manifest(cell(0, 0)));
        s.update([source(50, 50, 100)]);
        h.prepared('c_0_0');
        await flush();
        const cleared = s.clear();
        expect(h.calls.filter((c) => c === 'rush:c_0_0').length).toBeGreaterThan(0);
        expect(s.holding).toBe(false);
        h.published('c_0_0');
        await cleared;
    });
});

describe('Bakes hold and finish', () => {
    it('finish runs what is left at once and settles the promise', async () => {
        const bakes = new Bakes();
        let steps = 0;
        const handle = bakes.run('job', (function* () { for (let i = 0; i < 100; i++) { steps++; yield i / 100; } return 'made'; })());
        handle.finish();
        await expect(handle.done).resolves.toBe('made');
        expect(steps).toBe(100);
        expect(bakes.active).toEqual([]);
    });

    it('a turn waits for a frame, and a frame gives at least one', async () => {
        const bakes = new Bakes();
        const order: string[] = [];
        void bakes.turn({}).then(() => order.push('a'));
        void bakes.turn({}).then(() => order.push('b'));
        await Promise.resolve();
        expect(order).toEqual([]);
        expect(bakes.waiting).toBe(2);
        // A frame with no time left still gives one turn, in the order they were asked for.
        let t = 0;
        bakes.budgetMs = 0;
        bakes.step(() => t);
        await Promise.resolve();
        expect(order).toEqual(['a']);
        bakes.step(() => t);
        await Promise.resolve();
        expect(order).toEqual(['a', 'b']);
        t++;
    });

    it('gives as many turns as the frame has time for, by what a turn has been costing', async () => {
        const bakes = new Bakes();
        let t = 0;
        const clock = () => t;
        bakes.budgetMs = 8;
        const owner = {};
        let opened = 0;
        // Each piece of work after a turn takes 3 ms and then asks for the next turn.
        const worker = async (pieces: number) => {
            for (let i = 0; i < pieces; i++) { await bakes.turn(owner); opened++; t += 3; }
        };
        void worker(10);
        // The first frame: nothing known about the cost, one turn and then another as the estimate allows.
        bakes.step(clock);
        for (let i = 0; i < 5; i++) await Promise.resolve();
        const afterFirst = opened;
        expect(afterFirst).toBeGreaterThanOrEqual(1);
        bakes.step(clock);
        for (let i = 0; i < 5; i++) await Promise.resolve();
        // Known to cost 3 ms, an 8 ms frame fits two: never the whole queue.
        expect(opened - afterFirst).toBeLessThanOrEqual(2);
    });

    it('lets an urgent owner, and a released one, through at once', async () => {
        const bakes = new Bakes();
        const urgent = {}, later = {};
        bakes.urge(urgent, true);
        let passed = false;
        await bakes.turn(urgent).then(() => { passed = true; });
        expect(passed).toBe(true);
        let released = false;
        void bakes.turn(later).then(() => { released = true; });
        bakes.release(later);
        await Promise.resolve();
        expect(released).toBe(true);
        let urged = false;
        const other = {};
        void bakes.turn(other).then(() => { urged = true; });
        bakes.urge(other, true);
        await Promise.resolve();
        expect(urged).toBe(true);
        expect(bakes.waiting).toBe(0);
    });

    it('a hold is counted per owner', () => {
        const bakes = new Bakes();
        const a = {}, b = {};
        bakes.hold(a, true);
        bakes.hold(b, true);
        bakes.hold(a, false);
        expect(bakes.holding).toBe(true);
        bakes.hold(b, false);
        expect(bakes.holding).toBe(false);
    });
});

describe('a staged spawn', () => {
    const Tag = defineComponent('StagedTag', { n: 0 });

    function world(): World {
        const mod = createMockModule();
        const w = new World();
        w.connectCpp(mod.getRegistry(), mod);
        return w;
    }

    const data: SceneData = {
        version: 4, name: 'cell',
        entities: [
            { id: 1, name: 'Root', parent: null, children: [2], visible: true, components: [{ type: 'StagedTag', data: { n: 1 } }] },
            { id: 2, name: 'Child', parent: 1, children: [], visible: true, components: [{ type: 'StagedTag', data: { n: 2 } }] },
            { id: 3, name: 'Off', parent: null, children: [], visible: true, components: [{ type: 'Disabled', data: {} }] },
        ],
    } as unknown as SceneData;

    it('yields as it goes, keeps its roots switched off, and switches them on whole', () => {
        const w = world();
        const job = spawnAndLoadEntitiesJob(w, data, undefined, undefined, true);
        let yields = 0;
        let next = job.next();
        while (!next.done) { yields++; next = job.next(); }
        expect(yields).toBeGreaterThan(3);
        const spawn = next.value;
        const root = spawn.entities.get(1)!;
        const off = spawn.entities.get(3)!;
        expect(spawn.hidden).toEqual([root]);
        expect(w.has(root, Disabled)).toBe(true);

        revealStagedEntities(w, spawn);
        expect(w.has(root, Disabled)).toBe(false);
        // What the author switched off stays off.
        expect(w.has(off, Disabled)).toBe(true);
    });

    it('tells Added filters its components arrived when it was switched on', () => {
        const w = world();
        w.enableChangeTracking(Tag);
        const job = spawnAndLoadEntitiesJob(w, data, undefined, undefined, true);
        let next = job.next();
        while (!next.done) next = job.next();
        const spawn = next.value;
        w.advanceTick();
        w.advanceTick();
        const before = w.getWorldTick() - 1;
        expect(w.isAddedSince(spawn.entities.get(2)!, Tag, before)).toBe(false);
        revealStagedEntities(w, spawn);
        expect(w.isAddedSince(spawn.entities.get(2)!, Tag, before)).toBe(true);
    });
});
