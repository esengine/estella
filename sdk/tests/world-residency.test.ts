// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  world-residency.test.ts — why a cell exists, and what the streamer does
 *        about it. The decision is pure and is held to on its own; the streamer
 *        is held to the moves it issues, against a host that records them.
 */
import { describe, it, expect } from 'vitest';
import {
    desiredResidency, distanceToCell, type WorldCell, type ResidencySource,
} from '../src/residency/cells';
import { WorldStreamer, type WorldStreamHost } from '../src/residency/WorldStreamer';
import type { WorldManifest } from '../src/residency/cells';
import { World } from '../src/ecs/world';
import { Health, applyDamage } from '../src/gameplay/Health';
import { makeEntity, entityIndex, entityGeneration } from '../src/types';

const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

/** A cell covering one grid square of `size` at grid coordinate (x, z). */
function cell(x: number, z: number, size = 100): WorldCell {
    return {
        name: `c_${x}_${z}`, path: `world/c_${x}_${z}.json`, x, z,
        minX: x * size, minZ: z * size, maxX: (x + 1) * size, maxZ: (z + 1) * size,
        entityCount: 1, rootCount: 1,
    };
}

const source = (x: number, z: number, load: number, unload: number): ResidencySource =>
    ({ x, z, loadRadius: load, unloadRadius: unload });

describe('desiredResidency', () => {
    it('asks for the cell a source stands in', () => {
        const d = desiredResidency([cell(0, 0)], [source(50, 50, 10, 20)], new Set());
        expect(d.toLoad).toEqual(['c_0_0']);
        expect(d.target).toEqual(['c_0_0']);
    });

    it('measures to the cell box, so a diagonal neighbour is not a hole', () => {
        // The corner of c_1_1 is at (100,100); a source at (95,95) is 0 away from
        // c_0_0 and 7.07 from c_1_1's corner. Measured to the CENTRES it would be
        // 70.7 and 70.7 — the same for a cell it is inside and one it is not.
        const cells = [cell(0, 0), cell(1, 1)];
        expect(distanceToCell(cells[1], 95, 95)).toBeCloseTo(Math.hypot(5, 5), 6);
        expect(desiredResidency(cells, [source(95, 95, 10, 20)], new Set()).target)
            .toEqual(['c_0_0', 'c_1_1']);
    });

    it('keeps a resident cell inside the band, and drops it past unloadRadius', () => {
        const c = cell(0, 0);
        // 15 past the edge: beyond loadRadius 10, inside unloadRadius 20.
        const inside = desiredResidency([c], [source(115, 50, 10, 20)], new Set(['c_0_0']));
        expect(inside.toUnload).toEqual([]);
        expect(inside.target).toEqual(['c_0_0']);
        // A cell that is NOT resident is not brought in by the band — otherwise
        // the band is just a wider load radius.
        expect(desiredResidency([c], [source(115, 50, 10, 20)], new Set()).target).toEqual([]);
        expect(desiredResidency([c], [source(125, 50, 10, 20)], new Set(['c_0_0'])).toUnload)
            .toEqual(['c_0_0']);
    });

    it('unions the sources — a second one does not overwrite the first', () => {
        const cells = [cell(0, 0), cell(5, 0)];
        const far = source(550, 50, 10, 20);
        const near = source(50, 50, 10, 20);
        // Whichever order they arrive in, both cells are wanted. A fold would
        // answer with whichever was written last.
        expect(desiredResidency(cells, [near, far], new Set()).target).toEqual(['c_0_0', 'c_5_0']);
        expect(desiredResidency(cells, [far, near], new Set()).target).toEqual(['c_0_0', 'c_5_0']);
    });

    it('keeps a cell one source still needs when another has left it', () => {
        const cells = [cell(0, 0)];
        const resident = new Set(['c_0_0']);
        const left = source(9999, 9999, 10, 20);
        const stayed = source(50, 50, 10, 20);
        expect(desiredResidency(cells, [left, stayed], resident).toUnload).toEqual([]);
        // Either order: whichever is written last must not be the whole answer.
        expect(desiredResidency(cells, [stayed, left], resident).toUnload).toEqual([]);
        // …and gives it up only when NO source needs it.
        expect(desiredResidency(cells, [left], resident).toUnload).toEqual(['c_0_0']);
    });

    it('partitions on XZ only — a source overhead still holds the ground', () => {
        // Y is not in the sample at all: a cell is a vertical column, so a source
        // on a tower's roof keeps the floors below it resident.
        const d = desiredResidency([cell(0, 0)], [source(50, 50, 10, 20)], new Set());
        expect(d.target).toEqual(['c_0_0']);
    });
});

function recordingHost() {
    const loaded = new Set<string>();
    const calls: string[] = [];
    const pending: Array<() => void> = [];
    let deferred = false;
    const host: WorldStreamHost = {
        register(config) { calls.push(`register:${config.name}`); },
        loadAdditive(name) {
            calls.push(`load:${name}`);
            const settle = (): void => { loaded.add(name); };
            if (!deferred) { settle(); return Promise.resolve({}); }
            return new Promise((resolve) => pending.push(() => { settle(); resolve({}); }));
        },
        unload(name, options) {
            calls.push(`unload:${name}:${options?.keepPersistent}`);
            const settle = (): void => { loaded.delete(name); };
            if (!deferred) { settle(); return Promise.resolve(); }
            return new Promise((resolve) => pending.push(() => { settle(); resolve(); }));
        },
        isLoaded: (name) => loaded.has(name),
    };
    return {
        host, loaded, calls,
        defer(on: boolean) { deferred = on; },
        settle() { const queued = pending.splice(0); for (const run of queued) run(); },
    };
}

const manifest = (...cells: WorldCell[]): WorldManifest =>
    ({ version: 1, scene: 'main', cellSize: 100, persistentRefs: [], cells });

describe('WorldStreamer', () => {
    it('registers every cell as a scene the game itself never names', async () => {
        const { host, calls } = recordingHost();
        new WorldStreamer(host).loadManifest(manifest(cell(0, 0), cell(1, 0)));
        expect(calls).toEqual(['register:c_0_0', 'register:c_1_0']);
    });

    it('brings a cell in, and takes it out taking everything with it', async () => {
        const { host, calls, loaded } = recordingHost();
        const streamer = new WorldStreamer(host);
        streamer.loadManifest(manifest(cell(0, 0)));

        streamer.update([source(50, 50, 10, 20)]);
        await flush();
        expect(loaded.has('c_0_0')).toBe(true);
        expect(streamer.residencyOf('c_0_0')).toBe('resident');

        streamer.update([source(9999, 9999, 10, 20)]);
        await flush();
        expect(loaded.has('c_0_0')).toBe(false);
        // keepPersistent false: a cell's unload takes what the cell brought, or
        // residency leaves behind exactly what it exists to remove.
        expect(calls).toContain('unload:c_0_0:false');
    });

    it('does not churn a cell a source is breathing across the boundary of', async () => {
        const { host } = recordingHost();
        const streamer = new WorldStreamer(host);
        streamer.loadManifest(manifest(cell(0, 0)));
        // Inside the band the whole time: in at 5 past the edge, back out to 15.
        for (let i = 0; i < 20; i++) {
            streamer.update([source(i % 2 === 0 ? 105 : 115, 50, 10, 20)]);
            await flush();
        }
        const status = streamer.status();
        expect(status.loadCount).toBe(1);
        expect(status.unloadCount).toBe(0);
        expect(status.residentCells).toEqual(['c_0_0']);
    });

    it('asks once while a load is in flight, and finishes what the source undid', async () => {
        const { host, calls, settle, defer } = recordingHost();
        defer(true);
        const streamer = new WorldStreamer(host);
        streamer.loadManifest(manifest(cell(0, 0)));

        streamer.update([source(50, 50, 10, 20)]);
        streamer.update([source(50, 50, 10, 20)]);
        expect(calls.filter((c) => c === 'load:c_0_0')).toHaveLength(1);

        // The source leaves while the load is still in flight. The unload cannot
        // be issued yet — but it must not be forgotten, or the cell stays resident
        // with nothing asking for it.
        streamer.update([source(9999, 9999, 10, 20)]);
        expect(calls.filter((c) => c.startsWith('unload:'))).toHaveLength(0);
        settle();
        await flush();
        settle();
        await flush();
        expect(streamer.residencyOf('c_0_0')).toBe('unloaded');
    });

    it('counts a cell that failed to load as absent, so it can be asked for again', async () => {
        const failing: WorldStreamHost = {
            register() {},
            loadAdditive: () => Promise.reject(new Error('no')),
            unload: () => Promise.resolve(),
            isLoaded: () => false,
        };
        const streamer = new WorldStreamer(failing);
        streamer.loadManifest(manifest(cell(0, 0)));
        streamer.update([source(50, 50, 10, 20)]);
        await flush();
        expect(streamer.residencyOf('c_0_0')).toBe('unloaded');
    });
});

describe('a handle that no longer names its entity', () => {
    it('does not reach the entity holding its slot', () => {
        // What residency makes ordinary: an event in flight carries a handle
        // whose index is live and whose generation is not, and anything keying by
        // index lands the blow on a stranger.
        const world = new World();
        const live = world.spawn();
        world.insert(live, Health, { current: 25, max: 25 });

        const stale = makeEntity(entityIndex(live), entityGeneration(live) + 1);
        expect(entityIndex(stale)).toBe(entityIndex(live));
        expect(stale).not.toBe(live);
        expect(world.valid(stale)).toBe(false);

        applyDamage(world, [{ target: stale, source: live, amount: 25, x: 0, y: 0, z: 0 }]);
        expect(world.get(live, Health).current).toBe(25);

        // …and the live handle still works, so the refusal above is about the
        // generation and not about damage being broken.
        applyDamage(world, [{ target: live, source: live, amount: 10, x: 0, y: 0, z: 0 }]);
        expect(world.get(live, Health).current).toBe(15);
    });
});
