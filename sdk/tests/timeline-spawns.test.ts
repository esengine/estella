// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Spawn tracks: an instance while the playhead is inside a clip, taken away when it leaves, one that arrives
 *        after its clip ended thrown away, every one gone when the player stops; saved and loaded as written.
 */
import { describe, it, expect } from 'vitest';
import { TimelineSpawns, spawnClipActive, type TimelineSpawner } from '../src/timeline/timelineSpawns';
import { WrapMode, TrackType, type TimelineAsset, type SpawnTrack } from '../src/timeline/TimelineTypes';
import { parseTimelineAsset } from '../src/timeline/TimelineLoader';
import { serializeTimelineToJson } from '../src/timeline/TimelineSerializer';
import type { Entity } from '../src/types';

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

    it('takes everything away and lets go of what it prepared when the player stops', async () => {
        const f = fakeSpawner();
        const spawns = new TimelineSpawns();
        spawns.sync(player, asset([clip, { ...clip, start: 1.5, name: 'Rider' }]), 2, f.spawner, () => player);
        await flush();
        expect(f.alive.size).toBe(2);
        spawns.stop(player, f.spawner);
        expect(f.alive.size).toBe(0);
        expect(f.released()).toBe(1);
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
