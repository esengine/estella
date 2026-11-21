// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    timelineSpawns.ts
 * @brief   Spawn tracks: entities a timeline makes from a prefab for as long as the playhead is inside a clip.
 *
 * @details A spawn clip names a prefab and what to call what
 *          it makes; while the playhead is inside the clip an instance exists, under the entity the track names, and
 *          when the playhead leaves it (or the timeline is stopped, or its player goes) the instance is taken away. The
 *          instance is named, so the timeline's other tracks address it by that name like any child: a dragon a cut
 *          scene brings in is animated, moved and filmed by the same tracks as one placed in the scene.
 *
 *          Each frame the instances a player should have are compared with the ones it has, as audio clips are. The
 *          prefabs a timeline spawns are prepared as soon as its player has the timeline, playing or not, and once a
 *          prefab is prepared its instance is made on the spot: it exists on the frame its clip starts, for the tracks
 *          that address it that same frame. A clip that starts
 *          before its prefab is prepared asks for its instance asynchronously instead, and keeps it when it arrives only
 *          if the playhead is still inside the clip.
 */
import { TrackType, type SpawnClip, type TimelineAsset } from './TimelineTypes';
import type { Entity } from '../types';

/** A prefab loaded ahead of its first spawn: held until released, and made on the spot while it is. */
export interface PreparedTimelineSpawn {
    release(): void;
    /** Makes it now under `parent` (null: a root) named `name`; its root, or null where it cannot be made. */
    spawn?(parent: Entity | null, name: string): Entity | null;
}

/** How a spawn track makes and takes away its instances: the game's prefab server, or the editor's preview. */
export interface TimelineSpawner {
    /** Makes `prefab` under `parent` (null: a root) named `name`; its root, or null where it cannot be made. */
    spawn(prefab: string, parent: Entity | null, name: string): Promise<Entity | null>;
    /** Takes an instance away, with everything under it. */
    despawn(entity: Entity): void;
    /** Loads `prefab` and what it uses ahead of its first spawn; what it answers is released when no longer wanted. */
    prepare?(prefab: string): Promise<PreparedTimelineSpawn>;
}

/** Whether `clip` has an instance at track time `time`: from its start up to (not including) its end. */
export const spawnClipActive = (clip: SpawnClip, time: number): boolean =>
    clip.duration > 0 && time >= clip.start && time < clip.start + clip.duration;

interface Instance {
    entity: Entity | null;
    /** Still wanted once it arrives; cleared when the playhead leaves the clip before it does. */
    wanted: boolean;
}

/** The instances of every playing timeline's spawn tracks, by player. */
export class TimelineSpawns {
    private readonly live_ = new Map<Entity, Map<string, Instance>>();
    /** What each player's timeline spawns, loaded or loading: by prefab, null until it lands. */
    private readonly prepared_ = new Map<Entity, { key: string; byPrefab: Map<string, PreparedTimelineSpawn | null> }>();

    /**
     * Brings `player`'s instances in line with `asset` at `time`: each spawn clip the playhead is inside has one, under
     * the entity its track names (`resolve`, null where that is not there: no instance then).
     */
    sync(
        player: Entity, asset: TimelineAsset, time: number, spawner: TimelineSpawner,
        resolve: (childPath: string) => Entity | null,
    ): void {
        let live = this.live_.get(player);
        const ready = this.prepare(player, asset, spawner);
        const want = new Map<string, { clip: SpawnClip; parent: Entity | null }>();
        asset.tracks.forEach((track, ti) => {
            if (track.type !== TrackType.Spawn) return;
            track.clips.forEach((clip, ci) => {
                if (!clip.prefab || !spawnClipActive(clip, time)) return;
                const parent = resolve(track.childPath);
                if (parent == null && track.childPath) return;
                // Keyed by what makes it, so an edit that changes the prefab, the name or the parent makes a new one.
                want.set(`${ti}:${ci}:${clip.prefab}:${clip.name}:${parent ?? ''}`, { clip, parent });
            });
        });
        if (live) {
            for (const [key, inst] of live) {
                if (want.has(key)) continue;
                inst.wanted = false;
                if (inst.entity !== null) spawner.despawn(inst.entity);
                live.delete(key);
            }
        }
        if (want.size === 0) return;
        if (!live) this.live_.set(player, (live = new Map()));
        for (const [key, { clip, parent }] of want) {
            if (live.has(key)) continue;
            const inst: Instance = { entity: null, wanted: true };
            live.set(key, inst);
            // Prepared: made now, for the tracks that address it this frame.
            const now = ready.get(clip.prefab);
            if (now?.spawn) {
                try { inst.entity = now.spawn(parent, clip.name); } catch { inst.entity = null; }
                continue;
            }
            const map = live;
            void spawner.spawn(clip.prefab, parent, clip.name).then((entity) => {
                if (entity === null) return;
                if (!inst.wanted || map.get(key) !== inst) { spawner.despawn(entity); return; }
                inst.entity = entity;
            }, () => { /* a prefab that cannot be made leaves the clip empty */ });
        }
    }

    /** Takes away every instance of `player` (what was prepared for it is kept, for when it plays again). */
    stop(player: Entity, spawner: TimelineSpawner | null): void {
        const live = this.live_.get(player);
        if (!live) return;
        for (const inst of live.values()) {
            inst.wanted = false;
            if (inst.entity !== null) spawner?.despawn(inst.entity);
        }
        this.live_.delete(player);
    }

    /** Takes away every instance of `player` and lets go of what was prepared for it: the player or its timeline went. */
    forget(player: Entity, spawner: TimelineSpawner | null): void {
        this.stop(player, spawner);
        const held = this.prepared_.get(player);
        if (!held) return;
        this.prepared_.delete(player);
        for (const p of held.byPrefab.values()) p?.release();
    }

    /** Forgets every player. */
    stopAll(spawner: TimelineSpawner | null): void {
        for (const player of [...this.live_.keys(), ...this.prepared_.keys()]) this.forget(player, spawner);
    }

    /** The entities `player` has spawned and still has. */
    instancesOf(player: Entity): Entity[] {
        return [...(this.live_.get(player)?.values() ?? [])].flatMap((i) => (i.entity !== null ? [i.entity] : []));
    }

    /**
     * Starts loading what `asset` spawns for `player`, once per set of prefabs (a changed set lets go of the old one);
     * answers what has landed so far. Called every frame a player has its timeline, so loading starts before it plays.
     */
    prepare(player: Entity, asset: TimelineAsset, spawner: TimelineSpawner): ReadonlyMap<string, PreparedTimelineSpawn | null> {
        const prefabs = new Set<string>();
        for (const t of asset.tracks) if (t.type === TrackType.Spawn) for (const c of t.clips) if (c.prefab) prefabs.add(c.prefab);
        const key = [...prefabs].sort().join('\n');
        const had = this.prepared_.get(player);
        if (had && had.key === key) return had.byPrefab;
        const byPrefab = new Map<string, PreparedTimelineSpawn | null>();
        const held = { key, byPrefab };
        this.prepared_.set(player, held);
        // Kept across the change: what the new set still spawns. The rest is let go.
        for (const [prefab, p] of had?.byPrefab ?? []) {
            if (prefabs.has(prefab)) byPrefab.set(prefab, p); else p?.release();
        }
        if (!spawner.prepare) return byPrefab;
        for (const prefab of prefabs) {
            if (byPrefab.has(prefab)) continue;
            byPrefab.set(prefab, null);
            // Lands in whichever set the player has by then (a later set may have kept it), or is let go.
            void spawner.prepare(prefab).then((p) => {
                const now = this.prepared_.get(player)?.byPrefab;
                if (now?.get(prefab) === null) now.set(prefab, p); else p.release();
            }, () => {
                const now = this.prepared_.get(player)?.byPrefab;
                if (now?.get(prefab) === null) now.delete(prefab); // spawned unprepared, then
            });
        }
        return byPrefab;
    }
}
