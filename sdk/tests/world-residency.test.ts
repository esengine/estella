// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    world-residency.test.ts
 * @brief   Verify residency decisions, asynchronous ownership and world replacement.
 */
import { describe, it, expect, vi } from 'vitest';
import {
    desiredResidency, distanceToCell, type WorldCell, type ResidencySource,
} from '../src/residency/cells';
import { WorldStreamer, type WorldStreamHost } from '../src/residency/WorldStreamer';
import type { RenderReadiness } from '../src/render/renderReadiness';
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

const source = (
    x: number, z: number, load: number, unload: number, prefetch = load,
): ResidencySource => ({ x, z, loadRadius: load, unloadRadius: unload, prefetchRadius: prefetch });

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

    it('prepares further out than it publishes, and does not publish what it prepared', () => {
        const cells = [cell(0, 0), cell(3, 0)];
        // c_3_0 starts 300 past this source; inside prefetch, outside load.
        const d = desiredResidency(cells, [source(0, 50, 100, 150, 400)], new Set());
        expect(d.prefetch).toEqual(['c_0_0', 'c_3_0']);
        expect(d.target).toEqual(['c_0_0']);
        expect(d.toLoad).toEqual(['c_0_0']);
    });

    it('unions what the sources prepare, the same way it unions what they demand', () => {
        const cells = [cell(0, 0), cell(5, 0)];
        const here = source(50, 50, 10, 20, 60);
        const there = source(550, 50, 10, 20, 60);
        expect(desiredResidency(cells, [here, there], new Set()).prefetch)
            .toEqual(['c_0_0', 'c_5_0']);
        expect(desiredResidency(cells, [there, here], new Set()).prefetch)
            .toEqual(['c_0_0', 'c_5_0']);
    });

    it('never prepares less far than it demands, whatever the author wrote', () => {
        // The wider of the two is what preparation uses. OUTSIDE the cell on
        // purpose: a source standing in one is zero away, and zero is within
        // every radius including the one under test.
        const d = desiredResidency([cell(0, 0)], [source(150, 50, 100, 150, 0)], new Set());
        expect(d.target).toEqual(['c_0_0']);
        expect(d.prefetch).toEqual(['c_0_0']);
    });

    it('publishes the nearest demanded cell first', () => {
        const cells = [cell(3, 0), cell(1, 0), cell(2, 0)];
        // Standing left of all three: c_1_0 is nearest, c_3_0 furthest, and the
        // manifest deliberately lists them out of order.
        const d = desiredResidency(cells, [source(0, 300, 5000, 6000)], new Set());
        expect(d.toLoad).toEqual(['c_1_0', 'c_2_0', 'c_3_0']);
    });

    it('partitions on XZ only — a source overhead still holds the ground', () => {
        // Y is not in the sample at all: a cell is a vertical column, so a source
        // on a tower's roof keeps the floors below it resident.
        const d = desiredResidency([cell(0, 0)], [source(50, 50, 10, 20)], new Set());
        expect(d.target).toEqual(['c_0_0']);
    });
});

/**
 * A host with a renderer that always readies. `readiness` steers what the
 * readying answers, so a criterion can put a cell in front of every outcome the
 * obligation has — a claim, a debt, and no renderer at all.
 */
function recordingHost(readiness?: () => RenderReadiness) {
    const loaded = new Set<string>();
    const readied = new Set<string>();
    const calls: string[] = [];
    const pending: Array<() => void> = [];
    let deferred = false;
    const host: WorldStreamHost = {
        register(config) { calls.push(`register:${config.name}`); },
        prepare(name) {
            calls.push(`prepare:${name}`);
            const settle = (): void => { readied.add(name); };
            if (!deferred) { settle(); return Promise.resolve(); }
            return new Promise((resolve) => pending.push(() => { settle(); resolve(); }));
        },
        ...(readiness ? {
            readyRenderPrograms(name: string): Promise<RenderReadiness> {
                calls.push(`ready:${name}`);
                return Promise.resolve(readiness());
            },
        } : {}),
        discardPrepared(name) {
            calls.push(`discard:${name}`);
            // Two receipts per readied cell, so "gave them back" is a number and
            // not the absence of a complaint.
            return readied.delete(name) ? 2 : 0;
        },
        loadAdditive(name) {
            calls.push(`load:${name}`);
            const settle = (): void => { readied.delete(name); loaded.add(name); };
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
        host, loaded, readied, calls,
        defer(on: boolean) { deferred = on; },
        settle() { const queued = pending.splice(0); for (const run of queued) run(); },
    };
}

const manifest = (...cells: WorldCell[]): WorldManifest =>
    ({ version: 1, scene: 'main', cellSize: 100, persistentRefs: [], cells });

describe('WorldStreamer', () => {
    // `prepared` means every obligation publication has is satisfied — not that
    // the assets arrived. A cell whose programs are not ready is one whose first
    // visible frame pays for them, which is the frame a player is looking at.
    describe('the render-program obligation gates prepared', () => {
        const claim: RenderReadiness =
            { applicable: true, stamp: { digestLo: 7, digestHi: 0, programEpoch: 3 } };
        // Speculated, never demanded: the cell stays where preparation leaves it
        // instead of being published the instant it is ready, which is what makes
        // `prepared` observable at all.
        const nearby = () => source(250, 50, 10, 20, 200);

        it('a cell with a valid claim is prepared', async () => {
            const { host } = recordingHost(() => claim);
            const s = new WorldStreamer(host);
            s.loadManifest(manifest(cell(0, 0)));
            s.update([nearby()]);
            await flush();
            expect(s.residencyOf('c_0_0')).toBe('prepared');
            expect(s.renderReadinessOf('c_0_0'))
                .toEqual({ digestLo: 7, digestHi: 0, programEpoch: 3 });
        });

        it('a cell whose readying made NO claim is not prepared, whatever its assets did',
           async () => {
            const { host, readied } = recordingHost(() => ({ applicable: true, stamp: null }));
            const s = new WorldStreamer(host);
            s.loadManifest(manifest(cell(0, 0)));
            s.update([nearby()]);
            await flush();
            // The assets are in — this is precisely the state the old contract
            // called prepared, and publishing from it is the defect.
            expect(readied.has('c_0_0')).toBe(true);
            expect(s.residencyOf('c_0_0')).not.toBe('prepared');
            expect(s.residencyOf('c_0_0')).toBe('preparing');
        });

        // The phase prefetch exists to hide: unnamed, it was 6 ms of preparation
        // nothing could account for. What it cost is the work, not the wait — a
        // promise nobody settles still readied.
        it('names what the readying cost, as the work rather than the wait', async () => {
            let clock = 0;
            const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
            try {
                const base = recordingHost(() => claim);
                const host: WorldStreamHost = {
                    ...base.host,
                    readyRenderPrograms() {
                        clock += 7;
                        return new Promise<RenderReadiness>(() => { /* never settles */ });
                    },
                };
                const s = new WorldStreamer(host);
                s.loadManifest(manifest(cell(0, 0)));
                s.update([nearby()]);
                await flush();
                // Still owed — the claim never came back — and the cost is named.
                expect(s.residencyOf('c_0_0')).toBe('preparing');
                expect(s.delivery()['c_0_0']?.phases.readying).toBeCloseTo(7, 6);
            } finally {
                now.mockRestore();
            }
        });

        // No renderer is no obligation, so there is no phase — an absent cost and
        // a zero one are the same only if nothing was ever owed.
        it('names no readying where there was no renderer to ready', async () => {
            const { host } = recordingHost();
            const s = new WorldStreamer(host);
            s.loadManifest(manifest(cell(0, 0)));
            s.update([nearby()]);
            await flush();
            expect(s.residencyOf('c_0_0')).toBe('prepared');
            expect(s.delivery()['c_0_0']?.phases.readying).toBeUndefined();
        });

        it('an unpaid claim is a debt the next progression retries', async () => {
            let answer: RenderReadiness = { applicable: true, stamp: null };
            const { host, calls } = recordingHost(() => answer);
            const s = new WorldStreamer(host);
            s.loadManifest(manifest(cell(0, 0)));
            s.update([nearby()]);
            await flush();
            expect(s.residencyOf('c_0_0')).toBe('preparing');

            // The device settled, or whatever refused the claim stopped. The
            // preparation must continue rather than start over.
            answer = claim;
            s.update([nearby()]);
            await flush();
            expect(s.residencyOf('c_0_0')).toBe('prepared');
            expect(calls.filter((c) => c === 'prepare:c_0_0')).toHaveLength(1);
            expect(calls.filter((c) => c === 'ready:c_0_0')).toHaveLength(2);
        });

        it('a readying that throws leaves the debt, not a prepared cell', async () => {
            const { host } = recordingHost(() => { throw new Error('device went away'); });
            const s = new WorldStreamer(host);
            s.loadManifest(manifest(cell(0, 0)));
            s.update([nearby()]);
            await flush();
            expect(s.residencyOf('c_0_0')).toBe('preparing');
        });

        it('a host with no renderer satisfies the obligation by not having it', async () => {
            const { host, calls } = recordingHost(() => ({ applicable: false }));
            const s = new WorldStreamer(host);
            s.loadManifest(manifest(cell(0, 0)));
            s.update([nearby()]);
            await flush();
            expect(s.residencyOf('c_0_0')).toBe('prepared');
            expect(calls).toContain('ready:c_0_0');
            // Not applicable holds NO claim. An empty stamp would be a claim
            // about nothing, and publication would later re-check it against the
            // live renderer as if a renderer had made it.
            expect(s.renderReadinessOf('c_0_0')).toBeNull();
        });

        it('a host that predates the obligation is not held to it', async () => {
            const { host, calls } = recordingHost();
            const s = new WorldStreamer(host);
            s.loadManifest(manifest(cell(0, 0)));
            s.update([nearby()]);
            await flush();
            expect(s.residencyOf('c_0_0')).toBe('prepared');
            expect(calls.some((c) => c.startsWith('ready:'))).toBe(false);
            expect(s.renderReadinessOf('c_0_0')).toBeNull();
        });
    });

    // Entering prepared with a true claim is not publishing with one that is still
    // true. Requirements change and programs go cold, and each is caught on its
    // own: a gate seeing only "something differs" stays green with one side cut.
    describe('publication re-checks the claim it was prepared with', () => {
        const stamp = (digestLo: number, programEpoch: number): RenderReadiness =>
            ({ applicable: true, stamp: { digestLo, digestHi: 0, programEpoch } });
        /** Speculated first, then demanded: a dwell is what makes a claim age. */
        const far = () => source(250, 50, 10, 20, 200);
        const near = () => source(50, 50, 10, 20, 200);

        async function preparedThenDemanded(answer: () => RenderReadiness) {
            const rec = recordingHost(answer);
            const s = new WorldStreamer(rec.host);
            s.loadManifest(manifest(cell(0, 0)));
            s.update([far()]);
            await flush();
            expect(s.residencyOf('c_0_0')).toBe('prepared');
            return { s, ...rec };
        }

        it('a claim that is still true publishes without readying again', async () => {
            let answer = stamp(7, 3);
            const { s, calls } = await preparedThenDemanded(() => answer);
            const readiedAtPrepare = calls.filter((c) => c === 'ready:c_0_0').length;

            s.update([near()]);
            await flush();
            expect(s.residencyOf('c_0_0')).toBe('resident');
            // One revalidation, and it found nothing to do: the derivation is the
            // cost of asking, and it compiled nothing because nothing changed.
            expect(calls.filter((c) => c === 'ready:c_0_0'))
                .toHaveLength(readiedAtPrepare + 1);
            expect(s.renderReadinessOf('c_0_0'))
                .toEqual({ digestLo: 7, digestHi: 0, programEpoch: 3 });
            // Nothing was restamped, which is what "the claim held" means.
            expect(s.restampsOf('c_0_0')).toBe(0);
        });

        it('a requirement that changed during the dwell is re-readied before publishing',
           async () => {
            let answer = stamp(7, 3);
            const { s } = await preparedThenDemanded(() => answer);
            // Same epoch: only WHAT is needed moved. An environment map arriving
            // flips a variant without any program going cold.
            answer = stamp(99, 3);

            s.update([near()]);
            await flush();
            expect(s.residencyOf('c_0_0')).toBe('resident');
            expect(s.renderReadinessOf('c_0_0'))
                .toEqual({ digestLo: 99, digestHi: 0, programEpoch: 3 });
            // The DIGEST half caught it: a comparison blind to requirements
            // would have published on the claim it was prepared with.
            expect(s.restampsOf('c_0_0')).toBe(1);
        });

        it('a program cache emptied during the dwell is re-readied before publishing',
           async () => {
            let answer = stamp(7, 3);
            const { s } = await preparedThenDemanded(() => answer);
            // Same digest: the content needs exactly what it needed, and the
            // programs that covered it are gone. This is the device-loss shape.
            answer = stamp(7, 8);

            s.update([near()]);
            await flush();
            expect(s.residencyOf('c_0_0')).toBe('resident');
            expect(s.renderReadinessOf('c_0_0'))
                .toEqual({ digestLo: 7, digestHi: 0, programEpoch: 8 });
            // The EPOCH half caught it, independently of the digest one.
            expect(s.restampsOf('c_0_0')).toBe(1);
        });

        it('a re-readying that makes no claim blocks publication, and stays owed',
           async () => {
            let answer = stamp(7, 3);
            const { s, loaded } = await preparedThenDemanded(() => answer);
            // The device went away again mid-readying: claimValid = 0.
            answer = { applicable: true, stamp: null };

            s.update([near()]);
            await flush();
            expect(loaded.has('c_0_0')).toBe(false);
            // Not sent backwards: it satisfied everything preparation asks, and
            // still does. What it cannot do is publish.
            expect(s.residencyOf('c_0_0')).toBe('prepared');

            answer = stamp(7, 9);
            s.update([near()]);
            await flush();
            expect(s.residencyOf('c_0_0')).toBe('resident');
            expect(s.renderReadinessOf('c_0_0'))
                .toEqual({ digestLo: 7, digestHi: 0, programEpoch: 9 });
        });

        it('a re-readying that throws blocks publication too', async () => {
            let answer: () => RenderReadiness = () => stamp(7, 3);
            const { s, loaded } = await preparedThenDemanded(() => answer());
            answer = () => { throw new Error('device went away'); };

            s.update([near()]);
            await flush();
            expect(loaded.has('c_0_0')).toBe(false);
            expect(s.residencyOf('c_0_0')).toBe('prepared');
        });

        it('a host with no renderer publishes without any of this', async () => {
            const { host, calls } = recordingHost(() => ({ applicable: false }));
            const s = new WorldStreamer(host);
            s.loadManifest(manifest(cell(0, 0)));
            s.update([far()]);
            await flush();
            const readiedAtPrepare = calls.filter((c) => c === 'ready:c_0_0').length;

            s.update([near()]);
            await flush();
            expect(s.residencyOf('c_0_0')).toBe('resident');
            // Nothing to keep fresh, so publication asks nobody anything.
            expect(calls.filter((c) => c === 'ready:c_0_0')).toHaveLength(readiedAtPrepare);
        });
    });

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

    it('asks once while a preparation is in flight, and drops what the source undid', async () => {
        const { host, calls, settle, defer } = recordingHost();
        defer(true);
        const streamer = new WorldStreamer(host);
        streamer.loadManifest(manifest(cell(0, 0)));

        streamer.update([source(50, 50, 10, 20)]);
        streamer.update([source(50, 50, 10, 20)]);
        expect(calls.filter((c) => c === 'prepare:c_0_0')).toHaveLength(1);

        // The source leaves while the preparation is still in flight. What
        // finishes was begun against a world that has moved, so it is asked again
        // — and the answer now is that nobody wants it.
        streamer.update([source(9999, 9999, 10, 20)]);
        settle();
        await flush();
        expect(calls).toContain('discard:c_0_0');
        expect(calls.filter((c) => c.startsWith('load:'))).toHaveLength(0);
        expect(streamer.residencyOf('c_0_0')).toBe('unloaded');
    });

    it('counts a cell that failed to prepare as absent, so it can be asked for again', async () => {
        const failing: WorldStreamHost = {
            register() {},
            prepare: () => Promise.reject(new Error('no')),
            discardPrepared: () => 0,
            loadAdditive: () => Promise.resolve({}),
            unload: () => Promise.resolve(),
            isLoaded: () => false,
        };
        const streamer = new WorldStreamer(failing);
        streamer.loadManifest(manifest(cell(0, 0)));
        streamer.update([source(50, 50, 10, 20)]);
        await flush();
        expect(streamer.residencyOf('c_0_0')).toBe('unloaded');
    });

    it('readies a speculated cell and does not publish it', async () => {
        const { host, loaded, readied } = recordingHost();
        const streamer = new WorldStreamer(host);
        streamer.loadManifest(manifest(cell(3, 0)));
        // Inside prefetch, outside load: prepared, and nothing in the world.
        streamer.update([source(0, 50, 100, 150, 400)]);
        await flush();
        expect(streamer.residencyOf('c_3_0')).toBe('prepared');
        expect(readied.has('c_3_0')).toBe(true);
        expect(loaded.has('c_3_0')).toBe(false);
        expect(streamer.status().residentCells).toEqual([]);
    });

    it('publishes what it prepared once demand arrives, and calls that a hit', async () => {
        const { host, loaded } = recordingHost();
        const streamer = new WorldStreamer(host);
        streamer.loadManifest(manifest(cell(3, 0)));
        streamer.update([source(0, 50, 100, 150, 400)]);
        await flush();
        streamer.update([source(280, 50, 100, 150, 400)]);
        await flush();
        expect(loaded.has('c_3_0')).toBe(true);
        const status = streamer.status();
        expect(status.prefetchHits).toBe(1);
        expect(status.prefetchMisses).toBe(0);
    });

    it('calls it a miss when demand arrived before anything was ready', async () => {
        const { host } = recordingHost();
        const streamer = new WorldStreamer(host);
        streamer.loadManifest(manifest(cell(0, 0)));
        streamer.update([source(50, 50, 10, 20)]);
        await flush();
        expect(streamer.status().prefetchMisses).toBe(1);
        expect(streamer.status().prefetchHits).toBe(0);
    });

    it('calls a preparation still in flight a miss, however it ends', async () => {
        // Rules out reading a hit as "prepared by the time we published it",
        // which is true of every cell that loads. This speculation had not
        // landed when the place was wanted, so it bought nothing.
        const { host, settle, defer } = recordingHost();
        defer(true);
        const streamer = new WorldStreamer(host);
        streamer.loadManifest(manifest(cell(3, 0)));
        streamer.update([source(0, 50, 100, 150, 400)]);
        expect(streamer.residencyOf('c_3_0')).toBe('preparing');

        streamer.update([source(280, 50, 100, 150, 400)]);
        expect(streamer.status().prefetchMisses).toBe(1);
        expect(streamer.status().prefetchHits).toBe(0);

        // It goes on to publish from that preparation — the move is right and
        // only the CREDIT is refused.
        settle();
        await flush();
        settle();
        await flush();
        expect(streamer.residencyOf('c_3_0')).toBe('resident');
        expect(streamer.status().prefetchHits).toBe(0);
        expect(streamer.delivery()['c_3_0'].outcome).toBe('miss');
    });

    it('counts a preparation as speculative only when nothing had asked yet', async () => {
        const { host } = recordingHost();
        const streamer = new WorldStreamer(host);
        streamer.loadManifest(manifest(cell(0, 0), cell(3, 0)));
        // c_0_0 is demanded outright; c_3_0 is only speculated about.
        streamer.update([source(50, 50, 100, 150, 400)]);
        await flush();
        expect(streamer.status().prepareCount).toBe(2);
        expect(streamer.status().prefetchRequests).toBe(1);
    });

    it('reports a dwell only where readiness actually waited', async () => {
        const { host } = recordingHost();
        const streamer = new WorldStreamer(host);
        streamer.loadManifest(manifest(cell(0, 0), cell(3, 0)));
        // The band is as wide as the speculation, so walking on does not give
        // c_0_0 up and re-speculate about it — which would clear the very
        // verdict this is reading.
        streamer.update([source(50, 50, 100, 400, 400)]);
        await flush();
        streamer.update([source(280, 50, 100, 400, 400)]);
        await flush();
        const delivery = streamer.delivery();
        // c_0_0 was wanted the instant it was heard of; c_3_0 sat ready first.
        expect(delivery['c_0_0'].outcome).toBe('miss');
        expect(delivery['c_0_0'].dwellMs).toBe(0);
        expect(delivery['c_3_0'].outcome).toBe('hit');
        expect(delivery['c_3_0'].dwellMs).toBeGreaterThanOrEqual(0);
        expect(delivery['c_3_0'].publishMs).toBeGreaterThanOrEqual(0);
    });

    it('readies again, at once, a cell it gave up while still speculating about it', async () => {
        // The shape of speculation without a heading: the streamer knows how far
        // a source is, never which way it is going. Hence the authoring rule —
        // keep prefetchRadius inside unloadRadius, or leaving refetches.
        const { host } = recordingHost();
        const streamer = new WorldStreamer(host);
        streamer.loadManifest(manifest(cell(0, 0)));
        streamer.update([source(50, 50, 10, 20, 400)]);
        await flush();
        expect(streamer.residencyOf('c_0_0')).toBe('resident');

        // 25 out: past unloadRadius 20, and far inside prefetchRadius 400.
        streamer.update([source(125, 50, 10, 20, 400)]);
        await flush();
        expect(streamer.status().unloadCount).toBe(1);
        expect(streamer.residencyOf('c_0_0')).toBe('prepared');
        expect(streamer.status().prepareCount).toBe(2);
        // And the delivery that ended does not lend its verdict to the one that
        // has not been asked for: a report reading this row would otherwise
        // count a hit for a cell nobody has demanded since.
        expect(streamer.delivery()['c_0_0'].outcome).toBe('');

        // With the band wider than the speculation, the same departure is final.
        const second = recordingHost();
        const kept = new WorldStreamer(second.host);
        kept.loadManifest(manifest(cell(0, 0)));
        kept.update([source(50, 50, 10, 400, 400)]);
        await flush();
        kept.update([source(125, 50, 10, 400, 400)]);
        await flush();
        expect(kept.residencyOf('c_0_0')).toBe('resident');
    });

    it('throws away what a source turned away from, rather than publishing it', async () => {
        const { host, calls, loaded } = recordingHost();
        const streamer = new WorldStreamer(host);
        streamer.loadManifest(manifest(cell(3, 0)));
        streamer.update([source(0, 50, 100, 150, 400)]);
        await flush();
        expect(streamer.residencyOf('c_3_0')).toBe('prepared');
        streamer.update([source(-9999, 50, 100, 150, 400)]);
        await flush();
        expect(calls).toContain('discard:c_3_0');
        expect(loaded.has('c_3_0')).toBe(false);
        expect(streamer.residencyOf('c_3_0')).toBe('unloaded');
        expect(streamer.status().cancelCount).toBe(1);
        // What it acquired came back with it. A discard that forgot the receipts
        // would leak a cell's worth of assets per turn a player takes.
        expect(streamer.status().cancelledRefs).toBe(2);
    });
});

describe('world residency teardown and replacement', () => {
    it('releases prepared assets when the world is cleared', async () => {
        const h = recordingHost();
        const streamer = new WorldStreamer(h.host);
        streamer.loadManifest(manifest(cell(3, 0)));
        streamer.update([source(0, 50, 100, 150, 400)]);
        await flush();
        expect(h.readied.size).toBe(1);
        await streamer.clear();
        await flush();
        expect(h.readied.size).toBe(0);
        expect(streamer.status().prefetchCells).toEqual([]);
        expect(streamer.residencyOf('c_3_0')).toBe('unloaded');
    });

    it('discards a preparation that finishes after clearing began', async () => {
        const h = recordingHost(); h.defer(true);
        const streamer = new WorldStreamer(h.host);
        streamer.loadManifest(manifest(cell(0, 0)));
        streamer.update([source(50, 50, 10, 20)]);
        const cleared = streamer.clear();
        h.settle(); h.defer(false);
        await cleared; await flush();
        expect(h.readied.size).toBe(0);
        expect(h.loaded.size).toBe(0);
        expect(streamer.residencyOf('c_0_0')).toBe('unloaded');
    });

    it('unloads a resident cell without preparing it again during clear', async () => {
        const h = recordingHost();
        const streamer = new WorldStreamer(h.host);
        streamer.loadManifest(manifest(cell(0, 0)));
        streamer.update([source(50, 50, 10, 20, 400)]);
        await flush();
        expect(h.loaded.size).toBe(1);
        await streamer.clear(); await flush();
        expect(h.loaded.size).toBe(0);
        expect(h.readied.size).toBe(0);
        expect(streamer.status().prepareCount).toBe(1);
    });

    it('does not publish after demand disappears during the final readiness check', async () => {
        const claim: RenderReadiness = { applicable: true, stamp: { digestLo: 7, digestHi: 0, programEpoch: 3 } };
        const h = recordingHost();
        let checks = 0, finish!: (value: RenderReadiness) => void;
        h.host.readyRenderPrograms = () => ++checks === 1 ? Promise.resolve(claim)
            : new Promise(resolve => { finish = resolve; });
        const streamer = new WorldStreamer(h.host);
        streamer.loadManifest(manifest(cell(0, 0)));
        streamer.update([source(50, 50, 10, 20)]);
        await flush();
        expect(checks).toBe(2);
        streamer.update([]);
        finish(claim); await flush(); await flush();
        expect(h.calls.filter(call => call.startsWith('load:'))).toEqual([]);
        expect(h.readied.size).toBe(0);
        expect(streamer.residencyOf('c_0_0')).toBe('unloaded');
    });

    it('releases assets whose render-program readiness never became valid', async () => {
        const h = recordingHost(() => ({ applicable: true, stamp: null }));
        const streamer = new WorldStreamer(h.host);
        streamer.loadManifest(manifest(cell(0, 0)));
        streamer.update([source(50, 50, 10, 20)]);
        await flush();
        expect(streamer.residencyOf('c_0_0')).toBe('preparing');
        await streamer.clear(); await flush();
        expect(h.readied.size).toBe(0);
        expect(streamer.residencyOf('c_0_0')).toBe('unloaded');
    });

    it.each(['unclaimed', 'rejected'])('releases %s readiness when the last source leaves', async outcome => {
        const h = recordingHost(() => {
            if (outcome === 'rejected') throw new Error('renderer unavailable');
            return { applicable: true, stamp: null };
        });
        const streamer = new WorldStreamer(h.host);
        await streamer.loadManifest(manifest(cell(0, 0)));
        streamer.update([source(50, 50, 10, 20)]);
        await flush();
        expect(streamer.residencyOf('c_0_0')).toBe('preparing');
        expect(h.readied.size).toBe(1);
        streamer.update([]);
        await flush();
        expect(h.readied.size).toBe(0);
        expect(streamer.residencyOf('c_0_0')).toBe('unloaded');
        expect(h.calls.some(call => call.startsWith('load:'))).toBe(false);
    });

    it('unloads the previous manifest before registering a replacement', async () => {
        const h = recordingHost();
        const streamer = new WorldStreamer(h.host);
        streamer.loadManifest(manifest(cell(0, 0)));
        streamer.update([source(50, 50, 10, 20)]);
        await flush();
        await streamer.loadManifest(manifest(cell(5, 0)));
        expect(h.loaded.size).toBe(0);
        expect(h.calls.indexOf('unload:c_0_0:false')).toBeLessThan(h.calls.indexOf('register:c_5_0'));
        expect(h.calls).toContain('unload:c_0_0:false');
    });

    it('returns old preparation receipts before reusing a cell name', async () => {
        const h = recordingHost(); h.defer(true);
        const streamer = new WorldStreamer(h.host);
        streamer.loadManifest(manifest(cell(0, 0)));
        streamer.update([source(50, 50, 10, 20)]);
        const replacement = streamer.loadManifest(manifest(cell(0, 0)));
        h.settle(); h.defer(false);
        await replacement; await flush();
        expect(h.readied.size).toBe(0);
        expect(h.calls).toContain('discard:c_0_0');
        expect(h.calls.indexOf('discard:c_0_0')).toBeLessThan(h.calls.lastIndexOf('register:c_0_0'));
    });

    it('waits for in-flight publication and its teardown before clear resolves', async () => {
        const h = recordingHost();
        let publish!: () => void;
        const load = h.host.loadAdditive;
        h.host.loadAdditive = name => new Promise(resolve => { publish = () => { void load(name).then(resolve); }; });
        const streamer = new WorldStreamer(h.host);
        streamer.loadManifest(manifest(cell(0, 0)));
        streamer.update([source(50, 50, 10, 20)]);
        await flush();
        expect(streamer.residencyOf('c_0_0')).toBe('publishing');
        let cleared = false;
        const clearing = streamer.clear().then(() => { cleared = true; });
        streamer.update([source(50, 50, 10, 20)]);
        await flush(); expect(cleared).toBe(false);
        publish(); await clearing;
        expect(h.loaded.size).toBe(0);
        expect(h.readied.size).toBe(0);
        expect(streamer.status().loadCount).toBe(1);
        expect(streamer.status().unloadCount).toBe(1);
        streamer.update([source(50, 50, 10, 20)]);
        await flush(); publish(); await flush();
        expect(h.loaded.size).toBe(1);
    });

    it('adopts only the latest manifest requested while old work drains', async () => {
        const h = recordingHost(); h.defer(true);
        const streamer = new WorldStreamer(h.host);
        streamer.loadManifest(manifest(cell(0, 0)));
        streamer.update([source(50, 50, 10, 20)]);
        const first = streamer.loadManifest(manifest(cell(3, 0)));
        const last = streamer.loadManifest(manifest(cell(5, 0)));
        h.settle(); h.defer(false);
        await Promise.all([first, last]);
        expect(h.calls).not.toContain('register:c_3_0');
        expect(streamer.manifest?.cells.map(c => c.name)).toEqual(['c_5_0']);
        expect(h.readied.size).toBe(0);
    });

    it('an explicit clear cancels a pending manifest adoption', async () => {
        const h = recordingHost(); h.defer(true);
        const streamer = new WorldStreamer(h.host);
        streamer.loadManifest(manifest(cell(0, 0)));
        streamer.update([source(50, 50, 10, 20)]);
        const replacement = streamer.loadManifest(manifest(cell(5, 0)));
        const cleared = streamer.clear();
        h.settle(); h.defer(false);
        await Promise.all([replacement, cleared]);
        expect(h.calls).not.toContain('register:c_5_0');
        expect(h.loaded.size).toBe(0);
        expect(h.readied.size).toBe(0);
    });

    it('reports a failed unload without spinning or adopting a replacement over live content', async () => {
        const h = recordingHost();
        const unload = h.host.unload;
        let attempts = 0;
        h.host.unload = () => { attempts++; throw new Error('teardown unavailable'); };
        const streamer = new WorldStreamer(h.host);
        streamer.loadManifest(manifest(cell(0, 0)));
        streamer.update([source(50, 50, 10, 20)]);
        await flush();
        await expect(streamer.loadManifest(manifest(cell(5, 0)))).rejects.toThrow('c_0_0');
        expect(attempts).toBe(1);
        expect(h.calls).not.toContain('register:c_5_0');
        expect(h.loaded.size).toBe(1);
        h.host.unload = unload;
        await streamer.clear();
        expect(h.loaded.size).toBe(0);
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
