// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Spawn tracks: an instance while the playhead is inside a clip, taken away when it leaves, one that arrives
 *        after its clip ended thrown away, every one gone when the player stops; once prepared, made on the frame its
 *        clip starts; saved and loaded as written.
 */
import { describe, it, expect, vi } from 'vitest';
import { TimelineSpawns, spawnClipActive, type PreparedTimelineSpawn, type TimelineSpawner } from '../src/timeline/timelineSpawns';
import { reservePromise } from '../src/util/reservePromise';
import { WrapMode, TrackType, type TimelineAsset, type SpawnTrack } from '../src/timeline/TimelineTypes';
import { parseTimelineAsset } from '../src/timeline/TimelineLoader';
import { serializeTimelineToJson } from '../src/timeline/TimelineSerializer';
import type { Entity } from '../src/types';
import type { PreparedPrefab } from '../src/prefab/preparedPrefab';

const asset = (clips: SpawnTrack['clips'], childPath = ''): TimelineAsset => ({
    version: '1.3', type: 'timeline', duration: 10, wrapMode: WrapMode.Once,
    tracks: [{ type: TrackType.Spawn, name: '', childPath, clips }],
});
const player = 1 as Entity;

/** A spawner that makes numbered entities, either at once or when told to. */
function fakeSpawner(deferred = false) {
    let next = 100;
    const alive = new Set<Entity>();
    const made: { prefab: string; parent: Entity | null; name: string }[] = [];
    const waiting: (() => void)[] = [];
    const prepared: string[] = [];
    let released = 0;
    const spawner: TimelineSpawner = {
        spawn: (prefab, parent, name) => new Promise((resolve) => {
            const go = () => { const e = next++ as Entity; alive.add(e); made.push({ prefab, parent, name }); resolve(e); };
            if (deferred) waiting.push(go); else go();
        }),
        despawn: (e) => { alive.delete(e); },
        prepare: async (prefab) => { prepared.push(prefab); return { release: () => { released++; } }; },
    };
    return { spawner, alive, made, waiting, prepared, released: () => released };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('spawn tracks', () => {
    const clip = { start: 1, duration: 2, prefab: 'dragon.esprefab', name: 'Dragon' };

    it('is there only while the playhead is inside its clip', () => {
        expect(spawnClipActive(clip, 0.9)).toBe(false);
        expect(spawnClipActive(clip, 1)).toBe(true);
        expect(spawnClipActive(clip, 3)).toBe(false);
    });

    it('makes the prefab under the track’s entity on entering the clip and takes it away on leaving', async () => {
        const f = fakeSpawner();
        const spawns = new TimelineSpawns();
        const resolve = (p: string) => (p === 'Lair' ? (7 as Entity) : p === '' ? player : null);
        spawns.sync(player, asset([clip], 'Lair'), 0.5, f.spawner, resolve);
        await flush();
        expect(f.alive.size).toBe(0);
        expect(f.prepared).toEqual(['dragon.esprefab']);
        spawns.sync(player, asset([clip], 'Lair'), 1.5, f.spawner, resolve);
        await flush();
        expect(f.made).toEqual([{ prefab: 'dragon.esprefab', parent: 7, name: 'Dragon' }]);
        expect(spawns.instancesOf(player)).toHaveLength(1);
        // Frame after frame inside: still the one.
        spawns.sync(player, asset([clip], 'Lair'), 2, f.spawner, resolve);
        await flush();
        expect(f.made).toHaveLength(1);
        spawns.sync(player, asset([clip], 'Lair'), 3.5, f.spawner, resolve);
        expect(f.alive.size).toBe(0);
        // Back inside (a loop, a scrub): a new one.
        spawns.sync(player, asset([clip], 'Lair'), 1.2, f.spawner, resolve);
        await flush();
        expect(f.alive.size).toBe(1);
        expect(f.made).toHaveLength(2);
    });

    it('throws away an instance that arrives after the playhead left its clip', async () => {
        const f = fakeSpawner(true);
        const spawns = new TimelineSpawns();
        spawns.sync(player, asset([clip]), 1.5, f.spawner, () => player);
        spawns.sync(player, asset([clip]), 5, f.spawner, () => player);
        f.waiting.forEach((go) => go());
        await flush();
        expect(f.alive.size).toBe(0);
        expect(spawns.instancesOf(player)).toEqual([]);
    });

    it('takes everything away when the player stops, and lets go of what it prepared when the player goes', async () => {
        const f = fakeSpawner();
        const spawns = new TimelineSpawns();
        spawns.sync(player, asset([clip, { ...clip, start: 1.5, name: 'Rider' }]), 2, f.spawner, () => player);
        await flush();
        expect(f.alive.size).toBe(2);
        spawns.stop(player, f.spawner);
        expect(f.alive.size).toBe(0);
        // Kept for when it plays again.
        expect(f.released()).toBe(0);
        spawns.forget(player, f.spawner);
        expect(f.released()).toBe(1);
    });

    it('makes a prepared prefab on the frame its clip starts, preparing before the timeline plays', async () => {
        const made: { parent: Entity | null; name: string }[] = [];
        let released = 0;
        let prepares = 0;
        const spawner: TimelineSpawner = {
            spawn: () => Promise.reject(new Error('the prepared spawn should be used')),
            despawn: () => {},
            prepare: async (prefab) => {
                prepares++;
                return {
                    release: () => { released++; },
                    spawn: (parent, name) => { made.push({ parent, name }); return (200 + made.length) as Entity; },
                };
            },
        };
        const spawns = new TimelineSpawns();
        // Waiting to play: loading starts, nothing made.
        spawns.prepare(player, asset([clip]), spawner);
        spawns.prepare(player, asset([clip]), spawner);
        await flush();
        expect(prepares).toBe(1);
        expect(made).toEqual([]);
        // The clip starts: there at once, before any await.
        spawns.sync(player, asset([clip]), 1, spawner, () => player);
        expect(spawns.instancesOf(player)).toEqual([201 as Entity]);
        expect(made).toEqual([{ parent: player, name: 'Dragon' }]);
        // A timeline that no longer spawns it lets it go.
        spawns.sync(player, asset([]), 1, spawner, () => player);
        expect(released).toBe(1);
        expect(spawns.instancesOf(player)).toEqual([]);
    });

    it.each(['remove clip', 'forget player'])('keeps the new player request when an older preparation lands after %s', async change => {
        const spawns = new TimelineSpawns(), f = fakeSpawner();
        const first = reservePromise<PreparedTimelineSpawn>(), second = reservePromise<PreparedTimelineSpawn>();
        const pending = [first, second];
        const spawner = { ...f.spawner, prepare: vi.fn((_ref: string, _origin?: Entity) => pending.shift()!.promise) };
        const list = asset([clip]);
        spawns.prepare(player, list, spawner);
        if (change === 'remove clip') spawns.prepare(player, asset([]), spawner);
        else spawns.forget(player, spawner);
        const current = spawns.prepare(player, list, spawner);
        const old = { release: vi.fn() }, fresh = { release: vi.fn() };
        first.resolve(old);
        await flush();
        expect(old.release).toHaveBeenCalledOnce();
        expect(current.get(clip.prefab)).toBeNull();
        second.resolve(fresh);
        await flush();
        expect(spawner.prepare.mock.calls).toEqual([[clip.prefab, player], [clip.prefab, player]]);
        expect(current.get(clip.prefab)).toBe(fresh);
        spawns.forget(player, spawner);
        expect(fresh.release).toHaveBeenCalledOnce();
    });

    it('switches a pending code spawn to the published recipe and recovers a missing clip on refresh', async () => {
        const f = fakeSpawner(true), spawns = new TimelineSpawns(), timeline = asset([clip]);
        const scene = { name: 'Dragon', version: 4, entities: [] };
        const recipe: PreparedPrefab = { ref: clip.prefab, scene, rootId: 1, missing: [], release: vi.fn() };
        const spawner = { ...f.spawner, spawnPrepared: vi.fn(() => 0 as Entity) };
        const missing = new Map<string, PreparedPrefab>(), ready = new Map([[clip.prefab, recipe]]);
        spawns.sync(player, timeline, 1, spawner, () => player);
        spawns.sync(player, timeline, 1, spawner, () => player, missing);
        f.waiting.forEach(go => go());
        await flush();
        expect(f.alive.size).toBe(0);
        expect(f.released()).toBe(1);
        expect(f.prepared).toEqual([clip.prefab]);
        spawns.sync(player, timeline, 1, spawner, () => player, ready);
        expect(spawner.spawnPrepared).toHaveBeenCalledWith(recipe, player, clip.name, player);
        expect(spawns.instancesOf(player)).toEqual([0]);
        spawns.sync(player, timeline, 1, spawner, () => player, new Map([[clip.prefab, { ...recipe }]]));
        expect(spawner.spawnPrepared).toHaveBeenCalledTimes(1);
        spawns.sync(player, timeline, null, spawner, () => player, ready);
        expect(spawns.instancesOf(player)).toEqual([]);
        expect(recipe.release).not.toHaveBeenCalled();
    });

    it('makes nothing where the track’s entity is not there, nor for a clip with no prefab', async () => {
        const f = fakeSpawner();
        const spawns = new TimelineSpawns();
        spawns.sync(player, asset([clip], 'Missing'), 1.5, f.spawner, () => null);
        spawns.sync(2 as Entity, asset([{ ...clip, prefab: '' }]), 1.5, f.spawner, () => player);
        await flush();
        expect(f.made).toEqual([]);
    });

    it('saves and loads its clips', () => {
        const back = parseTimelineAsset(JSON.parse(serializeTimelineToJson(asset([clip], 'Lair')))).tracks[0] as SpawnTrack;
        expect(back).toMatchObject({ type: 'spawn', childPath: 'Lair', clips: [clip] });
    });
});
